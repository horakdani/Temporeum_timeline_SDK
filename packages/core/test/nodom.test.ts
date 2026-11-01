import { describe, expect, it } from "vitest";

import { startOf } from "../src/calendar.js";
import { createProjector } from "../src/geometry.js";
import { createTimeScale } from "../src/scale.js";
import { generateTicks } from "../src/ticks.js";

/**
 * The DOM-free promise, checked where it can actually fail.
 *
 * The lint rule in `eslint.config.mjs` forbids the globals statically; this
 * file is the runtime half. It runs in Vitest's `node` environment, where
 * there is no DOM at all, so anything the core reaches for would throw rather
 * than quietly resolve against a jsdom stand-in.
 */
describe("the core without a DOM", () => {
  it("runs in an environment that has none", () => {
    expect(typeof globalThis.window).toBe("undefined");
    expect(typeof globalThis.document).toBe("undefined");
    expect(typeof globalThis.localStorage).toBe("undefined");
    expect(typeof globalThis.sessionStorage).toBe("undefined");
    // `navigator` and `fetch` are NOT asserted here: Node has shipped both as
    // globals since v21, so their presence is not a DOM leak and their
    // absence cannot be checked. Those two are held by the lint rule in
    // eslint.config.mjs, which is the static half of the same promise.
  });

  it("computes a whole axis and projection there anyway", () => {
    const domain = [Date.UTC(2025, 0, 1), Date.UTC(2026, 0, 1)] as const;
    const scale = createTimeScale(domain, 1200);
    const ticks = generateTicks(domain, 1200);
    const projector = createProjector("vertical");

    expect(ticks.length).toBeGreaterThan(3);
    const boxes = ticks.map((tick) =>
      projector.projectRect({
        main: scale.toMain(tick.time),
        mainSize: 1,
        cross: 0,
        crossSize: 24,
      }),
    );
    expect(boxes.every((box) => Number.isFinite(box.y) && box.width === 24)).toBe(true);
    expect(startOf(domain[0], "year")).toBe(domain[0]);
  });
});
