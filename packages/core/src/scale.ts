/**
 * The time scale: milliseconds to main-axis pixels and back.
 *
 * Deliberately *not* a general-purpose scale. It is linear, it knows one
 * domain and one extent, and it is pure — which is what lets the whole layout
 * run in Node. The reason the package carries its own instead of a dependency
 * is in the zero-dependency promise: a scale is forty lines, and a peer
 * dependency is a reason not to adopt a library.
 *
 * Sign convention, once, for everything downstream: `main` grows with time.
 * Panning by a positive number of pixels moves the *window* forward in time.
 * A gesture that drags the content to the right therefore pans by a negative
 * amount, and that negation belongs to the input layer, not here.
 */

import { toTimeMs } from "./time.js";
import type { Tick, TickOptions } from "./ticks.js";
import type { Domain, DomainLimits, TimeMs } from "./types.js";

/** The narrowest span the engine will produce. Below this, pixels stop being useful. */
export const MIN_SPAN_MS = 1;

/** The widest instant `Date` can represent, and therefore the engine's bound. */
export const MAX_TIME_MS = 8.64e15;

/**
 * Time with stretches taken out: hidden dates.
 *
 * `toShown` maps an instant to a number that grows only with *shown* time —
 * constant across a hidden stretch, and with slope one everywhere else — and
 * `toReal` maps it back, to the earliest instant with that value, so a
 * hidden stretch collapses onto its start. A scale or a gesture handed one
 * does its linear arithmetic in shown time and converts at the edges: a pan
 * moves the window by shown time, and a zoom holds the instant under the
 * focus across a hidden stretch as it does everywhere else.
 *
 * All three are called unbound. `createHiddenDates` in `/tools` builds one
 * from fixed and repeating ranges.
 */
export interface TimeWarp {
  readonly toShown: (time: TimeMs) => number;
  readonly toReal: (shown: number) => TimeMs;
  /**
   * The axis's ticks in this time: `generateTicks`'s contract, with the step
   * chosen at the shown zoom and no tick in a hidden stretch. Without it the
   * renderer uses `generateTicks`, which knows nothing of hidden time.
   */
  readonly ticks?: (domain: Domain, mainSize: number, options: TickOptions) => readonly Tick[];
}

/** A linear mapping between a time domain and the main axis. */
export interface TimeScale {
  readonly domain: Domain;
  /** Container extent along the time axis, in CSS pixels. */
  readonly mainSize: number;
  /** Milliseconds per pixel. The zoom level, measurably. */
  readonly msPerPx: number;
  /** Time to main-axis pixels. Values outside the domain project outside the extent. */
  toMain(time: TimeMs): number;
  /** Main-axis pixels back to time. */
  toTime(main: number): TimeMs;
}

/** Visible span in milliseconds. */
export function spanOf(domain: Domain): number {
  return domain[1] - domain[0];
}

function assertUsableDomain(domain: Domain): void {
  const [start, end] = domain;
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    throw new RangeError(`Invalid domain: [${String(start)}, ${String(end)}]`);
  }
  if (end - start < MIN_SPAN_MS) {
    throw new RangeError(
      `Domain span must be at least ${MIN_SPAN_MS} ms, got ${String(end - start)}`,
    );
  }
}

function assertUsableMainSize(mainSize: number): void {
  if (!Number.isFinite(mainSize) || mainSize <= 0) {
    throw new RangeError(`Main extent must be a positive number of pixels, got ${String(mainSize)}`);
  }
}

/**
 * A scale for one domain and one extent.
 *
 * Immutable: a new viewport means a new scale. That is cheaper than it looks
 * (two divisions) and removes a whole class of stale-state bugs from the
 * render path.
 */
export function createTimeScale(domain: Domain, mainSize: number, warp?: TimeWarp): TimeScale {
  assertUsableDomain(domain);
  assertUsableMainSize(mainSize);
  // Linear in shown time; without a warp, shown time is time.
  const toShown = warp?.toShown ?? same;
  const toReal = warp?.toReal ?? same;
  const start = toShown(domain[0]);
  const msPerPx = (toShown(domain[1]) - start) / mainSize;
  return {
    domain,
    mainSize,
    msPerPx,
    toMain: (time) => (toShown(time) - start) / msPerPx,
    toTime: (main) => toReal(start + main * msPerPx),
  };
}

