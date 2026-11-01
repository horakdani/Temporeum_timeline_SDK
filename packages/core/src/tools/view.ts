/**
 * Views a host asks for by name: a rolling window that follows the clock,
 * and zoom presets — "a day", "a week" — around what is on screen.
 *
 * Both are pure: the clock is an argument, as it is for the now line. The
 * element runs the timer and calls these.
 */

import { addCalendar, DEFAULT_TIME_ZONE } from "../calendar.js";
import type { TimeWarp } from "../scale.js";
import { alignToStep } from "../ticks.js";
import type { Domain, Granularity, TimeMs } from "../types.js";

/** A window that follows the clock. */
export interface RollingOptions {
  /** Where `now` sits in the window, from 0 (its start) to 1 (its end). 0.5 by default. */
  readonly offset?: number;
}

/**
 * The window of the same span with `now` at `offset` — of shown time, with
 * hidden dates, so a rolling working-hours view keeps its working hours.
 */
export function rollingDomain(domain: Domain, now: TimeMs, options: RollingOptions = {}, warp?: TimeWarp): Domain {
  const offset = Math.min(Math.max(options.offset ?? 0.5, 0), 1);
  if (warp === undefined) {
    const span = domain[1] - domain[0];
    return [now - span * offset, now - span * offset + span];
  }
  const span = warp.toShown(domain[1]) - warp.toShown(domain[0]);
  const at = warp.toShown(now) - span * offset;
  return [warp.toReal(at), warp.toReal(at + span)];
}

/** A named zoom: `count` calendar units, aligned as the axis aligns them. */
export interface ZoomPreset {
  readonly id: string;
  /** What a button for it says. */
  readonly label: string;
  readonly unit: Granularity;
  /** How many units. 1 by default; seven days is a week, aligned to Monday. */
  readonly count?: number;
}

/** A day, a week, a month and a year. */
export const DEFAULT_ZOOM_PRESETS: readonly ZoomPreset[] = [
  { id: "day", label: "Day", unit: "day" },
  { id: "week", label: "Week", unit: "day", count: 7 },
  { id: "month", label: "Month", unit: "month" },
  { id: "year", label: "Year", unit: "year" },
];

/**
 * The preset's window around an instant — the middle of the view unless
 * told: the unit it falls in, from its aligned start. "A week" around a
 * Thursday is that Monday to the next.
 */
export function presetDomain(
  preset: ZoomPreset,
  domain: Domain,
  options: { readonly around?: TimeMs; readonly timeZone?: string } = {},
): Domain {
  const zone = options.timeZone ?? DEFAULT_TIME_ZONE;
  const count = preset.count ?? 1;
  if (!(Number.isInteger(count) && count >= 1)) throw new RangeError(`A zoom preset's count must be a positive integer, got ${String(count)}`);
  const around = options.around ?? (domain[0] + domain[1]) / 2;
  const start = alignToStep(around, { granularity: preset.unit, count }, zone);
  return [start, addCalendar(start, preset.unit, count, zone)];
}
