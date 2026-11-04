/**
 * The gantt-a11y check: a task's predecessors and successors, for a reader who
 * cannot see the arrows.
 *
 * Two claims, on generated projects:
 *
 *  - every predecessor and every successor of a task is named in the task's
 *    accessible name — the rendered option's `aria-label`, not only the
 *    function that builds it (`links-named`);
 *  - from any task, `[` reaches each of its predecessors and `]` each of its
 *    successors, pressed again and again, and nothing else (`key-jumps`).
 */

import { describe, expect, it } from "vitest";

import {
  dependencyKeyStep,
  dependencyLinks,
  describeDependencies,
  ganttHooks,
  resolveDependencyKey,
} from "../../src/gantt/index.js";
import type { Dependency, DependencyKeyAction, DependencyType } from "../../src/gantt/index.js";
import { renderTimeline } from "../../src/render.js";
import type { SceneElement } from "../../src/scene.js";
import type { Item } from "../../src/types.js";
import { makeRandom } from "../property/harness.js";

const DAY = 86_400_000;
const ORIGIN = Date.UTC(2025, 0, 1);
const SEED = Number(process.env.SDK_GANTT_A11Y_SEED ?? 2021);
const CASES = 60;

function generate(random: () => number): { items: Item[]; dependencies: Dependency[] } {
  const count = 2 + Math.floor(random() * 15);
  const items: Item[] = Array.from({ length: count }, (_, at) => {
    const start = ORIGIN + Math.floor(random() * 20) * DAY;
    return { id: `t${String(at)}`, start, end: start + (1 + Math.floor(random() * 5)) * DAY, label: `Task ${String(at)}`, laneId: `l${String(at)}` };
  });
  const dependencies: Dependency[] = [];
  const seen = new Set<string>();
  for (let at = 0; at < count * 1.5; at += 1) {
    const from = items[Math.floor(random() * count)] as Item;
    const to = items[Math.floor(random() * count)] as Item;
    const key = `${from.id}->${to.id}`;
    if (from.id === to.id || seen.has(key)) continue;
    seen.add(key);
    dependencies.push({ from: from.id, to: to.id, type: (["FS", "SS", "FF", "SF"] as const)[Math.floor(random() * 4)] as DependencyType });
  }
  return { items, dependencies };
}

function labels(node: SceneElement, into = new Map<string, string>()): Map<string, string> {
  const id = node.attrs?.["data-tl-id"];
  const label = node.attrs?.["aria-label"];
  if (node.attrs?.role === "option" && typeof id === "string" && typeof label === "string") into.set(id, label);
  for (const child of node.children ?? []) labels(child, into);
  return into;
}

// eslint-disable-next-line no-console
console.log(`[gantt-a11y] seed=${String(SEED)} cases=${String(CASES)}`);

describe("a task's dependencies, without the arrows", () => {
  it("[claim:links-named] every predecessor and successor is in the task's accessible name, as rendered", () => {
    const random = makeRandom(SEED);
    let named = 0;
    for (let at = 0; at < CASES; at += 1) {
      const { items, dependencies } = generate(random);
      const lanes = items.map((item) => ({ id: item.laneId as string, label: `Row ${item.id}` }));
      const frame = renderTimeline({
        items,
        lanes,
        domain: [ORIGIN - DAY, ORIGIN + 30 * DAY],
        width: 1200,
        height: 2000,
        hooks: ganttHooks({}, { dependencies, items, lanes: new Map(lanes.map((lane) => [lane.id, lane.label])) }),
      });
      const names = labels(frame.scene);
      const links = dependencyLinks(dependencies);
      for (const item of items) {
        const name = names.get(item.id);
        expect(name, `no option for ${item.id}`).toBeDefined();
        for (const dependency of links.predecessors.get(item.id) ?? []) {
          expect(name).toContain(`after`);
          expect(name).toContain(`Task ${dependency.from.slice(1)} (`);
          named += 1;
        }
        for (const dependency of links.successors.get(item.id) ?? []) {
          expect(name).toContain(`before`);
          expect(name).toContain(`Task ${dependency.to.slice(1)} (`);
          named += 1;
        }
        // The default name is still there: label and lane.
        expect(name).toContain(item.label as string);
        expect(name).toContain(`Row ${item.id}`);
      }
    }
    expect(named).toBeGreaterThan(200);
  });

  it("[claim:key-jumps] [ and ] reach every predecessor and successor, round, and nothing else", () => {
    const random = makeRandom(SEED + 1);
    for (let at = 0; at < CASES; at += 1) {
      const { items, dependencies } = generate(random);
      const links = dependencyLinks(dependencies);
      for (const item of items) {
        for (const action of ["predecessor", "successor"] as DependencyKeyAction[]) {
          const expected = new Set(
            action === "predecessor"
              ? (links.predecessors.get(item.id) ?? []).map((dependency) => dependency.from)
              : (links.successors.get(item.id) ?? []).map((dependency) => dependency.to),
          );
          const reached = new Set<string>();
          let focused = item.id;
          let memory: { origin: string; action: DependencyKeyAction; last: string } | undefined;
          for (let press = 0; press < expected.size * 2 + 1; press += 1) {
            const step = dependencyKeyStep(dependencies, focused, action, memory);
            if (step === undefined) break;
            reached.add(step.focus);
            memory = { origin: step.origin, action, last: step.focus };
            focused = step.focus;
          }
          expect([...reached].sort()).toEqual([...expected].sort());
        }
      }
    }
  });

  it("reads [ and ] with no modifier but Shift", () => {
    const sample = { key: "[", shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, time: 0 };
    expect(resolveDependencyKey(sample)).toBe("predecessor");
    expect(resolveDependencyKey({ ...sample, key: "]" })).toBe("successor");
    expect(resolveDependencyKey({ ...sample, ctrlKey: true })).toBeUndefined();
    expect(resolveDependencyKey({ ...sample, key: "a" })).toBeUndefined();
  });

  it("says the type and the lag", () => {
    const dependencies: Dependency[] = [{ from: "a", to: "b", type: "SS", lagMs: 2 * DAY }, { from: "b", to: "c", lagMs: -3_600_000 }];
    const names = new Map([["a", "Design"], ["b", "Build"], ["c", "Launch"]]);
    expect(describeDependencies("b", dependencyLinks(dependencies), (id) => names.get(id) ?? id)).toBe(
      "after Design (start-to-start, lag 2 d); before Launch (finish-to-start, lead 1 h)",
    );
    expect(dependencyKeyStep(dependencies, null, "successor")).toBeUndefined();
  });
});
