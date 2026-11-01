import { expect, it } from "vitest";

import {
  crossAxisOf,
  mainAxisOf,
  projectPoint,
  projectRect,
  unprojectPoint,
} from "../../src/geometry.js";
import { createTimeScale, zoomDomainAt } from "../../src/scale.js";
import { generateTicks } from "../../src/ticks.js";
import type { Domain } from "../../src/types.js";
import { describeBothOrientations } from "../orientation.js";

const DAY: Domain = [Date.UTC(2025, 2, 15, 0, 0, 0), Date.UTC(2025, 2, 16, 0, 0, 0)];
const MAIN_SIZE = 960;
const CROSS_SIZE = 400;

describeBothOrientations("viewport projection", (orientation) => {
  const scale = createTimeScale(DAY, MAIN_SIZE);

  it("places an item's box where the scale puts its time", () => {
    const start = Date.UTC(2025, 2, 15, 6, 0, 0);
    const end = Date.UTC(2025, 2, 15, 12, 0, 0);
    const screen = projectRect(
      {
        main: scale.toMain(start),
        mainSize: (end - start) / scale.msPerPx,
        cross: 48,
        crossSize: 24,
      },
      orientation,
    );
    // Six hours into a one-day window on 960 px: a quarter in, a quarter wide.
    const alongTime = orientation === "horizontal" ? screen.x : screen.y;
    const timeExtent = orientation === "horizontal" ? screen.width : screen.height;
    const acrossLanes = orientation === "horizontal" ? screen.y : screen.x;
    const laneExtent = orientation === "horizontal" ? screen.height : screen.width;
    expect(alongTime).toBeCloseTo(MAIN_SIZE / 4, 6);
    expect(timeExtent).toBeCloseTo(MAIN_SIZE / 4, 6);
    expect(acrossLanes).toBe(48);
    expect(laneExtent).toBe(24);
  });

  it("puts every tick inside the container along the time axis", () => {
    const ticks = generateTicks(DAY, MAIN_SIZE);
    expect(ticks.length).toBeGreaterThan(2);
    for (const tick of ticks) {
      const screen = projectPoint({ main: scale.toMain(tick.time), cross: 0 }, orientation);
      const along = screen[mainAxisOf(orientation)];
      expect(along).toBeGreaterThanOrEqual(0);
      expect(along).toBeLessThanOrEqual(MAIN_SIZE);
      expect(screen[crossAxisOf(orientation)]).toBe(0);
    }
  });

  it("anchors zoom to the time under the pointer, from screen coordinates", () => {
    // The gesture arrives in screen space; only the projector knows which
    // component of it is time. Getting this backwards is the classic vertical
    // timeline bug, and it is why this test runs in both orientations.
    const pointer =
      orientation === "horizontal"
        ? { x: 240, y: CROSS_SIZE / 2 }
        : { x: CROSS_SIZE / 2, y: 240 };
    const focusMain = unprojectPoint(pointer, orientation).main;
    expect(focusMain).toBe(240);

    const timeUnderPointer = scale.toTime(focusMain);
    const zoomedIn = zoomDomainAt(DAY, MAIN_SIZE, focusMain, 4);
    const zoomedOut = zoomDomainAt(DAY, MAIN_SIZE, focusMain, 1 / 4);

    expect(createTimeScale(zoomedIn, MAIN_SIZE).toTime(focusMain)).toBeCloseTo(
      timeUnderPointer,
      3,
    );
    expect(createTimeScale(zoomedOut, MAIN_SIZE).toTime(focusMain)).toBeCloseTo(
      timeUnderPointer,
      3,
    );
    expect(zoomedIn[1] - zoomedIn[0]).toBeCloseTo((DAY[1] - DAY[0]) / 4, 6);
    expect(zoomedOut[1] - zoomedOut[0]).toBeCloseTo((DAY[1] - DAY[0]) * 4, 6);
  });

  it("keeps the container's own extents straight", () => {
    const full = projectRect(
      { main: 0, cross: 0, mainSize: MAIN_SIZE, crossSize: CROSS_SIZE },
      orientation,
    );
    expect(full.width).toBe(orientation === "horizontal" ? MAIN_SIZE : CROSS_SIZE);
    expect(full.height).toBe(orientation === "horizontal" ? CROSS_SIZE : MAIN_SIZE);
  });
});