const same = (time: number): number => time;

/** A domain computed in shown time, back in real time. */
function viaShown(domain: Domain, warp: TimeWarp, step: (domain: Domain) => Domain): Domain {
  const next = step([warp.toShown(domain[0]), warp.toShown(domain[1])]);
  return [warp.toReal(next[0]), warp.toReal(next[1])];
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

function withSpan(start: TimeMs, span: number): Domain {
  const safeSpan = clamp(span, MIN_SPAN_MS, 2 * MAX_TIME_MS);
  const safeStart = clamp(start, -MAX_TIME_MS, MAX_TIME_MS - safeSpan);
  return [safeStart, safeStart + safeSpan];
}

/**
 * Zoom about a point on the main axis.
 *
 * The time under `focusMain` is the same before and after — this is the
 * function behind the rule that zoom anchors to the gesture's focus and never
 * to the middle of the viewport. `factor` above 1 zooms in. With
 * `options.warp` (hidden dates), the zoom is in the time that is shown.
 */
export function zoomDomainAt(
  domain: Domain,
  mainSize: number,
  focusMain: number,
  factor: number,
  options: { readonly warp?: TimeWarp | undefined } = {},
): Domain {
  const warp = options.warp;
  if (warp !== undefined) return viaShown(domain, warp, (shown) => zoomDomainAt(shown, mainSize, focusMain, factor));
  assertUsableDomain(domain);
  assertUsableMainSize(mainSize);
  if (!Number.isFinite(factor) || factor <= 0) {
    throw new RangeError(`Zoom factor must be a positive number, got ${String(factor)}`);
  }
  if (!Number.isFinite(focusMain)) {
    throw new RangeError(`Zoom focus must be a finite pixel offset, got ${String(focusMain)}`);
  }
  // The instant under the focus, as `createTimeScale(domain, mainSize).toTime` has it.
  const anchorTime = domain[0] + focusMain * (spanOf(domain) / mainSize);
  const span = spanOf(domain) / factor;
  // The anchor keeps its pixel offset, so it keeps its fraction of the span.
  return withSpan(anchorTime - span * (focusMain / mainSize), span);
}

/** Move the window along the main axis by a number of pixels. */
export function panDomainBy(domain: Domain, mainSize: number, deltaMain: number, warp?: TimeWarp): Domain {
  if (warp !== undefined) return viaShown(domain, warp, (shown) => panDomainBy(shown, mainSize, deltaMain));
  assertUsableDomain(domain);
  assertUsableMainSize(mainSize);
  if (!Number.isFinite(deltaMain)) {
    throw new RangeError(`Pan distance must be a finite pixel offset, got ${String(deltaMain)}`);
  }
  const span = spanOf(domain);
  return withSpan(domain[0] + (deltaMain * span) / mainSize, span);
}

/**
 * The nearest domain that satisfies the host's limits.
 *
 * Span first, then position: a window that is too wide for the allowed range
 * is narrowed to the range rather than being left hanging outside it, which
 * is the behaviour a user reads as "it stopped at the end".
 */
export function clampDomain(domain: Domain, limits: DomainLimits = {}): Domain {
  assertUsableDomain(domain);
  const min = limits.min === undefined ? -MAX_TIME_MS : toTimeMs(limits.min);
  const max = limits.max === undefined ? MAX_TIME_MS : toTimeMs(limits.max);
  if (max - min < MIN_SPAN_MS) {
    throw new RangeError(`Domain limits leave no room: [${String(min)}, ${String(max)}]`);
  }
  const minSpan = clamp(limits.minSpanMs ?? MIN_SPAN_MS, MIN_SPAN_MS, max - min);
  const maxSpan = clamp(limits.maxSpanMs ?? max - min, minSpan, max - min);
  const span = clamp(spanOf(domain), minSpan, maxSpan);
  const start = clamp(domain[0], min, max - span);
  return [start, start + span];
}
