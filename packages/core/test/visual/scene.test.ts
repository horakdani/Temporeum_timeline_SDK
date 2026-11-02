/**
 * The visual matrix: three widths x two orientations x two themes.
 *
 * Two different things are checked here, and keeping them apart is the point.
 *
 * The **fixture** check compares the source render, byte for byte, with the
 * SVG committed under `fixtures/` — which `scripts/sdk_visual_snapshots.mjs`
 * generated from the *built* bundle. So a difference here means either a real
 * visual change nobody regenerated, or the build transforming behaviour that
 * the source does not have. Both are worth a red gate.
 *
 * The **invariant** checks say what has to be true of any frame, fixture or
 * not: items inside the container, no two labels on top of each other, the
 * theme that was asked for, and off-screen data costing nothing.
 *
 * The matrix comes from `matrix.json` (widths) and from the core's own
 * `ORIENTATIONS` and `THEMES`. A local list here is exactly what would let the
 * gate pass while quietly covering one orientation.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import type { Decoration, MarkerShape } from "../../src/decorations.js";
import { densityMetrics } from "../../src/density.js";
import { ORIENTATIONS } from "../../src/geometry.js";
import { findLabelOverlap } from "../../src/labels.js";
import { renderTimeline } from "../../src/render.js";
import type { RenderOptions } from "../../src/render.js";
import { countSceneNodes, renderToSvgString } from "../../src/scene.js";
import { THEMES } from "../../src/theme.js";
import type { Density, Item, Lane, Orientation } from "../../src/types.js";

interface Matrix {
  readonly widths: readonly number[];
  readonly height: number;
  readonly densityForWidth: Readonly<Record<string, Density>>;
}

function read(name: string): string {
  return readFileSync(new URL(name, import.meta.url), "utf8");
}

const matrix = JSON.parse(read("./matrix.json")) as Matrix;

/** The scenario as it is stored: times are ISO strings, so it stays readable. */
interface RawScenario {
  readonly timeZone: string;
  readonly ariaLabel: string;
  readonly domain: readonly [string, string];
  readonly selectedIds: readonly string[];
  readonly lanes: readonly Lane[];
  readonly items: readonly (Omit<Item, "start" | "end"> & {
    readonly start: string;
    readonly end?: string;
  })[];
  readonly decorations: readonly RawDecoration[];
}

type RawDecoration =
  | { readonly kind: "banding"; readonly className?: string }
  | { readonly kind: "now"; readonly time: string; readonly label?: string }
  | {
      readonly kind: "era";
      readonly id: string;
      readonly start: string;
      readonly end: string;
      readonly label?: string;
    }
  | {
      readonly kind: "marker";
      readonly id: string;
      readonly time: string;
      readonly label?: string;
      readonly shape?: MarkerShape;
    };

const scenario = JSON.parse(read("./scenario.json")) as RawScenario;

const at = (value: string): number => Date.parse(value);

const ITEMS: readonly Item[] = scenario.items.map(({ start, end, ...rest }) => ({
  ...rest,
  start: at(start),
  ...(end === undefined ? {} : { end: at(end) }),
}));

const DECORATIONS: readonly Decoration[] = scenario.decorations.map((decoration) => {
  switch (decoration.kind) {
    case "banding":
      return decoration;
    case "now":
      return { ...decoration, time: at(decoration.time) };
    case "era":
      return { ...decoration, start: at(decoration.start), end: at(decoration.end) };
    default:
      return { ...decoration, time: at(decoration.time) };
  }
});

function options(
  width: number,
  orientation: Orientation,
  theme: string,
  name: string,
): RenderOptions {
  return {
    items: ITEMS,
    lanes: scenario.lanes,
    domain: [at(scenario.domain[0]), at(scenario.domain[1])],
    width,
    height: matrix.height,
    orientation,
    density: matrix.densityForWidth[String(width)] ?? "comfortable",
    theme: theme === "light" || theme === "dark" ? theme : "auto",
    instanceId: name,
    timeZone: scenario.timeZone,
    decorations: DECORATIONS,
    selectedIds: scenario.selectedIds,
    ariaLabel: scenario.ariaLabel,
  };
}

for (const width of matrix.widths) {
  const density = matrix.densityForWidth[String(width)] ?? "comfortable";
  for (const orientation of ORIENTATIONS) {
    for (const theme of THEMES) {
      const name = `${String(width)}-${orientation}-${theme.name}`;
      describe(`frame ${String(width)}px ${orientation} ${theme.name} (${density})`, () => {
        const result = renderTimeline(options(width, orientation, theme.name, name));
        const metrics = densityMetrics(density, orientation);

        it("matches the committed fixture, so the build changed nothing", () => {
          const fixture = read(`./fixtures/${name}.svg`);
          expect(`${renderToSvgString(result.scene, { pretty: true })}\n`).toBe(fixture);
        });

        it("draws every visible item inside the container", () => {
          const mainKey = orientation === "horizontal" ? "x" : "y";
          const mainExtent = orientation === "horizontal" ? "width" : "height";
          const items =
            (result.scene.children ?? []).find(
              (child) => child.attrs?.class === "tl-layer tl-layer--items",
            )?.children ?? [];
          expect(items.length).toBeGreaterThan(0);
          for (const node of items) {
            const start = Number(node.attrs?.[mainKey]);
            const size = Number(node.attrs?.[mainExtent]);
            expect(start).toBeGreaterThanOrEqual(-metrics.rowSize);
            expect(start + size).toBeLessThanOrEqual(result.viewport.mainSize + metrics.rowSize);
          }
        });

        it("never draws two labels on top of each other", () => {
          expect(findLabelOverlap(result.labels.kept)).toBeUndefined();
          for (const label of result.labels.kept) {
            expect(label.box.main).toBeGreaterThanOrEqual(0);
            expect(label.box.main + label.box.mainSize).toBeLessThanOrEqual(
              result.viewport.mainSize,
            );
          }
        });

        it("carries the theme it was given", () => {
          expect(result.scene.attrs?.["data-tl-theme"]).toBe(theme.name);
          const style = (result.scene.children ?? []).find((child) => child.tag === "style");
          expect(style?.text).toContain(theme.tokens.surface);
          expect(style?.text).not.toContain("prefers-color-scheme");
        });

        it("charges nothing for data outside the viewport", () => {
          // Culling is the claim: a hundred more items the viewport cannot see
          // must not add a single node.
          const far: readonly Item[] = Array.from({ length: 100 }, (_, index) => ({
            id: `far${String(index)}`,
            start: at("2030-01-01T00:00:00Z") + index * 86_400_000,
            end: at("2030-01-02T00:00:00Z") + index * 86_400_000,
            label: `Far ${String(index)}`,
            laneId: scenario.lanes[index % scenario.lanes.length]?.id ?? "",
          }));
          const crowded = renderTimeline({
            ...options(width, orientation, theme.name, name),
            items: [...ITEMS, ...far],
          });
          expect(countSceneNodes(crowded.scene)).toBe(countSceneNodes(result.scene));
          expect(crowded.visibleCount).toBe(result.visibleCount);
        });
      });
    }
  }
}
