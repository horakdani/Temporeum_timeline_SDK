import { describe, expect, it } from "vitest";

import { budgetMs } from "./time-budget.js";

import { densityMetrics } from "../src/density.js";
import { createInputMachine } from "../src/input.js";
import { estimateTextWidth, labelSpace } from "../src/labels.js";
import {
  defaultItemNode,
  defaultTickLabel,
  renderTimeline,
} from "../src/render.js";
import { renderToSvgString } from "../src/scene.js";
import type { SceneElement } from "../src/scene.js";
import type { Item, Tick } from "../src/index.js";

const DAY = 86_400_000;
const DOMAIN: readonly [number, number] = [Date.UTC(2025, 2, 1), Date.UTC(2025, 2, 21)];

const ITEMS: readonly Item[] = [
  { id: "a", start: Date.UTC(2025, 2, 3), end: Date.UTC(2025, 2, 9), label: "Research", laneId: "terv" },
  { id: "b", start: Date.UTC(2025, 2, 5), end: Date.UTC(2025, 2, 7), label: "Interviews", laneId: "terv" },
  { id: "c", start: Date.UTC(2025, 2, 12), open: true, label: "Development", laneId: "build" },
];

function render(overrides: Partial<Parameters<typeof renderTimeline>[0]> = {}) {
  return renderTimeline({
    items: ITEMS,
    domain: DOMAIN,
    width: 900,
    height: 300,
    ...overrides,
  });
}

function layerOf(scene: SceneElement, name: string): readonly SceneElement[] {
  for (const child of scene.children ?? []) {
    if (child.attrs?.class === `tl-layer tl-layer--${name}`) {
      return child.children ?? [];
    }
  }
  throw new Error(`no such layer: ${name}`);
}

function byId(scene: SceneElement, id: string): SceneElement | undefined {
  return layerOf(scene, "items").find((node) => node.attrs?.["data-tl-id"] === id);
}

function number(value: string | number | undefined): number {
  return typeof value === "number" ? value : Number.NaN;
}

describe("the scene a render produces", () => {
  it("is one svg with a viewBox, a role and the resolved settings on it", () => {
    const { scene } = render({ density: "dense", orientation: "vertical" });
    expect(scene.tag).toBe("svg");
    expect(scene.attrs?.viewBox).toBe("0 0 900 300");
    expect(scene.attrs?.xmlns).toBe("http://www.w3.org/2000/svg");
    // A listbox and one focus stop; a group when the frame is only an
    // image.
    expect(scene.attrs?.role).toBe("listbox");
    expect(scene.attrs?.tabindex).toBe(0);
    expect(scene.attrs?.["aria-label"]).toBe("Timeline");
    expect(render({ interactive: false }).scene.attrs?.role).toBe("group");
    expect(scene.attrs?.["data-tl-density"]).toBe("dense");
    expect(scene.attrs?.["data-tl-orientation"]).toBe("vertical");
  });

  it("takes the accessible name the host gives it", () => {
    expect(render({ ariaLabel: "Project timeline" }).scene.attrs?.["aria-label"]).toBe(
      "Project timeline",
    );
  });

  it("layers the frame back to front, and keeps a layer even when empty", () => {
    const { scene } = render();
    const classes = (scene.children ?? [])
      .map((child) => child.attrs?.class)
      .filter((value): value is string => typeof value === "string" && value.startsWith("tl-layer"));
    expect(classes).toEqual([
      "tl-layer tl-layer--background",
      "tl-layer tl-layer--axis",
      "tl-layer tl-layer--lanes",
      "tl-layer tl-layer--items",
      "tl-layer tl-layer--labels",
      "tl-layer tl-layer--foreground",
      "tl-layer tl-layer--overlay",
      "tl-layer tl-layer--context",
    ]);
    expect(layerOf(scene, "overlay")).toEqual([]);
  });

  it("embeds the stylesheet by default and leaves it out on request", () => {
    const withStyle = render({ theme: "dark" }).scene.children ?? [];
    expect(withStyle[0]?.tag).toBe("style");
    expect(withStyle[0]?.text).toContain("--tl-surface:#14171c");
    const without = render({ includeStyle: false }).scene.children ?? [];
    expect(without.some((child) => child.tag === "style")).toBe(false);
  });

  it("pins the theme on the root only when the host pinned one", () => {
    expect(render({ theme: "dark" }).scene.attrs?.["data-tl-theme"]).toBe("dark");
    expect(render().scene.attrs?.["data-tl-theme"]).toBeUndefined();
  });

  it("paints a surface behind everything", () => {
    const surface = (render().scene.children ?? []).find(
      (child) => child.attrs?.class === "tl-surface",
    );
    expect(number(surface?.attrs?.width)).toBe(900);
    expect(number(surface?.attrs?.height)).toBe(300);
  });

  it("renders the same bytes twice for the same input", () => {
    expect(renderToSvgString(render().scene)).toBe(renderToSvgString(render().scene));
  });

  it("survives having nothing to draw", () => {
    const { scene, layout, visibleCount } = renderTimeline({
      items: [],
      domain: DOMAIN,
      width: 400,
      height: 100,
    });
    expect(visibleCount).toBe(0);
    expect(layout.items).toEqual([]);
    expect(renderToSvgString(scene)).toContain("<svg");
  });
});

