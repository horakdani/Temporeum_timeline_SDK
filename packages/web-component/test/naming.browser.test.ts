import { afterEach, describe, expect, it, vi } from "vitest";

import { createCommand } from "@temporeum/timeline-core";

import { createTimeline, defineTimelineElement, TIMELINE_EVENTS } from "../src/index.js";
import type { TemporeumTimelineElement, Timeline } from "../src/index.js";

/**
 * The naming rule of the 1.0 API, as the code has
 * it: an event that reports a change that happened is in the past tense, an
 * event that reports what the reader asked for is in the present; the same
 * name has the same signature on the element and the instance; a query that
 * costs nothing is a getter; acronyms are written as words (`exportSvg`).
 */

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 5);
const items = [
  { id: "a", start: T0, end: T0 + 2 * DAY, label: "Spec" },
  { id: "b", start: T0 + 3 * DAY, end: T0 + 5 * DAY, label: "Build" },
];

/** What the reader asked for — the present tense. `command` is the edit itself, handed to the host to keep. */
const SIGNALS = ["itemClick", "itemDblClick", "itemHover", "jumpRequest", "command"];

afterEach(() => {
  document.body.replaceChildren();
});

function mount(): { element: HTMLDivElement; timeline: Timeline } {
  const element = document.createElement("div");
  element.style.width = "800px";
  element.style.height = "200px";
  document.body.append(element);
  return { element, timeline: createTimeline(element, { items, domain: [T0 - DAY, T0 + 7 * DAY] }) };
}

describe("the names of the 1.0 API", () => {
  it("every event is a change in the past tense or a signal in the present, and the plurals agree", () => {
    expect([...TIMELINE_EVENTS].sort()).toEqual(
      [
        "itemClick",
        "itemDblClick",
        "itemHover",
        "selectionChanged",
        "viewportChanged",
        "layoutChanged",
        "itemMoved",
        "itemResized",
        "command",
        "densityChanged",
        "orientationChanged",
        "clusterOpened",
        "jumpRequest",
        "itemsAdded",
        "itemsRemoved",
        "itemsChanged",
        "groupToggled",
        "groupMoved",
        "timeBarMoved",
        "rangeSelected",
        "slotsChanged",
        "inputSkipped",
      ].sort(),
    );
    for (const name of TIMELINE_EVENTS) {
      if (SIGNALS.includes(name)) continue;
      expect(name, `${name} is a change, so it is in the past tense`).toMatch(/(ed|Changed)$/);
    }
  });

  it("the queries that cost nothing are getters, the exports are spelled as words", () => {
    const { timeline } = mount();
    for (const name of ["items", "layout", "slots", "metrics", "result", "timeBars", "destroyed"]) {
      expect(Object.getOwnPropertyDescriptor(timeline, name)?.get, `${name} is a getter`).toBeTypeOf("function");
    }
    for (const name of ["exportSvg", "exportPng", "exportPdf", "print", "getSnapshot"]) expect(timeline[name as keyof Timeline]).toBeTypeOf("function");
    for (const gone of ["getLayout", "exportSVG", "exportPNG", "exportPDF"]) expect(timeline).not.toHaveProperty(gone);
    expect(timeline.slots).toBeInstanceOf(Map);
    timeline.destroy();
  });

  it("the element's zoomTo takes what the instance's takes", async () => {
    defineTimelineElement();
    const element = document.createElement("temporeum-timeline") as TemporeumTimelineElement;
    element.style.width = "800px";
    element.items = items;
    document.body.append(element);
    await vi.waitFor(() => expect(element.timeline?.getSnapshot().domain).toBeDefined());
    element.zoomTo([new Date(T0), T0 + 4 * DAY]);
    // The snapshot is the drawn frame's: the next one.
    await vi.waitFor(() => expect(element.timeline?.getSnapshot().domain).toEqual([T0, T0 + 4 * DAY]));
  });
});

describe("update({ items }) and setItems: one meaning each", () => {
  it("the same array through update is no change; through setItems it replaces the edits", async () => {
    const { timeline } = mount();
    await vi.waitFor(() => expect(timeline.layout).toBeDefined());
    const moved = createCommand("move", [{ id: "a", start: T0 }], [{ id: "a", start: T0 + DAY }]);
    timeline.applyCommand(moved);
    expect(timeline.items.find((item) => item.id === "a")?.start).toBe(T0 + DAY);
    timeline.update({ items });
    expect(timeline.items.find((item) => item.id === "a")?.start, "update with the same array keeps the edit").toBe(T0 + DAY);
    timeline.setItems(items);
    expect(timeline.items.find((item) => item.id === "a")?.start, "setItems with the same array replaces it").toBe(T0);
    timeline.destroy();
  });
});
