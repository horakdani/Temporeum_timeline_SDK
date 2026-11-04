import { describe, expect, it } from "vitest";

import { ganttPlugin } from "../src/gantt.js";
import type * as Plugins from "../src/plugins.js";

/**
 * One plugin registry for the page. A page can
 * hold two copies of the element's module — the ESM and the CJS build of one
 * version, or two bundles that did not dedupe it — and a plugin registered
 * through one copy has to be there for a timeline the other makes.
 */
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
    const key = Symbol.for("@temporeum/timeline/plugins");
    const global = globalThis as Record<symbol, unknown>;
    delete global[key];
    await copy("three");
    expect(key in global).toBe(false);
  });
});
