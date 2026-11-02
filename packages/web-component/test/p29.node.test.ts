import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import type { Item, Lane } from "@temporeum/timeline-core";

import { hasPlugin, registerPlugin, renderTimelineSvg } from "../src/index.js";
import type { TimelineConfig } from "../src/index.js";
import { exportPlugin } from "../src/export.js";
import { ganttPlugin } from "../src/gantt.js";
import { resourcesPlugin } from "../src/resources.js";
import { intlPlugin } from "../src/intl.js";

/**
 * The Gantt chart, the resource view and export are plugins on entry
 * points of their own. Two claims. A page that does not import them does
 * not download them — the base's import graph holds none of the core's
 * `/gantt`, `/resources` or `/export`. And a configuration that asks for a
 * part whose plugin is not registered says which import is missing, where
 * it is drawn, instead of drawing a plain timeline.
 *
 * The registry is the page's, and in this file the page starts with none:
 * the order of the tests below is the order of a page's life.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 1);
const items: Item[] = [
  { id: "a", start: T0, end: T0 + 4 * DAY, label: "Spec", laneId: "a", progress: 0.5 },
  { id: "b", start: T0 + 5 * DAY, end: T0 + 9 * DAY, label: "Build", laneId: "b" },
];
const lanes: Lane[] = [
  { id: "a", label: "Spec" },
  { id: "b", label: "Build" },
];
const gantt: TimelineConfig = { items, lanes, gantt: { dependencies: [{ from: "a", to: "b" }] }, domain: [T0 - DAY, T0 + 12 * DAY] };
const resources: TimelineConfig = { items, resources: [{ id: "a", label: "Ann" }, { id: "b", label: "Ben" }], domain: [T0 - DAY, T0 + 12 * DAY] };

/** The modules a source file imports at run time — `import type` and type-only lines left out. */
function runtimeImports(file: string): string[] {
  const text = readFileSync(join(SRC, file), "utf8");
  const found: string[] = [];
  for (const match of text.matchAll(/^(?:import|export)\s+(?!type\b)(?:[^;]*?\sfrom\s+)?"([^"]+)";/gms)) {
    found.push(match[1] as string);
  }
  return found;
}

/** Every source file the base entry reaches, and every package it imports. */
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

describe("the base does not carry the plugins", () => {
  it("the base entry reaches none of the core's /gantt, /resources or /export, nor the plugins' own files", () => {
    for (const entry of ["index.ts", "define.ts"]) {
      const { files, packages } = reach(entry);
      for (const core of ["@temporeum/timeline-core/gantt", "@temporeum/timeline-core/resources", "@temporeum/timeline-core/export"]) {
        expect(packages.has(core), `${entry} reaches ${core}`).toBe(false);
      }
      for (const own of ["gantt.ts", "resources.ts", "export.ts", "task-grid.ts", "backlog.ts"]) {
        expect(files.has(own), `${entry} reaches ${own}`).toBe(false);
      }
    }
  });

  it("each plugin reaches its own part of the core — the control that the walk above sees an import at all", () => {
    expect(reach("gantt.ts").packages.has("@temporeum/timeline-core/gantt")).toBe(true);
    expect(reach("resources.ts").packages.has("@temporeum/timeline-core/resources")).toBe(true);
    expect(reach("export.ts").packages.has("@temporeum/timeline-core/export")).toBe(true);
  });
});

describe("a missing plugin is named, not ignored", () => {
  it("a Gantt configuration with no plugin throws, naming the import", () => {
    expect(hasPlugin("gantt")).toBe(false);
    expect(() => renderTimelineSvg(gantt)).toThrow(TypeError);
    expect(() => renderTimelineSvg(gantt)).toThrow('import { ganttPlugin } from "@temporeum/timeline-element/gantt"');
  });

  it("a resource view with no plugin throws, naming the import", () => {
    expect(() => renderTimelineSvg(resources)).toThrow('import { resourcesPlugin } from "@temporeum/timeline-element/resources"');
  });

  it("a plain timeline needs no plugin", () => {
    expect(renderTimelineSvg({ items, lanes }).svg).toContain("<svg");
  });

  it("registered, the Gantt chart draws its arrows and the resource view its load", () => {
    registerPlugin(ganttPlugin, resourcesPlugin, exportPlugin);
    registerPlugin(ganttPlugin);
    expect(hasPlugin("gantt") && hasPlugin("resources") && hasPlugin("export")).toBe(true);
    const drawn = renderTimelineSvg(gantt).svg;
    expect(drawn).toContain("tl-layer--deps");
    expect(drawn).toMatch(/data-tl-dep="a-(>|&gt;)b"/);
    expect(renderTimelineSvg(resources).svg).toContain("tl-layer--load");
  });

  it("registered, the resource view says its overbookings in the configured words and locale", () => {
    const overbooked: TimelineConfig = {
      items: [
        { id: "x", start: T0, end: T0 + 4 * DAY, label: "Spec", laneId: "a" },
        { id: "y", start: T0 + DAY, end: T0 + 3 * DAY, label: "Review", laneId: "a" },
      ],
      resources: [{ id: "a", label: "Ann", capacity: 1 }],
      strings: { loadLane: "Terhelés: {lane}", overbooked: "túlfoglalva ({percent}%)" },
      locale: "hu",
      timeZone: "Europe/Budapest",
      domain: [T0 - DAY, T0 + 6 * DAY],
    };
    // The words of another language belong to the `/intl` plugin.
    registerPlugin(intlPlugin);
    const drawn = renderTimelineSvg(overbooked).svg;
    // Hungarian dates on Budapest's clock (an hour past UTC midnight), the configured words.
    expect(drawn).toContain('aria-label="Spec, 2026. jan. 1. 1:00 – 2026. jan. 5. 1:00, Ann, túlfoglalva (200%)"');
  });
});
