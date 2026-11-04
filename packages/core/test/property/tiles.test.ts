/**
 * A frame drawn in tiles is one frame: labels never collide across a tile
 * edge, and what was cached before never changes what is drawn now.
 *
 * Labels are placed tile by tile, each tile knowing nothing of its
 * neighbours' labels — only of the items crossing it. That is safe for two
 * reasons the renderer states and this property checks from the outside:
 * every item reserves its extent in every tile it crosses, and a label
 * placed after its item stays inside its own tile. If either rule broke, two
 * labels would overlap somewhere near a tile edge, or a label would land on
 * an item, and the check below would find it.
 *
 * The second half is the cache. Tiles are kept between frames, so the same
 * input must give the same bytes whatever was drawn before it: the frame is
 * rendered once from a fresh cache and once after a different extent warmed
 * it, and the two scenes must be identical.
 */

import { afterAll, describe, expect, it } from "vitest";

import { containerExtents } from "../../src/geometry.js";
import { itemRect } from "../../src/layout.js";
import { renderTimeline } from "../../src/render.js";
import type { RenderOptions } from "../../src/render.js";
import { createTimeScale } from "../../src/scale.js";
import type { SceneElement } from "../../src/scene.js";
import { planSceneSpace } from "../../src/scene-space.js";
import type { SceneSpace } from "../../src/scene-space.js";
import type { Density, Item, Orientation } from "../../src/types.js";
import { forAll, generateCase, writePropertyReport } from "./harness.js";
import type { GeneratedCase } from "./harness.js";

const DAY = 86_400_000;
const ORIGIN = Date.UTC(2020, 0, 1);
const CASES = 600;
const ORIENTATIONS: readonly Orientation[] = ["horizontal", "vertical"];
const DENSITIES: readonly Density[] = ["comfortable", "compact", "dense"];

interface View {
  readonly orientation: Orientation;
  readonly density: Density;
  readonly domain: readonly [number, number];
  readonly width: number;
  readonly height: number;
  readonly shift: number;
  readonly stretch: number;
  readonly reachBefore: number;
  readonly reachAfter: number;
  /** The extent a previous frame drew, to warm the cache with. */
  readonly warmShift: number;
  readonly labels: readonly string[];
}

function generate(random: () => number): GeneratedCase<View> {
  const base = generateCase(random, { open: true, tall: true, granularity: true, lanes: 3 });
  const start = ORIGIN + Math.floor(random() * 300) * DAY;
  const labels = base.items.map(() => "x".repeat(1 + Math.floor(random() * 14)));
  const view: View = {
    orientation: ORIENTATIONS[Math.floor(random() * 2)] as Orientation,
    density: DENSITIES[Math.floor(random() * 3)] as Density,
    domain: [start, start + Math.floor(5 + random() * 120) * DAY],
    width: 300 + Math.floor(random() * 900),
    height: 200 + Math.floor(random() * 500),
    shift: (random() - 0.5) * 1500,
    stretch: 0.7 + random() * 0.8,
    reachBefore: random() * 1.5,
    reachAfter: random() * 1.5,
    warmShift: (random() - 0.5) * 2,
    labels,
  };
  return { ...base, steps: [view] };
}

