/**
 * What an item is called when it cannot be seen.
 *
 * A screen reader gets one string per item, and it has to carry what the eye
 * gets from position: when the item happens, and in which lane. The label
 * alone ("Építés") says what, not when — the axis says when, and the axis is
 * hidden from assistive technology because reading every tick would bury the
 * items. So the date range goes into the name, formatted by `Intl` in the
 * host's locale and time zone, and nothing in this file knows a language.
 *
 * Formatting is not free, and a tile entering the view names hundreds of
 * items in one frame. Measured: `formatRange` costs ~13 µs and the zone
 * lookup behind a calendar conversion ~4 µs, while a plain `format` costs
 * 0.4 µs — so a range is two `format`s and a dash, and "is this midnight?" is
 * asked of a 24-hour clock formatter, not of the calendar. A name is also
 * cached on the item object and rebuilt only when the item, the locale, the
 * zone or the lane's label changes; items are the host's immutable records,
 * and a new one is a new key.
 */

import type { ItemSpan } from "./layout.js";
import type { Granularity, Item } from "./types.js";

/** Granularities a reader wants a date for, not a time of day. */
export const DATE_ONLY: ReadonlySet<Granularity> = new Set([
  "day",
  "month",
  "year",
  "decade",
  "century",
  "millennium",
]);

const formatters = new Map<string, Intl.DateTimeFormat>();

function cached(key: string, create: () => Intl.DateTimeFormat): Intl.DateTimeFormat {
  let formatter = formatters.get(key);
  if (formatter === undefined) {
    formatter = create();
    formatters.set(key, formatter);
  }
  return formatter;
}

/** The accessible names' date formatter: medium date, a short time when asked. Shared with `/intl`. */
export function formatterFor(locale: string, timeZone: string, withTime: boolean): Intl.DateTimeFormat {
  return cached(`${locale}\u0000${timeZone}\u0000${String(withTime)}`, () =>
    new Intl.DateTimeFormat(locale, {
      dateStyle: "medium",
      ...(withTime ? { timeStyle: "short" } : {}),
      timeZone,
    }),
  );
}

/** The first instant of year 1 AD: before it a year has no meaning without its era. */
const YEAR_ONE = -62_135_596_800_000;

/** What the accessible names format a date with: `format` of an instant. */
export interface DateFormat {
  format(time: number): string;
}

/**
 * The accessible names' date format: `formatterFor`'s, and before year 1 the same date with its era — "1 Jan 45 BC", not
 * "1 Jan 45", which a reader takes for AD. Shared with `/intl`.
 */
export function dateFormatFor(locale: string, timeZone: string, withTime: boolean): DateFormat {
  const key = `${locale}\u0000${timeZone}\u0000${String(withTime)}\u0000era`;
  let known = eras.get(key);
  if (known === undefined) {
    const ad = formatterFor(locale, timeZone, withTime);
    const bc = new Intl.DateTimeFormat(locale, {
      year: "numeric",
      month: "short",
      day: "numeric",
      era: "short",
      ...(withTime ? { hour: "numeric", minute: "2-digit" } : {}),
      timeZone,
    });
    known = { format: (time) => (time < YEAR_ONE ? bc : ad).format(time) };
    eras.set(key, known);
  }
  return known;
}
const eras = new Map<string, DateFormat>();

/** Whether an instant is a midnight in a zone. Shared with `/intl`. */
export function atMidnight(time: number, timeZone: string): boolean {
  // Every new item's accessible name asks this; in UTC it needs no Intl.
  if (timeZone === "UTC") {
    return time % 86_400_000 === 0;
  }
  const clock = cached(`\u0000clock\u0000${timeZone}`, () =>
    new Intl.DateTimeFormat("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
      timeZone,
    }),
  );
  // Zone offsets are whole seconds, so the milliseconds need no zone.
  return time % 1000 === 0 && clock.format(time) === "00:00:00";
}

