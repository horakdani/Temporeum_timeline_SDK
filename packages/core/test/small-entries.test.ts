/**
 * The two small entry points the element's base loads instead of
 * `/tools` and `/intl` — `/live` and `/words`.
 *
 * Each is the same code as before, not a copy: `/tools` still exports live
 * data and `/intl` the English words, and both hand out the very functions
 * the new entry points do, so a host that imported them from the old place
 * gets the same behaviour, and a page that loads both pays for them once.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import * as intl from "../src/intl/index.js";
import * as live from "../src/live/index.js";
import * as tools from "../src/tools/index.js";
import * as words from "../src/words/index.js";
import { CALENDAR_STRINGS, GANTT_STRINGS, RESOURCE_STRINGS } from "../src/strings.js";
import type { Item } from "../src/types.js";

const src = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
const DAY = 86_400_000;

describe("/live", () => {
  it("exports the live-data functions /tools exports — the same functions", () => {
    expect(Object.keys(live).sort()).toEqual(["applyItemChanges", "relayout"]);
    expect(live.applyItemChanges).toBe(tools.applyItemChanges);
    expect(live.relayout).toBe(tools.relayout);
  });

  it("applies a change on its own", () => {
    const items: Item[] = [{ id: "a", start: 0, end: DAY, laneId: "x" }];
    const applied = live.applyItemChanges(items, { add: [{ id: "b", start: DAY, end: 2 * DAY, laneId: "y" }], remove: ["a"] });
    expect(applied.items.map((item) => item.id)).toEqual(["b"]);
    expect([...applied.lanes].sort()).toEqual(["x", "y"]);
  });

  it("imports nothing of another entry point's own code", () => {
    const source = readFileSync(join(src, "live", "index.ts"), "utf8");
    const specifiers = [...source.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]);
    // Only the live module, which itself imports only the base.
    expect(specifiers.every((spec) => spec === "../shared/live-data.js")).toBe(true);
    const module = readFileSync(join(src, "shared", "live-data.ts"), "utf8");
    for (const match of module.matchAll(/from\s+"([^"]+)"/g)) expect(match[1]).toMatch(/^\.\.\/[a-z-]+\.js$/);
  });
});

describe("/words", () => {
  it("exports the dictionary /intl exports — the same objects and functions", () => {
    expect(Object.keys(words).sort()).toEqual(["DEFAULT_STRINGS", "fill", "formatAmount", "resolveStrings", "sayIn"]);
    expect(words.DEFAULT_STRINGS).toBe(intl.DEFAULT_STRINGS);
    expect(words.resolveStrings).toBe(intl.resolveStrings);
    expect(words.sayIn).toBe(intl.sayIn);
    expect(words.fill).toBe(intl.fill);
    expect(words.formatAmount).toBe(intl.formatAmount);
  });

  it("holds every word the library says, frozen, in English", () => {
    expect(Object.isFrozen(words.DEFAULT_STRINGS)).toBe(true);
    for (const record of [GANTT_STRINGS, RESOURCE_STRINGS, CALENDAR_STRINGS]) {
      for (const [key, phrase] of Object.entries(record)) expect(words.DEFAULT_STRINGS[key as keyof typeof words.DEFAULT_STRINGS]).toEqual(phrase);
    }
    expect(words.DEFAULT_STRINGS.timeline).toBe("Timeline");
    expect(words.DEFAULT_STRINGS.newItem).toBe("New item");
  });

  it("resolves a host's words over the defaults and says them in a locale", () => {
    const strings = words.resolveStrings({ newItem: "Neues Element", cluster: { one: "{count} Element", other: "{count} Elemente" } });
    expect(strings.timeline).toBe("Timeline");
    const say = words.sayIn(strings, "de");
    expect(say("newItem")).toBe("Neues Element");
    expect(say("cluster", { count: 1 })).toBe("1 Element");
    expect(say("cluster", { count: 1200 })).toBe("1.200 Elemente");
    expect(words.sayIn(words.resolveStrings())("cluster", { count: 3 })).toBe("3 items");
  });

  it("imports nothing of /intl: the translation tools stay there", () => {
    const source = readFileSync(join(src, "words", "index.ts"), "utf8");
    const specifiers = [...source.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]);
    expect(specifiers.length).toBeGreaterThan(0);
    // The base, or the shared dictionary module — which itself imports only the base.
    for (const spec of specifiers) expect(spec).toMatch(/^\.\.\/(shared\/)?[a-z-]+\.js$/);
    const module = readFileSync(join(src, "shared", "dictionary.ts"), "utf8");
    for (const match of module.matchAll(/from\s+"([^"]+)"/g)) expect(match[1]).toMatch(/^\.\.\/[a-z-]+\.js$/);
    // The control: /intl does import /words — the scan sees an import.
    const intlStrings = readFileSync(join(src, "intl", "strings.ts"), "utf8");
    expect([...intlStrings.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1])).toContain("../shared/dictionary.js");
  });
});