function check(generated: GeneratedCase<View>): string | undefined {
  const view = generated.steps?.[0];
  if (view === undefined) {
    return undefined;
  }
  const items: Item[] = generated.items.map((item, index) => ({ ...item, label: view.labels[index] ?? "" }));
  const { mainSize } = containerExtents(view.width, view.height, view.orientation);
  const scale = createTimeScale(view.domain, mainSize);
  const span = view.domain[1] - view.domain[0];
  const origin = view.domain[0] + view.shift * scale.msPerPx;
  const msPerPx = scale.msPerPx * view.stretch;
  const extent: readonly [number, number] = [
    view.domain[0] - span * view.reachBefore,
    view.domain[1] + span * view.reachAfter,
  ];
  const options = (list: readonly Item[], drawn: readonly [number, number]): RenderOptions => ({
    items: list,
    ...(generated.lanes === undefined ? {} : { lanes: generated.lanes }),
    domain: view.domain,
    width: view.width,
    height: view.height,
    orientation: view.orientation,
    density: view.density,
    space: { origin, msPerPx, extent: drawn },
  });

  // --- the cache changes nothing ------------------------------------------
  const warm = [...items];
  const offset = span * view.warmShift;
  renderTimeline(options(warm, [extent[0] + offset, extent[1] + offset]));
  const warmed = renderTimeline(options(warm, extent));
  const fresh = renderTimeline(options([...items], extent));
  if (JSON.stringify(warmed.scene) !== JSON.stringify(fresh.scene)) {
    return "the same frame differs after the cache was warmed by another extent";
  }

  // --- labels never collide -----------------------------------------------
  const kept = fresh.labels.kept;
  const rowsOf = (row: number, span: number): number[] =>
    Array.from({ length: Math.max(span, 1) }, (_, offset) => row + offset);
  const share = (a: readonly number[], b: readonly number[]): boolean => a.some((row) => b.includes(row));
  for (let i = 0; i < kept.length; i += 1) {
    const a = kept[i];
    if (a === undefined) {
      continue;
    }
    for (let j = i + 1; j < kept.length; j += 1) {
      const b = kept[j];
      if (b === undefined || !share(rowsOf(a.row, a.rowSpan), rowsOf(b.row, b.rowSpan))) {
        continue;
      }
      if (a.box.main < b.box.main + b.box.mainSize && b.box.main < a.box.main + a.box.mainSize) {
        return `labels "${a.id}" and "${b.id}" overlap (${view.orientation})`;
      }
    }
  }
  // And none lands on another item drawn in its rows.
  const spaceScale = createTimeScale([origin, origin + mainSize * msPerPx], mainSize);
  for (const label of kept) {
    for (const placed of fresh.layout.items) {
      if (placed.item.id === label.id || !share(rowsOf(label.row, label.rowSpan), rowsOf(placed.row, placed.sublaneSpan))) {
        continue;
      }
      const rect = itemRect(placed, spaceScale);
      const from = rect.main;
      const to = placed.span.open ? Number.POSITIVE_INFINITY : rect.main + rect.mainSize;
      // A zero-length item reserves nothing to land on.
      if (!(to > from)) {
        continue;
      }
      if (label.box.main < to && from < label.box.main + label.box.mainSize) {
        return `label "${label.id}" lands on item "${placed.item.id}" (${view.orientation})`;
      }
    }
  }
  return undefined;
}

interface Step {
  readonly orientation: Orientation;
  readonly density: Density;
  readonly domain: readonly [number, number];
  readonly width: number;
  readonly height: number;
  /** How far the gesture zooms, and about which point of the view. */
  readonly zoom: number;
  readonly about: number;
  readonly budget: number;
  readonly labels: readonly string[];
}

function generateStep(random: () => number): GeneratedCase<Step> {
  const base = generateCase(random, { open: true, tall: true, granularity: true, lanes: 3 });
  const start = ORIGIN + Math.floor(random() * 300) * DAY;
  const inward = random() < 0.5;
  const step: Step = {
    orientation: ORIENTATIONS[Math.floor(random() * 2)] as Orientation,
    density: DENSITIES[Math.floor(random() * 3)] as Density,
    domain: [start, start + Math.floor(5 + random() * 120) * DAY],
    width: 300 + Math.floor(random() * 900),
    height: 200 + Math.floor(random() * 500),
    // Past the 1.5x limit, up to two steps away.
    // Out, a space is squeezed to a half before it steps: past 2x.
    zoom: inward ? 1.6 + random() * 3 : 1 / (2.1 + random() * 3),
    about: random(),
    budget: 1 + Math.floor(random() * 3),
    labels: base.items.map(() => "x".repeat(1 + Math.floor(random() * 14))),
  };
  return { ...base, steps: [step] };
}

/** Every item node of a layer, by id, in order — tiles and stand-ins alike. */
function itemNodes(scene: SceneElement): SceneElement[] {
  return placedNodes(scene, "horizontal").map((entry) => entry.node);
}

