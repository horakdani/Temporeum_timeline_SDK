/**
 * A frame at rest in a space shows every label an exact frame keeps.
 *
 * Content in a space is drawn tile by tile, and each tile places its labels
 * knowing only the items around it — which is what makes a pan cheap, and
 * what used to cost labels: the label of an item that starts before the
 * viewport sat where the item starts, off-screen, and a label after an item
 * near a tile's end was given up. Before P14 that was why the element drew
 * small timelines exactly. The renderer now lets a label run into the next
 * tile and, at rest, places the viewport's labels the way the exact frame
 * does and adds the ones the tiles do not show. This checks the outcome
 * from the outside, against the exact frame itself: every label it keeps is
 * on screen in the space frame too, and nothing shown overlaps or lands on
 * an item. Under a `maxLabels` ceiling the frame at rest shows exactly the
 * exact frame's labels: a ceiling is the whole frame's, not a tile's.
 *
 * The control: the same frames during a gesture — the same tiles, without
 * what the frame at rest adds (`bare`: since P17 a gesture's frame pins the
 * edges' labels as well) — must miss some of those labels. If they did
 * not, the property would hold without the addition and prove nothing
 * about it.
 */

import { writeFileSync } from "node:fs";

import { afterAll, describe, expect, it } from "vitest";

import { containerExtents } from "../../src/geometry.js";
import { findLabelOverlap } from "../../src/labels.js";
import type { PlacedLabel } from "../../src/labels.js";
import { itemRect } from "../../src/layout.js";
import { renderTimeline } from "../../src/render.js";
import type { RenderOptions, RenderResult } from "../../src/render.js";
import { createTimeScale } from "../../src/scale.js";
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
  /** Where the space's origin sits, in pixels from the viewport's start. */
  readonly shift: number;
  readonly reachBefore: number;
  readonly reachAfter: number;
  /** A ceiling on labels, in some cases: then the frame at rest holds it as a whole. */
  readonly maxLabels: number | undefined;
  readonly labels: readonly string[];
}

function generate(random: () => number): GeneratedCase<View> {
  const base = generateCase(random, { open: true, tall: true, granularity: true, lanes: 3 });
  const start = ORIGIN + Math.floor(random() * 300) * DAY;
  // Unique texts, so a label on screen names its item.
  const labels = base.items.map((_, index) => `L${String(index)}${"x".repeat(Math.floor(random() * 14))}`);
  const view: View = {
    orientation: ORIENTATIONS[Math.floor(random() * 2)] as Orientation,
    density: DENSITIES[Math.floor(random() * 3)] as Density,
    domain: [start, start + Math.floor(5 + random() * 120) * DAY],
    width: 300 + Math.floor(random() * 900),
    height: 200 + Math.floor(random() * 500),
    shift: (random() - 0.5) * 3000,
    reachBefore: random() * 1.5,
    reachAfter: random() * 1.5,
    maxLabels: random() < 0.25 ? 1 + Math.floor(random() * 5) : undefined,
    labels,
  };
  return { ...base, steps: [view] };
}

/** What the gesture-time frames lost, over every case — the control. */
const control = { cases: 0, exactLabels: 0, missedDuringGesture: 0, casesMissing: 0 };

