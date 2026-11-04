import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { Item } from "@temporeum/timeline-core";

import "../src/define.js";
import { exportPlugin } from "../src/export.js";
import { groupsPlugin } from "../src/groups.js";
import { createTimeline, registerPlugin } from "../src/index.js";
import type { TemporeumTimelineElement, Timeline } from "../src/index.js";
import { mountStory, TRUSTED_TYPES_POLICY } from "../src/story.js";

/**
 * The timeline under a strict Content-Security-Policy and Trusted Types:
 * no `'unsafe-inline'` for styles, a `TrustedHTML` for every HTML
 * sink, and only the element's own policy allowed. A `<style>`'s text or a
 * written `style` attribute would be blocked, and say so with a
 * `securitypolicyviolation`; an `innerHTML` with a string would throw.
 *
 * The policy is set once, for this file's frame alone: a policy cannot be
 * taken back, and every test file has a frame of its own.
 */

const POLICY = [
  "style-src 'self'",
  "img-src 'self' blob:",
  "require-trusted-types-for 'script'",
  `trusted-types ${TRUSTED_TYPES_POLICY} host-policy`,
].join("; ");

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 5);
const domain: [number, number] = [T0, T0 + 10 * DAY];
const items: Item[] = [
  { id: "a", start: T0 + DAY, end: T0 + 3 * DAY, label: "Alpha", laneId: "one" },
  { id: "b", start: T0 + 4 * DAY, end: T0 + 6 * DAY, label: "Beta", laneId: "two" },
];
/** The light theme's item fill, `#dce9fd`: what the drawing shows only if its stylesheet applies. */
const ITEM_FILL = "rgb(220, 233, 253)";

const violations: string[] = [];

beforeAll(() => {
  registerPlugin(groupsPlugin);
  registerPlugin(exportPlugin);
  document.addEventListener("securitypolicyviolation", (event) => violations.push(`${event.violatedDirective}: ${event.sample || event.blockedURI}`));
  const meta = document.createElement("meta");
  meta.httpEquiv = "Content-Security-Policy";
  meta.content = POLICY;
  document.head.append(meta);
  // The policy is in force: a string in an HTML sink throws, a `<style>` is blocked.
  // (Chromium and WebKit name the type the sink wants; Firefox the mismatch.)
  expect(() => {
    document.createElement("div").innerHTML = "<b>x</b>";
  }).toThrow(/TrustedHTML|Sink type mismatch/);
});

afterEach(async () => {
  document.body.replaceChildren();
  // A violation is reported in a task of its own.
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(violations.filter((each) => !each.startsWith("require-trusted-types-for: Element innerHTML|<b>x</b>"))).toEqual([]);
});

function box(height = 240): HTMLDivElement {
  const element = document.createElement("div");
  element.style.width = "800px";
  element.style.height = `${String(height)}px`;
  element.style.position = "relative";
  document.body.append(element);
  return element;
}

async function drawn(timeline: Timeline): Promise<void> {
  await vi.waitFor(() => expect(timeline.result).toBeDefined());
}

