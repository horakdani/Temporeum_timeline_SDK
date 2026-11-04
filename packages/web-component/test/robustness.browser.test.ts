import { afterEach, describe, expect, it, vi } from "vitest";

import type { Item } from "@temporeum/timeline-core";

import { createTimeline, defineTimelineElement } from "../src/index.js";
import type { InputSkippedPayload, TemporeumTimelineElement } from "../src/index.js";

/**
 * One bad item or option does not take the whole frame (S9). An item from
 * an attribute, a JSON script, a fetched window or a host's typo — a start
 * in words, NaN, ±1e20, a fractional `sublaneSpan`, no id — is left out; a
 * `locale` or `timeZone` the platform cannot read falls back to the
 * default. Each is said once, with `inputSkipped`.
 */

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 5);
const good: Item = { id: "ok", start: T0 + DAY, end: T0 + 3 * DAY, label: "Fine" };
const bad: unknown[] = [
  { id: "text", start: "text" },
  { id: "nan", start: Number.NaN },
  { id: "huge", start: 1e20 },
  { id: "end", start: T0, end: -1e20 },
  { id: "span", start: T0, end: T0 + DAY, sublaneSpan: 1.5 },
  { start: T0 },
  null,
];
const domain: [number, number] = [T0, T0 + 10 * DAY];

afterEach(() => {
  document.body.replaceChildren();
});

function host(): HTMLDivElement {
  const element = document.createElement("div");
  element.style.width = "800px";
  element.style.height = "200px";
  document.body.append(element);
  return element;
}

describe("a bad item or option is left out, and said (S9)", () => {
  it("at creation: the good item is drawn, each bad one is reported once, after the host can listen", async () => {
    const skipped: InputSkippedPayload[] = [];
    const timeline = createTimeline(host(), { items: [good, ...bad] as Item[], domain, locale: "not a locale!!", timeZone: "Mars/Olympus" });
    timeline.on("inputSkipped", (payload) => skipped.push(payload));
    await vi.waitFor(() => expect(timeline.result).toBeDefined());
    expect(timeline.items.map((item) => item.id)).toEqual(["ok"]);
    expect(document.querySelector('[data-tl-id="ok"]')).not.toBeNull();
    expect(skipped.filter((each) => each.item !== undefined).map((each) => each.item)).toEqual(bad);
    expect(skipped.filter((each) => each.option !== undefined).map((each) => each.option).sort()).toEqual(["locale", "timeZone"]);
    for (const each of skipped) expect(each.message).toMatch(/\w/);
  });

  it("through update and setItems, and a bad timeZone or locale later does not throw in a frame", async () => {
    const timeline = createTimeline(host(), { items: [good], domain });
    await vi.waitFor(() => expect(timeline.result).toBeDefined());
    const skipped: InputSkippedPayload[] = [];
    timeline.on("inputSkipped", (payload) => skipped.push(payload));
    timeline.update({ items: [good, { id: "nan", start: Number.NaN }] });
    expect(timeline.items.map((item) => item.id)).toEqual(["ok"]);
    timeline.setItems([good, { id: "words", start: "soon" } as unknown as Item]);
    expect(timeline.items.map((item) => item.id)).toEqual(["ok"]);
    const errors: unknown[] = [];
    const onError = (event: ErrorEvent) => errors.push(event.error);
    window.addEventListener("error", onError);
    timeline.update({ timeZone: "Mars/Olympus", locale: "??" });
    const before = timeline.result;
    await vi.waitFor(() => expect(timeline.result).not.toBe(before));
    window.removeEventListener("error", onError);
    expect(errors).toEqual([]);
    expect(skipped.map((each) => each.item ?? each.option)).toEqual([{ id: "nan", start: Number.NaN }, { id: "words", start: "soon" }, "locale", "timeZone"]);
  });

  it("through live changes: a bad added item is left out", async () => {
    const timeline = createTimeline(host(), { items: [good], domain });
    await vi.waitFor(() => expect(timeline.result).toBeDefined());
    const skipped: InputSkippedPayload[] = [];
    timeline.on("inputSkipped", (payload) => skipped.push(payload));
    timeline.addItems([{ id: "late", start: Number.NaN } as Item, { id: "fine2", start: T0 + 5 * DAY }]);
    expect(timeline.items.map((item) => item.id)).toEqual(["ok", "fine2"]);
    expect(skipped.map((each) => (each.item as Item).id)).toEqual(["late"]);
  });

  it("on the element: a JSON script with a start in words still draws the rest, and says input-skipped", async () => {
    defineTimelineElement();
    const element = document.createElement("temporeum-timeline") as TemporeumTimelineElement;
    element.style.width = "800px";
    const script = document.createElement("script");
    script.type = "application/json";
    script.textContent = JSON.stringify({ items: [{ id: "ok", start: "2026-01-06", end: "2026-01-08", label: "Fine" }, { id: "bad", start: "next tuesday" }], domain: ["2026-01-05", "2026-01-15"] });
    element.append(script);
    const said: string[] = [];
    element.addEventListener("input-skipped", (event) => said.push(((event as CustomEvent<InputSkippedPayload>).detail.item as Item).id));
    document.body.append(element);
    await vi.waitFor(() => expect(element.shadowRoot?.querySelector('[data-tl-id="ok"]')).not.toBeNull());
    expect(said).toEqual(["bad"]);
  });
});

