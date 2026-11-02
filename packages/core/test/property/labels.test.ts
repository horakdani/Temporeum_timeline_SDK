/**
 * Properties of a rendered frame.
 *
 * The layout properties next door prove that no two items share a row while
 * overlapping in time. These prove the same kind of thing one level up, where
 * the text is: that no two drawn labels overlap, that nothing is drawn outside
 * the viewport, that every label is accounted for, and that the same input
 * renders the same bytes.
 *
 * The overlap check is the core's own exported {@link findLabelOverlap}, not a
 * copy here — a parallel checker could carry the same mistake as the placer
 * and the property would then be proving itself.
 */

import { afterAll, describe, it } from "vitest";

import { densityMetrics } from "../../src/density.js";
import { findLabelOverlap } from "../../src/labels.js";
import { findSublaneOverlap } from "../../src/layout.js";
import { renderTimeline } from "../../src/render.js";
import { renderToSvgString } from "../../src/scene.js";
import type { Item } from "../../src/types.js";
import { forAll, generateCase, writePropertyReport } from "./harness.js";
import type { GeneratedCase } from "./harness.js";

const DAY = 86_400_000;
const ORIGIN = Date.UTC(2020, 0, 1);
const DOMAIN: readonly [number, number] = [ORIGIN, ORIGIN + 400 * DAY];
const WIDTH = 800;
const HEIGHT = 600;
const CASES = 600;

/** Label texts of deliberately mixed length, including none at all. */
const TEXTS: readonly string[] = [
  "A",
  "Short",
  "Medium-length label",
  "",
  "A really long description that will certainly not fit",
  "iiii",
  "WWWW",
];

function labelled(random: () => number, options: Parameters<typeof generateCase>[1] = {}) {
  return (): GeneratedCase => {
    const generated = generateCase(random, options);
    return {
      ...generated,
      items: generated.items.map((item, index) => ({
        ...item,
        label: TEXTS[index % TEXTS.length] ?? "",
      })) as readonly Item[],
    };
  };
}

function render(generated: GeneratedCase, orientation: "horizontal" | "vertical" = "horizontal") {
  return renderTimeline({
    items: generated.items,
    ...(generated.lanes === undefined ? {} : { lanes: generated.lanes }),
    domain: DOMAIN,
    width: WIDTH,
    height: HEIGHT,
    orientation,
  });
}

describe("rendering properties", () => {
  it("never draws two labels on top of each other", () => {
    forAll(
      "no overlap between labels",
      CASES,
      0xfade,
      (random) => labelled(random, { open: true, tall: true, granularity: true, lanes: 3 })(),
      (generated) => {
        const result = render(generated);
        const overlap = findLabelOverlap(result.labels.kept);
        if (overlap !== undefined) {
          return `labels "${overlap.a.id}" and "${overlap.b.id}" overlap in row ${String(overlap.a.row)}`;
        }
        // The layout invariant underneath has to hold too: a label placed in a
        // row that already had overlapping items would be a false pass here.
        const rows = findSublaneOverlap(result.layout);
        return rows === undefined
          ? undefined
          : `items "${rows.a.item.id}" and "${rows.b.item.id}" share a row`;
      },
    );
  });

  it("never draws text outside the viewport or outside its lane", () => {
    forAll(
      "labels stay inside the viewport and their lane",
      CASES,
      0xbead,
      (random) => labelled(random, { open: true, granularity: true, lanes: 2 })(),
      (generated) => {
        for (const orientation of ["horizontal", "vertical"] as const) {
          const result = render(generated, orientation);
          const axisSize = densityMetrics(result.viewport.density, orientation).axisSize;
          const crossOf = new Map(
            result.layout.items.map((placed) => [
              placed.item.id,
              { from: placed.cross + axisSize, to: placed.cross + axisSize + placed.crossSize },
            ]),
          );
          for (const label of result.labels.kept) {
            if (label.box.main < 0 || label.box.main + label.box.mainSize > result.viewport.mainSize) {
              return `label "${label.id}" runs from ${String(label.box.main)} past ${String(result.viewport.mainSize)} (${orientation})`;
            }
            // The lane check is what a vertical timeline needs: there the text
            // runs ACROSS the lane, so a long label would reach into the
            // neighbouring one instead of running off the viewport.
            const lane = crossOf.get(label.id);
            if (
              lane !== undefined &&
              (label.box.cross < lane.from - 0.001 ||
                label.box.cross + label.box.crossSize > lane.to + 0.001)
            ) {
              return `label "${label.id}" leaves its lane [${String(lane.from)}, ${String(lane.to)}] (${orientation})`;
            }
          }
        }
        return undefined;
      },
    );
  });

  it("accounts for every label exactly once", () => {
    forAll(
      "every label is kept or dropped, never both",
      CASES,
      0xc0de,
      (random) => labelled(random, { open: true, tall: true, lanes: 2 })(),
      (generated) => {
        const result = render(generated);
        const visible = new Set(
          result.layout.items
            .filter(
              (placed) =>
                placed.span.start < DOMAIN[1] &&
                placed.span.end > DOMAIN[0] &&
                (placed.item.label ?? "") !== "",
            )
            .map((placed) => placed.item.id),
        );
        const kept = result.labels.kept.map((label) => label.id);
        const dropped = result.labels.dropped.map((label) => label.id);
        const seen = [...kept, ...dropped];
        if (new Set(seen).size !== seen.length) {
          return "a label is both kept and dropped, or reported twice";
        }
        if (seen.length !== visible.size) {
          return `${String(seen.length)} labels reported for ${String(visible.size)} visible labelled items`;
        }
        return seen.every((id) => visible.has(id)) ? undefined : "a label was reported for an invisible item";
      },
    );
  });

  it("renders the same bytes for the same input", () => {
    forAll(
      "rendering is deterministic",
      CASES,
      0xd00d,
      (random) => labelled(random, { open: true, tall: true, granularity: true, lanes: 3 })(),
      (generated) => {
        const first = renderToSvgString(render(generated).scene);
        const second = renderToSvgString(render(generated).scene);
        return first === second ? undefined : "two renders of one input differ";
      },
    );
  });

  afterAll(() => {
    writePropertyReport("labels");
  });
});
