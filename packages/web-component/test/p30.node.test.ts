import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import type { Item, Lane } from "@temporeum/timeline-core";

import { contentOf, hiddenDatesOf, minimapSize, usesSceneSpace } from "../src/config.js";
import { hasPlugin, registerPlugin, renderTimelineHtml, renderTimelineSvg } from "../src/index.js";
import { resolvedServerFrame } from "../src/ssr.js";
import type { TimelineConfig } from "../src/index.js";
import { groupsPlugin } from "../src/groups.js";
import { intlPlugin } from "../src/intl.js";
import { itemsPlugin } from "../src/items.js";
import { requireKinds, requirePlugins } from "../src/plugins.js";
import { toolsPlugin } from "../src/tools.js";

/**
 * P30: the time tools, the group tree, the item kinds and the other
 * languages are plugins too. The same two claims as P29's, for the four new
 * ones: the base does not import them — the core's `/tools`, `/groups`,
 * `/items` and `/intl` are not in its graph, and neither are the plugins'
 * own files — and an option that needs one says which import is missing.
 *
 * The registry is the page's, and in this file the page starts with none:
 * the order of the tests below is the order of a page's life.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 5);
const items: Item[] = [
  { id: "a", start: T0, end: T0 + 3 * DAY, label: "Spec", laneId: "x" },
  { id: "b", start: T0 + 4 * DAY, end: T0 + 8 * DAY, label: "Build", laneId: "y" },
];
const lanes: Lane[] = [
  { id: "x", label: "Design" },
  { id: "y", label: "Engineering" },
];
const domain = [T0 - DAY, T0 + 10 * DAY] as const;
const base: TimelineConfig = { items, lanes, domain };

/** The modules a source file imports at run time — `import type` and type-only lines left out. */
function runtimeImports(file: string): string[] {
  const text = readFileSync(join(SRC, file), "utf8");
  const found: string[] = [];
  for (const match of text.matchAll(/^(?:import|export)\s+(?!type\b)(?:[^;]*?\sfrom\s+)?"([^"]+)";/gms)) {
    found.push(match[1] as string);
  }
  return found;
}

/** Every source file an entry reaches, and every package it imports. */
function reach(entry: string): { readonly files: Set<string>; readonly packages: Set<string> } {
  const files = new Set<string>();
  const packages = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (files.has(file)) continue;
    files.add(file);
    for (const spec of runtimeImports(file)) {
      if (spec.startsWith("./")) queue.push(spec.slice(2).replace(/\.js$/, ".ts"));
      else packages.add(spec);
    }
  }
  return { files, packages };
}

/** The error a missing plugin throws: a TypeError naming what asked and the import. */
function missing(run: () => unknown, name: string, what: string): void {
  let thrown: unknown;
  try {
    run();
  } catch (error) {
    thrown = error;
  }
  expect(thrown, `${what} did not throw`).toBeInstanceOf(TypeError);
  const message = (thrown as TypeError).message;
  expect(message).toContain(what);
  expect(message).toContain(`import { ${name}Plugin } from "@temporeum/timeline-element/${name}"`);
  expect(message).toContain(`registerPlugin(${name}Plugin)`);
}

const PLUGINS = { tools: "/tools", groups: "/groups", items: "/items", intl: "/intl" } as const;

describe("P30: the base does not carry the four new plugins", () => {
  it("the base entry reaches none of the core's /tools, /groups, /items or /intl, nor the plugins' own files", () => {
    for (const entry of ["index.ts", "define.ts"]) {
      const { files, packages } = reach(entry);
      for (const core of Object.values(PLUGINS)) {
        expect(packages.has(`@temporeum/timeline-core${core}`), `${entry} reaches the core's ${core}`).toBe(false);
      }
      for (const own of ["tools.ts", "tools/layer.ts", "groups.ts", "groups/layer.ts", "items.ts", "intl.ts"]) expect(files.has(own), `${entry} reaches ${own}`).toBe(false);
      // What it loads instead: live data and the English words.
      expect(packages.has("@temporeum/timeline-core/live")).toBe(true);
      expect(packages.has("@temporeum/timeline-core/words")).toBe(true);
    }
  });

  it("each plugin reaches its own part of the core — the control that the walk above sees an import at all", () => {
    for (const [name, core] of Object.entries(PLUGINS)) {
      expect(reach(`${name}.ts`).packages.has(`@temporeum/timeline-core${core}`), `${name}.ts`).toBe(true);
    }
  });
});

