/**
 * The resources check: on generated assignments, the load at every moment is the
 * sum of the assignments running then, the overload is marked exactly where
 * the load is above the capacity, and a move between resources is one
 * reversible command — by a drag and by a key.
 *
 *  - between every two consecutive edges of a resource's assignments, and
 *    before the first and after the last, the load is the reference sum read
 *    straight off the items; the stretches are in order, never empty, never
 *    two of the same load side by side, and cover exactly the time with work
 *    (`load-sum`);
 *  - a stretch is over exactly when its reference load is above the
 *    capacity; the bands drawn in a resource's lane, the red bars in its load
 *    lane and the items marked overbooked are exactly the overloaded time and
 *    the assignments running in it — the marks checked against the reference,
 *    not against the sweep (`overload-exact`);
 *  - a drag of an assignment onto any row — a load lane counting as its
 *    resource — is one `move` command whose lane is a resource; the load
 *    after it is the reference load of the moved plan, and its inverse gives
 *    back the exact items; `Alt` with the arrow across moves it to the next
 *    resource, over the load lane, as the same kind of command (`reassign`).
 */

import { describe, expect, it } from "vitest";

import { applyPatches, createHitTester } from "../../src/editing.js";
import { createInputMachine } from "../../src/input.js";
import type { InputEffect } from "../../src/input.js";
import { createNavigator } from "../../src/keyboard.js";
import { layoutItems } from "../../src/layout.js";
import type { Layout } from "../../src/layout.js";
import { renderTimeline } from "../../src/render.js";
import {
  loadAt,
  loadLaneOf,
  loadNodes,
  overloads,
  resourceHooks,
  resourceLanes,
  resourceLoad,
  withLoadLanes,
} from "../../src/resources/index.js";
import type { ResourceLoad } from "../../src/resources/index.js";
import { createTimeScale } from "../../src/scale.js";
import type { SceneElement } from "../../src/scene.js";
import type { Command, Item } from "../../src/types.js";
import { makeRandom } from "../property/harness.js";
import { BASE, DAY, edgesOf, generatePlan, HOUR, referenceLoad, referenceOver, sameItems, unitsOf } from "./fixture.js";
import type { Plan } from "./fixture.js";

const SEED = Number(process.env.SDK_RESOURCES_SEED ?? 2222);
const CASES = 300;

/** Every moment the load can differ at: each edge, half-way to the next, and before the first. */
function moments(edges: readonly number[]): number[] {
  if (edges.length === 0) return [BASE];
  const out = [(edges[0] as number) - HOUR];
  edges.forEach((edge, index) => {
    out.push(edge);
    const next = edges[index + 1];
    out.push(next === undefined ? edge + DAY : (edge + next) / 2);
  });
  return out;
}

/** The boxes of a path made of `M x y H x V y H x Z` parts, as [main0, main1, cross0, cross1]. */
function boxes(d: string): [number, number, number, number][] {
  const out: [number, number, number, number][] = [];
  for (const match of d.matchAll(/M(-?[\d.e+]+) (-?[\d.e+]+)H(-?[\d.e+]+)V(-?[\d.e+]+)H/g)) {
    const [x0, y0, x1, y1] = [match[1], match[2], match[3], match[4]].map(Number) as [number, number, number, number];
    out.push([Math.min(x0, x1), Math.max(x0, x1), Math.min(y0, y1), Math.max(y0, y1)]);
  }
  return out;
}

function pathOf(nodes: readonly SceneElement[], className: string): string {
  return String(nodes.find((node) => node.attrs?.class === className)?.attrs?.d ?? "");
}

function walk(node: SceneElement, visit: (node: SceneElement) => void): void {
  visit(node);
  for (const child of node.children ?? []) walk(child, visit);
}