describe("under style-src 'self' and Trusted Types", () => {
  it("the element takes its height and draws with its stylesheet", async () => {
    const element = document.createElement("temporeum-timeline") as TemporeumTimelineElement;
    element.style.width = "800px";
    element.height = 260;
    element.config = { items, domain };
    document.body.append(element);
    await vi.waitFor(() => expect(element.timeline?.result).toBeDefined());
    const root = element.shadowRoot as ShadowRoot;
    expect(element.getBoundingClientRect().height).toBe(260);
    expect(getComputedStyle(root.querySelector('[data-tl-id="a"]') as Element).fill).toBe(ITEM_FILL);
    // Nothing the browser reads as a stylesheet in the shadow root: the sheets are adopted.
    expect([...root.querySelectorAll<Element>("style")].filter((each) => each instanceof HTMLStyleElement || each instanceof SVGStyleElement)).toEqual([]);
  });

  it("createTimeline in the light DOM draws with its stylesheet, and takes it away on destroy", async () => {
    const timeline = createTimeline(box(), { items, domain });
    await drawn(timeline);
    expect(getComputedStyle(document.querySelector('[data-tl-id="a"]') as Element).fill).toBe(ITEM_FILL);
    const before = document.adoptedStyleSheets.length;
    timeline.destroy();
    expect(document.adoptedStyleSheets.length).toBeLessThan(before);
  });

  it("puts the group headers at their rows", async () => {
    const container = box();
    const timeline = createTimeline(container, {
      items,
      domain,
      groups: [
        { id: "one", label: "One" },
        { id: "two", label: "Two" },
      ],
    });
    await drawn(timeline);
    const header = (id: string): HTMLElement => container.querySelector(`[data-tl-group="${id}"]`) as HTMLElement;
    await vi.waitFor(() => expect(header("two")).not.toBeNull());
    expect(getComputedStyle(header("one")).position).toBe("absolute");
    // Where its inline style puts it — which applies only through the CSSOM.
    const tree = (container.querySelector(".tl-groups") as HTMLElement).getBoundingClientRect();
    for (const id of ["one", "two"]) {
      const top = Number.parseFloat(header(id).style.top);
      expect(header(id).getBoundingClientRect().top - tree.top).toBeCloseTo(top, 0);
    }
    expect(Number.parseFloat(header("two").style.top)).toBeGreaterThan(Number.parseFloat(header("one").style.top));
    timeline.destroy();
  });

  it("tells a story: its HTML through the element's own policy, its stylesheet adopted", async () => {
    const timeline = createTimeline(box(), { items, domain });
    await drawn(timeline);
    const panel = document.createElement("div");
    panel.style.height = "300px";
    document.body.append(panel);
    const story = mountStory(panel, timeline, {
      title: { headline: "The <b>big</b> day", text: "<p>It <em>began</em> here.</p><script>window.ran = true</script>" },
      slide: (item) => ({ headline: item.label ?? item.id, text: "<p>A slide</p>" }),
    });
    expect(panel.querySelector(".tl-story b")?.textContent).toBe("big");
    expect(panel.querySelector(".tl-story em")?.textContent).toBe("began");
    expect((window as { ran?: boolean }).ran).toBeUndefined();
    expect(getComputedStyle(panel.querySelector(".tl-story") as Element).display).toBe("flex");
    story.destroy();
    timeline.destroy();
  });

  it("prints: the view is built with the DOM, and its stylesheet applies", async () => {
    const timeline = createTimeline(box(), { items, domain });
    await drawn(timeline);
    const print = vi.spyOn(window, "print").mockImplementation(() => undefined);
    const done = timeline.print();
    const view = document.querySelector("body>[data-tl-print]") as HTMLElement;
    expect(view.querySelectorAll("section svg").length).toBeGreaterThan(0);
    // On screen the view is hidden — by the print stylesheet, which applied.
    expect(getComputedStyle(view).display).toBe("none");
    window.dispatchEvent(new Event("afterprint"));
    await done;
    expect(document.querySelector("body>[data-tl-print]")).toBeNull();
    expect(print).toHaveBeenCalledOnce();
    print.mockRestore();
    timeline.destroy();
  });

  it("exports a PNG, with img-src blob:", async () => {
    const timeline = createTimeline(box(), { items, domain });
    await drawn(timeline);
    const png = await timeline.exportPng({ scale: 1 });
    expect(png.type).toBe("image/png");
    expect(png.size).toBeGreaterThan(1000);
    timeline.destroy();
  });

  it("a host's own Trusted Types policy is used instead, when it gives one", async () => {
    const timeline = createTimeline(box(), { items, domain });
    await drawn(timeline);
    const given: string[] = [];
    const factory = (window as unknown as { trustedTypes: { createPolicy(name: string, rules: { createHTML(input: string): string }): { createHTML(input: string): unknown } } }).trustedTypes;
    const policy = factory.createPolicy("host-policy", {
      createHTML: (input) => {
        given.push(input);
        return input;
      },
    });
    const panel = document.createElement("div");
    document.body.append(panel);
    const story = mountStory(panel, timeline, { title: { headline: "Host", text: "<p>Through the <i>host</i></p>" }, slide: () => undefined, trustedTypesPolicy: policy });
    expect(panel.querySelector(".tl-story i")?.textContent).toBe("host");
    expect(given).toContain("<p>Through the <i>host</i></p>");
    story.destroy();
    timeline.destroy();
  });
});