describe("P30: a missing plugin is named, not ignored", () => {
  it("starts with none of them", () => {
    for (const name of ["tools", "groups", "items", "intl"] as const) expect(hasPlugin(name)).toBe(false);
  });

  it("a plain timeline needs none of them, and empty or switched-off tools ask for nothing", () => {
    expect(renderTimelineSvg(base).svg).toContain("<svg");
    const off: TimelineConfig = { ...base, hiddenDates: [], timeBars: [], rolling: false, zoomPresets: false, minimap: false, rangeSelect: false, laneHeaders: false, tooltip: false, direction: "ltr" };
    expect(renderTimelineSvg(off).svg).toContain("<svg");
    expect(minimapSize(off)).toBe(0);
    expect(hiddenDatesOf(off)).toBeUndefined();
    expect(usesSceneSpace(off)).toBe(true);
  });

  it("every time tool asks for the tools plugin, by its option's name", () => {
    const tools: Record<string, TimelineConfig> = {
      hiddenDates: { hiddenDates: [{ start: T0, end: T0 + DAY }] },
      timeBars: { timeBars: [{ id: "now", time: T0 }] },
      rolling: { rolling: true },
      zoomPresets: { zoomPresets: true },
      minimap: { minimap: { size: 24 } },
      rangeSelect: { rangeSelect: true },
      laneHeaders: { laneHeaders: true },
      tooltip: { tooltip: (item) => item.label ?? null },
    };
    for (const [option, config] of Object.entries(tools)) {
      missing(() => renderTimelineSvg({ ...base, ...config }), "tools", `The ${option} option`);
      missing(() => requirePlugins(config), "tools", `The ${option} option`);
    }
    // The helpers a host may call on their own say so too.
    missing(() => minimapSize({ minimap: true }), "tools", "The minimap option");
    missing(() => hiddenDatesOf({ hiddenDates: [{ start: T0, end: T0 + DAY }] }), "tools", "The hiddenDates option");
    // Hidden dates draw exactly whether or not the plugin is there.
    expect(usesSceneSpace({ hiddenDates: [{ start: T0, end: T0 + DAY }] })).toBe(false);
  });

  it("groups ask for the groups plugin", () => {
    missing(() => renderTimelineSvg({ ...base, groups: [{ id: "x", label: "Design" }] }), "groups", "The groups option");
    missing(() => contentOf({ groups: [{ id: "x" }] }, { items }), "groups", "The groups option");
  });

  it("a template, adding, removing, dropping and an item of a drawn kind ask for the items plugin", () => {
    missing(() => renderTimelineSvg({ ...base, template: () => "<b>x</b>" }), "items", "The template option");
    for (const key of ["add", "remove", "drop"] as const) {
      missing(() => renderTimelineSvg({ ...base, editing: { enabled: true, [key]: true } }), "items", `The editing.${key} option`);
    }
    for (const kind of ["box", "point", "background"] as const) {
      const kinded = [...items, { id: "k", start: T0 + DAY, kind, label: kind }];
      missing(() => renderTimelineSvg({ ...base, items: kinded }), "items", `An item of kind "${kind}"`);
      // A fetched source's items are read where a frame lays them out.
      missing(() => contentOf({}, { items: kinded }), "items", `An item of kind "${kind}"`);
    }
    // A range and a milestone are not the items plugin's.
    expect(() => {
      requireKinds([{ id: "r", start: T0, end: T0 + DAY, kind: "range" }, { id: "m", start: T0, kind: "milestone" }]);
    }).not.toThrow();
    expect(() => renderTimelineSvg({ ...base, editing: { enabled: true, add: false, remove: false, drop: false } })).not.toThrow();
  });

  it("other words, a calendar and a mirrored direction ask for the intl plugin", () => {
    missing(() => renderTimelineSvg({ ...base, strings: { newItem: "Neues Element" } }), "intl", "The strings option");
    missing(() => renderTimelineSvg({ ...base, calendar: "hebrew" }), "intl", "The calendar option");
    missing(() => renderTimelineSvg({ ...base, direction: "rtl" }), "intl", 'The direction "rtl" option');
    // "auto" may resolve to right to left at run time: it asks up front.
    missing(() => renderTimelineSvg({ ...base, direction: "auto" }), "intl", 'The direction "auto" option');
    missing(() => renderTimelineHtml({ ...base, direction: "rtl" }), "intl", 'The direction "rtl" option');
  });
});

