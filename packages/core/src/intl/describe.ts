/**
 * Accessible names in the dictionary's words.
 *
 * The core names an item "label, date range, lane" and a cluster "23 items,
 * date range, lane", with an English dash, comma and word. These are the
 * same names with every word, joiner and dash taken from a dictionary — as
 * render hooks, so the core draws them without knowing a language. The
 * dates are the core's own (`Intl`, medium date, a time only where it
 * carries information), so a name reads the same in both.
 *
 * A name is cached on its item, as the core caches its own: a tile entering
 * the view names hundreds of items in a frame.
 */

import { atMidnight, DATE_ONLY, dateFormatFor } from "../a11y.js";
import type { Cluster } from "../cluster.js";
import type { LayoutItem } from "../layout.js";
import type { RenderHooks } from "../render.js";
import { fill } from "../text.js";
import type { Strings } from "./strings.js";

/** What the names are made from. */
export interface DescribeOptions {
  readonly strings: Strings;
  readonly locale?: string;
  readonly timeZone?: string;
  /** Lane names by lane id. */
  readonly lanes?: ReadonlyMap<string, string | undefined>;
}

interface Cached {
  readonly start: number;
  readonly end: number;
  readonly open: boolean;
  readonly options: DescribeOptions;
  readonly name: string;
}

/**
 * `describeItem` and `describeCluster` render hooks speaking the
 * dictionary. Pass them in `hooks`, and the Gantt and resource hooks build
 * on them as on the core's own.
 */
export function describeHooks<T>(options: DescribeOptions): Required<Pick<RenderHooks<T>, "describeItem" | "describeCluster">> {
  const { strings, locale = "en", timeZone = "UTC", lanes } = options;
  const say = (key: keyof Strings, values?: Readonly<Record<string, string | number>>): string => fill(strings[key], values, locale);
  const withLane = (parts: string[], laneId: string): string => {
    const lane = lanes?.get(laneId);
    if (lane !== undefined && lane !== "") parts.push(lane);
    return parts.join(say("listSeparator"));
  };
  const names = new WeakMap<object, Cached>();
  return {
    describeItem(placed: LayoutItem<T>): string {
      const { item, span } = placed;
      const known = names.get(item);
      if (known !== undefined && known.options === options && known.start === span.start && known.end === span.end && known.open === span.open) {
        return known.name;
      }
      const hasEnd = item.end !== undefined && !span.open;
      const withTime =
        item.granularity === undefined
          ? !atMidnight(span.start, timeZone) || (hasEnd && !atMidnight(span.end, timeZone))
          : !DATE_ONLY.has(item.granularity);
      const format = dateFormatFor(locale, timeZone, withTime);
      const start = format.format(span.start);
      const dates = span.open
        ? say("openRange", { start })
        : hasEnd && span.end > span.start
          ? say("range", { start, end: format.format(span.end) })
          : start;
      const name = withLane([item.label ?? item.id, dates], placed.laneId);
      names.set(item, { start: span.start, end: span.end, open: span.open, options, name });
      return name;
    },
    describeCluster(cluster: Cluster<T>): string {
      const withTime = !atMidnight(cluster.start, timeZone) || !atMidnight(cluster.lastStart, timeZone);
      const format = dateFormatFor(locale, timeZone, withTime);
      const from = format.format(cluster.start);
      const to = format.format(cluster.lastStart);
      const count = cluster.members.length;
      return withLane([say("cluster", { count }), from === to ? from : say("range", { start: from, end: to })], cluster.laneId);
    },
  };
}
