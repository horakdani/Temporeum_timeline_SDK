import { describe, expect, it } from "vitest";

import type { LoadingRange } from "../../src/data.js";
import { densityMetrics } from "../../src/density.js";
import { renderTimeline } from "../../src/render.js";
import type { RenderOptions } from "../../src/render.js";
import type { SceneElement } from "../../src/scene.js";
import { planSceneSpace } from "../../src/scene-space.js";
import { timelineStyleCss } from "../../src/theme.js";
import type { Orientation } from "../../src/types.js";
import { DAY, ORIGIN } from "./fixture.js";

/** The loading state on the axis: where the mark is, and what the root says. */

const WIDTH = 800;
const HEIGHT = 300;
const domain: readonly [number, number] = [ORIGIN, ORIGIN + 40 * DAY];

function marks(scene: SceneElement): SceneElement[] {
  const found: SceneElement[] = [];
  const walk = (node: SceneElement): void => {
    if (typeof node.attrs?.class === "string" && node.attrs.class.split(" ").includes("tl-loading")) {
      found.push(node);
    }
    for (const child of node.children ?? []) {
      walk(child);
    }
  };
  walk(scene);
  return found;
}

function overlayOf(scene: SceneElement): SceneElement {
  return (scene.children ?? []).find((child) => child.attrs?.class === "tl-layer tl-layer--overlay") as SceneElement;
}

const render = (orientation: Orientation, loading: readonly LoadingRange[] | undefined, extra: Partial<RenderOptions> = {}) =>
  renderTimeline({ items: [], domain, width: WIDTH, height: HEIGHT, orientation, ...(loading === undefined ? {} : { loading }), ...extra });