describe("items", () => {
  it("culls what the viewport cannot see", () => {
    const { visibleCount, scene } = render({
      items: [
        ...ITEMS,
        { id: "past", start: Date.UTC(2020, 0, 1), end: Date.UTC(2020, 0, 2), label: "old" },
        { id: "future", start: Date.UTC(2030, 0, 1), label: "future" },
      ],
    });
    expect(visibleCount).toBe(3);
    expect(byId(scene, "past")).toBeUndefined();
    expect(byId(scene, "future")).toBeUndefined();
  });

  it("keeps an instant visible instead of drawing nothing", () => {
    const metrics = densityMetrics("comfortable", "horizontal");
    const { scene } = render({
      items: [{ id: "tiny", start: Date.UTC(2025, 2, 10), label: "instant" }],
    });
    const node = byId(scene, "tiny");
    expect(number(node?.attrs?.width)).toBe(metrics.minItemMainSize);
    expect(String(node?.attrs?.class)).toContain("tl-item--instant");
  });

  it("clips an item that reaches far past the viewport", () => {
    const { scene } = render({
      items: [
        { id: "long", start: Date.UTC(1990, 0, 1), end: Date.UTC(2060, 0, 1), label: "long" },
      ],
    });
    const node = byId(scene, "long");
    const metrics = densityMetrics("comfortable", "horizontal");
    expect(number(node?.attrs?.x)).toBe(-metrics.rowSize);
    expect(number(node?.attrs?.width)).toBe(900 + 2 * metrics.rowSize);
  });

  it("marks an open interval and lets it run off the edge", () => {
    const { scene } = render();
    const node = byId(scene, "c");
    expect(String(node?.attrs?.class)).toContain("tl-item--open");
    const metrics = densityMetrics("comfortable", "horizontal");
    // Past the edge, so no rounded corner suggests an ending it does not have.
    expect(number(node?.attrs?.x) + number(node?.attrs?.width)).toBeCloseTo(
      900 + metrics.rowSize,
    );
    expect(number(node?.attrs?.x) + number(node?.attrs?.width)).toBeGreaterThan(900);
  });

  it("keeps an open interval's label inside the viewport", () => {
    const { labels } = render();
    const label = labels.kept.find((candidate) => candidate.id === "c");
    expect(label).toBeDefined();
    expect((label?.box.main ?? 0) + (label?.box.mainSize ?? 0)).toBeLessThanOrEqual(900);
  });

  it("carries the full label as an accessible name even when the visible one is dropped", () => {
    const { scene, labels } = render({
      items: [{ id: "x", start: Date.UTC(2025, 2, 10), label: "A long description" }],
      width: 60,
      height: 100,
    });
    expect(labels.kept).toEqual([]);
    expect(labels.dropped).toEqual([{ id: "x", reason: "no-room" }]);
    // The name says when as well as what.
    expect(byId(scene, "x")?.children?.[0]).toEqual({
      tag: "title",
      text: "A long description, Mar 10, 2025",
    });
    expect(byId(scene, "x")?.attrs?.["aria-label"]).toBe("A long description, Mar 10, 2025");
  });

  it("falls back to the id as the accessible name", () => {
    const { scene } = render({ items: [{ id: "no-label", start: Date.UTC(2025, 2, 10) }] });
    expect(byId(scene, "no-label")?.children?.[0]?.text).toBe("no-label, Mar 10, 2025");
    const image = render({ items: [{ id: "no-label", start: Date.UTC(2025, 2, 10) }], interactive: false });
    expect(byId(image.scene, "no-label")?.children?.[0]?.text).toBe("no-label");
  });

  it("marks the selected items and offers a detail node only for them", () => {
    const { scene } = render({
      selectedIds: ["a"],
      hooks: {
        renderDetail: (context) => ({
          tag: "g",
          attrs: { class: "detail", "data-tl-id": context.placed.item.id },
        }),
      },
    });
    expect(String(byId(scene, "a")?.attrs?.class)).toContain("tl-item--selected");
    expect(String(byId(scene, "b")?.attrs?.class)).not.toContain("tl-item--selected");
    expect(layerOf(scene, "overlay")).toHaveLength(1);
    expect(layerOf(scene, "overlay")[0]?.attrs?.["data-tl-id"]).toBe("a");
  });

  it("keeps the host's own class on the item", () => {
    const { scene } = render({
      items: [{ id: "k", start: Date.UTC(2025, 2, 10), className: "risk" }],
    });
    expect(String(byId(scene, "k")?.attrs?.class)).toContain("risk");
  });
});

