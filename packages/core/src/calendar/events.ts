/**
 * Calendar events, and the items they become on a timeline or in a week.
 *
 * An event is what an iCal `VEVENT` says: a start, an end, maybe a rule. It
 * becomes one {@link Item} per occurrence, in the range the view asks for —
 * the timeline's windowed data path (`items` as a function) takes a
 * recurring calendar without the element knowing what a rule is.
 *
 * An occurrence keeps its event's length: a timed event the same elapsed
 * time, an all-day event the same number of days on the wall clock (a day
 * across a clock change is 23 or 25 hours, and still one day). A changed
 * occurrence — iCal's `RECURRENCE-ID` — is an event of its own with the
 * series' `id`, and takes the place of the one it changes.
 */

import { DEFAULT_TIME_ZONE } from "../calendar.js";
import { toTimeMs } from "../time.js";
import type { Domain, Item, ItemsSource, TimeInput, TimeMs } from "../types.js";
import { formatWall, instantOf, occurrences, wallOf } from "./rrule.js";
import type { RecurrenceRule } from "./rrule.js";

/** One calendar event, recurring or not. */
export interface CalendarEvent<T = unknown> {
  /** iCal's `UID`. Every occurrence's item id starts with it. */
  readonly id: string;
  readonly title?: string;
  readonly start: TimeInput;
  /** Exclusive. Without it, an instant — or, all day, one day. */
  readonly end?: TimeInput;
  /** Whole days: `start` and `end` are midnights in `timeZone`. */
  readonly allDay?: boolean;
  /** The zone the event is read in: its rule, its days. UTC by default. */
  readonly timeZone?: string;
  readonly rrule?: RecurrenceRule | string;
  readonly rdates?: readonly TimeInput[];
  readonly exdates?: readonly TimeInput[];
  /**
   * This event changes one occurrence of the series with the same `id`: the
   * one that would have started at `recurrenceId`.
   */
  readonly recurrenceId?: TimeInput;
  readonly description?: string;
  readonly location?: string;
  /** The lane its items go in on a timeline. */
  readonly laneId?: string;
  readonly data?: T;
}

/** What an occurrence's item carries. */
export interface OccurrenceData<T = unknown> {
  readonly event: CalendarEvent<T>;
  /** When the series would have started it — iCal's `RECURRENCE-ID`. */
  readonly occurrence: TimeMs;
  readonly allDay: boolean;
}

/** Where to expand. */
export interface ExpandOptions {
  /** Ignored for an event that names its own zone. UTC by default. */
  readonly timeZone?: string;
  /**
   * At most this many occurrences of one event, the first in the range; the
   * rest are left out. 10 000 by default: a rule that repeats every second
   * is 86 400 a day.
   */
  readonly limit?: number;
  /** Called with an event's id when its occurrences in the range were more than `limit`. */
  readonly onLimit?: (eventId: string, limit: number) => void;
}

/** The occurrences of one event an expansion gives at most, by default. */
const OCCURRENCE_LIMIT = 10_000;

const DAY = 86_400_000;

/** An instant as iCal writes it in UTC: `20261030T080000Z`. */
export function utcStamp(t: TimeMs): string {
  return `${formatWall(t)}Z`;
}

/** The id of an occurrence's item: the event's, and the occurrence's start for a recurring one. */
export function occurrenceId(event: CalendarEvent<unknown>, occurrence: TimeMs): string {
  return isRecurring(event) || event.recurrenceId !== undefined ? `${event.id}@${utcStamp(occurrence)}` : event.id;
}

function isRecurring(event: CalendarEvent<unknown>): boolean {
  return event.rrule !== undefined || (event.rdates?.length ?? 0) > 0;
}

/** The end of an occurrence that starts at `start`, keeping the event's length. */
function endOf(event: CalendarEvent<unknown>, start: TimeMs, zone: string): TimeMs {
  const first = toTimeMs(event.start);
  if (event.allDay === true) {
    const days = event.end === undefined ? 1 : Math.max(1, Math.round((wallOf(toTimeMs(event.end), zone) - wallOf(first, zone)) / DAY));
    return instantOf(wallOf(start, zone) + days * DAY, zone);
  }
  return event.end === undefined ? start : start + Math.max(0, toTimeMs(event.end) - first);
}

/**
 * Every occurrence of the events that overlaps `[from, to)`, as items,
 * sorted by start. An instant counts at its start.
 */
export function expandEvents<T>(events: readonly CalendarEvent<T>[], from: TimeInput, to: TimeInput, options: ExpandOptions = {}): Item<OccurrenceData<T>>[] {
  const lo = toTimeMs(from);
  const hi = toTimeMs(to);
  const changed = new Set<string>();
  for (const event of events) {
    if (event.recurrenceId !== undefined) changed.add(`${event.id}\u0000${String(toTimeMs(event.recurrenceId))}`);
  }
  const items: Item<OccurrenceData<T>>[] = [];
  const push = (event: CalendarEvent<T>, start: TimeMs, occurrence: TimeMs, zone: string): void => {
    const end = endOf(event, start, zone);
    if (!(start < hi && (end > lo || (end === start && start >= lo)))) return;
    const item: { -readonly [K in keyof Item<OccurrenceData<T>>]: Item<OccurrenceData<T>>[K] } = {
      id: occurrenceId(event, occurrence),
      start,
      data: { event, occurrence, allDay: event.allDay === true },
    };
    if (end > start || event.allDay === true) item.end = end;
    if (event.title !== undefined) item.label = event.title;
    if (event.laneId !== undefined) item.laneId = event.laneId;
    if (event.allDay === true) item.granularity = "day";
    items.push(item);
  };
  for (const event of events) {
    const zone = event.timeZone ?? options.timeZone ?? DEFAULT_TIME_ZONE;
    const start = toTimeMs(event.start);
    if (event.recurrenceId !== undefined) {
      push(event, start, toTimeMs(event.recurrenceId), zone);
      continue;
    }
    if (!isRecurring(event)) {
      push(event, start, start, zone);
      continue;
    }
    // An occurrence that starts before the range can still reach into it.
    const reach = endOf(event, start, zone) - start + DAY;
    const limit = options.limit ?? OCCURRENCE_LIMIT;
    // One past the limit, to know whether there were more.
    const starts = occurrences(
      { start, timeZone: zone, ...(event.rrule === undefined ? {} : { rule: event.rrule }), ...(event.rdates === undefined ? {} : { rdates: event.rdates }), ...(event.exdates === undefined ? {} : { exdates: event.exdates }) },
      { from: lo - reach, to: hi, limit: limit + 1 },
    );
    if (starts.length > limit) {
      starts.length = limit;
      options.onLimit?.(event.id, limit);
    }
    for (const at of starts) {
      if (!changed.has(`${event.id}\u0000${String(at)}`)) push(event, at, at, zone);
    }
  }
  return items.sort((a, b) => toTimeMs(a.start) - toTimeMs(b.start) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * The events as a timeline's `items`: a function of the domain, so the
 * timeline asks for the window it draws and a rule that repeats forever is
 * only ever expanded as far as the view goes.
 */
export function recurringSource<T>(events: readonly CalendarEvent<T>[], options: ExpandOptions = {}): ItemsSource<OccurrenceData<T>> {
  return (domain: Domain) => Promise.resolve(expandEvents(events, domain[0], domain[1], options));
}