for (const orientation of ["horizontal", "vertical"] as const) {
  describe(`[${orientation}]`, () => {
    const metrics = densityMetrics("comfortable", orientation);
    const mainSize = orientation === "horizontal" ? WIDTH : HEIGHT;
    const pxPerMs = mainSize / (domain[1] - domain[0]);

    it("[claim:axis-mark] draws one mark per range, along the inner edge of the axis band, clipped to the view", () => {
      const result = render(orientation, [
        { start: ORIGIN - 10 * DAY, end: ORIGIN + 10 * DAY },
        { start: ORIGIN + 30 * DAY, end: ORIGIN + 90 * DAY, failed: true },
        { start: ORIGIN + 100 * DAY, end: ORIGIN + 120 * DAY },
      ]);
      const found = marks(result.scene);
      expect(found).toHaveLength(2);
      const [loading, failed] = found as [SceneElement, SceneElement];
      expect(loading.attrs?.class).toBe("tl-loading");
      expect(failed.attrs?.class).toBe("tl-loading tl-loading--failed");
      const main = orientation === "horizontal" ? ["x1", "x2"] : ["y1", "y2"];
      const cross = orientation === "horizontal" ? ["y1", "y2"] : ["x1", "x2"];
      expect(Number(loading.attrs?.[main[0]!])).toBeCloseTo(0, 3);
      expect(Number(loading.attrs?.[main[1]!])).toBeCloseTo(10 * DAY * pxPerMs, 2);
      expect(Number(failed.attrs?.[main[0]!])).toBeCloseTo(30 * DAY * pxPerMs, 2);
      expect(Number(failed.attrs?.[main[1]!])).toBeCloseTo(mainSize, 3);
      for (const mark of found) {
        const at = Number(mark.attrs?.[cross[0]!]);
        expect(Number(mark.attrs?.[cross[1]!])).toBe(at);
        // Inside the axis band, against its inner edge.
        expect(at).toBeGreaterThan(metrics.axisSize - 3);
        expect(at).toBeLessThan(metrics.axisSize);
      }
      // In the overlay: decorative, hidden from assistive technology.
      expect(marks(overlayOf(result.scene))).toHaveLength(2);
      expect(overlayOf(result.scene).attrs?.["aria-hidden"]).toBe("true");
    });

    it("[claim:aria-busy] the root is aria-busy while something inside the view is loading, not for a failure or off-screen", () => {
      expect(render(orientation, [{ start: ORIGIN + DAY, end: ORIGIN + 2 * DAY }]).scene.attrs?.["aria-busy"]).toBe("true");
      expect(render(orientation, [{ start: ORIGIN + DAY, end: ORIGIN + 2 * DAY, failed: true }]).scene.attrs?.["aria-busy"]).toBeUndefined();
      expect(render(orientation, [{ start: ORIGIN + 50 * DAY, end: ORIGIN + 60 * DAY }]).scene.attrs?.["aria-busy"]).toBeUndefined();
      expect(render(orientation, []).scene.attrs?.["aria-busy"]).toBeUndefined();
      expect(render(orientation, undefined).scene.attrs?.["aria-busy"]).toBeUndefined();
      // Also on a frame that is only an image, and on an empty one.
      expect(render(orientation, [{ start: ORIGIN, end: ORIGIN + DAY }], { interactive: false }).scene.attrs?.["aria-busy"]).toBe("true");
      expect(render(orientation, [{ start: ORIGIN, end: ORIGIN + DAY }], { width: 0 }).scene.attrs?.["aria-busy"]).toBe("true");
    });

    it("[claim:axis-mark] without loading ranges the frame is byte-identical to one rendered without the loading layer", () => {
      const items = [{ id: "a", start: ORIGIN + DAY, end: ORIGIN + 5 * DAY, label: "A" }];
      const plain = renderTimeline({ items, domain, width: WIDTH, height: HEIGHT, orientation });
      const empty = renderTimeline({ items, domain, width: WIDTH, height: HEIGHT, orientation, loading: [] });
      const offscreen = renderTimeline({ items, domain, width: WIDTH, height: HEIGHT, orientation, loading: [{ start: ORIGIN + 80 * DAY, end: ORIGIN + 90 * DAY, failed: true }] });
      expect(JSON.stringify(empty.scene)).toBe(JSON.stringify(plain.scene));
      expect(JSON.stringify(offscreen.scene)).toBe(JSON.stringify(plain.scene));
    });

    it("[claim:axis-mark] in a scene space the mark is drawn in the items' space and lands on the same pixels", () => {
      const loading: LoadingRange[] = [{ start: ORIGIN + 5 * DAY, end: ORIGIN + 15 * DAY }];
      // A space anchored earlier and at another zoom: the layer transform maps it back.
      const space = planSceneSpace(planSceneSpace(undefined, { domain: [ORIGIN - 10 * DAY, ORIGIN + 50 * DAY], mainSize }), { domain, mainSize });
      const result = render(orientation, loading, { space });
      const overlay = overlayOf(result.scene);
      const [mark] = marks(overlay) as [SceneElement];
      const transform = String(overlay.attrs?.transform ?? "");
      const numbers = (transform.match(/-?[\d.]+(e-?\d+)?/g) ?? []).map(Number);
      const [k, shift] = orientation === "horizontal" ? [numbers[0] ?? 1, numbers[4] ?? 0] : [numbers[3] ?? 1, numbers[5] ?? 0];
      const main = orientation === "horizontal" ? ["x1", "x2"] : ["y1", "y2"];
      const onScreen = (value: number) => value * k + shift;
      expect(onScreen(Number(mark.attrs?.[main[0]!]))).toBeCloseTo(5 * DAY * pxPerMs, 1);
      expect(onScreen(Number(mark.attrs?.[main[1]!]))).toBeCloseTo(15 * DAY * pxPerMs, 1);
    });
  });
}

describe("stylesheet", () => {
  const css = timelineStyleCss({ metrics: densityMetrics("comfortable", "horizontal"), theme: "light" });

  it("[claim:reduced-motion] the loading mark moves by its dashes, and stops for reduced motion", () => {
    expect(css).toMatch(/\.tl-loading\{[^}]*stroke-dasharray:10 5[^}]*animation:tl-loading/);
    expect(css).toContain("@keyframes tl-loading{to{stroke-dashoffset:-15}}");
    expect(css).toContain("@media (prefers-reduced-motion:reduce){.tl .tl-loading{animation:none}}");
    // The motion is not a fade: the mark keeps its contrast at every moment.
    expect(css).not.toMatch(/@keyframes tl-loading\{[^}]*opacity/);
  });

  it("[claim:reduced-motion] a failure differs in shape, not only colour, and does not move", () => {
    expect(css).toMatch(/\.tl-loading--failed\{stroke:var\(--tl-now\);stroke-dasharray:2 4;animation:none\}/);
    expect(css).toMatch(/\.tl-loading\{[^}]*vector-effect:non-scaling-stroke/);
  });
});