describe("hooks", () => {
  it("lets a hook replace the item node", () => {
    const { scene } = render({
      hooks: {
        renderItem: (context) => ({
          tag: "circle",
          attrs: { "data-tl-id": context.placed.item.id, cx: context.rect.x, cy: context.rect.y, r: 4 },
        }),
      },
    });
    expect(layerOf(scene, "items").every((node) => node.tag === "circle")).toBe(true);
  });

  it("lets a hook wrap the default instead of reimplementing it", () => {
    const { scene } = render({
      hooks: {
        renderItem: (context) => {
          const base = defaultItemNode(context);
          return { ...base, attrs: { ...base.attrs, "data-mine": "1" } };
        },
      },
    });
    expect(byId(scene, "a")?.attrs?.["data-mine"]).toBe("1");
    expect(byId(scene, "a")?.tag).toBe("rect");
  });

  it("draws nothing for a hook that returns null", () => {
    const { scene } = render({ hooks: { renderItem: () => null, renderLabel: () => null } });
    expect(layerOf(scene, "items")).toEqual([]);
    expect(layerOf(scene, "labels")).toEqual([]);
  });

  it("hands the label hook the placement it can style on", () => {
    const placements: string[] = [];
    render({
      hooks: {
        renderLabel: (context) => {
          placements.push(context.label.placement);
          return null;
        },
      },
    });
    expect(placements.length).toBeGreaterThan(0);
  });
});

describe("the axis", () => {
  it("draws a line per tick and never two tick labels on top of each other", () => {
    const { scene, ticks } = render({ width: 700 });
    const axis = layerOf(scene, "axis");
    expect(axis.filter((node) => node.tag === "line")).toHaveLength(ticks.length);
    const metrics = densityMetrics("comfortable", "horizontal");
    const measure = labelSpace(metrics, estimateTextWidth, metrics.tickFontSize);
    let previousEnd = Number.NEGATIVE_INFINITY;
    for (const node of axis.filter((candidate) => candidate.tag === "text")) {
      const start = number(node.attrs?.x) - metrics.labelPadding;
      expect(start).toBeGreaterThanOrEqual(previousEnd);
      previousEnd = start + measure(node.text ?? "").main;
      expect(previousEnd).toBeLessThanOrEqual(700 + metrics.labelPadding);
    }
  });

  it("can have its labels replaced wholesale", () => {
    const { scene } = render({ formatTick: () => "x" });
    const texts = layerOf(scene, "axis")
      .filter((node) => node.tag === "text")
      .map((node) => node.text);
    expect(texts.length).toBeGreaterThan(0);
    expect(new Set(texts)).toEqual(new Set(["x"]));
  });

  it("draws no tick label at all when the formatter returns nothing", () => {
    const { scene } = render({ formatTick: () => "" });
    expect(layerOf(scene, "axis").every((node) => node.tag === "line")).toBe(true);
  });

  it("reserves the first band of the cross axis for itself", () => {
    const { scene } = render();
    const metrics = densityMetrics("comfortable", "horizontal");
    for (const lane of layerOf(scene, "lanes")) {
      expect(number(lane.attrs?.y)).toBeGreaterThanOrEqual(metrics.axisSize);
    }
  });
});

describe("lanes", () => {
  it("draws one rect per lane, pinned ones marked", () => {
    const { scene } = render({ lanes: [{ id: "terv" }, { id: "build", pinned: true }] });
    const lanes = layerOf(scene, "lanes");
    expect(lanes).toHaveLength(2);
    expect(lanes.map((lane) => lane.attrs?.["data-tl-lane"])).toEqual(["build", "terv"]);
    expect(lanes[0]?.attrs?.class).toBe("tl-lane tl-lane--pinned");
    expect(lanes[1]?.attrs?.class).toBe("tl-lane");
  });
});

