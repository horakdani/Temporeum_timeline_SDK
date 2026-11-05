/**
 * Custom time bars: the host's own lines across the timeline, which the
 * reader can drag — a "now" that is not the clock's, a cut-off, a what-if.
 *
 * A bar is a slider, and is one for every kind of input: a pointer drags it,
 * and with the bar focused an arrow moves it a step, `PageUp`/`PageDown` ten,
 * `Home`/`End` to the view's ends. Both end in {@link moveTimeBar}, the one
 * place a bar moves, so a drag and a key step to the same time give the same
 * event. The bar knows nothing of the DOM: the element puts it on screen.
 */

import type { TimeScale } from "../scale.js";
import { toTimeMs } from "../time.js";
import type { Domain, TimeInput, TimeMs } from "../types.js";
import { snapTime } from "../editing.js";
import { stepsOf } from "./keys.js";
import type { AxisKeyAction } from "./keys.js";

/** A line at one instant, across every lane, that the reader can move. */
export interface TimeBar {
  readonly id: string;
  readonly time: TimeInput;
  /** Its name — the slider's accessible name, and the text on its grip. */
  readonly label?: string;
  readonly className?: string;
  /** `false` draws the bar but does not let it be moved. Movable by default. */
  readonly movable?: boolean;
}

/** What `timeBarMoved` carries. */
export interface TimeBarMovedPayload {
  readonly id: string;
  readonly time: TimeMs;
  readonly previous: TimeMs;
}

/** How a move lands. */
export interface TimeBarMoveOptions {
  /** The grid a moved bar lands on. */
  readonly snapMs?: number;
  readonly snapOrigin?: TimeMs;
  /** The zone a grid of whole days lies in: local midnights all year. UTC by default. */
  readonly timeZone?: string;
  /** Bounds a bar cannot be moved past. */
  readonly limits?: Domain;
}

/**
 * The one place a bar moves — for a drag and a key alike.
 *
 * The bars with the moved one at its new time, and what moved; `undefined`
 * when nothing would: no such bar, a bar that is not movable, or a time that
 * snaps back to where it is.
 */
export function moveTimeBar(
  bars: readonly TimeBar[],
  id: string,
  time: TimeMs,
  options: TimeBarMoveOptions = {},
): { readonly bars: readonly TimeBar[]; readonly moved: TimeBarMovedPayload } | undefined {
  const bar = bars.find((each) => each.id === id);
  if (bar === undefined || bar.movable === false || !Number.isFinite(time)) return undefined;
  const previous = toTimeMs(bar.time);
  let next = snapTime(time, options.snapMs, options.snapOrigin, options.timeZone);
  if (options.limits !== undefined) next = Math.min(Math.max(next, options.limits[0]), options.limits[1]);
  if (next === previous) return undefined;
  return { bars: bars.map((each) => (each === bar ? { ...each, time: next } : each)), moved: { id, time: next, previous } };
}

/**
 * Where a dragged bar goes: it keeps the distance to the pointer it was
 * grabbed at, so a bar grabbed a pixel off its line does not jump.
 */
export function dragTimeBarTime(grab: { readonly time: TimeMs; readonly main: number }, main: number, scale: TimeScale): TimeMs {
  return scale.toTime(main) + (grab.time - scale.toTime(grab.main));
}

/** Where a key moves a bar: a step or a page from where it is, or the view's end. */
export function timeBarKeyTime(time: TimeMs, action: AxisKeyAction, options: { readonly stepMs: number; readonly domain: Domain }): TimeMs {
  const steps = stepsOf(action);
  if (steps !== undefined) return time + steps * options.stepMs;
  return action === "first" ? options.domain[0] : options.domain[1];
}

/** The step a key moves a bar by when the host names none: a hundredth of the view. */
export function defaultTimeBarStep(domain: Domain, snapMs?: number): number {
  const hundredth = (domain[1] - domain[0]) / 100;
  return snapMs !== undefined && snapMs > 0 ? Math.max(snapMs, Math.round(hundredth / snapMs) * snapMs) : hundredth;
}

/** A bar on screen: its time and where it is along the axis, for the element to place. */
export interface TimeBarPlacement {
  readonly bar: TimeBar;
  readonly time: TimeMs;
  readonly main: number;
  /** Whether it is inside the view. A bar outside is not drawn, and keeps its focus stop. */
  readonly inView: boolean;
}

/** Each bar's place on the axis. */
export function timeBarPlacements(bars: readonly TimeBar[], scale: TimeScale): readonly TimeBarPlacement[] {
  return bars.map((bar) => {
    const time = toTimeMs(bar.time);
    const main = scale.toMain(time);
    return { bar, time, main, inView: main >= 0 && main <= scale.mainSize };
  });
}
