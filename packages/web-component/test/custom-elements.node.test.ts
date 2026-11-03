import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { eventNameOf, OBSERVED_ATTRIBUTES } from "../src/element.js";
import { TIMELINE_EVENTS } from "../src/timeline.js";

/**
 * The Custom Elements Manifest (W8 of the quality round): what an editor,
 * Storybook or a framework's tooling reads to know `<temporeum-timeline>`.
 * It is made from the source at build time; here it has to say everything
 * the element does — every attribute, every property, every event — each
 * with a description, and the built file has to be the one the source makes.
 */

interface Manifest {
  readonly schemaVersion: string;
  readonly modules: readonly {
    readonly path: string;
    readonly declarations: readonly {
      readonly tagName?: string;
      readonly customElement?: boolean;
      readonly attributes?: readonly { readonly name: string; readonly description: string; readonly fieldName?: string }[];
      readonly members?: readonly { readonly name: string; readonly description: string }[];
      readonly events?: readonly { readonly name: string; readonly description: string; readonly type: { readonly text: string } }[];
    }[];
    readonly exports: readonly { readonly kind: string; readonly name: string }[];
  }[];
}

const script = new URL("../../../scripts/sdk_custom_elements.mjs", import.meta.url).href;
const load = async (): Promise<Manifest> => ((await import(/* @vite-ignore */ script)) as { manifest: () => Manifest }).manifest();

describe("custom-elements.json", () => {
  it("lists every attribute, property and event of the element, each described", async () => {
    const manifest = await load();
    expect(manifest.schemaVersion).toBe("2.1.0");
    const element = manifest.modules[0]?.declarations[0];
    expect(element?.tagName).toBe("temporeum-timeline");
    expect(element?.customElement).toBe(true);
    expect(element?.attributes?.map((each) => each.name)).toEqual([...OBSERVED_ATTRIBUTES]);
    expect(element?.events?.map((each) => each.name).sort()).toEqual(TIMELINE_EVENTS.map(eventNameOf).sort());
    expect(element?.events?.find((each) => each.name === "item-moved")?.type.text).toBe("CustomEvent<ItemMovedPayload<T>>");
    const members = element?.members?.map((each) => each.name) ?? [];
    for (const name of ["timeline", "items", "lanes", "groups", "selectedIds", "config", "orientation", "density", "theme", "height", "editable", "zoomTo"]) expect(members).toContain(name);
    const undescribed = [...(element?.attributes ?? []), ...(element?.members ?? []), ...(element?.events ?? [])].filter((each) => each.description.trim() === "").map((each) => each.name);
    expect(undescribed).toEqual([]);
    expect(element?.attributes?.find((each) => each.name === "theme")?.fieldName).toBe("theme");
    expect(manifest.modules.flatMap((module) => module.exports).find((each) => each.kind === "custom-element-definition")?.name).toBe("temporeum-timeline");
  });

  it("the built file is the one the source makes, and the package points to it", async () => {
    const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { customElements?: string };
    expect(manifest.customElements).toBe("dist/custom-elements.json");
    const built = new URL("../dist/custom-elements.json", import.meta.url);
    if (!existsSync(built)) return;
    expect(JSON.parse(readFileSync(built, "utf8"))).toEqual(await load());
  });
});
