import { afterEach, describe, expect, it, vi } from "vitest";

import type { Item } from "@temporeum/timeline-core";

import "../src/define.js";
import { groupsPlugin } from "../src/groups.js";
import { createTimeline, registerPlugin } from "../src/index.js";
import type { TemporeumTimelineElement } from "../src/index.js";
import { mountStory } from "../src/story.js";

/**
 * The nonce (C2): where a stylesheet cannot be adopted — a browser without
 * constructable stylesheets — each `<style>` the timeline writes carries
 * the host's nonce, which a policy without `'unsafe-inline'` lets apply.
 */

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 5);
const domain: [number, number] = [T0, T0 + 10 * DAY];
const items: Item[] = [{ id: "a", start: T0 + DAY, end: T0 + 3 * DAY, label: "Alpha", laneId: "one" }];
const groups = [{ id: "one", label: "One" }];

registerPlugin(groupsPlugin);

const restores: (() => void)[] = [];
afterEach(() => {
  document.body.replaceChildren();
  for (const restore of restores.splice(0)) restore();
});

/** A browser that cannot adopt a sheet, for the rest of the test. */
function withoutAdoptedSheets(): void {
  for (const target of [Document.prototype, ShadowRoot.prototype]) {
    const own = Object.getOwnPropertyDescriptor(target, "adoptedStyleSheets") as PropertyDescriptor;
    Object.defineProperty(target, "adoptedStyleSheets", { configurable: true, get: () => undefined, set: () => undefined });
    restores.push(() => Object.defineProperty(target, "adoptedStyleSheets", own));
  }
}

const nonces = (root: ParentNode): string[] => [...root.querySelectorAll("style")].map((style) => (style as HTMLStyleElement).nonce ?? "");

describe("the nonce (C2)", () => {
  it("the element reads its nonce attribute, and the companions take it from the instance", async () => {
    const element = document.createElement("temporeum-timeline") as TemporeumTimelineElement;
    element.setAttribute("nonce", "n0");
    element.config = { items, domain };
    document.body.append(element);
    await vi.waitFor(() => expect(element.timeline?.result).toBeDefined());
    expect(element.timeline?.nonce).toBe("n0");
    expect(createTimeline(document.body.appendChild(document.createElement("div")), { items, domain }).nonce).toBeUndefined();
  });

  it("without constructable stylesheets, every <style> of the element carries it", async () => {
    withoutAdoptedSheets();
    const element = document.createElement("temporeum-timeline") as TemporeumTimelineElement;
    element.setAttribute("nonce", "n0");
    element.config = { items, domain, groups };
    document.body.append(element);
    await vi.waitFor(() => expect(element.shadowRoot?.querySelector("[data-tl-group]")).not.toBeNull());
    const root = element.shadowRoot as ShadowRoot;
    // The host's, the drawing's, the group tree's.
    expect(nonces(root).length).toBeGreaterThanOrEqual(3);
    expect(new Set(nonces(root))).toEqual(new Set(["n0"]));
    expect(root.querySelector("style")?.textContent).toContain(":host{display:block");
  });

  it("without constructable stylesheets, createTimeline and a story write theirs with config.nonce", async () => {
    withoutAdoptedSheets();
    const container = document.body.appendChild(document.createElement("div"));
    container.style.width = "800px";
    const timeline = createTimeline(container, { items, domain, nonce: "n1" });
    await vi.waitFor(() => expect(timeline.result).toBeDefined());
    const panel = document.body.appendChild(document.createElement("div"));
    mountStory(panel, timeline, { title: { headline: "Title" } });
    expect(nonces(container)).toEqual(["n1"]);
    expect(nonces(panel)).toEqual(["n1"]);
    expect(container.querySelector("style")?.textContent).toContain(".tl-item{");
    timeline.destroy();
  });
});