describe("decorations in a frame", () => {
  it("puts bands and eras behind the items, now and markers in front", () => {
    const { scene } = render({
      decorations: [
        { kind: "banding" },
        { kind: "era", id: "q", start: DOMAIN[0], end: DOMAIN[0] + 5 * DAY },
        { kind: "now", time: DOMAIN[0] + 10 * DAY },
        { kind: "marker", id: "m", time: DOMAIN[0] + 12 * DAY },
      ],
    });
    const background = layerOf(scene, "background").map((node) => node.attrs?.class);
    expect(background).toContain("tl-band");
    expect(background).toContain("tl-era");
    const foreground = layerOf(scene, "foreground").map((node) => node.attrs?.class);
    expect(foreground).toContain("tl-now");
    expect(foreground).toContain("tl-marker");
  });

  it("names an era in the axis band, where no item covers it, clear of the dates and of a now line's label", () => {
    const now = DOMAIN[0] + 10 * DAY;
    for (const orientation of ["horizontal", "vertical"] as const) {
      const width = orientation === "horizontal" ? 900 : 300;
      const height = orientation === "horizontal" ? 300 : 900;
      // The era's middle is where the now line and its label are; the era comes first in the list.
      const { scene } = render({
        orientation,
        density: "comfortable",
        width,
        height,
        decorations: [
          { kind: "era", id: "q", start: DOMAIN[0] + 6 * DAY, end: DOMAIN[0] + 14 * DAY, label: "Q1" },
          { kind: "now", time: now, label: "Today" },
        ],
      });
      const metrics = densityMetrics("comfortable", orientation);
      const label = layerOf(scene, "background").find((node) => node.attrs?.class === "tl-era-label");
      expect(label?.text).toBe("Q1");
      const across = Number(orientation === "horizontal" ? label?.attrs?.y : label?.attrs?.x);
      const along = Number(orientation === "horizontal" ? label?.attrs?.x : label?.attrs?.y);
      expect(across).toBeLessThan(metrics.axisSize);
      const need = labelSpace(metrics, estimateTextWidth, metrics.tickFontSize)("Q1").main;
      const [start, end] = orientation === "horizontal" ? [along - metrics.labelPadding, along - metrics.labelPadding + need] : [along - need / 2, along + need / 2];
      // Within the era, and off the line and the label of now.
      const span = orientation === "horizontal" ? width : height;
      const toMain = (time: number) => ((time - DOMAIN[0]) / (DOMAIN[1] - DOMAIN[0])) * span;
      expect(start).toBeGreaterThanOrEqual(toMain(DOMAIN[0] + 6 * DAY) - 0.5);
      expect(end).toBeLessThanOrEqual(toMain(DOMAIN[0] + 14 * DAY) + 0.5);
      const nowLabel = layerOf(scene, "foreground").find((node) => node.attrs?.class === "tl-now-label");
      expect(nowLabel).toBeDefined();
      const nowAt = Number(orientation === "horizontal" ? nowLabel?.attrs?.x : nowLabel?.attrs?.y);
      const nowNeed = labelSpace(metrics, estimateTextWidth, metrics.tickFontSize)("Today").main;
      const [nowStart, nowEnd] = orientation === "horizontal" ? [nowAt, nowAt + nowNeed] : [nowAt - nowNeed / 2, nowAt + nowNeed / 2];
      expect(end <= Math.min(nowStart, toMain(now) - 1) || start >= nowEnd).toBe(true);
    }
  });
});

describe("what a render reports back", () => {
  it("describes the viewport it resolved", () => {
    const { viewport } = render({ density: "compact", width: 1000, height: 400 });
    expect(viewport.orientation).toBe("horizontal");
    expect(viewport.density).toBe("compact");
    expect(viewport.mainSize).toBe(1000);
    expect(viewport.crossSize).toBe(400);
    expect(viewport.msPerPx).toBeCloseTo((DOMAIN[1] - DOMAIN[0]) / 1000);
    expect(viewport.domain).toEqual(DOMAIN);
  });

  it("swaps main and cross in a vertical timeline", () => {
    const { viewport } = render({ orientation: "vertical", width: 1000, height: 400 });
    expect(viewport.mainSize).toBe(400);
    expect(viewport.crossSize).toBe(1000);
  });

  it("says how much room the content needs, axis included", () => {
    const result = render();
    const metrics = densityMetrics("comfortable", "horizontal");
    expect(result.contentCrossSize).toBe(result.layout.crossSize + metrics.axisSize);
  });

  it("accepts Dates at the domain boundary", () => {
    const { viewport } = render({ domain: [new Date(DOMAIN[0]), new Date(DOMAIN[1])] });
    expect(viewport.domain).toEqual(DOMAIN);
  });
});