describe("P30: registered, each plugin draws its part", () => {
  it("the tools: hidden dates drawn exactly, the overview strip and the lane headers in the frame", () => {
    registerPlugin(toolsPlugin);
    registerPlugin(toolsPlugin);
    expect(hasPlugin("tools")).toBe(true);
    const hidden = { ...base, hiddenDates: [{ start: T0 + DAY, end: T0 + 2 * DAY }] };
    expect(hiddenDatesOf(hidden)?.stretches(T0, T0 + 3 * DAY)).toEqual([{ start: T0 + DAY, end: T0 + 2 * DAY }]);
    expect(hiddenDatesOf(hidden)?.timeZone).toBe("UTC");
    // One object per ranges array and zone.
    expect(hiddenDatesOf(hidden)).toBe(hiddenDatesOf(hidden));
    expect(minimapSize({ minimap: true })).toBeGreaterThan(0);
    expect(minimapSize({ minimap: { size: 24 } })).toBe(24);
    const frame = resolvedServerFrame({ ...hidden, minimap: true, laneHeaders: true });
    expect(frame.view.band).toBeGreaterThan(0);
    expect(frame.svg).toContain("tl-layer--minimap");
    expect(frame.svg).toContain("tl-layer--lane-headers");
    expect(frame.svg).toContain('data-tl-lane-header="y"');
    // The strip alone, and the headers alone.
    expect(renderTimelineSvg({ ...base, minimap: true }).svg).not.toContain("tl-layer--lane-headers");
    expect(renderTimelineSvg({ ...base, laneHeaders: true }).svg).not.toContain("tl-layer--minimap");
    // The client's controls ask for nothing on the server.
    expect(renderTimelineSvg({ ...base, tooltip: true, zoomPresets: true, rangeSelect: true, rolling: true, timeBars: [{ id: "now", time: T0 }] }).svg).toContain("<svg");
  });

  it("the groups: the header rows and the tree's markup", () => {
    registerPlugin(groupsPlugin);
    const frame = renderTimelineSvg({ items, domain, groups: [{ id: "team", label: "Team" }, { id: "x", parentId: "team", label: "Design" }, { id: "y", parentId: "team", label: "Engineering" }] });
    expect(frame.groups).toContain('role="tree"');
    expect(frame.groups).toContain("Engineering");
    // Without groups there is no tree, with the plugin as without.
    expect(renderTimelineSvg(base).groups).toBe("");
  });

  it("the items: the kinds, the background as a decoration, a template", () => {
    registerPlugin(itemsPlugin);
    const kinded: TimelineConfig = {
      ...base,
      items: [
        ...items,
        { id: "box", start: T0 + DAY, end: T0 + 2 * DAY, kind: "box", label: "Box", laneId: "x" },
        { id: "dot", start: T0 + 5 * DAY, kind: "point", label: "Dot", laneId: "y" },
        { id: "bg", start: T0 + 6 * DAY, end: T0 + 7 * DAY, kind: "background", label: "Freeze" },
      ],
    };
    const svg = renderTimelineSvg(kinded).svg;
    expect(svg).toContain("tl-item-box");
    expect(svg).toContain("tl-item-dot");
    expect(svg).toContain("tl-background");
    // A background is not an item to the layout.
    expect(contentOf(kinded, { items: kinded.items as Item[] }).items.map((item) => item.id)).not.toContain("bg");
    const templated = renderTimelineSvg({ ...base, template: (item) => `<b class="who">${item.label ?? ""}</b>` }).svg;
    expect(templated).toContain('class="who"');
    expect(() => {
      requireKinds([{ id: "k", start: T0, kind: "box" }]);
    }).not.toThrow();
  });

  it("the intl plugin: the dictionary's names, a mirrored frame, a calendar's axis", () => {
    registerPlugin(intlPlugin);
    const named = renderTimelineSvg({ ...base, strings: { range: "{start} bis {end}" }, locale: "de" }).svg;
    expect(named).toContain(" bis ");
    const mirrored = renderTimelineSvg({ ...base, direction: "rtl" }).svg;
    expect(mirrored).toContain('dir="rtl"');
    expect(mirrored).toContain("tl-mirror");
    // "auto" on a server, which has no computed style, draws left to right.
    expect(renderTimelineSvg({ ...base, direction: "auto" }).svg).not.toContain('dir="rtl"');
    // 5 January 2026 is 16 Tevet 5786: the axis counts the calendar's own days.
    const labels = (svg: string): string[] =>
      [...svg.matchAll(/class="tl-tick-label(?![^"]*--context)[^"]*"[^>]*>([^<]*)</g)].map((match) => match[1] as string);
    const context = (svg: string): string | undefined => /class="[^"]*tl-tick-label--context"[^>]*>([^<]*)</.exec(svg)?.[1];
    expect(labels(renderTimelineSvg(base).svg)).toEqual(["05", "12"]);
    expect(context(renderTimelineSvg(base).svg)).toBe("2026-01");
    const hebrew = renderTimelineSvg({ ...base, calendar: "hebrew", locale: "en" }).svg;
    expect(labels(hebrew)).toEqual(["16", "23"]);
    // The context label is the calendar's month too.
    expect(context(hebrew)).toMatch(/Tevet 5786/);
  });

  it("with every plugin registered, every option above draws", () => {
    for (const name of ["tools", "groups", "items", "intl"] as const) expect(hasPlugin(name)).toBe(true);
    expect(() =>
      requirePlugins({
        hiddenDates: [{ start: T0, end: T0 + DAY }],
        timeBars: [{ id: "now", time: T0 }],
        rolling: true,
        zoomPresets: true,
        minimap: true,
        rangeSelect: true,
        laneHeaders: true,
        tooltip: true,
        groups: [],
        template: () => null,
        editing: { add: true, remove: true, drop: true },
        strings: {},
        calendar: "persian",
        direction: "auto",
      }),
    ).not.toThrow();
  });
});
