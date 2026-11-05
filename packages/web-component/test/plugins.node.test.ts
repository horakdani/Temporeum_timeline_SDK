import { describe, expect, it } from "vitest";

import { readFileSync } from "node:fs";

import { ganttPlugin } from "../src/gantt.js";
import type * as Plugins from "../src/plugins.js";

/**
 * One plugin registry for the page. A page can
 * hold two copies of the element's module — the ESM and the CJS build of one
 * version, or two bundles that did not dedupe it — and a plugin registered
 * through one copy has to be there for a timeline the other makes.
 */
const RELEASE = (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string }).version;

/** The module once more: a query makes Vite load it as a copy of its own. */
const copy = (name: string): Promise<typeof Plugins> => import(/* @vite-ignore */ `../src/plugins.js?copy=${name}`) as Promise<typeof Plugins>;

describe("the plugin registry", () => {
  it("is one for two copies of the module", async () => {
    const one = await copy("one");
    const two = await copy("two");
    expect(one.registerPlugin).not.toBe(two.registerPlugin);
    expect(two.hasPlugin("gantt")).toBe(false);
    one.registerPlugin(ganttPlugin);
    expect(two.hasPlugin("gantt")).toBe(true);
    expect(two.pluginIf("gantt")).toBe(ganttPlugin.feature);
  });

  it("is under a registered symbol, and importing the module writes nothing", async () => {
    const key = Symbol.for(`@temporeum/timeline/plugins@${RELEASE}`);
    const global = globalThis as Record<symbol, unknown>;
    delete global[key];
    await copy("three");
    expect(key in global).toBe(false);
  });

  it("is one per release: a copy of another release's plugins are not drawn with (R45)", async () => {
    // What a plugin hands the element is internal and changes between
    // releases; a CDN build of one release beside a bundle of another mixed
    // them through one registry, by name, with no check.
    const global = globalThis as Record<symbol, unknown>;
    const other = Symbol.for("@temporeum/timeline/plugins@0.9.0");
    const unversioned = Symbol.for("@temporeum/timeline/plugins");
    global[other] = { groups: { stale: true } };
    global[unversioned] = { groups: { stale: true } };
    try {
      const mine = await copy("four");
      expect(mine.hasPlugin("groups")).toBe(false);
      expect(() => mine.plugin("groups", "groups")).toThrow('import { groupsPlugin } from "@temporeum/timeline-element/groups"');
    } finally {
      delete global[other];
      delete global[unversioned];
    }
  });
});

