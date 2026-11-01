/**
 * A small editable timeline, shared by the editing suites.
 *
 * Deliberately concrete: three items in two lanes, twenty pixels to the day,
 * so a test can say "drag it one day right" and mean "move the pointer twenty
 * pixels". The gate suites build their own machines rather than using this
 * one — a suite that proves something about the pipeline should show the
 * pipeline it drives.
 */

import { createHitTester } from "../src/editing.js";
import type { HitTester } from "../src/editing.js";
import { layoutItems } from "../src/layout.js";
import type { Layout } from "../src/layout.js";
import { createTimeScale } from "../src/scale.js";
import type { TimeScale } from "../src/scale.js";
import type { Domain, Item, Lane } from "../src/types.js";

export const DAY = 86_400_000;
export const START = Date.UTC(2026, 0, 1);
/** Twenty pixels to the day. */
export const MAIN_SIZE = 600;
export const DOMAIN: Domain = [START, START + 30 * DAY];

export const LANES: readonly Lane[] = [{ id: "l1" }, { id: "l2" }];

export function demoItems(): Item[] {
  return [
    { id: "a", start: START + 2 * DAY, end: START + 6 * DAY, laneId: "l1" },
    { id: "b", start: START + 10 * DAY, end: START + 14 * DAY, laneId: "l1" },
    { id: "c", start: START + 4 * DAY, end: START + 8 * DAY, laneId: "l2" },
    { id: "moment", start: START + 20 * DAY, laneId: "l2" },
  ];
}

export interface Surface {
  readonly layout: Layout;
  readonly scale: TimeScale;
  readonly tester: HitTester;
  /** Main-axis pixel of a time. */
  readonly mainOf: (time: number) => number;
  /** A cross coordinate inside an item's row. */
  readonly crossOf: (id: string) => number;
}

export function surfaceFor(items: readonly Item[] = demoItems()): Surface {
  const layout = layoutItems(items, { lanes: LANES });
  const scale = createTimeScale(DOMAIN, MAIN_SIZE);
  const tester = createHitTester({ layout, scale });
  return {
    layout,
    scale,
    tester,
    mainOf: (time) => scale.toMain(time),
    crossOf: (id) => {
      const placed = layout.items.find((candidate) => candidate.item.id === id);
      if (placed === undefined) {
        throw new Error(`no item ${id} in the layout`);
      }
      return placed.cross + placed.crossSize / 2;
    },
  };
}