describe("defaultTickLabel", () => {
  const tick = (time: number, granularity: Tick["granularity"], major: boolean): Tick => ({
    time,
    granularity,
    major,
  });

  it("prints a full date for a major day and a bare day otherwise", () => {
    expect(defaultTickLabel(tick(Date.UTC(2025, 2, 1), "day", true))).toBe("2025-03-01");
    expect(defaultTickLabel(tick(Date.UTC(2025, 2, 17), "day", false))).toBe("17");
  });

  it("prints the date on a major hour tick, which is midnight", () => {
    expect(defaultTickLabel(tick(Date.UTC(2025, 2, 17), "hour", true))).toBe("03-17");
    expect(defaultTickLabel(tick(Date.UTC(2025, 2, 17, 14), "hour", false))).toBe("14:00");
  });

  it("prints clock time for minutes and seconds", () => {
    expect(defaultTickLabel(tick(Date.UTC(2025, 2, 17, 14, 30), "minute", false))).toBe("14:30");
    expect(defaultTickLabel(tick(Date.UTC(2025, 2, 17, 14, 30, 5), "second", false))).toBe(":05");
    expect(defaultTickLabel(tick(Date.UTC(2025, 2, 17, 14, 30, 5), "second", true))).toBe(
      "14:30:05",
    );
  });

  it("prints milliseconds with three digits", () => {
    expect(defaultTickLabel(tick(Date.UTC(2025, 2, 17, 0, 0, 1, 25), "millisecond", false))).toBe(
      ".025",
    );
    expect(defaultTickLabel(tick(Date.UTC(2025, 2, 17, 0, 0, 1, 25), "millisecond", true))).toBe(
      "01.025",
    );
  });

  it("prints the year for every coarse unit", () => {
    for (const granularity of ["year", "decade", "century", "millennium"] as const) {
      expect(defaultTickLabel(tick(Date.UTC(1700, 0, 1), granularity, true))).toBe("1700");
    }
  });

  it("reads the wall clock of the zone it is given", () => {
    const at = Date.UTC(2025, 2, 1, 23, 30);
    expect(defaultTickLabel(tick(at, "day", true), "Europe/Budapest")).toBe("2025-03-02");
    expect(defaultTickLabel(tick(at, "day", true), "UTC")).toBe("2025-03-01");
  });

  it("prints a month with its year when it starts the year", () => {
    expect(defaultTickLabel(tick(Date.UTC(2025, 0, 1), "month", true))).toBe("2025-01");
    expect(defaultTickLabel(tick(Date.UTC(2025, 5, 1), "month", false))).toBe("06");
  });
});

describe("more than one timeline in one document", () => {
  it("scopes the stylesheet and marks the root when given an instance id", () => {
    const { scene } = render({ instanceId: "left", theme: "light" });
    expect(scene.attrs?.["data-tl-instance"]).toBe("left");
    const style = (scene.children ?? []).find((child) => child.tag === "style");
    expect(style?.text).toContain('.tl[data-tl-instance="left"]');
    expect(style?.text).not.toContain("}.tl-item{");
  });

  it("leaves the root unmarked when the host did not ask for a scope", () => {
    expect(render().scene.attrs?.["data-tl-instance"]).toBeUndefined();
  });

  it("keeps two instances from deciding each other's theme", () => {
    const left = render({ instanceId: "left", theme: "light", density: "comfortable" });
    const right = render({ instanceId: "right", theme: "dark", density: "dense" });
    const styleOf = (scene: SceneElement): string =>
      String((scene.children ?? []).find((child) => child.tag === "style")?.text);
    // Neither stylesheet contains a rule that could match the other's root.
    expect(styleOf(left.scene)).not.toContain('data-tl-instance="right"');
    expect(styleOf(right.scene)).not.toContain('data-tl-instance="left"');
    expect(styleOf(left.scene).includes(".tl{")).toBe(false);
    expect(styleOf(right.scene).includes(".tl{")).toBe(false);
  });
});