function check(generated: GeneratedCase<View>, record: boolean): string | undefined {
  const view = generated.steps?.[0];
  if (view === undefined) {
    return undefined;
  }
  const items: Item[] = generated.items.map((item, index) => ({ ...item, label: view.labels[index] ?? "" }));
  const { mainSize } = containerExtents(view.width, view.height, view.orientation);
  const scale = createTimeScale(view.domain, mainSize);
  const span = view.domain[1] - view.domain[0];
  // Same scale as the viewport: a frame at rest is not stretched.
  const msPerPx = scale.msPerPx;
  const origin = view.domain[0] + view.shift * msPerPx;
  const base: RenderOptions = {
    items,
    ...(generated.lanes === undefined ? {} : { lanes: generated.lanes }),
    domain: view.domain,
    width: view.width,
    height: view.height,
    orientation: view.orientation,
    density: view.density,
    ...(view.maxLabels === undefined ? {} : { maxLabels: view.maxLabels }),
  };
  const extent: readonly [number, number] = [
    view.domain[0] - span * view.reachBefore,
    view.domain[1] + span * view.reachAfter,
  ];
  const exact = renderTimeline(base);
  const rest = renderTimeline({ ...base, space: { origin, msPerPx, extent, atRest: true } });
  // The tiles alone: since P17 a frame during a gesture pins the edges'
  // labels too, and `bare` is the frame that adds nothing to its tiles.
  const moving = renderTimeline({ ...base, space: { origin, msPerPx, extent, atRest: false, bare: true } });

  // Space pixels to the viewport's: a shift, nothing else.
  const offset = (origin - view.domain[0]) / msPerPx;
  const onScreen = (result: RenderResult): Set<string> => {
    const ids = new Set<string>();
    for (const label of result.labels.kept) {
      const from = label.box.main + offset;
      if (from < mainSize && from + label.box.mainSize > 0) {
        ids.add(label.id);
      }
    }
    return ids;
  };

  const shown = onScreen(rest);
  if (view.maxLabels !== undefined) {
    // Under a ceiling the frame at rest is the exact frame's labels, no more.
    const exactIds = exact.labels.kept.map((label) => label.id).sort();
    const restIds = rest.labels.kept.map((label) => label.id).sort();
    if (JSON.stringify(exactIds) !== JSON.stringify(restIds)) {
      return `under maxLabels ${String(view.maxLabels)} the frame at rest shows ${JSON.stringify(restIds)}, the exact frame ${JSON.stringify(exactIds)} (${view.orientation})`;
    }
  }
  const shownMoving = onScreen(moving);
  let missed = 0;
  for (const label of exact.labels.kept) {
    if (!shown.has(label.id)) {
      return `label "${label.id}" (${label.placement}) is kept by the exact frame but not shown at rest (${view.orientation})`;
    }
    if (!shownMoving.has(label.id)) {
      missed += 1;
    }
  }
  if (record && view.maxLabels === undefined) {
    control.cases += 1;
    control.exactLabels += exact.labels.kept.length;
    control.missedDuringGesture += missed;
    control.casesMissing += missed > 0 ? 1 : 0;
  }

  // Nothing drawn overlaps: the tiles' labels and what the rest added.
  const kept: readonly PlacedLabel[] = rest.labels.kept;
  const overlap = findLabelOverlap(kept);
  if (overlap !== undefined) {
    return `labels "${overlap.a.id}" and "${overlap.b.id}" overlap at rest (${view.orientation})`;
  }
  // Every label the frame reports is drawn, once per box.
  const labelLayer = rest.scene.children?.find((node) => node.attrs?.class === "tl-layer tl-layer--labels");
  const texts: string[] = [];
  const walk = (node: { text?: string; children?: readonly unknown[] }): void => {
    if (typeof node.text === "string") {
      texts.push(node.text);
    }
    for (const child of (node.children ?? []) as { text?: string; children?: readonly unknown[] }[]) {
      walk(child);
    }
  };
  if (labelLayer !== undefined) {
    walk(labelLayer);
  }
  if (texts.length !== kept.length) {
    return `the frame reports ${String(kept.length)} labels and draws ${String(texts.length)} (${view.orientation})`;
  }
  // And none lands on another item drawn in its rows.
  const rowsOf = (row: number, rowSpan: number): number[] =>
    Array.from({ length: Math.max(rowSpan, 1) }, (_, step) => row + step);
  const share = (a: readonly number[], b: readonly number[]): boolean => a.some((row) => b.includes(row));
  const spaceScale = createTimeScale([origin, origin + mainSize * msPerPx], mainSize);
  for (const label of kept) {
    for (const placed of rest.layout.items) {
      if (placed.item.id === label.id || !share(rowsOf(label.row, label.rowSpan), rowsOf(placed.row, placed.sublaneSpan))) {
        continue;
      }
      const rect = itemRect(placed, spaceScale);
      const from = rect.main;
      const to = placed.span.open ? Number.POSITIVE_INFINITY : rect.main + rect.mainSize;
      if (!(to > from)) {
        continue;
      }
      if (label.box.main < to && from < label.box.main + label.box.mainSize) {
        return `label "${label.id}" lands on item "${placed.item.id}" at rest (${view.orientation})`;
      }
    }
  }
  return undefined;
}

describe("labels at rest in a space", () => {
  it("shows every label the exact frame keeps, and nothing shown overlaps", () => {
    forAll("rest labels match the exact frame", CASES, 0x5e57, generate, (generated) => check(generated, false));
  });

  it("needs what the frame at rest adds: during a gesture the tiles alone miss some (control)", () => {
    // The same seed and count: the very cases the property ran on.
    forAll("rest labels control cases", CASES, 0x5e57, generate, (generated) => check(generated, true));
    expect(control.cases).toBeGreaterThan(CASES / 2);
    expect(control.exactLabels).toBeGreaterThan(1000);
    expect(control.missedDuringGesture).toBeGreaterThan(0);
  });
});

afterAll(() => {
  writePropertyReport("rest-labels");
  writeFileSync(".rest-labels-control.json", `${JSON.stringify(control, null, 2)}\n`);
});