describe("two timelines in the light DOM (S12)", () => {
  it("each gets a stylesheet scope of its own, and a server drawing taken over keeps the server's", async () => {
    const { renderTimelineSvg } = await import("../src/index.js");
    const first = createTimeline(host(), { items: [good], domain });
    const second = createTimeline(host(), { items: [good], domain });
    await vi.waitFor(() => expect(first.result && second.result).toBeDefined());
    const svgs = [...document.querySelectorAll("svg[data-tl-instance]")];
    const scopes = svgs.map((svg) => svg.getAttribute("data-tl-instance"));
    expect(scopes).toHaveLength(2);
    expect(new Set(scopes).size).toBe(2);
    svgs.forEach((svg, index) => expect(svg.querySelector("style")?.textContent).toContain(`[data-tl-instance="${String(scopes[index])}"]`));
    // Unscoped on the server, unscoped once taken over: the markup stays the server's.
    const element = host();
    element.innerHTML = renderTimelineSvg({ items: [good], domain }, { width: 800 }).svg;
    expect(element.querySelector("svg")?.hasAttribute("data-tl-instance")).toBe(false);
    const hydrated = createTimeline(element, { items: [good], domain }, { hydrate: true, measureText: false });
    await vi.waitFor(() => expect(hydrated.result).toBeDefined());
    expect(element.querySelector("svg")?.hasAttribute("data-tl-instance")).toBe(false);
  });
});

describe("a story destroyed before the timeline's first frame (S12)", () => {
  it("lets go of its wait for that frame", async () => {
    const { mountStory } = await import("../src/story.js");
    const element = document.createElement("div");
    element.style.cssText = "width:0;height:200px";
    document.body.append(element);
    const timeline = createTimeline(element, { items: [good], domain });
    const stops: ReturnType<typeof vi.fn>[] = [];
    const watched = new Proxy(timeline, {
      get(target, key) {
        if (key !== "on") return Reflect.get(target, key) as unknown;
        return (type: string, listener: () => void) => {
          const stop = vi.fn(target.on(type as "layoutChanged", listener));
          if (type === "layoutChanged") stops.push(stop);
          return stop;
        };
      },
    });
    const panel = document.body.appendChild(document.createElement("div"));
    const { fromTimelineJS } = await import("@temporeum/timeline-core/story");
    const title = fromTimelineJS({ title: { text: { headline: "A story" } }, events: [] }).title;
    const story = mountStory(panel, watched, { reveal: false, ...(title === undefined ? {} : { title }) });
    expect(timeline.getSnapshot().viewport).toBeUndefined();
    expect(stops).toHaveLength(1);
    story.destroy();
    expect(stops[0]).toHaveBeenCalled();
  });
});
