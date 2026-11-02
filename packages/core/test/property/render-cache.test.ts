/**
 * The layout cache is never stale.
 *
 * The renderer remembers the last layout per items array, because packing is
 * done in time and a pan or zoom does not change it (31 of 33 ms of a
 * frame at 10 000 items). A cache like that is only worth having if it can
 * never be caught out — and the way it gets caught out is a host mutating the
 * array it already handed over: pushing an item, replacing one, swapping the
 * lane list. Plain JavaScript does that all the time.
 *
 * So the property drives one items array and one lanes array through a
 * generated sequence of exactly those mutations, renders after every step,
 * and compares the bytes with a render from fresh copies — which cannot hit
 * the cache, because the cache is keyed by the array.
 */

import { afterAll, describe, it } from "vitest";

import { renderTimeline } from "../../src/render.js";
import { renderToSvgString } from "../../src/scene.js";
import type { Density, Item, Lane, PackMode } from "../../src/types.js";
import { forAll, generateCase, makeRandom, writePropertyReport } from "./harness.js";
import type { GeneratedCase } from "./harness.js";

const DAY = 86_400_000;
const ORIGIN = Date.UTC(2020, 0, 1);
const DOMAIN: readonly [number, number] = [ORIGIN, ORIGIN + 400 * DAY];
const CASES = 600;

type Step =
  | { readonly kind: "push"; readonly item: Item }
  | { readonly kind: "replace"; readonly index: number; readonly item: Item }
  | { readonly kind: "remove"; readonly index: number }
  | { readonly kind: "lanes-push"; readonly lane: Lane }
  | { readonly kind: "lanes-replace"; readonly index: number; readonly lane: Lane }
  | { readonly kind: "density"; readonly density: Density }
  | { readonly kind: "pack"; readonly packMode: PackMode }
  | { readonly kind: "pan"; readonly days: number }
  | { readonly kind: "new-array" };

const DENSITIES: readonly Density[] = ["comfortable", "compact", "dense"];
const PACKS: readonly PackMode[] = ["pack", "overlap", "single"];

function randomItem(random: () => number, serial: number, laneCount: number): Item {
  const start = ORIGIN + Math.floor(random() * 380) * DAY;
  return {
    id: `n${String(serial)}`,
    start,
    end: start + Math.floor(1 + random() * 40) * DAY,
    laneId: `lane-${String(Math.floor(random() * laneCount))}`,
    label: `New ${String(serial)}`,
  };
}

function generate(random: () => number): GeneratedCase<Step> {
  const base = generateCase(random, { open: true, tall: true, lanes: 3 });
  const steps: Step[] = [];
  const count = 2 + Math.floor(random() * 8);
  for (let index = 0; index < count; index += 1) {
    const roll = Math.floor(random() * 9);
    const at = Math.floor(random() * 30);
    if (roll === 0) {
      steps.push({ kind: "push", item: randomItem(random, index, 4) });
    } else if (roll === 1) {
      steps.push({ kind: "replace", index: at, item: randomItem(random, 100 + index, 4) });
    } else if (roll === 2) {
      steps.push({ kind: "remove", index: at });
    } else if (roll === 3) {
      steps.push({ kind: "lanes-push", lane: { id: `lane-${String(3 + index)}`, pinned: random() < 0.5 } });
    } else if (roll === 4) {
      steps.push({
        kind: "lanes-replace",
        index: at % 3,
        lane: { id: `lane-${String(at % 3)}`, pinned: random() < 0.5, packMode: PACKS[at % 3] as PackMode },
      });
    } else if (roll === 5) {
      steps.push({ kind: "density", density: DENSITIES[at % 3] as Density });
    } else if (roll === 6) {
      steps.push({ kind: "pack", packMode: PACKS[at % 3] as PackMode });
    } else if (roll === 7) {
      steps.push({ kind: "pan", days: at - 15 });
    } else {
      steps.push({ kind: "new-array" });
    }
  }
  return {
    items: base.items,
    lanes: base.lanes ?? [{ id: "lane-0" }, { id: "lane-1" }, { id: "lane-2" }],
    steps,
  };
}

/** Render with the live arrays, then with fresh copies, and compare. */
function check(generated: GeneratedCase<Step>): string | undefined {
  // The SAME arrays throughout: every mutation below lands in them in place,
  // which is the case the cache has to notice.
  let items: Item[] = [...generated.items];
  const lanes: Lane[] = [...(generated.lanes ?? [])];
  let density: Density = "comfortable";
  let packMode: PackMode | undefined;
  let domain: readonly [number, number] = DOMAIN;
  const frame = (live: boolean): string =>
    renderToSvgString(
      renderTimeline({
        items: live ? items : items.map((item) => ({ ...item })),
        lanes: live ? lanes : lanes.map((lane) => ({ ...lane })),
        domain,
        width: 800,
        height: 600,
        density,
        ...(packMode === undefined ? {} : { packMode }),
      }).scene,
    );
  const steps = generated.steps ?? [];
  for (let index = -1; index < steps.length; index += 1) {
    const step = steps[index];
    if (step !== undefined) {
      if (step.kind === "push") {
        items.push(step.item);
      } else if (step.kind === "replace") {
        if (items.length > 0) {
          items[step.index % items.length] = step.item;
        }
      } else if (step.kind === "remove") {
        if (items.length > 0) {
          items.splice(step.index % items.length, 1);
        }
      } else if (step.kind === "lanes-push") {
        lanes.push(step.lane);
      } else if (step.kind === "lanes-replace") {
        lanes[step.index] = step.lane;
      } else if (step.kind === "density") {
        density = step.density;
      } else if (step.kind === "pack") {
        packMode = step.packMode;
      } else if (step.kind === "pan") {
        domain = [domain[0] + step.days * DAY, domain[1] + step.days * DAY];
      } else {
        items = [...items];
      }
    }
    // Twice live: the second call is the one served from the cache.
    frame(true);
    const cached = frame(true);
    const fresh = frame(false);
    if (cached !== fresh) {
      return `after step ${String(index + 1)} (${step?.kind ?? "initial"}) the cached frame differs from a fresh one`;
    }
  }
  return undefined;
}

describe("layout cache", () => {
  it("never serves a stale layout, whatever the host does to its arrays", () => {
    forAll("a cached layout is never stale", CASES, 0xcac4e, generate, check);
  });

  it("is actually used: the second frame of a pan returns the same layout object", () => {
    const random = makeRandom(7);
    const items = generateCase(random, { lanes: 2 }).items;
    const first = renderTimeline({ items, domain: DOMAIN, width: 800, height: 600 });
    const panned = renderTimeline({
      items,
      domain: [DOMAIN[0] + 5 * DAY, DOMAIN[1] + 5 * DAY],
      width: 800,
      height: 600,
    });
    if (first.layout !== panned.layout) {
      throw new Error("the pan recomputed the layout — the cache is not in the path");
    }
  });
});

afterAll(() => {
  writePropertyReport("render-cache");
});
