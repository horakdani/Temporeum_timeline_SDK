import { describe, expectTypeOf, it } from "vitest";

import { createProjector, projectPoint, projectRect } from "../src/geometry.js";
import { itemRect, layoutItems } from "../src/layout.js";
import type { Layout, LayoutItem } from "../src/layout.js";
import type { ScreenPoint, ScreenRect } from "../src/geometry.js";
import { createTimeScale, zoomDomainAt } from "../src/scale.js";
import { chooseTickStep, generateTicks } from "../src/ticks.js";
import type { Tick } from "../src/ticks.js";
import type { Domain, Granularity, MainCross } from "../src/types.js";

/**
 * The geometry surface, asserted at the type level.
 *
 * The point of `(main, cross)` is that the compiler refuses the mistake a
 * reviewer would miss: handing a screen point to a function that wants
 * internal coordinates, or the other way round. These assertions are where
 * that claim is checked.
 */
describe("geometry API types", () => {
  it("keeps internal and screen coordinates apart", () => {
    expectTypeOf(projectPoint).parameter(0).toEqualTypeOf<MainCross>();
    expectTypeOf(projectPoint({ main: 0, cross: 0 }, "horizontal")).toEqualTypeOf<ScreenPoint>();
    expectTypeOf(
      projectRect({ main: 0, cross: 0, mainSize: 1, crossSize: 1 }, "vertical"),
    ).toEqualTypeOf<ScreenRect>();
  });

  it("rejects a screen point where an internal one belongs", () => {
    // @ts-expect-error — x/y is screen space; the engine works in (main, cross).
    projectPoint({ x: 10, y: 20 }, "horizontal");
  });

  it("rejects an orientation it does not have", () => {
    // @ts-expect-error — there is no diagonal timeline.
    createProjector("diagonal");
  });

  it("types a domain as a pair of times", () => {
    const domain: Domain = [0, 1000];
    expectTypeOf(createTimeScale(domain, 100).msPerPx).toBeNumber();
    expectTypeOf(zoomDomainAt(domain, 100, 50, 2)).toEqualTypeOf<Domain>();
    // @ts-expect-error — a domain is exactly two times.
    const tooMany: Domain = [0, 1000, 2000];
    void tooMany;
  });

  it("carries the host's own payload type through the layout untouched", () => {
    interface Task {
      readonly assignee: string;
    }
    const layout = layoutItems<Task>([
      { id: "a", start: 0, end: 1000, data: { assignee: "dh" } },
    ]);
    expectTypeOf(layout).toEqualTypeOf<Layout<Task>>();
    const placed = layout.items[0];
    expectTypeOf(placed).toEqualTypeOf<LayoutItem<Task> | undefined>();
    expectTypeOf(placed?.item.data).toEqualTypeOf<Task | undefined>();
  });

  it("refuses to turn a placed item into a box without a scale", () => {
    const placed = layoutItems([{ id: "a", start: 0 }]).items[0] as LayoutItem;
    // @ts-expect-error — the main axis comes from the scale, never from nothing.
    itemRect(placed);
  });

  it("types ticks as a read-only list of calendar-tagged instants", () => {
    const ticks = generateTicks([0, 86_400_000], 800);
    expectTypeOf(ticks).toEqualTypeOf<readonly Tick[]>();
    expectTypeOf(chooseTickStep(1000).granularity).toEqualTypeOf<Granularity>();
    // @ts-expect-error — the axis a host receives is not its to edit.
    ticks[0] = { time: 0, granularity: "day", major: true };
  });
});
