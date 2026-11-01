import { writeFileSync } from "node:fs";

import { afterAll, describe, expect, it } from "vitest";

import { renderTimeline } from "../../src/render.js";
import type { RenderOptions } from "../../src/render.js";
import { clampDomain, panDomainBy, zoomDomainAt } from "../../src/scale.js";
import { planSceneSpace } from "../../src/scene-space.js";
import type { SceneSpace } from "../../src/scene-space.js";
import type { SceneElement } from "../../src/scene.js";
import type { Density, Domain, Item, Orientation } from "../../src/types.js";
import { makeRandom } from "../property/harness.js";
import { DAY, denseUniverse, measure, membersFrom, ORIGIN, readFrame } from "./fixture.js";
import type { FrameReading, MembersOf } from "./fixture.js";

/**
 * G-CLUSTER: the counts of the clusters ALWAYS add up to the items shown —
 * no item is lost.
 *
 * Each schedule is a seeded walk over a dense universe: bursts of zoom steps
 * in and out, pans of every length, lane scrolls, density changes now and
 * then. After every step the frame is rendered twice — with clustering, and
 * without it, which is what "visible" means — and the clustered one is read
 * back from its scene and measured (`fixture.ts`). Half the schedules draw
 * every frame through a scene space planned the way a host plans it, so the
 * P7 tile cache hands tiles from one frame to the next; the log counts how
 * many, so a cache that never hit would show.
 *
 * Two more things are checked along the way. A pan never changes a count:
 * at one zoom level, a marker drawn in two frames says the same number in
 * both. And the NEGATIVE CONTROLS run the same meter over two broken
 * renderings — one that forgets the last member of each cluster, one that
 * draws a member a second time — and the meter has to catch them.
 */

const SCHEDULES = 200;
const STEPS = 40;
const DENSITIES: readonly Density[] = ["comfortable", "compact", "dense"];
/** The floors that keep the measurement from being vacuous; the gate script reads the same numbers. */
const MIN_FRAMES_WITH_MARKERS = 1500;
const MIN_MARKERS = 10_000;
const MIN_TAMPERED = 1000;

interface Totals {
  schedules: number;
  frames: number;
  framesWithMarkers: number;
  markers: number;
  /** Frames whose counts add up to the visible set exactly, with nothing beyond it. */
  exactFrames: number;
  /** Frames with a marker across the culling edge: their sum is the visible set plus its far members. */
  straddleFrames: number;
  visible: number;
  sum: number;
  extras: number;
  spacedFrames: number;
  reusedTiles: number;
  panChecks: number;
  problems: number;
}

function emptyTotals(): Totals {
  return {
    schedules: 0,
    frames: 0,
    framesWithMarkers: 0,
    markers: 0,
    exactFrames: 0,
    straddleFrames: 0,
    visible: 0,
    sum: 0,
    extras: 0,
    spacedFrames: 0,
    reusedTiles: 0,
    panChecks: 0,
    problems: 0,
  };
}

/** The tile groups of a frame's item layer, as objects: the same object twice is a reused tile. */
function tiles(scene: SceneElement): readonly SceneElement[] {
  const layer = (scene.children ?? []).find((child) => child.attrs?.class === "tl-layer tl-layer--items");
  return (layer?.children ?? []).filter((node) => node.attrs?.["data-tl-tile"] !== undefined);
}

type Control = (
  clustered: FrameReading,
  members: MembersOf,
  plain: FrameReading,
) => { reading: FrameReading; members: MembersOf } | undefined;

/**
 * Leaves one item on screen out of every cluster — and still hides it: a
 * marker whose count and member list agree with each other, and not with
 * what is there.
 */
const forgetful: Control = (clustered, members, plain) => {
  if (clustered.markers.length === 0) {
    return undefined;
  }
  const visible = new Set(plain.singles);
  const forget = (id: string): readonly string[] | undefined => {
    const all = members(id);
    const dropped = all?.find((member) => visible.has(member));
    return all?.filter((member) => member !== dropped);
  };
  return {
    reading: { ...clustered, markers: clustered.markers.map((marker) => ({ ...marker, count: forget(marker.id)?.length ?? 0 })) },
    members: forget,
  };
};

/** Draws the first member of the first cluster as itself too. */
const doubling: Control = (clustered, members) => {
  const first = clustered.markers[0];
  const member = first === undefined ? undefined : members(first.id)?.[0];
  return member === undefined ? undefined : { reading: { ...clustered, singles: [...clustered.singles, member] }, members };
};