describe("the axis band is shared", () => {
  it("keeps a marker's label off a date label", () => {
    // Both live in the axis band; the axis asks first.
    const { scene } = render({
      width: 420,
      decorations: [
        { kind: "marker", id: "m", time: DOMAIN[0] + DAY, label: "a long marker caption" },
      ],
    });
    const spans: { start: number; end: number }[] = [];
    const metrics = densityMetrics("comfortable", "horizontal");
    const measure = labelSpace(metrics, estimateTextWidth, metrics.tickFontSize);
    for (const layer of ["axis", "foreground"] as const) {
      for (const node of layerOf(scene, layer)) {
        if (node.tag !== "text") {
          continue;
        }
        const start = number(node.attrs?.x) - (layer === "axis" ? metrics.labelPadding : 0);
        spans.push({ start, end: start + measure(node.text ?? "").main });
      }
    }
    expect(spans.length).toBeGreaterThan(1);
    for (let i = 0; i < spans.length; i += 1) {
      for (let j = i + 1; j < spans.length; j += 1) {
        const a = spans[i];
        const b = spans[j];
        expect(
          (a?.end ?? 0) <= (b?.start ?? 0) || (b?.end ?? 0) <= (a?.start ?? 0),
          `axis labels ${String(i)} and ${String(j)} overlap`,
        ).toBe(true);
      }
    }
  });

  it("still draws the marker itself when its label had to go", () => {
    const { scene } = render({
      width: 300,
      decorations: [
        { kind: "marker", id: "m", time: DOMAIN[0] + DAY, label: "a very long caption right here" },
      ],
    });
    const foreground = layerOf(scene, "foreground");
    expect(foreground.filter((node) => node.tag === "polygon")).toHaveLength(1);
    expect(foreground.filter((node) => node.tag === "text")).toHaveLength(0);
  });
});

describe("a container that measures nothing", () => {
  // Found by looking, not by a test: the demo page rendered an empty body and
  // the console held a RangeError. A container with zero extent is not an
  // error condition — it is a hidden tab, a collapsed panel, or simply a
  // frame rendered before the browser has laid anything out. A library that
  // throws there takes down the host's render loop on page load.
  const base = {
    items: [{ id: "a", start: Date.UTC(2026, 0, 2), end: Date.UTC(2026, 0, 5), label: "A" }],
    domain: [Date.UTC(2026, 0, 1), Date.UTC(2026, 1, 1)] as const,
  };

  it("renders an empty frame instead of throwing", () => {
    for (const size of [
      { width: 0, height: 200 },
      { width: 900, height: 0 },
      { width: 0, height: 0 },
      { width: -10, height: 200 },
    ]) {
      const result = renderTimeline({ ...base, ...size });
      expect(result.visibleCount).toBe(0);
      expect(result.ticks).toEqual([]);
      expect(result.labels.kept).toEqual([]);
      expect(result.viewport.msPerPx).toBe(0);
      expect(result.contentCrossSize).toBe(0);
    }
  });

  it("keeps the root the host can mount, with the same layers", () => {
    const empty = renderTimeline({ ...base, width: 0, height: 200, instanceId: "x" });
    const real = renderTimeline({ ...base, width: 900, height: 200, instanceId: "x" });
    expect(empty.scene.attrs?.class).toBe("tl");
    expect(empty.scene.attrs?.["data-tl-instance"]).toBe("x");
    expect(empty.scene.attrs?.["data-tl-orientation"]).toBe("horizontal");
    // Negative extents do not leak into the markup.
    expect(renderTimeline({ ...base, width: -10, height: 200 }).scene.attrs?.width).toBe(0);
    // Same layer structure as a real frame, so a patching renderer can
    // diff the two instead of rebuilding.
    const layersOf = (scene: SceneElement): readonly (string | number | undefined)[] =>
      (scene.children ?? [])
        .filter((child) => child.tag === "g")
        .map((child) => child.attrs?.class);
    expect(layersOf(empty.scene)).toEqual(layersOf(real.scene));
    // And the stylesheet is there, so mounting it is already themed.
    expect(renderToSvgString(empty.scene)).toContain("--tl-surface:");
    expect(renderToSvgString(renderTimeline({ ...base, width: 0, height: 0, includeStyle: false }).scene)).not.toContain(
      "<style>",
    );
  });

  it("lets the input machine wait for a size instead of throwing", () => {
    const machine = createInputMachine({ domain: [base.domain[0], base.domain[1]], mainSize: 0 });
    // A host builds the machine next to the element, so it meets the same
    // zero-size container — and a pointer handler is the worst place to throw.
    expect(machine.handle({ pointerId: 1, phase: "down", x: 10, y: 10, time: 0, pointerType: "touch" })).toEqual([]);
    expect(
      machine.wheel({ x: 10, y: 10, deltaX: 0, deltaY: 50, ctrlKey: false, shiftKey: false, time: 0 }),
    ).toEqual([]);
    expect(machine.pan(50)).toEqual([]);
    expect(machine.zoom(2, 10)).toEqual([]);
    machine.setDomain([base.domain[0], base.domain[1]]);
    expect(machine.domain).toEqual([base.domain[0], base.domain[1]]);
    // Once it has pixels, it works.
    machine.resize({ mainSize: 900 });
    machine.handle({ pointerId: 1, phase: "down", x: 300, y: 10, time: 0, pointerType: "touch" });
    expect(
      machine.handle({ pointerId: 1, phase: "move", x: 500, y: 10, time: 10, pointerType: "touch" }).length,
    ).toBeGreaterThan(0);
  });
});