/** Item nodes with where they start on screen: every transform above them applied. */
function placedNodes(scene: SceneElement, orientation: Orientation): { node: SceneElement; screen: number }[] {
  const layer = scene.children?.find((node) => node.attrs?.class === "tl-layer tl-layer--items");
  const found: { node: SceneElement; screen: number }[] = [];
  const along = (node: SceneElement): { k: number; t: number } => {
    const parts = /^matrix\(([^)]*)\)$/.exec(String(node.attrs?.transform ?? ""))?.[1]?.split(" ").map(Number);
    if (parts === undefined) {
      return { k: 1, t: 0 };
    }
    return orientation === "horizontal"
      ? { k: parts[0] as number, t: parts[4] as number }
      : { k: parts[3] as number, t: parts[5] as number };
  };
  const walk = (node: SceneElement, k: number, t: number): void => {
    const own = along(node);
    const nk = k * own.k;
    const nt = k * own.t + t;
    if (node.attrs?.["data-tl-id"] !== undefined) {
      const main = Number(node.attrs[orientation === "horizontal" ? "x" : "y"]);
      found.push({ node, screen: nk * main + nt });
      return;
    }
    for (const child of node.children ?? []) {
      walk(child, nk, nt);
    }
  };
  if (layer !== undefined) {
    walk(layer, 1, 0);
  }
  return found;
}

/** The same space without a budget: everything drawn at once. */
function unpaced(space: SceneSpace): SceneSpace {
  return {
    origin: space.origin,
    msPerPx: space.msPerPx,
    ...(space.extent === undefined ? {} : { extent: space.extent }),
    ...(space.atRest === undefined ? {} : { atRest: space.atRest }),
    ...(space.bare === undefined ? {} : { bare: space.bare }),
  };
}

/** How many cases refilled over more than one frame — the stand-ins were really shown. */
const refills = { cases: 0, multiFrame: 0, frames: 0 };

/**
 * A stepped re-anchor is one frame, drawn over several: while the old
 * scale stands in, every frame draws every item exactly once — none twice
 * at a seam between the scales, none missing — where a fresh frame draws
 * it; when the refill of the view is done, what starts in view is what a
 * fresh draw at the new scale gives; and a frame without a budget then
 * draws the rest, ending exactly at the fresh frame.
 */
