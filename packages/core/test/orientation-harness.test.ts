import { describe, expect, it } from "vitest";

import { ORIENTATIONS } from "../src/geometry.js";

/**
 * The harness's own test.
 *
 * It lives outside `test/geometry/` on purpose: every test in that directory
 * is required to carry an orientation tag, and this one is about the list of
 * orientations rather than about any single orientation.
 */
describe("ORIENTATIONS", () => {
  it("is both orientations and nothing else", () => {
    expect([...ORIENTATIONS]).toEqual(["horizontal", "vertical"]);
  });
});