describe("the axis's context label", () => {
  const contextOf = (scene: SceneElement): readonly SceneElement[] => layerOf(scene, "context");

  it("says the month of a view of days, at the start of the axis, over the surface", () => {
    const nodes = contextOf(render().scene);
    expect(nodes.map((node) => node.attrs?.class)).toEqual([
      "tl-axis-context",
      "tl-tick-label tl-tick-label--major tl-tick-label--context",
    ]);
    expect(nodes[1]?.text).toBe("2025-03");
    expect(number(nodes[0]?.attrs?.x)).toBe(0);
  });

  it("says the year of a view of months, and nothing for a view of years", () => {
    const months = render({ domain: [Date.UTC(2025, 1, 1), Date.UTC(2025, 11, 1)] });
    expect(contextOf(months.scene)[1]?.text).toBe("2025");
    const years = render({ domain: [Date.UTC(1900, 0, 1), Date.UTC(2100, 0, 1)] });
    expect(contextOf(years.scene)).toEqual([]);
  });

  it("names the unit whose first tick is under it, not the sliver before", () => {
    // Daily ticks: March's first is four hours in, under the label.
    const under = contextOf(render({ domain: [Date.UTC(2025, 1, 28, 20), Date.UTC(2025, 2, 9)] }).scene);
    expect(under[1]?.text).toBe("2025-03");
    // Weekly ticks: the first is March 3rd, a hundred pixels in — the days
    // before it are February's, and the label says so.
    const before = contextOf(render({ domain: [Date.UTC(2025, 1, 28, 20), Date.UTC(2025, 2, 20)] }).scene);
    expect(before[1]?.text).toBe("2025-02");
  });

  it("covers every tick label that starts under it, whole", () => {
    // The first daily tick is four hours in, 8 px: under the context label (V27 — the domain before had none, and nothing was asserted).
    const domain: [number, number] = [Date.UTC(2025, 2, 1, 20), Date.UTC(2025, 2, 21)];
    const { scene, ticks } = render({ domain });
    const width = number(contextOf(scene)[0]?.attrs?.width);
    const measure = labelSpace(densityMetrics("comfortable", "horizontal"), estimateTextWidth, densityMetrics("comfortable", "horizontal").tickFontSize);
    const scale = (time: number): number => ((time - domain[0]) / (domain[1] - domain[0])) * 900;
    const under = ticks.filter((tick) => scale(tick.time) >= 0 && scale(tick.time) < width);
    expect(under.length).toBeGreaterThan(0);
    for (const tick of under) expect(scale(tick.time) + measure(defaultTickLabel(tick)).main).toBeLessThanOrEqual(width + 1e-6);
  });

  it("is the host's formatTick, told it is the context, and can be switched off", () => {
    const seen: Tick[] = [];
    const { scene } = render({
      formatTick: (tick) => {
        seen.push(tick);
        return tick.context === true ? "March" : "x";
      },
    });
    expect(contextOf(scene)[1]?.text).toBe("March");
    expect(seen.filter((tick) => tick.context === true).length).toBeGreaterThan(0);
    expect(contextOf(render({ axisContext: false }).scene)).toEqual([]);
  });

  it("formats each granularity's context without Intl", () => {
    const at = Date.UTC(2025, 2, 30, 13, 45, 7, 250);
    const context = (granularity: Tick["granularity"]): string => defaultTickLabel({ time: at, granularity, major: true, context: true });
    expect(context("millisecond")).toBe("13:45:07");
    expect(context("second")).toBe("2025-03-30 13:45");
    expect(context("minute")).toBe("2025-03-30");
    expect(context("hour")).toBe("2025-03-30");
    expect(context("day")).toBe("2025-03");
    expect(context("month")).toBe("2025");
    expect(context("year")).toBe("");
  });
});