/**
 * The date range of an item, as a reader would say it.
 *
 * A time of day is given only when it carries information: an item known to
 * the day, or one whose ends fall on midnights, is a date range. An open
 * interval is a start and a dash; an instant is one date.
 */
export function describeSpan(
  item: Item<unknown>,
  span: ItemSpan,
  locale: string,
  timeZone: string,
): string {
  const start = span.start;
  const hasEnd = item.end !== undefined && !span.open;
  const withTime =
    item.granularity === undefined
      ? !atMidnight(start, timeZone) || (hasEnd && !atMidnight(span.end, timeZone))
      : !DATE_ONLY.has(item.granularity);
  const formatter = dateFormatFor(locale, timeZone, withTime);
  if (span.open) {
    return `${formatter.format(start)} –`;
  }
  return hasEnd && span.end > start
    ? `${formatter.format(start)} – ${formatter.format(span.end)}`
    : formatter.format(start);
}

/**
 * A name, with what it was made from. Compared field by field rather than
 * through a key built of them: a key is a string per item named, kept as
 * long as the item is, and a long pan names every item it passes.
 */
interface CachedName {
  readonly span: ItemSpan;
  readonly laneLabel: string | undefined;
  readonly locale: string;
  readonly timeZone: string;
  readonly name: string;
}

const names = new WeakMap<object, CachedName>();

/** The accessible name of an item: what, when, and in which lane. */
export function describeItem(
  item: Item<unknown>,
  span: ItemSpan,
  laneLabel: string | undefined,
  locale: string,
  timeZone: string,
): string {
  const known = names.get(item);
  if (
    known !== undefined &&
    known.locale === locale &&
    known.timeZone === timeZone &&
    known.laneLabel === laneLabel &&
    (known.span === span || (known.span.start === span.start && known.span.end === span.end && known.span.open === span.open))
  ) {
    return known.name;
  }
  const parts = [item.label ?? item.id, describeSpan(item, span, locale, timeZone)];
  if (laneLabel !== undefined && laneLabel !== "") {
    parts.push(laneLabel);
  }
  const name = parts.join(", ");
  names.set(item, { span, laneLabel, locale, timeZone, name });
  return name;
}

/**
 * A document id for an item's node.
 *
 * `aria-activedescendant` points at an element by id, so the id has to be
 * unique in the document and valid as one. The host's item ids are arbitrary
 * strings; anything outside `[A-Za-z0-9_-]` is escaped, so two different ids
 * can never meet in the same document id.
 */
export function itemDomId(prefix: string, id: string): string {
  return `${prefix}-i-${escapeId(id)}`;
}

function escapeId(id: string): string {
  return id.replace(/[^A-Za-z0-9_-]/g, (char) => `.${char.charCodeAt(0).toString(16)}.`);
}

/**
 * A document id for a cluster's marker. A namespace of its own (`-c-`), so
 * a cluster can never take the id of the item it is named after.
 */
export function clusterDomId(prefix: string, id: string): string {
  return `${prefix}-c-${escapeId(id)}`;
}

/**
 * The accessible name of a cluster: how many, from when to when, and where.
 *
 * "23 items, Jan 3, 2024 – Mar 5, 2024, Releases": the dates are the first
 * and the last member's start — the range they begin in, which is what a
 * reader zooming in will find. Written with the same formatter as an item's
 * name, so a cluster and its members read alike.
 */
export function describeCluster(
  count: number,
  start: number,
  lastStart: number,
  laneLabel: string | undefined,
  locale: string,
  timeZone: string,
): string {
  const withTime = !atMidnight(start, timeZone) || !atMidnight(lastStart, timeZone);
  const formatter = dateFormatFor(locale, timeZone, withTime);
  const from = formatter.format(start);
  const to = formatter.format(lastStart);
  const parts = [`${String(count)} items`, from === to ? from : `${from} – ${to}`];
  if (laneLabel !== undefined && laneLabel !== "") {
    parts.push(laneLabel);
  }
  return parts.join(", ");
}
