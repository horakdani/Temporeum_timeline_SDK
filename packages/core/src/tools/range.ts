/**
 * Range selection: a stretch of time the reader picks — to filter by, to
 * zoom to, to count what is in it.
 *
 * With a pointer, a drag along the axis band. With the keyboard, `r` starts
 * a range at the middle of the view, an arrow along the axis moves its far
 * end a step (`PageUp`/`PageDown` ten), `Enter` selects it and `Escape`
 * lets it go. Both end in {@link selectRange}, so a drag and the keys over
 * the same stretch select the same range and give the same event.
 */

import type { KeySample } from "../keyboard.js";
import type { TimeScale } from "../scale.js";
import type { Domain, Orientation, TimeMs } from "../types.js";
import { snapTime } from "../editing.js";
import { resolveAxisKey, stepsOf } from "./keys.js";

/** A selected stretch of time, `[start, end)`. What `rangeSelected` carries. */
export interface TimeRange {
  readonly start: TimeMs;
  readonly end: TimeMs;
}

/** How a selected range lands. */
export interface RangeSelectOptions {
  /** The grid its ends land on. */
  readonly snapMs?: number;
  readonly snapOrigin?: TimeMs;
}

/**
 * The one place a range is made — for a drag and the keys alike: the two
 * ends in order, snapped. `undefined` for a range with no length.
 */
export function selectRange(a: TimeMs, b: TimeMs, options: RangeSelectOptions = {}): TimeRange | undefined {
  const from = snapTime(Math.min(a, b), options.snapMs, options.snapOrigin);
  const to = snapTime(Math.max(a, b), options.snapMs, options.snapOrigin);
  return to > from ? { start: from, end: to } : undefined;
}

/** The range a drag from `fromMain` to `toMain` along the axis selects. */
export function rangeFromDrag(scale: TimeScale, fromMain: number, toMain: number, options: RangeSelectOptions = {}): TimeRange | undefined {
  return selectRange(scale.toTime(fromMain), scale.toTime(toMain), options);
}

/** What a key does to a range being picked. */
export type RangeKeyAction = "start" | "earlier" | "later" | "pageEarlier" | "pageLater" | "commit" | "cancel";

/**
 * The range action a key asks for: `r` starts one; while one is being
 * picked, the axis arrows and pages move its end, `Enter` commits and
 * `Escape` cancels.
 */
export function resolveRangeKey(sample: KeySample, orientation: Orientation, options: { readonly picking?: boolean | undefined } = {}): RangeKeyAction | undefined {
  if (sample.ctrlKey || sample.metaKey || sample.altKey) return undefined;
  if (options.picking !== true) return sample.key === "r" || sample.key === "R" ? "start" : undefined;
  if (sample.key === "Enter") return "commit";
  if (sample.key === "Escape") return "cancel";
  const axis = resolveAxisKey(sample, orientation);
  return axis === "first" || axis === "last" ? undefined : axis;
}

/** A range being picked from the keyboard: where it began, and its moving end. */
export interface RangeDraft {
  readonly anchor: TimeMs;
  readonly head: TimeMs;
}

/** A key step of a range being picked. `start` begins one at the view's middle, on the grid. */
export function rangeKeyStep(
  draft: RangeDraft | undefined,
  action: Exclude<RangeKeyAction, "commit" | "cancel">,
  options: RangeSelectOptions & { readonly domain: Domain; readonly stepMs: number },
): RangeDraft {
  if (action === "start" || draft === undefined) {
    const middle = snapTime((options.domain[0] + options.domain[1]) / 2, options.snapMs, options.snapOrigin);
    return { anchor: middle, head: middle };
  }
  return { anchor: draft.anchor, head: draft.head + (stepsOf(action) ?? 0) * options.stepMs };
}
