/**
 * A slide's date, written out to the precision it is known in.
 *
 * An item known to the year says "1969"; to the day "20 July 1969"; to the
 * minute "20 July 1969, 20:17". A span says both ends, sharing what they
 * share ("1914 – 1918", "16 – 24 July 1969"). As in the layout, an item
 * with a granularity runs to the end of its end's unit, so its end is said
 * as that unit; one without (or to the millisecond) ends at its end, which
 * is not part of it. A year before 1 AD carries its era ("753 BC"), so the
 * panel and the axis agree.
 */

import { toTimeMs } from "../time.js";
import type { Granularity, Item } from "../types.js";

/** How a date is written. */
export interface StoryDateOptions {
  /** A BCP 47 locale; the runtime's by default. */
  readonly locale?: string;
  /** The zone the date is read in. UTC by default, as TimelineJS's dates are. */
  readonly timeZone?: string;
}

const PARTS: Readonly<Record<Granularity, Intl.DateTimeFormatOptions>> = {
  millennium: { year: "numeric" },
  century: { year: "numeric" },
  decade: { year: "numeric" },
  year: { year: "numeric" },
  month: { year: "numeric", month: "long" },
  day: { year: "numeric", month: "long", day: "numeric" },
  hour: { year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" },
  minute: { year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" },
  second: { year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit" },
  millisecond: { year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit", fractionalSecondDigits: 3 },
};

const cache = new Map<string, Intl.DateTimeFormat>();

function format(granularity: Granularity, early: boolean, options: StoryDateOptions): Intl.DateTimeFormat {
  const key = `${granularity}|${String(early)}|${options.locale ?? ""}|${options.timeZone ?? "UTC"}`;
  let formatter = cache.get(key);
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat(options.locale, { ...PARTS[granularity], ...(early ? { era: "short" } : {}), timeZone: options.timeZone ?? "UTC" });
    cache.set(key, formatter);
  }
  return formatter;
}

/** The item's date as a sentence would say it. */
export function storyDateText(item: Pick<Item, "start" | "end" | "granularity">, options: StoryDateOptions = {}): string {
  const granularity = item.granularity ?? "minute";
  const start = toTimeMs(item.start);
  const end = item.end === undefined ? undefined : toTimeMs(item.end);
  const exclusive = item.granularity === undefined || item.granularity === "millisecond";
  const last = end === undefined ? undefined : Math.max(start, exclusive ? end - 1 : end);
  const early = new Date(start).getUTCFullYear() < 1 || (last !== undefined && new Date(last).getUTCFullYear() < 1);
  const formatter = format(granularity, early, options);
  if (last === undefined || formatter.format(start) === formatter.format(last)) return formatter.format(start);
  return formatter.formatRange(start, last);
}