function runSchedule(
  seed: number,
  orientation: Orientation,
  spaced: boolean,
  totals: Totals,
  problems: string[],
  control?: { readonly tamper: Control; readonly caught: { caught: number; tampered: number } },
): void {
  const random = makeRandom(seed);
  const { items, lanes } = denseUniverse(random);
  // The oracle draws from its own array: the renderer's caches are keyed by
  // the array, and sharing one would make every frame drop the tiles the
  // clustered frame is meant to reuse.
  const plainItems: readonly Item[] = [...items];
  const width = 360 + Math.floor(random() * 900);
  const height = 160 + Math.floor(random() * 420);
  const mainSize = orientation === "horizontal" ? width : height;
  const settings = (): true | { gap: number; itemSize: number; minCount: number } =>
    random() < 0.25 ? { gap: 1 + random() * 10, itemSize: 4 + random() * 20, minCount: 2 + Math.floor(random() * 3) } : true;
  let cluster = settings();
  // Log-uniform from a week to three years: dense enough to cluster at one
  // end, sparse enough to dissolve at the other.
  const firstSpan = 7 * DAY * 150 ** random();
  let domain: Domain = [ORIGIN + random() * 700 * DAY - firstSpan / 2, 0];
  domain = [domain[0], domain[0] + firstSpan];
  let density: Density = DENSITIES[Math.floor(random() * 3)] as Density;
  let crossOffset = 0;
  let space: SceneSpace | undefined;
  const counts = new Map<string, number>();
  let countsAt: string | undefined;
  let previousTiles = new Set<SceneElement>();

  const frame = (settle: boolean): void => {
    space = spaced ? planSceneSpace(space, { domain, mainSize }, { settle }) : undefined;
    const base: RenderOptions = {
      items,
      lanes,
      domain,
      width,
      height,
      orientation,
      density,
      crossOffset,
      ...(space === undefined ? {} : { space }),
    };
    const clustered = renderTimeline({ ...base, cluster });
    const plain = renderTimeline({ ...base, items: plainItems });
    const reading = readFrame(clustered.scene);
    const plainReading = readFrame(plain.scene);
    const members = membersFrom(clustered);
    totals.frames += 1;
    if (control !== undefined) {
      const tampered = control.tamper(reading, members, plainReading);
      if (tampered !== undefined) {
        control.caught.tampered += 1;
        if (measure(tampered.reading, plainReading, tampered.members).problems.length > 0) {
          control.caught.caught += 1;
        }
      }
      return;
    }
    const measured = measure(reading, plainReading, members, {
      visibleCount: clustered.visibleCount,
      markerIds: clustered.clusters.map((marker) => marker.cluster.id),
    });
    const where = `seed ${String(seed)} ${orientation}${spaced ? " spaced" : ""} frame ${String(totals.frames)}`;
    problems.push(...measured.problems.map((problem) => `${where}: ${problem}`));
    totals.problems += measured.problems.length;
    totals.visible += measured.visible;
    totals.sum += measured.sum;
    totals.extras += measured.extras;
    totals.markers += measured.markers;
    if (measured.markers > 0) {
      totals.framesWithMarkers += 1;
    }
    if (measured.extras === 0 && measured.sum === measured.visible) {
      totals.exactFrames += 1;
    } else if (measured.extras > 0 && measured.sum === measured.visible + measured.extras) {
      totals.straddleFrames += 1;
    }
    // A pan never changes a count: at one zoom level (and one density, whose
    // minimum item width is part of a gap), a marker says the same in every frame.
    const zoom = `${String(clustered.clustering?.msPerPx)}|${density}`;
    if (zoom !== countsAt) {
      counts.clear();
      countsAt = zoom;
    }
    for (const marker of reading.markers) {
      const before = counts.get(marker.id);
      if (before !== undefined) {
        totals.panChecks += 1;
        if (before !== marker.count) {
          problems.push(`${where}: marker ${marker.id} said ${String(before)} before a pan, ${String(marker.count)} after`);
          totals.problems += 1;
        }
      }
      counts.set(marker.id, marker.count);
    }
    if (space !== undefined) {
      totals.spacedFrames += 1;
      const now = tiles(clustered.scene);
      totals.reusedTiles += now.filter((tile) => previousTiles.has(tile)).length;
      previousTiles = new Set(now);
    }
  };

  frame(true);
  for (let step = 0; step < STEPS; step += 1) {
    const roll = random();
    if (roll < 0.4) {
      // A burst of zoom steps, as a wheel or a pinch makes them.
      const burst = 1 + Math.floor(random() * 6);
      const inward = random() < 0.5;
      const anchor = random() * mainSize;
      for (let index = 0; index < burst; index += 1) {
        // Symmetric in log space, so the walk does not drift in or out.
        const step = 1.1 + random() * 1.4;
        domain = clampDomain(zoomDomainAt(domain, mainSize, anchor, inward ? step : 1 / step), {
          minSpanMs: 6 * 3_600_000,
          maxSpanMs: 1500 * DAY,
        });
        frame(false);
      }
      frame(true);
    } else if (roll < 0.8) {
      // Pans, from a nudge to several viewports.
      const pans = 1 + Math.floor(random() * 5);
      for (let index = 0; index < pans; index += 1) {
        const reach = random() < 0.7 ? 0.05 + random() * 0.5 : 1 + random() * 3;
        // Back towards the data when the walk has wandered off it.
        const centre = (domain[0] + domain[1]) / 2;
        const sign = centre < ORIGIN ? 1 : centre > ORIGIN + 730 * DAY ? -1 : random() < 0.5 ? -1 : 1;
        domain = panDomainBy(domain, mainSize, sign * reach * mainSize);
        frame(false);
      }
      frame(true);
    } else if (roll < 0.9) {
      crossOffset = random() < 0.3 ? 0 : Math.floor(random() * 400);
      frame(true);
    } else if (roll < 0.95) {
      density = DENSITIES[Math.floor(random() * 3)] as Density;
      frame(true);
    } else {
      // New settings in the same space: every tile drawn with the old ones is stale.
      cluster = settings();
      counts.clear();
      frame(false);
    }
  }
  totals.schedules += 1;
}