function checkStep(generated: GeneratedCase<Step>): string | undefined {
  const step = generated.steps?.[0];
  if (step === undefined) {
    return undefined;
  }
  const items: Item[] = generated.items.map((item, index) => ({ ...item, label: step.labels[index] ?? "" }));
  const { mainSize } = containerExtents(step.width, step.height, step.orientation);
  const base = (domain: readonly [number, number]): RenderOptions => ({
    items,
    ...(generated.lanes === undefined ? {} : { lanes: generated.lanes }),
    domain,
    width: step.width,
    height: step.height,
    orientation: step.orientation,
    density: step.density,
  });
  // At rest, grown into its overscan: every tile of the first scale drawn.
  let space = planSceneSpace(undefined, { domain: step.domain, mainSize }, { settle: true });
  for (let frame = 0; frame < 12; frame += 1) {
    renderTimeline({ ...base(step.domain), space });
    space = planSceneSpace(space, { domain: step.domain, mainSize }, { settle: true });
  }
  const span = step.domain[1] - step.domain[0];
  const pivot = step.domain[0] + span * step.about;
  const zoomed: readonly [number, number] = [
    pivot - (pivot - step.domain[0]) / step.zoom,
    pivot + (step.domain[1] - pivot) / step.zoom,
  ];
  const stepped = planSceneSpace(space, { domain: zoomed, mainSize }, { levels: true, budget: step.budget });
  if (stepped.origin !== space.origin || stepped.msPerPx === space.msPerPx) {
    return "the gesture did not step the scale around the same origin";
  }
  const ids = (scene: SceneElement): string[] => itemNodes(scene).map((node) => String(node.attrs?.["data-tl-id"]));
  const frames: string[][] = [];
  const screens: Map<string, number>[] = [];
  let pending = Number.POSITIVE_INFINITY;
  let last: ReturnType<typeof renderTimeline> | undefined;
  for (let frame = 0; frame < 200 && pending > 0; frame += 1) {
    last = renderTimeline({ ...base(zoomed), space: stepped });
    if (!(last.pendingTiles < pending)) {
      return `the refill stalled at ${String(last.pendingTiles)} tiles stood in for`;
    }
    pending = last.pendingTiles;
    frames.push(ids(last.scene));
    screens.push(new Map(placedNodes(last.scene, step.orientation).map((entry) => [String(entry.node.attrs?.["data-tl-id"]), entry.screen])));
  }
  if (last === undefined || pending !== 0) {
    return "the refill never finished";
  }
  const fresh = renderTimeline({ ...base(zoomed), items: items.map((item) => ({ ...item })), space: unpaced(stepped) });
  const want = ids(fresh.scene).sort();
  refills.cases += 1;
  refills.frames += frames.length;
  refills.multiFrame += frames.length > 1 ? 1 : 0;
  // Every frame of the refill puts every item where the fresh frame does.
  const where = new Map(placedNodes(fresh.scene, step.orientation).map((entry) => [String(entry.node.attrs?.["data-tl-id"]), entry.screen]));
  for (const [index, frame] of screens.entries()) {
    for (const [id, screen] of frame) {
      const want = where.get(id);
      if (want === undefined || !(Math.abs(screen - want) < 0.01)) {
        return `frame ${String(index)} of the refill draws "${id}" at ${String(screen)}, a fresh frame at ${String(want)} (${step.orientation})`;
      }
    }
  }
  for (const [index, drawn] of frames.entries()) {
    const sorted = [...drawn].sort();
    if (new Set(sorted).size !== sorted.length) {
      return `frame ${String(index)} of the refill draws an item twice (${step.orientation})`;
    }
    if (JSON.stringify(sorted) !== JSON.stringify(want)) {
      return `frame ${String(index)} of the refill draws ${String(sorted.length)} items, a fresh frame ${String(want.length)} (${step.orientation})`;
    }
  }
  // Done with what is in view: every item that starts there is the node a
  // fresh draw makes. Off-screen stand-ins may wait.
  const byId = new Map(itemNodes(fresh.scene).map((node) => [String(node.attrs?.["data-tl-id"]), JSON.stringify(node)]));
  for (const { node, screen } of placedNodes(last.scene, step.orientation)) {
    if (screen >= 0 && screen < mainSize && byId.get(String(node.attrs?.["data-tl-id"])) !== JSON.stringify(node)) {
      return `item "${String(node.attrs?.["data-tl-id"])}" in view differs from a fresh frame after the refill (${step.orientation})`;
    }
  }
  // And a frame without a budget draws the rest: the fresh frame, labels and all.
  const whole = renderTimeline({ ...base(zoomed), space: unpaced(stepped) });
  if (whole.pendingTiles !== 0 || JSON.stringify(itemNodes(whole.scene)) !== JSON.stringify(itemNodes(fresh.scene))) {
    return `a frame without a budget after the refill is not the fresh frame (${step.orientation})`;
  }
  if (JSON.stringify(whole.labels.kept) !== JSON.stringify(fresh.labels.kept)) {
    return `the labels differ from a fresh frame once everything is drawn (${step.orientation})`;
  }
  return undefined;
}

describe("tile properties", () => {
  it("draws every item once in every frame of a stepped refill, and ends where a fresh frame is", () => {
    forAll("a stepped refill is one frame", CASES, 0x5ca1e, generateStep, checkStep);
    // Not vacuous: in most cases the old scale stood in for at least a frame.
    expect(refills.multiFrame).toBeGreaterThan(CASES / 3);
  });

  it("never lets labels collide across tiles, and never lets the cache change a frame", () => {
    forAll("tiles are one frame", CASES, 0x711e5, generate, check);
  });
});

afterAll(() => {
  writePropertyReport("tiles");
});
