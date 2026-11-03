/**
 * The geometry a task's box and its arrows share. Not on the `/gantt` entry:
 * the arrows' routing and the milestone's diamond use it, and the tests.
 */
import type { MainCross, MainCrossRect } from "../types.js";

/** Half the width of a milestone's diamond, for a row of `crossSize`. */
export function milestoneHalf(crossSize: number): number {
  return Math.max(crossSize / 2, 3);
}

/** The point an arrow leaves or reaches an edge at: the edge, half-way across. */
export function edgePoint(box: MainCrossRect, edge: "start" | "end"): MainCross {
  return { main: edge === "start" ? box.main : box.main + box.mainSize, cross: box.cross + box.crossSize / 2 };
}