describe("focus and forced colours", () => {
  const css = (): string => (render().scene.children ?? [])[0]?.text ?? "";

  it("draws the timeline's own focus ring inside its box, where a clipping parent cannot cut it", () => {
    expect(css()).toContain(".tl:focus-visible{outline:2px solid var(--tl-focus);outline-offset:-2px}");
  });

  it("turns every token into a system colour in forced colours, whatever the theme", () => {
    const text = css();
    const at = text.indexOf("@media (forced-colors:active)");
    expect(at).toBeGreaterThan(-1);
    const block = text.slice(at);
    expect(block).toContain('.tl:not([data-tl-theme="light"])');
    for (const token of ["surface", "text", "item-fill", "item-stroke", "item-text", "focus", "accent", "line"]) {
      expect(block).toMatch(new RegExp(`--tl-${token}:(Canvas|CanvasText|GrayText|Highlight)[;}]`));
    }
  });
});

describe("the edges of what it accepts (R30, R31)", () => {
  it("refuses a NaN width or height, instead of a NaN viewBox or a throw from deep inside", () => {
    expect(() => renderTimeline({ items: [], domain: [0, 1000], width: 300, height: Number.NaN })).toThrow(RangeError);
    expect(() => renderTimeline({ items: [], domain: [0, 1000], width: Number.NaN, height: 200 })).toThrow(RangeError);
    expect(() => renderTimeline({ items: [], domain: [0, 1000], width: 300, height: Number.POSITIVE_INFINITY })).toThrow(RangeError);
  });

  it("names an item at the edge of the accepted range without taking the frame down", () => {
    const edge = 8.64e15;
    const result = renderTimeline({ items: [{ id: "edge", start: edge, label: "Last" }], domain: [edge - 86_400_000, edge], width: 600, height: 200 });
    expect(result.layout.items).toHaveLength(1);
  });
});

describe("a dense lane", () => {
  it("places labels in time that grows with the items, not with their square", () => {
    // R5: 10k items in one lane, more than fit the width, took 1094 ms a frame
    // without a scene space; 80k took ~38 s. An instant drawn wider than its
    // time overlaps its neighbours, and the inside-room search followed that
    // chain across the whole row for every item.
    const day = 86_400_000;
    const items: Item[] = Array.from({ length: 80_000 }, (_, i) => ({ id: `i${String(i)}`, start: i * day, end: i * day + day / 2, label: `Event ${String(i)}` }));
    const started = performance.now();
    renderTimeline({ items, domain: [0, 80_000 * day], width: 1200, height: 400 });
    // ~1.8 s alone; 7.5 s under the gate's coverage on a loaded machine. The
    // old code took 45 s, so 15 s still tells the two apart.
    expect(performance.now() - started).toBeLessThan(budgetMs(15_000));
  });
});

describe("the start index (R83)", () => {
  it("measures long against the items with a length, not against instants", async () => {
    const { startIndexOf } = await import("../src/render.js");
    const { layoutItems } = await import("../src/layout.js");
    const T = Date.UTC(2025, 0, 1);
    const items: Item[] = [
      ...Array.from({ length: 900 }, (_, i) => ({ id: `i${String(i)}`, start: T + i * 60_000 })),
      ...Array.from({ length: 100 }, (_, i) => ({ id: `h${String(i)}`, start: T + i * 3_600_000, end: T + (i + 1) * 3_600_000 })),
      { id: "year", start: T, end: T + 365 * DAY },
      { id: "open", start: T, open: true },
    ];
    const layout = layoutItems(items);
    const index = startIndexOf(layout);
    // The median instant is a millisecond: every hour was "long" and looked at in every tile.
    const long = index.long.map((position) => layout.items[position]?.item.id).sort();
    expect(long).toEqual(["open", "year"]);
    // Only instants: only the open one is apart.
    const instants = layoutItems([...items.slice(0, 900), { id: "open", start: T, open: true }]);
    expect(startIndexOf(instants).long.map((position) => instants.items[position]?.item.id)).toEqual(["open"]);
  });
});
