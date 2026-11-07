import { existsSync, readdirSync, readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import { renderTimelineSvg } from "../src/index.js";

/**
 * What the reference says about the configuration is what the code does:
 * the default orientation (R24), and which fields the element has as
 * properties (R25). The reference is generated from these doc comments and
 * from api.md, so a wrong sentence here is a wrong reference page.
 */

const source = (path: string): string => readFileSync(new URL(path, import.meta.url), "utf8");
const T0 = Date.UTC(2026, 0, 5);
const items = [{ id: "a", start: T0, end: T0 + 86_400_000, label: "A" }];

describe("the reference's orientation default (R24)", () => {
  it("says auto, and an unset orientation is auto: vertical below the breakpoint, horizontal above", () => {
    const doc = /\/\*\*([^*]|\*(?!\/))*\*\/\s*readonly orientation\?/.exec(source("../src/config.ts"))?.[0] ?? "";
    expect(doc).toMatch(/`"auto"` by default/);
    expect(doc).not.toMatch(/[Hh]orizontal by default/);
    expect(renderTimelineSvg({ items }, { width: 600 }).orientation).toBe("vertical");
    expect(renderTimelineSvg({ items }, { width: 900 }).orientation).toBe("horizontal");
  });
});

describe("the reference's element properties (R25)", () => {
  it("names exactly the configuration fields the element has accessors for, and sends the rest through config", () => {
    const accessors = [...source("../src/element.ts").matchAll(/^ {2}get (\w+)\(\)/gm)].map((m) => m[1]).filter((name) => name !== "timeline" && name !== "config");
    const page = source("../../docs/site/pages/reference/api.md");
    const sentence = /On the element, [^\n]*/.exec(page)?.[0] ?? "";
    const named = [...sentence.matchAll(/`element\.(\w+)`|`(\w+)`/g)].map((m) => m[1] ?? m[2]).filter((name) => name !== "config");
    expect(new Set(named)).toEqual(new Set(accessors));
    expect(sentence).toMatch(/`element\.config`/);
    expect(sentence).not.toMatch(/the same fields are properties/);
  });
});

describe("what a pinned lane does (R9)", () => {
  it("is described as first and scrolling with the rest, which is what it does", () => {
    const doc = /\/\*\*([^*]|\*(?!\/))*\*\/\s*readonly pinned\?/.exec(source("../../core/src/types.ts"))?.[0] ?? "";
    expect(doc).toMatch(/comes first/);
    expect(doc).toMatch(/scrolls with the others/);
    for (const page of ["guides/items-and-lanes.md", "recipes/log.md"]) {
      const text = source(`../../docs/site/pages/${page}`);
      expect(text).not.toMatch(/pinned[^.\n]*(keeps its place|stays in view|keep their cross position)/i);
    }
    const lanes = [{ id: "rest", label: "Rest" }, { id: "top", label: "Top", pinned: true }];
    const many = [{ id: "a", laneId: "top", start: T0, end: T0 + 86_400_000 }, ...Array.from({ length: 30 }, (_, n) => ({ id: `r${String(n)}`, laneId: "rest", start: T0, end: T0 + 86_400_000 }))];
    const yOf = (svg: string, lane: string): number => Number(new RegExp(`<rect[^>]*data-tl-lane="${lane}"[^>]*\\sy="([-\\d.]+)"`).exec(svg)?.[1] ?? Number.NaN);
    const svg = renderTimelineSvg({ items: many, lanes, height: 300, orientation: "horizontal" }, { width: 900 }).svg;
    // First: above the lane listed before it, with the pinned class.
    expect(yOf(svg, "top")).toBeLessThan(yOf(svg, "rest"));
    expect(svg).toMatch(/class="tl-lane tl-lane--pinned"/);
  });
});

describe("one name for an accessible name (R21, D7)", () => {
  it("is ariaLabel in every options object of every entry point", () => {
    const files = ["config.ts", "task-grid.ts", "backlog.ts", "calendar-view.ts", "story.ts", "export.ts"];
    const named: string[] = [];
    for (const file of files) {
      for (const block of source(`../src/${file}`).matchAll(/export interface (\w+)[^{]*\{([\s\S]*?)\n\}/g)) {
        // A dictionary's keys are phrases, not options.
        if (block[1]?.endsWith("Strings") === true) continue;
        for (const member of (block[2] ?? "").matchAll(/\/\*\*((?:[^*]|\*(?!\/))*)\*\/\s*readonly (\w+)\??:/g)) {
          // A field that is the name, not one that says what happens to the name.
          if (/^[\s*]*The (\w+'s )?accessible name\b/.test(member[1] ?? "")) named.push(`${block[1] ?? ""}.${member[2] ?? ""}`);
        }
      }
    }
    expect(named.length).toBeGreaterThanOrEqual(4); // config, calendar view, grid, backlog
    expect(named.filter((name) => !name.endsWith(".ariaLabel"))).toEqual([]);
  });
});

describe("one install types an app and reaches its plugins (R23)", () => {
  it("every adapter's README installs the element beside it, as the plugins it imports need", () => {
    for (const framework of ["react", "vue", "svelte", "angular"]) {
      const readme = source(`../../${framework}/README.md`);
      expect(readme, framework).toMatch(new RegExp(`npm install @temporeum/timeline-${framework} @temporeum/timeline-element\\n`));
      expect(readme, framework).toMatch(/`Item`, `Lane`/);
    }
    expect(source("../../docs/site/pages/getting-started.md")).toMatch(/npm install @temporeum\/timeline-react @temporeum\/timeline-element\n/);
  });
});

describe("what the reference pages and READMEs list is what there is (R54–R63)", () => {
  const readme = source("../README.md");

  it("names every attribute the element reads, and nonce", async () => {
    const { OBSERVED_ATTRIBUTES } = await import("../src/index.js");
    const table = readme.slice(readme.indexOf("| Attribute | Means |"));
    const named = new Set([...table.slice(0, table.indexOf("\n\n")).matchAll(/`([a-z-]+)`/g)].map((m) => m[1]));
    for (const attribute of [...OBSERVED_ATTRIBUTES, "nonce"]) expect(named, attribute).toContain(attribute);
  });

  it("says what each entry point exports, and only that", async () => {
    const entries: Record<string, () => Promise<Record<string, unknown>>> = {
      calendar: () => import("../src/calendar.js"),
      gantt: () => import("../src/gantt.js"),
      resources: () => import("../src/resources.js"),
      export: () => import("../src/export.js"),
      tools: () => import("../src/tools.js"),
      groups: () => import("../src/groups.js"),
      items: () => import("../src/items.js"),
      intl: () => import("../src/intl.js"),
      story: () => import("../src/story.js"),
    };
    for (const [entry, load] of Object.entries(entries)) {
      const row = new RegExp(`^\\| \`dist/${entry}\\.mjs\` .*$`, "m").exec(readme)?.[0] ?? "";
      expect(row, entry).not.toBe("");
      const exported = Object.keys(await load());
      for (const name of [...row.matchAll(/\(`(\w+)`\)/g)].map((m) => m[1] ?? "")) expect(exported, `${entry} exports ${name}`).toContain(name);
      // A row that promises more than its names ("and the … functions") promises what is not there.
      expect(row, entry).not.toMatch(/functions \|$/);
    }
    // The reference lists every one of the element's entry points.
    const api = source("../../docs/site/pages/reference/api.md");
    for (const entry of Object.keys(entries)) expect(api, entry).toContain(`@temporeum/timeline-element/${entry}`);
    expect(api).toMatch(/`renderTimelineSvg\(config, \{ width\? \}\)` — [^\n]*`ServerFrame`/);
  });

  it("names the script tag's global as the build names it", () => {
    const name = /format: "umd", name: "(\w+)"/.exec(source("../rollup.config.mjs"))?.[1] ?? "";
    expect(name).toBe("TemporeumTimelineElement");
    expect(readme).toContain(`window.${name}`);
    expect(source("../../docs/site/pages/getting-started.md")).toContain(`window.${name}`);
  });

  it("states each peer range as the manifests do, and where the suites run", () => {
    expect(source("../../react/CHANGELOG.md")).not.toMatch(/18 and later/);
    expect(source("../../angular/CHANGELOG.md")).not.toMatch(/21 and later/);
    expect(source("../../docs/site/pages/stability.md")).not.toMatch(/runs on 19 only/);
  });

  it("counts the modules the benchmark measures as the script does", () => {
    const script = source("../../../scripts/sdk_bench_compare.mjs");
    const list = /temporeum: \[([^\]]*)\]/.exec(script)?.[1] ?? "";
    const count = [...list.matchAll(/"\/[^"]+"/g)].length;
    const words = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
    expect(source("../../docs/site/pages/benchmark.md")).toContain(`the ${words[count] ?? String(count)} ES modules of a plain timeline's page`);
  });
});

describe("the UMD file beside the Light claim (R58)", () => {
  it("is said to be nearly twice a plain timeline's page, and is", () => {
    const said = "nearly twice a plain timeline's page";
    // The repository's README, where it is the timeline's: the root README of another checkout is not.
    const readme = source("../../../README.md").includes("@temporeum/timeline") ? ["../../../README.md"] : [];
    for (const page of ["../../docs/site/pages/index.md", ...readme, "../../docs/site/pages/getting-started.md"]) {
      expect(source(page).replace(/\s+/g, " "), page).toContain(page.includes("getting-started") ? "nearly twice a plain timeline's page of modules" : said);
    }
    const umd = new URL("../dist/timeline-element.umd.js", import.meta.url);
    if (!existsSync(umd)) return;
    const field = JSON.parse(source("../../docs/site/benchmark/field/results.json")) as { results: { library: string; workload: string; metric: string; median: number }[] };
    const page = field.results.find((row) => row.library === "temporeum" && row.workload === "timeline" && row.metric === "js-min-gz")?.median ?? Number.NaN;
    const ratio = gzipSync(readFileSync(umd), { level: 9 }).length / 1000 / page;
    expect(ratio).toBeGreaterThan(1.6);
    expect(ratio).toBeLessThan(2);
  });
});

describe("what the docs say an export without its plugin does (X2, D22)", () => {
  // `exportPng`, `exportPdf` and `print` return a Promise and never throw
  // synchronously: a README that says they "throw" leads to a try/catch that
  // leaves the rejection unhandled.
  const pages = [
    "../README.md",
    "../../../README.md",
    "../../core/README.md",
    ...readdirSync(new URL("../../docs/site/pages/guides/", import.meta.url)).filter((name) => name.endsWith(".md")).map((name) => `../../docs/site/pages/guides/${name}`),
    "../../docs/site/pages/reference/api.md",
  ];
  it.each(pages)("%s never says the Promise exports throw", (page) => {
    const sentences = source(page).replace(/\s+/g, " ").split(/(?<=[.;:])\s/);
    const wrong = sentences.filter((sentence) => /`(?:exportPng|exportPdf|print)`/.test(sentence) && /\bthrows?\b/.test(sentence) && !/\breject/.test(sentence));
    expect(wrong).toEqual([]);
  });
});

describe("the conformance report judges the library, not the demo around it (X3)", () => {
  // The date prompt for `g` is the host's UI (the library only emits
  // `jumpRequest`); a row that credits the library with it describes the demo.
  const report = JSON.parse(source("../../docs/site/conformance/wcag22.json")) as { criteria: { id: string; status: string; remarks: string }[] };
  it("says the date prompt is the host's wherever a row names it", () => {
    const rows = report.criteria.filter((row) => /date prompt/i.test(row.remarks));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.filter((row) => !/the host's/.test(row.remarks)).map((row) => row.id)).toEqual([]);
  });
  it("rates the prompt's own label and error message not applicable", () => {
    const status = new Map(report.criteria.map((row) => [row.id, row.status]));
    expect([status.get("3.3.2"), status.get("3.3.3")]).toEqual(["not-applicable", "not-applicable"]);
  });
  it("counts in the accessibility guide as many 'Partially supports' rows as the report has", () => {
    const words = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight"];
    const partial = report.criteria.filter((row) => row.status === "partially-supports").length;
    const guide = source("../../docs/site/pages/guides/accessibility.md");
    const said = /The first (\w+) are the report's "Partially supports" rows/.exec(guide)?.[1];
    expect(said).toBe(words[partial]);
  });
});

describe("which attributes have a property as their pair (X10)", () => {
  // api.md said every attribute had one of the listed properties as its pair;
  // `aria-label`, `aria-labelledby` and `nonce` have none of them.
  it("pairs every observed attribute with a listed property, or names it as an exception", () => {
    const page = source("../../docs/site/pages/reference/api.md");
    const listed = new Set([...(/On the element, [^\n]*/.exec(page)?.[0] ?? "").matchAll(/`element\.(\w+)`|`(\w+)`/g)].map((m) => m[1] ?? m[2]));
    const sentence = /^[^\n]*attribute of the element[^\n]*/m.exec(page)?.[0] ?? "";
    expect(sentence).not.toBe("");
    const attributes = /OBSERVED_ATTRIBUTES = Object\.freeze\(\[([^\]]*)\]/.exec(source("../src/element.ts"))?.[1] ?? "";
    const names = [...attributes.matchAll(/"([\w-]+)"/g)].map((m) => m[1] ?? "");
    expect(names.length).toBeGreaterThan(10);
    const camel = (name: string): string => name.replace(/-(\w)/g, (_, c: string) => c.toUpperCase());
    const paired = (name: string): boolean => listed.has(camel(name)) || ((name === "start" || name === "end") && listed.has("domain"));
    const unpaired = names.filter((name) => !paired(name));
    expect(unpaired.filter((name) => !sentence.includes(`\`${name}\``))).toEqual([]);
    // The element reads `nonce` too, without observing it.
    expect(sentence).toMatch(/`nonce`/);
    expect(sentence).not.toMatch(/^Every attribute of the element has/);
  });
});
