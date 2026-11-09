/**
 * Every item with room for a shortened label gets a label.
 *
 * A dense timeline is the normal case: at ten thousand items an item is
 * thirty-odd pixels wide and its text is not. Until 1.0.0-rc.5 such a label
 * was given up, so a dense view showed no text at all. Now a label too long
 * for its room is shortened — at least three characters and an ellipsis —
 * inside its item, or in the free room after it, whichever shows more.
 *
 * The property is checked against an oracle computed from the layout alone,
 * not from the placement: an item whose shortest label (its first three
 * characters and an ellipsis, or its whole text when that is no longer)
 * fits inside its visible part, or between its end and whatever comes next
 * in its rows, must show a label. That every such item can is the reason
 * shortening works at all: every item is reserved, and a label placed after
 * one ends before the next, so no label can take another's room.
 *
 * Checked on the exact frame and on the frame at rest in a scene space,
 * grown into its overscan the way a host draws it, in both orientations.
 * What is shown is the item's text, whole or as a start of it with an
 * ellipsis; no two labels overlap, none lands on an item, and the full text
 * is the item's accessible name.
 *
 * Not covered: a `maxLabels` ceiling, which gives labels up on purpose, and
 * clusters, whose count is not shortened.
 *
 * The control: the same frames with `labelOverflow: "drop"`, the 1.0.0-rc.4
 * behaviour, must leave items that have the room without a label in most
 * cases. Otherwise the generated data would be too sparse to say anything
 * about shortening.
 */

import { writeFileSync } from "node:fs";

import { afterAll, describe, expect, it } from "vitest";

import { densityMetrics } from "../../src/density.js";
import { containerExtents } from "../../src/geometry.js";
import { afterGap, estimateTextWidth, findLabelOverlap, LABEL_ELLIPSIS, labelSpace, MIN_SHORT_LABEL_CHARACTERS } from "../../src/labels.js";
import type { LabelOverflow, PlacedLabel } from "../../src/labels.js";
import { itemRect } from "../../src/layout.js";
import { renderTimeline } from "../../src/render.js";
import type { RenderOptions, RenderResult } from "../../src/render.js";
import { createTimeScale } from "../../src/scale.js";
import type { SceneElement } from "../../src/scene.js";
import { planSceneSpace } from "../../src/scene-space.js";
import type { SceneSpace } from "../../src/scene-space.js";
import type { Density, Item, Orientation } from "../../src/types.js";
import { forAll, generateCase, writePropertyReport } from "./harness.js";
import type { GeneratedCase } from "./harness.js";

const DAY = 86_400_000;
const ORIGIN = Date.UTC(2020, 0, 1);
const CASES = 500;
const ORIENTATIONS: readonly Orientation[] = ["horizontal", "vertical"];
const DENSITIES: readonly Density[] = ["comfortable", "compact", "dense"];
const WORDS = ["Design", "Review", "Sprint", "Kick-off", "Release", "Retro", "Planning", "Audit", "Launch", "Migration"];

interface View {
  readonly orientation: Orientation;
  readonly density: Density;
  readonly domain: readonly [number, number];
  readonly width: number;
  readonly height: number;
  readonly labels: readonly string[];
}

function generate(random: () => number): GeneratedCase<View> {
  const awkward = generateCase(random, { open: true, tall: true, granularity: true, lanes: 3 });
  const start = ORIGIN + Math.floor(random() * 300) * DAY;
  // The awkward cases, and the dense timeline around them: ten to forty
  // short items over the view, the way a busy timeline looks.
  const dense: Item[] = Array.from({ length: 10 + Math.floor(random() * 31) }, (_, index) => {
    const at = start + Math.floor(random() * 600) * DAY;
    return { id: `d${String(index)}`, start: at, end: at + Math.floor(DAY / 2 + random() * 12 * DAY), laneId: `lane${String(Math.floor(random() * 3))}` };
  });
  const base = { items: [...awkward.items, ...dense] };
  // Words a timeline carries, numbered so a label names its item; some short
  // enough to have nothing to shorten.
  const word = (): string => WORDS[Math.floor(random() * WORDS.length)] ?? "Item";
  const labels = base.items.map((_, index) =>
    random() < 0.1 ? `L${String(index)}` : random() < 0.5 ? `${word()} ${String(index)}` : `${word()} ${word()} ${String(index)}`,
  );
  const view: View = {
    orientation: ORIENTATIONS[Math.floor(random() * 2)] as Orientation,
    density: DENSITIES[Math.floor(random() * 3)] as Density,
    // Wide enough that most items are narrower than their text: a dense
    // timeline, where shortening is the difference.
    domain: [start, start + Math.floor(150 + random() * 600) * DAY],
    width: 300 + Math.floor(random() * 900),
    height: 200 + Math.floor(random() * 500),
    labels,
  };
  return { ...base, steps: [view] };
}

