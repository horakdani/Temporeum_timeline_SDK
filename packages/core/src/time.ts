/**
 * Time normalisation at the public boundary.
 *
 * The engine works in epoch milliseconds, never in `Date` objects: the hot
 * paths run per frame, and allocating a `Date` per item per frame is the kind
 * of cost that only shows up on a mid-range phone. `Date` is accepted once,
 * here, and converted.
 */
import type { TimeInput, TimeMs } from "./types.js";

/**
 * Converts a boundary time value to epoch milliseconds.
 *
 * @throws RangeError if the value is not a finite instant — an `Invalid Date`
 * or a `NaN` silently poisons every downstream calculation, so it is rejected
 * where it enters.
 */
export function toTimeMs(value: TimeInput): TimeMs {
  const ms = typeof value === "number" ? value : value.getTime();
  if (!Number.isFinite(ms)) {
    throw new RangeError(
      `Invalid time value: ${String(value)}. Expected a finite epoch millisecond number or a valid Date.`,
    );
  }
  return ms;
}
