/**
 * R82: a host's `className` is its own classes, never the timeline's. A
 * `tl-` class given in data — `tl-item--selected`, `tl-groups` — drew a node
 * as selected or had it taken for one of the timeline's controls. The
 * template's classes were filtered; the data's were not.
 */

import { describe, expect, it } from "vitest";

import { calendarScene, layoutDays } from "../../src/calendar/index.js";
import { densityMetrics } from "../../src/density.js";
import { renderDecoration } from "../../src/decorations.js";
import { withClass } from "../../src/draw.js";
import { dependencyPaths, ganttHooks, routeDependencies } from "../../src/gantt/index.js";
import { createProjector } from "../../src/geometry.js";
import { itemKindHooks, splitBackgrounds } from "../../src/items/index.js";
import { layoutItems } from "../../src/layout.js";
import { renderTimeline } from "../../src/render.js";
import { createTimeScale } from "../../src/scale.js";
import type { SceneElement } from "../../src/scene.js";
import type { Item } from "../../src/types.js";

const DAY = 86_400_000;
const ORIGIN = Date.UTC(2025, 0, 1);
const HOSTILE = "urgent tl-item--selected TL-groups tl  tl-dep--selected mine";

function find(node: SceneElement, test: (node: SceneElement) => boolean): SceneElement | undefined {
  if (test(node)) return node;
  for (const child of node.children ?? []) {
    const hit = find(child, test);
    if (hit !== undefined) return hit;
  }
  return undefined;
}

const classOf = (scene: SceneElement, attr: string, id: string): string => String(find(scene, (node) => node.attrs?.[attr] === id)?.attrs?.class);

describe("a host's classes are its own (R82)", () => {
  it("keeps a host's classes and leaves out the timeline's", () => {
    expect(withClass("tl-item", HOSTILE)).toBe("tl-item urgent mine");
    expect(withClass("tl-item", undefined)).toBe("tl-item");
    expect(withClass("tl-item", "")).toBe("tl-item");
  });

  it("on an item, the default node and a milestone", () => {
    const items: Item[] = [
      { id: "a", start: ORIGIN, end: ORIGIN + 2 * DAY, className: HOSTILE },
      { id: "m", start: ORIGIN + 3 * DAY, kind: "milestone", className: HOSTILE },
    ];
    const plain = renderTimeline({ items, domain: [ORIGIN - DAY, ORIGIN + 10 * DAY], width: 900, height: 200 });
    expect(classOf(plain.scene, "data-tl-id", "a")).toBe("tl-item urgent mine");
    const gantt = renderTimeline({ items, domain: [ORIGIN - DAY, ORIGIN + 10 * DAY], width: 900, height: 200, hooks: ganttHooks({}, { items }) });
    expect(classOf(gantt.scene, "data-tl-id", "m")).toBe("tl-item tl-item--milestone urgent mine");
  });

  it("on the item kinds, and a background item keeps the class it is drawn with", () => {
    const items: Item[] = [{ id: "box", start: ORIGIN, end: ORIGIN + 2 * DAY, kind: "box", className: HOSTILE }];
    const frame = renderTimeline({ items, domain: [ORIGIN - DAY, ORIGIN + 10 * DAY], width: 900, height: 200, hooks: itemKindHooks() });
    expect(classOf(frame.scene, "data-tl-id", "box")).toBe("tl-item tl-item--box urgent mine");
    const { backgrounds } = splitBackgrounds([{ id: "bg", start: ORIGIN, end: ORIGIN + DAY, kind: "background", className: HOSTILE }]);
    const context = {
      scale: createTimeScale([ORIGIN - DAY, ORIGIN + 10 * DAY], 900),
      projector: createProjector("horizontal"),
      crossSize: 200,
      metrics: densityMetrics("comfortable", "horizontal"),
    };
    const [era] = renderDecoration(backgrounds[0] as NonNullable<(typeof backgrounds)[0]>, context as Parameters<typeof renderDecoration>[1]);
    expect(String(era?.attrs?.class)).toBe("tl-era tl-background urgent mine");
  });

  it("on a dependency arrow", () => {
    const items: Item[] = [
      { id: "a", start: ORIGIN, end: ORIGIN + 2 * DAY, laneId: "x" },
      { id: "b", start: ORIGIN + 3 * DAY, end: ORIGIN + 5 * DAY, laneId: "y" },
    ];
    const routes = routeDependencies(layoutItems(items, { lanes: [{ id: "x" }, { id: "y" }] }), [{ from: "a", to: "b", className: HOSTILE }], {
      scale: createTimeScale([ORIGIN - DAY, ORIGIN + 10 * DAY], 1100),
    });
    expect(dependencyPaths(routes, "horizontal").map((path) => path.attrs?.class)).toEqual(["tl-dep tl-dep--fs urgent mine"]);
  });

  it("on a calendar event", () => {
    const monday = Date.UTC(2026, 10, 2);
    const layout = layoutDays([{ id: "e", start: monday + 9 * 3_600_000, end: monday + 10 * 3_600_000, className: HOSTILE }], { start: monday, days: 1 });
    const scene = calendarScene(layout, { width: 400, height: 500 });
    const event = find(scene, (node) => String(node.attrs?.class).startsWith("tl-cal-event"));
    expect(event?.attrs?.class).toBe("tl-cal-event urgent mine");
  });
});