const log: Record<string, unknown> = {};

afterAll(() => {
  writeFileSync(".cluster-log.json", `${JSON.stringify(log, null, 2)}\n`);
});

describe("cluster counts always add up to the items shown", () => {
  for (const orientation of ["horizontal", "vertical"] as const) {
    it(`[claim:conservation] ${orientation}: ${String(SCHEDULES / 2)} seeded schedules, every frame read back and measured`, () => {
      const totals = emptyTotals();
      const problems: string[] = [];
      const base = orientation === "horizontal" ? 1 : 200_001;
      for (let index = 0; index < SCHEDULES / 2; index += 1) {
        runSchedule(base + index, orientation, index % 2 === 1, totals, problems);
      }
      log[`conservation:${orientation}`] = { seeds: [base, base + SCHEDULES / 2 - 1], ...totals, firstProblems: problems.slice(0, 5) };
      expect(problems.slice(0, 5)).toEqual([]);
      // Not vacuous: markers were drawn in most frames, through the tile cache too.
      expect(totals.framesWithMarkers).toBeGreaterThan(MIN_FRAMES_WITH_MARKERS);
      expect(totals.markers).toBeGreaterThan(MIN_MARKERS);
      expect(totals.straddleFrames).toBeGreaterThan(0);
      expect(totals.reusedTiles).toBeGreaterThan(totals.spacedFrames);
      expect(totals.panChecks).toBeGreaterThan(totals.frames);
      expect(totals.exactFrames + totals.straddleFrames).toBe(totals.frames);
    }, 240_000);
  }

  for (const [name, tamper] of [
    ["forgetful", forgetful],
    ["doubling", doubling],
  ] as const) {
    it(`[claim:negative-control] the meter catches a ${name} rendering`, () => {
      const totals = emptyTotals();
      const caught = { caught: 0, tampered: 0 };
      for (let index = 0; index < 40; index += 1) {
        runSchedule(1 + index, index % 2 === 0 ? "horizontal" : "vertical", index % 4 >= 2, totals, [], { tamper, caught });
      }
      log[`control:${name}`] = { schedules: totals.schedules, frames: totals.frames, ...caught };
      expect(caught.tampered).toBeGreaterThan(MIN_TAMPERED);
      // Every broken frame is caught: the forgotten member is visible in all
      // of them, or the doubled one is shown twice.
      expect(caught.caught).toBe(caught.tampered);
    }, 120_000);
  }
});
