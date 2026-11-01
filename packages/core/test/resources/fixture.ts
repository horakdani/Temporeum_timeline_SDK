/**
 * Generated resource plans, and the load read off them the slow way — the
 * reference the sweep is measured against.
 *
 * Units are quarters and capacities halves: sums of them are exact in
 * floating point, so a reference sum and the sweep's running sum agree to
 * the bit, and "over" means the same thing to both.
 */

import { LOAD_EPSILON } from "../../src/resources/index.js";
import type { Resource } from "../../src/resources/index.js";
import { toTimeMs } from "../../src/time.js";
import type { Item } from "../../src/types.js";

export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;
/** Monday 2025-03-24 00:00 UTC. */
export const BASE = Date.UTC(2025, 2, 24);

export interface Plan {
  readonly resources: Resource[];
  readonly items: Item<{ units: number }>[];
}

export interface PlanShape {
  readonly resources: number;
  readonly items: number;
  /** Starts fall in this many hours from {@link BASE}. */
  readonly spreadHours: number;
}

export const unitsOf = (item: Item<{ units: number }>): number => item.data?.units ?? 1;

/**
 * A plan: resources with capacities of 0 to 3 in halves, and assignments
 * of a quarter to two units — some sharing an edge with another, some
 * instants, a background band, an open one, one in a lane that is not a
 * resource, one of no units.
 */
export function generatePlan(random: () => number, shape: PlanShape): Plan {
  const resources: Resource[] = Array.from({ length: shape.resources }, (_, index) => {
    const pick = random();
    return pick < 0.15
      ? { id: `r${String(index)}`, label: `Resource ${String(index)}` }
      : { id: `r${String(index)}`, label: `Resource ${String(index)}`, capacity: Math.floor(random() * 7) / 2 };
  });
  const items: Item<{ units: number }>[] = [];
  const edges: number[] = [];
  for (let index = 0; index < shape.items; index += 1) {
    const lane = random() < 0.05 ? "elsewhere" : `r${String(Math.floor(random() * shape.resources))}`;
    // Half the time an edge someone else already has: ties are where a sweep goes wrong.
    const start = edges.length > 0 && random() < 0.5 ? (edges[Math.floor(random() * edges.length)] as number) : BASE + Math.floor(random() * shape.spreadHours * 4) * (HOUR / 4);
    const length = Math.floor(random() * 24 * 4 + 1) * (HOUR / 4);
    const units = random() < 0.03 ? 0 : (1 + Math.floor(random() * 8)) / 4;
    const kind = random();
    const item: Item<{ units: number }> =
      kind < 0.05
        ? { id: `a${String(index)}`, start, laneId: lane, data: { units } }
        : kind < 0.08
          ? { id: `a${String(index)}`, start, end: start + length, laneId: lane, kind: "background", data: { units } }
          : kind < 0.1
            ? { id: `a${String(index)}`, start, end: start + length, laneId: lane, open: true, data: { units } }
            : { id: `a${String(index)}`, start, end: start + length, laneId: lane, data: { units } };
    items.push(item);
    edges.push(start, start + length);
  }
  return { resources, items };
}

/** Whether an item takes any of its resource at `time`, read straight off the item. */
function runs(item: Item<{ units: number }>, time: number): boolean {
  if (item.kind === "background") return false;
  const start = toTimeMs(item.start);
  // An open one runs on; an instant, from its start to its start, never.
  const end = item.open === true ? Infinity : item.end === undefined ? start : toTimeMs(item.end);
  return start <= time && time < end;
}

/** The load of a resource at a moment: every assignment running then, its units added up. */
export function referenceLoad(items: readonly Item<{ units: number }>[], resourceId: string, time: number): number {
  let sum = 0;
  for (const item of items) {
    if (item.laneId !== resourceId || !runs(item, time)) continue;
    const units = unitsOf(item);
    if (units > 0) sum += units;
  }
  return sum;
}

/** Whether a load is over a capacity, by the one rule. */
export function referenceOver(load: number, capacity: number): boolean {
  return load > capacity + LOAD_EPSILON;
}

/** Every edge of a resource's assignments, sorted and distinct: the load can only change there. */
export function edgesOf(items: readonly Item<{ units: number }>[], resourceId: string): number[] {
  const times = new Set<number>();
  for (const item of items) {
    if (item.laneId !== resourceId) continue;
    times.add(toTimeMs(item.start));
    if (item.end !== undefined) times.add(toTimeMs(item.end));
  }
  return [...times].sort((a, b) => a - b);
}

/** Every key and value, `Object.is` — an `end: undefined` where there was no `end` is a difference. */
export function sameItems(before: readonly Item[], after: readonly Item[]): string | undefined {
  if (before.length !== after.length) return `${String(before.length)} items before, ${String(after.length)} after`;
  for (const [index, item] of before.entries()) {
    const other = after[index] as Item;
    if (item === other) continue;
    const keys = Object.keys(item).sort().join(",");
    if (keys !== Object.keys(other).sort().join(",")) return `${item.id}: keys [${keys}] became [${Object.keys(other).sort().join(",")}]`;
    for (const key of Object.keys(item)) {
      if (!Object.is((item as unknown as Record<string, unknown>)[key], (other as unknown as Record<string, unknown>)[key])) return `${item.id}.${key} differs`;
    }
  }
  return undefined;
}
