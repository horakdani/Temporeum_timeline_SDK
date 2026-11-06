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
 * @throws RangeError if the value is not an instant `Date` can hold — an
 * `Invalid Date` or a `NaN` silently poisons every downstream calculation, and
 * a number past ±8.64e15 ms fails later in whatever formats it first, so both
 * are rejected where they enter.
 */
export function toTimeMs(value: TimeInput): TimeMs {
  // A value of the wrong type (a string from JSON) is this error too, not a TypeError from inside (V34).
  const ms = typeof value === "number" ? value : (value as Partial<Date> | null)?.getTime?.();
  // Written so that NaN fails it too.
  if (!(Math.abs(ms as number) <= 8.64e15)) {
    throw new RangeError(
      `Invalid time value: ${String(value)}. Expected a valid Date or epoch milliseconds within ±8.64e15.`,
    );
  }
  return ms as number;
}
