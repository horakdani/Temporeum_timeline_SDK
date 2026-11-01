import { expect, it } from "vitest";

import {
  containerExtents,
  createProjector,
  crossAxisOf,
  mainAxisOf,
  projectPoint,
  projectRect,
  unprojectPoint,
  unprojectRect,
} from "../../src/geometry.js";
import { describeBothOrientations } from "../orientation.js";

describeBothOrientations("projector", (orientation) => {
  const horizontal = orientation === "horizontal";

  it("maps main onto the time axis and cross onto the lane axis", () => {
    const screen = projectPoint({ main: 120, cross: 40 }, orientation);
    expect(screen).toEqual(horizontal ? { x: 120, y: 40 } : { x: 40, y: 120 });
  });

  it("names the axes the same way it projects them", () => {
    expect(mainAxisOf(orientation)).toBe(horizontal ? "x" : "y");
    expect(crossAxisOf(orientation)).toBe(horizontal ? "y" : "x");
    const screen = projectPoint({ main: 7, cross: 3 }, orientation);
    expect(screen[mainAxisOf(orientation)]).toBe(7);
    expect(screen[crossAxisOf(orientation)]).toBe(3);
  });

  it("maps a box's extents onto the matching screen sides", () => {
    const rect = { main: 10, cross: 20, mainSize: 300, crossSize: 24 };
    expect(projectRect(rect, orientation)).toEqual(
      horizontal
        ? { x: 10, y: 20, width: 300, height: 24 }
        : { x: 20, y: 10, width: 24, height: 300 },
    );
  });

  it("round-trips points", () => {
    const point = { main: 123.5, cross: -17 };
    expect(unprojectPoint(projectPoint(point, orientation), orientation)).toEqual(point);
  });

  it("round-trips boxes", () => {
    const rect = { main: 1.5, cross: 2.5, mainSize: 3.5, crossSize: 4.5 };
    expect(unprojectRect(projectRect(rect, orientation), orientation)).toEqual(rect);
  });

  it("reads a container's width and height as main and cross extents", () => {
    expect(containerExtents(1024, 400, orientation)).toEqual(
      horizontal ? { mainSize: 1024, crossSize: 400 } : { mainSize: 400, crossSize: 1024 },
    );
  });

  it("binds the same four projections to one orientation", () => {
    const projector = createProjector(orientation);
    const point = { main: 5, cross: 6 };
    const rect = { main: 5, cross: 6, mainSize: 7, crossSize: 8 };
    expect(projector.orientation).toBe(orientation);
    expect(projector.mainAxis).toBe(mainAxisOf(orientation));
    expect(projector.crossAxis).toBe(crossAxisOf(orientation));
    expect(projector.projectPoint(point)).toEqual(projectPoint(point, orientation));
    expect(projector.projectRect(rect)).toEqual(projectRect(rect, orientation));
    expect(projector.unprojectPoint(projector.projectPoint(point))).toEqual(point);
    expect(projector.unprojectRect(projector.projectRect(rect))).toEqual(rect);
  });

  it("keeps the lane axis free of time", () => {
    const lanes = [0, 24, 48].map((cross) => projectRect(
      { main: 100, cross, mainSize: 50, crossSize: 24 },
      orientation,
    ));
    const acrossLanes = lanes.map((rect) => rect[crossAxisOf(orientation)]);
    const alongTime = lanes.map((rect) => rect[mainAxisOf(orientation)]);
    expect(acrossLanes).toEqual([0, 24, 48]);
    expect(new Set(alongTime)).toEqual(new Set([100]));
  });
});