describe("resources", () => {
  it("[claim:load-sum] is the sum of the assignments running at every moment, in stretches that cover exactly the time with work", () => {
    const random = makeRandom(SEED);
    let checked = 0;
    let stacked = 0;
    for (let index = 0; index < CASES; index += 1) {
      const plan = generatePlan(random, { resources: 1 + Math.floor(random() * 5), items: 1 + Math.floor(random() * 30), spreadHours: 24 + Math.floor(random() * 96) });
      const load = resourceLoad(plan.items, plan.resources, { unitsOf });
      // Asked again for the same three: the same object.
      expect(resourceLoad(plan.items, plan.resources, { unitsOf })).toBe(load);
      for (const resource of plan.resources) {
        const segments = load.segments.get(resource.id) ?? [];
        for (const [at, segment] of segments.entries()) {
          expect(segment.end, `case ${String(index)}`).toBeGreaterThan(segment.start);
          expect(segment.load).toBeGreaterThan(0);
          const before = segments[at - 1];
          if (before !== undefined) {
            expect(segment.start).toBeGreaterThanOrEqual(before.end);
            // Side by side with the same load is one stretch.
            if (segment.start === before.end) expect(segment.load).not.toBe(before.load);
          }
        }
        for (const time of moments(edgesOf(plan.items, resource.id))) {
          const expected = referenceLoad(plan.items, resource.id, time);
          expect(loadAt(load, resource.id, time), `case ${String(index)}, ${resource.id} at ${String(time)}`).toBe(expected);
          // Covered by a stretch exactly when there is work.
          const covered = segments.some((segment) => segment.start <= time && time < segment.end);
          expect(covered).toBe(expected > 0);
          if (expected > 1) stacked += 1;
          checked += 1;
        }
      }
    }
    expect(checked).toBeGreaterThan(CASES * 20);
    expect(stacked).toBeGreaterThan(CASES);
  });

  it("[claim:overload-exact] marks the overload exactly where the load is above the capacity — bands, red bars and items", () => {
    const random = makeRandom(SEED + 1);
    let overs = 0;
    let marked = 0;
    let unmarked = 0;
    for (let index = 0; index < CASES; index += 1) {
      const plan = generatePlan(random, { resources: 1 + Math.floor(random() * 4), items: 2 + Math.floor(random() * 24), spreadHours: 48 });
      const load = resourceLoad(plan.items, plan.resources, { unitsOf });
      const lanes = withLoadLanes(resourceLanes(plan.resources), plan.resources, 24);
      const layout = layoutItems(plan.items.filter((item) => item.kind !== "background"), { lanes });
      const domain = [BASE - DAY, BASE + 4 * DAY] as const;
      const scale = createTimeScale(domain, 1000);
      const nodes = loadNodes(layout, load, { scale, orientation: "horizontal" });
      const bands = boxes(pathOf(nodes, "tl-overload"));
      const red = boxes(pathOf(nodes, "tl-load tl-load--over"));
      const grey = boxes(pathOf(nodes, "tl-load"));
      for (const resource of plan.resources) {
        const capacity = load.capacity.get(resource.id) as number;
        const segments = load.segments.get(resource.id) ?? [];
        // Each stretch is over by the reference load, at its own start.
        for (const segment of segments) {
          expect(segment.over, `case ${String(index)}`).toBe(referenceOver(referenceLoad(plan.items, resource.id, segment.start), capacity));
          if (segment.over) overs += 1;
        }
        expect(overloads(load, resource.id)).toEqual(segments.filter((segment) => segment.over));
        // What is drawn for it, in view.
        const own = layout.lanes.find((lane) => lane.lane.id === resource.id);
        const under = layout.lanes.find((lane) => loadLaneOf(lane.lane.id) === resource.id);
        if (own === undefined || under === undefined) throw new Error("a resource without its lanes");
        const span = (segment: { start: number; end: number }): [number, number] => [
          Math.max(scale.toMain(segment.start), 0),
          Math.min(scale.toMain(segment.end), 1000),
        ];
        const inView = segments.filter((segment) => {
          const [from, to] = span(segment);
          return to > from;
        });
        const round = (box: readonly number[]): string => box.slice(0, 2).map((value) => value.toFixed(2)).join("-");
        const expectOver = inView.filter((segment) => segment.over).map((segment) => round(span(segment)));
        const inLane = (list: readonly number[][], lane: { cross: number; crossSize: number }): string[] =>
          list.filter((box) => (box[2] as number) >= lane.cross - 0.01 && (box[3] as number) <= lane.cross + lane.crossSize + 0.01).map(round);
        expect(inLane(bands, own), `case ${String(index)}, bands of ${resource.id}`).toEqual(expectOver);
        expect(inLane(red, under), `case ${String(index)}, red bars of ${resource.id}`).toEqual(expectOver);
        expect(inLane(grey, under).length + inLane(red, under).length).toBe(inView.length);
      }
      // The items marked overbooked: exactly those running while their
      // resource's reference load is over — at any edge inside them.
      const frame = renderTimeline({
        items: plan.items.filter((item) => item.kind !== "background"),
        lanes,
        domain,
        width: 1000,
        height: layout.crossSize + 80,
        hooks: resourceHooks({}, { load }),
      });
      const drawn = new Map<string, boolean>();
      walk(frame.scene, (node) => {
        const id = node.attrs?.["data-tl-id"];
        // A label carries the id too: the item is marked when any of its nodes is.
        if (typeof id === "string") drawn.set(id, (drawn.get(id) ?? false) || String(node.attrs?.class ?? "").includes("tl-item--overbooked"));
      });
      for (const placed of frame.layout.items) {
        if (!drawn.has(placed.item.id)) continue;
        const capacity = load.capacity.get(placed.laneId);
        const times = capacity === undefined ? [] : [placed.span.start, ...edgesOf(plan.items, placed.laneId).filter((time) => time > placed.span.start && time < placed.span.end)];
        const expected = times.some((time) => referenceOver(referenceLoad(plan.items, placed.laneId, time), capacity as number));
        expect(drawn.get(placed.item.id), `case ${String(index)}, item ${placed.item.id}`).toBe(expected);
        if (expected) marked += 1;
        else unmarked += 1;
      }
    }
    expect(overs).toBeGreaterThan(CASES / 2);
    expect(marked).toBeGreaterThan(CASES / 2);
    expect(unmarked).toBeGreaterThan(CASES);
  });

  it("[claim:reassign] moves work between resources as one reversible command, by a drag onto any row and by Alt and an arrow", () => {
    const random = makeRandom(SEED + 2);
    let dragged = 0;
    let ontoLoadLane = 0;
    let keyed = 0;
    for (let index = 0; index < CASES; index += 1) {
      const generated = generatePlan(random, { resources: 2 + Math.floor(random() * 4), items: 2 + Math.floor(random() * 16), spreadHours: 48 });
      // Work in the resources' lanes only: a row that is no resource is another test's business.
      const plan: Plan = { resources: generated.resources, items: generated.items.filter((item) => item.laneId !== "elsewhere" && item.kind !== "background") };
      const lanes = withLoadLanes(resourceLanes(plan.resources), plan.resources, 24);
      const layout: Layout<{ units: number }> = layoutItems(plan.items, { lanes });
      const scale = createTimeScale([BASE - DAY, BASE + 4 * DAY], 1000);
      const tester = createHitTester({ layout, scale });
      const laneAt = (cross: number): string | undefined => {
        const id = tester.laneAt(cross);
        return id === undefined ? undefined : (loadLaneOf(id) ?? id);
      };
      const candidates = layout.items.filter((placed) => placed.item.end !== undefined && placed.item.open !== true && scale.toMain(placed.span.end) - scale.toMain(placed.span.start) > 8 && scale.toMain(placed.span.start) > 0 && scale.toMain(placed.span.end) < 1000);
      const placed = candidates[Math.floor(random() * candidates.length)];
      if (placed === undefined) continue;
      const machine = createInputMachine<{ units: number }>({
        domain: [BASE - DAY, BASE + 4 * DAY],
        mainSize: 1000,
        crossSize: layout.crossSize,
        contentCrossSize: layout.crossSize,
        editing: { enabled: true, moveTrigger: "edit-mode", crossLane: true, snapMs: HOUR, hitTest: tester.hitTest, lookup: tester.lookup, laneAt },
        keyboard: { reducedMotion: true, navigator: createNavigator({ ...layout, lanes: layout.lanes.filter((lane) => loadLaneOf(lane.lane.id) === undefined) }) },
      });
      const main = (scale.toMain(placed.span.start) + scale.toMain(placed.span.end)) / 2;
      const cross = placed.cross + placed.crossSize / 2;
      // Anywhere across the rows, load lanes included.
      const to = Math.floor(random() * layout.crossSize);
      const shift = Math.round((random() - 0.5) * 200);
      let time = 0;
      const effects: InputEffect<{ units: number }>[] = [...machine.handle({ pointerId: 1, phase: "down", x: main, y: cross, time, pointerType: "mouse" })];
      for (let step = 1; step <= 8; step += 1) {
        effects.push(...machine.handle({ pointerId: 1, phase: "move", x: main + (shift * step) / 8, y: cross + ((to - cross) * step) / 8, time: (time += 16), pointerType: "mouse" }));
      }
      effects.push(...machine.handle({ pointerId: 1, phase: "up", x: main + shift, y: to, time: (time += 16), pointerType: "mouse" }));
      const command = effects.flatMap((effect) => (effect.type === "editEnd" && effect.command !== undefined ? [effect.command as Command] : []))[0];
      const target = laneAt(to);
      if (command === undefined) {
        // Nothing moved: no lane change and no shift a snap keeps.
        expect(target === placed.laneId || target === undefined).toBe(true);
      } else {
        expect(command.type, `case ${String(index)}`).toBe("move");
        expect(command.after.map((patch) => patch.id)).toEqual([placed.item.id]);
        const patch = command.after[0];
        if (patch !== undefined && "laneId" in patch) {
          // On a row, it is that row's resource; let go between the rows,
          // the row it was last over — the core's crossLane contract ("keeps
          // the lane when the pointer leaves every lane"). Never `null`:
          // that took the item off every row.
          if (target !== undefined) expect(patch.laneId).toBe(target);
          expect(loadLaneOf(String(patch.laneId))).toBeUndefined();
          expect(plan.resources.some((resource) => resource.id === patch.laneId)).toBe(true);
        }
        if (loadLaneOf(tester.laneAt(to) ?? "") !== undefined && target !== placed.laneId) ontoLoadLane += 1;
        const moved = applyPatches(plan.items, command.after) as Item<{ units: number }>[];
        const after = resourceLoad(moved, plan.resources, { unitsOf });
        for (const resource of plan.resources) {
          for (const at of moments(edgesOf(moved, resource.id))) expect(loadAt(after, resource.id, at)).toBe(referenceLoad(moved, resource.id, at));
        }
        expect(sameItems(plan.items, applyPatches(moved, command.inverse.after))).toBeUndefined();
        dragged += 1;
      }
      // The key: to the next resource across, over its load lane.
      machine.setFocus(placed.item.id);
      const order = plan.resources.map((resource) => resource.id);
      const next = order[order.indexOf(placed.laneId) + 1];
      const pressed = machine.key({ key: "ArrowDown", altKey: true, shiftKey: false, ctrlKey: false, metaKey: false, time: time + 500 });
      const keyCommand = pressed.flatMap((effect) => (effect.type === "editEnd" && effect.command !== undefined ? [effect.command as Command] : []))[0];
      if (next === undefined) {
        expect(keyCommand).toBeUndefined();
      } else {
        if (keyCommand === undefined) throw new Error(`case ${String(index)}: Alt+ArrowDown moved nothing`);
        expect(keyCommand.type).toBe("move");
        expect(keyCommand.after).toEqual([expect.objectContaining({ id: placed.item.id, laneId: next })]);
        expect(sameItems(plan.items, applyPatches(applyPatches(plan.items, keyCommand.after), keyCommand.inverse.after))).toBeUndefined();
        keyed += 1;
      }
    }
    expect(dragged).toBeGreaterThan(CASES / 2);
    expect(ontoLoadLane).toBeGreaterThan(CASES / 10);
    expect(keyed).toBeGreaterThan(CASES / 4);
  });
});

describe("the load at its edges", () => {
  it("measures nothing for a resource with no work, and a capacity of zero is over at any load", () => {
    const resources = [{ id: "a", capacity: 0 }, { id: "b", capacity: -1 }, { id: "c", capacity: Number.NaN }, { id: "d" }];
    const items: Item[] = [{ id: "x", start: BASE, end: BASE + HOUR, laneId: "a" }];
    const load: ResourceLoad = resourceLoad(items, resources);
    expect(load.capacity.get("a")).toBe(0);
    expect(load.capacity.get("b")).toBe(1);
    expect(load.capacity.get("c")).toBe(1);
    expect(load.capacity.get("d")).toBe(1);
    expect(load.segments.get("a")).toEqual([{ start: BASE, end: BASE + HOUR, load: 1, over: true }]);
    expect(load.segments.get("d")).toEqual([]);
    expect(loadAt(load, "nobody", BASE)).toBe(0);
    expect(overloads(load, "a", BASE + HOUR)).toEqual([]);
    expect(overloads(load, "a", BASE - DAY, BASE)).toEqual([]);
    expect(overloads(load, "nobody")).toEqual([]);
  });
});