/** The labels on screen, in the viewport's pixels, by item. */
function shownLabels(result: RenderResult, space: SceneSpace | undefined, domain: readonly [number, number], mainSize: number): Map<string, PlacedLabel> {
  const msPerPx = (domain[1] - domain[0]) / mainSize;
  const stretch = space === undefined ? 1 : space.msPerPx / msPerPx;
  const shift = space === undefined ? 0 : (space.origin - domain[0]) / msPerPx;
  const shown = new Map<string, PlacedLabel>();
  for (const label of result.labels.kept) {
    const main = stretch * label.box.main + shift;
    const mainSizeOf = stretch * label.box.mainSize;
    if (main < mainSize && main + mainSizeOf > 0) {
      shown.set(label.id, { ...label, box: { ...label.box, main, mainSize: mainSizeOf } });
    }
  }
  return shown;
}

/** Every item node's accessible name, by item. */
function names(scene: SceneElement): Map<string, string> {
  const found = new Map<string, string>();
  const walk = (node: SceneElement): void => {
    const id = node.attrs?.["data-tl-id"];
    if (id !== undefined) {
      found.set(String(id), String(node.attrs?.["aria-label"] ?? ""));
    }
    for (const child of node.children ?? []) {
      walk(child);
    }
  };
  walk(scene);
  return found;
}

const control = { cases: 0, required: 0, missedByDrop: 0, casesMissedByDrop: 0, shortened: 0 };

