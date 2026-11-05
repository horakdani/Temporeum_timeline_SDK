import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";

import { createCommand } from "@temporeum/timeline-core";

import { createTimeline, defineTimelineElement, TIMELINE_EVENTS } from "../src/index.js";
import type { TemporeumTimelineElement, Timeline } from "../src/index.js";
import type { CalendarView, CalendarViewEventMap, CalendarViewOptions } from "../src/calendar.js";
import type { TaskGrid, TaskGridOptions } from "../src/gantt.js";
import type { Backlog, BacklogOptions } from "../src/resources.js";
import { mountStory } from "../src/story.js";
import type { Story, StoryChange, StoryEventMap, StoryOptions } from "../src/story.js";

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

describe("the handles' verbs (R22)", () => {
  it("update takes options, next and previous say whether they moved, and events come through on", () => {
    expectTypeOf<Parameters<CalendarView["update"]>[0]>().toEqualTypeOf<Partial<CalendarViewOptions>>();
    expectTypeOf<Parameters<TaskGrid["update"]>[0]>().toEqualTypeOf<Partial<TaskGridOptions> | undefined>();
    expectTypeOf<Parameters<Backlog["update"]>[0]>().toEqualTypeOf<Partial<BacklogOptions>>();
    expectTypeOf<CalendarView["next"]>().toEqualTypeOf<Story["next"]>();
    expectTypeOf<CalendarView["previous"]>().toEqualTypeOf<Story["previous"]>();
    // A change in the past tense, a signal in the present — as on the instance.
    expectTypeOf<keyof CalendarViewEventMap>().toEqualTypeOf<"itemSelect" | "rangeChanged">();
    expectTypeOf<keyof StoryEventMap>().toEqualTypeOf<"slideChanged">();
    expectTypeOf<StoryOptions>().not.toHaveProperty("onChange");
  });

  it("a story mounted on a drawn timeline still tells its first listener the opening slide", async () => {
    const { element, timeline } = mount();
    await vi.waitFor(() => expect(timeline.getSnapshot().viewport).toBeDefined());
    const panel = document.createElement("div");
    element.after(panel);
    const story = mountStory(panel, timeline, { slide: (item) => ({ headline: item.label ?? item.id }), start: "b" });
    const heard: StoryChange[] = [];
    story.on("slideChanged", (change) => heard.push(change));
    await vi.waitFor(() => expect(heard.map(({ id, source }) => `${String(id)}:${source}`)).toEqual(["b:panel"]));
    const stop = story.on("slideChanged", () => {
      throw new Error("stopped listening");
    });
    stop();
    expect(story.previous()).toBe(true);
    expect(story.previous()).toBe(false);
    expect(heard.map(({ id }) => id)).toEqual(["b", "a"]);
    story.destroy();
    timeline.destroy();
  });
});

describe("a destroyed instance (R53) and a flag that says what it means (R44)", () => {
  it("does nothing and says nothing after destroy, and its getters read the last frame", async () => {
    const { timeline } = mount();
    await vi.waitFor(() => expect(timeline.layout).toBeDefined());
    const heard: string[] = [];
    for (const name of TIMELINE_EVENTS) timeline.on(name, () => heard.push(name));
    const before = timeline.getSnapshot();
    const items = timeline.items;
    timeline.destroy();
    timeline.select(["a"]);
    timeline.zoomTo([T0, T0 + DAY]);
    timeline.zoomBy(2);
    timeline.scrollTo(T0 + 3 * DAY);
    timeline.scrollLanes(40);
    timeline.revealLane("x");
    timeline.follow();
    timeline.addItems([{ id: "c", start: T0 }]);
    timeline.updateItems([{ id: "a", label: "Renamed" }]);
    timeline.removeItems(["b"]);
    timeline.changeItems({ add: [{ id: "d", start: T0 }] });
    timeline.applyCommand(createCommand("move", [{ id: "a", start: T0 }], [{ id: "a", start: T0 + DAY }]));
    timeline.toggleGroup("a", { collapsed: true });
    timeline.update({ items: [] });
    timeline.setItems([]);
    timeline.flush();
    expect(timeline.focusItem("a")).toBe(false);
    expect(timeline.dropItem({ label: "New", start: T0, durationMs: DAY })).toBe(false);
    expect(timeline.dropItemAt({ label: "New", durationMs: DAY }, { clientX: 10, clientY: 10 })).toBe(false);
    expect(timeline.zoomToPreset("day")).toBe(false);
    await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
    expect(heard).toEqual([]);
    expect(timeline.getSnapshot()).toBe(before);
    expect(timeline.items).toBe(items);
    expect(timeline.exportSvg()).toContain("<svg");
  });
});
