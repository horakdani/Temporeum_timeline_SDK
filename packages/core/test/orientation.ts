/**
 * The both-orientations harness.
 *
 * Every test that touches screen coordinates runs through this, which is how
 * the vertical timeline stays the same code path as the horizontal one rather
 * than drifting into a second implementation. `scripts/sdk_check_orientation.mjs`
 * enforces that every file under `test/geometry/` uses it, so the G-ORIENT
 * gate cannot be satisfied by a suite that quietly covers one orientation.
 *
 * The orientation list comes from the core itself, not from a copy here: if a
 * third orientation were ever added, these tests would run in it on the next
 * run without anyone remembering to update the harness.
 */

import { describe } from "vitest";

import { ORIENTATIONS } from "../src/geometry.js";
import type { Orientation } from "../src/types.js";

export { ORIENTATIONS };

/** Run a block of geometric tests once per orientation. */
export function describeBothOrientations(
  name: string,
  body: (orientation: Orientation) => void,
): void {
  for (const orientation of ORIENTATIONS) {
    describe(`${name} [${orientation}]`, () => {
      body(orientation);
    });
  }
}