function check(generated: GeneratedCase<View>, overflow: LabelOverflow): string | undefined {
  const view = generated.steps?.[0];
  if (view === undefined) {
    return undefined;
  }
  const items: Item[] = generated.items.map((item, index) => ({ ...item, label: view.labels[index] ?? "" }));
  const { mainSize, crossSize } = containerExtents(view.width, view.height, view.orientation);
  const metrics = densityMetrics(view.density, view.orientation);
  const measure = labelSpace(metrics, estimateTextWidth);
  const base: RenderOptions = {
    items,
    ...(generated.lanes === undefined ? {} : { lanes: generated.lanes }),
    domain: view.domain,
    width: view.width,
    height: view.height,
    orientation: view.orientation,
    density: view.density,
    labelOverflow: overflow,
  };

  const exact = renderTimeline(base);
  // The frame at rest in a space, grown into its overscan as a host draws it.
  let space = planSceneSpace(undefined, { domain: view.domain, mainSize }, { settle: true, levels: true });
  let rest = renderTimeline({ ...base, space });
  for (let frame = 0; frame < 200; frame += 1) {
    const next = planSceneSpace(space, { domain: view.domain, mainSize }, { settle: true, levels: true });
    if (next === space && rest.pendingTiles === 0) {
      break;
    }
    space = next;
    rest = renderTimeline({ ...base, space });
  }

  // The oracle: the room every item has, from the layout alone.
  const scale = createTimeScale(view.domain, mainSize);
  const rowsOf = (row: number, span: number): number[] => Array.from({ length: Math.max(span, 1) }, (_, step) => row + step);
  const extents = exact.layout.items.map((placed) => {
    const rect = itemRect(placed, scale);
    return { placed, start: rect.main, end: rect.main + Math.max(rect.mainSize, metrics.minItemMainSize), rows: rowsOf(placed.row, placed.sublaneSpan) };
  });
  const required: { readonly id: string; readonly text: string }[] = [];
  for (const own of extents) {
    const { placed } = own;
    const text = placed.item.label ?? "";
    const cross = placed.cross + metrics.axisSize;
    // Only rows wholly in view across: a clipped row is a room the oracle
    // would have to clip the same way the renderer does.
    if (text === "" || cross + placed.crossSize > crossSize || !(placed.span.start < view.domain[1] && placed.span.end > view.domain[0])) {
      continue;
    }
    if (!(own.end > 0 && own.start < mainSize)) {
      continue;
    }
    const visibleEnd = Math.min(own.end, mainSize);
    // Inside: the visible part, past an instant's few pixels that reach into
    // its start. After: up to whatever comes next in its rows, or the edge.
    let visibleStart = Math.max(own.start, 0);
    let next = mainSize;
    for (const other of extents) {
      if (other === own || !other.rows.some((row) => own.rows.includes(row))) {
        continue;
      }
      if (other.start <= visibleStart && other.end > visibleStart) {
        visibleStart = Math.min(other.end, visibleEnd);
      }
      if (other.end > visibleEnd) {
        next = Math.min(next, Math.max(other.start, visibleEnd));
      }
    }
    const characters = Array.from(text);
    const shortest = characters.length <= MIN_SHORT_LABEL_CHARACTERS ? text : `${characters.slice(0, MIN_SHORT_LABEL_CHARACTERS).join("").trimEnd()}${LABEL_ELLIPSIS}`;
    const need = measure(shortest);
    const fitsAcross = need.cross <= placed.crossSize;
    // After it, past the gap a label keeps from its item (down a timeline, the padding; across, none).
    if (fitsAcross && (need.main <= visibleEnd - visibleStart || need.main <= next - visibleEnd - afterGap(metrics))) {
      required.push({ id: placed.item.id, text });
    }
  }

  let missed = 0;
  for (const [frameName, result, frameSpace] of [["exact", exact, undefined], ["at rest in a space", rest, space]] as const) {
    const shown = shownLabels(result, frameSpace, view.domain, mainSize);
    for (const { id, text } of required) {
      const label = shown.get(id);
      if (label === undefined) {
        if (overflow === "drop") {
          missed += frameName === "exact" ? 1 : 0;
          continue;
        }
        return `item "${id}" ("${text}") has room for a shortened label and shows none (${frameName}, ${view.orientation}, ${view.density})`;
      }
    }
    if (overflow === "drop") {
      continue;
    }
    // What is shown is the item's text, whole or a start of it.
    const byId = new Map(items.map((item) => [item.id, item.label ?? ""]));
    for (const label of shown.values()) {
      const full = byId.get(label.id) ?? "";
      if (label.text === full) {
        continue;
      }
      const kept = label.text.slice(0, -LABEL_ELLIPSIS.length).trimEnd();
      if (!label.text.endsWith(LABEL_ELLIPSIS) || !full.startsWith(kept) || Array.from(kept).length < MIN_SHORT_LABEL_CHARACTERS || label.shortened !== true) {
        return `label "${label.id}" shows "${label.text}", which is not its text "${full}" nor a start of it (${frameName})`;
      }
      if (frameName === "exact") {
        control.shortened += 1;
      }
    }
    // No two overlap, none lands on another item in its rows.
    const overlap = findLabelOverlap([...shown.values()]);
    if (overlap !== undefined) {
      return `labels "${overlap.a.id}" and "${overlap.b.id}" overlap (${frameName}, ${view.orientation})`;
    }
    for (const label of shown.values()) {
      const rows = rowsOf(label.row, label.rowSpan);
      for (const other of extents) {
        if (other.placed.item.id === label.id || !other.rows.some((row) => rows.includes(row))) {
          continue;
        }
        const to = other.placed.span.open ? Number.POSITIVE_INFINITY : other.end;
        if (label.box.main < to && other.start < label.box.main + label.box.mainSize) {
          return `label "${label.id}" lands on item "${other.placed.item.id}" (${frameName}, ${view.orientation})`;
        }
      }
    }
    // The full text is the item's accessible name, shortened or not.
    const named = names(result.scene);
    for (const { id, text } of required) {
      const name = named.get(id);
      if (name !== undefined && !name.startsWith(text)) {
        return `item "${id}" is named "${name}", which does not carry its text "${text}" (${frameName})`;
      }
    }
  }
  if (overflow === "drop") {
    control.cases += 1;
    control.required += required.length;
    control.missedByDrop += missed;
    control.casesMissedByDrop += missed > 0 ? 1 : 0;
  }
  return undefined;
}

describe("labels on narrow items", () => {
  it("gives every item with room for a shortened label a label, in both frames and orientations", () => {
    forAll("narrow items get a label", CASES, 0x5a77, generate, (generated) => check(generated, "ellipsis"));
  });

  it("needs shortening: the same frames without it leave such items bare in most cases (control)", () => {
    // The same seed and count: the very cases the property ran on.
    forAll("narrow labels control cases", CASES, 0x5a77, generate, (generated) => check(generated, "drop"));
    expect(control.required).toBeGreaterThan(1000);
    expect(control.casesMissedByDrop).toBeGreaterThan(control.cases / 2);
  });
});

afterAll(() => {
  writePropertyReport("narrow-labels");
  writeFileSync(".narrow-labels-control.json", `${JSON.stringify(control, null, 2)}\n`);
});
