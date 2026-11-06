import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { userEvent } from "vitest/browser";

import { parseICal, weekStartOf } from "@temporeum/timeline-core/calendar";
import type { CalendarEvent } from "@temporeum/timeline-core/calendar";
import { DEFAULT_STRINGS, PSEUDO_OPEN, pseudoStrings } from "@temporeum/timeline-core/intl";

import { mountCalendarView } from "../src/calendar.js";
import type { CalendarSelectPayload, CalendarView } from "../src/calendar.js";

/**
 * The week view through the element, in a real Chromium: the week view draws the
 * events of a calendar file, a click and `Enter` choose the same event with
 * the same `select`, the arrows walk the events, the period keys and the
 * buttons page the same way, right to left mirrors the days, and every word
 * comes from the dictionary.
 */

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const MONDAY = Date.UTC(2026, 10, 2);
const ZONE = "UTC";
const ICS = [
  "BEGIN:VCALENDAR",
  "BEGIN:VEVENT",
  "UID:standup",
  "DTSTART:20261102T090000Z",
  "DTEND:20261102T093000Z",
  "RRULE:FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR",
  "SUMMARY:Standup",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:review",
  "DTSTART:20261104T090000Z",
  "DTEND:20261104T110000Z",
  "SUMMARY:Review",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:trip",
  "DTSTART;VALUE=DATE:20261105",
  "DTEND;VALUE=DATE:20261107",
  "SUMMARY:Trip",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");
const events: readonly CalendarEvent[] = parseICal(ICS).events;

afterEach(() => {
  document.body.replaceChildren();
});

function mount(options: Parameters<typeof mountCalendarView>[1] = {}): { element: HTMLDivElement; view: CalendarView; svg: SVGSVGElement } {
  const element = document.createElement("div");
  element.style.cssText = "width:980px";
  document.body.append(element);
  const view = mountCalendarView(element, { events, date: MONDAY + 2 * DAY, timeZone: ZONE, now: false, height: 640, ...options });
  const svg = element.querySelector("svg");
  if (svg === null) throw new Error("not drawn");
  return { element, view, svg };
}

const centre = (node: Element): { readonly x: number; readonly y: number } => {
  const box = node.getBoundingClientRect();
  return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
};

describe("the week view", () => {
  it("draws the file's events in the week, with the recurring ones expanded and the all-day one in the band", () => {
    const { view, svg } = mount();
    expect(view.range).toEqual([MONDAY, MONDAY + 7 * DAY]);
    const ids = [...svg.querySelectorAll("[role=option]")].map((node) => node.getAttribute("data-item-id"));
    expect(ids).toEqual(["standup@20261102T090000Z", "standup@20261103T090000Z", "review", "standup@20261104T090000Z", "trip", "standup@20261105T090000Z", "standup@20261106T090000Z"]);
    expect(svg.getAttribute("role")).toBe("listbox");
    expect(svg.getAttribute("aria-label")).toBe("Week of Nov 2, 2026");
  });

  it("a click and Enter choose the same event, with the same select", async () => {
    const chosen: CalendarSelectPayload[] = [];
    const first = mount();
    first.view.on("itemSelect", (payload) => chosen.push(payload));
    const review = first.svg.querySelector('[data-item-id="review"]');
    expect(review).not.toBeNull();
    if (review === null) return;
    await userEvent.click(review);
    expect(first.svg.getAttribute("aria-activedescendant")).toBe(review.id);
    expect(review.getAttribute("aria-selected")).toBe("true");
    first.view.destroy();
    // From the keyboard: the first event, a day right twice — on Wednesday the
    // nearest at nine is the longer Review, in the first column — then Enter.
    const second = mount();
    second.view.on("itemSelect", (payload) => chosen.push(payload));
    second.svg.focus();
    await userEvent.keyboard("{ArrowDown}");
    expect(second.view.focusedKey).toBe("standup@20261102T090000Z");
    await userEvent.keyboard("{ArrowRight}{ArrowRight}");
    expect(second.view.focusedKey).toBe("review");
    await userEvent.keyboard("{Enter}");
    expect(chosen.map((each) => [each.item.id, each.key, each.via])).toEqual([
      ["review", "review", "pointer"],
      ["review", "review", "keyboard"],
    ]);
  });

  it("the period keys and the buttons page the same way, and say so", async () => {
    const { element, view, svg } = mount();
    const ranges: number[] = [];
    view.on("rangeChanged", (payload) => ranges.push(payload.start));
    svg.focus();
    await userEvent.keyboard("{PageDown}");
    expect(view.range[0]).toBe(MONDAY + 7 * DAY);
    const previous = [...element.querySelectorAll("button")].find((button) => button.textContent === "Previous");
    expect(previous).toBeDefined();
    previous?.click();
    expect(view.range[0]).toBe(MONDAY);
    (element.querySelector("svg") as SVGSVGElement | null)?.focus();
    await userEvent.keyboard("{PageUp}");
    expect(view.range[0]).toBe(MONDAY - 7 * DAY);
    expect(ranges).toEqual([MONDAY + 7 * DAY, MONDAY, MONDAY - 7 * DAY]);
    expect(element.querySelector(".tl-cal-range")?.getAttribute("aria-live")).toBe("polite");
    view.update({ view: "day" });
    expect(view.range[1] - view.range[0]).toBe(DAY);
    // No options: it draws again, where it is (V15).
    const before = view.range;
    view.update();
    expect(view.range).toEqual(before);
  });

  it("right to left: Monday on the right, and the left arrow goes to the next day", async () => {
    const { view, svg } = mount({ direction: "rtl" });
    const monday = svg.querySelector('[data-item-id="standup@20261102T090000Z"]');
    const tuesday = svg.querySelector('[data-item-id="standup@20261103T090000Z"]');
    expect(monday !== null && tuesday !== null && centre(tuesday).x < centre(monday).x).toBe(true);
    svg.focus();
    await userEvent.keyboard("{ArrowDown}{ArrowLeft}");
    expect(view.focusedKey).toBe("standup@20261103T090000Z");
  });

  it("every word is the dictionary's: a pseudo-translation leaves none unmarked", () => {
    const { element } = mount({ strings: pseudoStrings(DEFAULT_STRINGS) });
    const said = [...element.querySelectorAll("button")].map((button) => button.textContent ?? "");
    const svg = element.querySelector("svg");
    said.push(svg?.getAttribute("aria-label") ?? "");
    for (const node of element.querySelectorAll("[role=option]")) said.push(node.getAttribute("aria-label") ?? "");
    for (const text of said) expect(text.startsWith(PSEUDO_OPEN), text).toBe(true);
  });

  it("destroy takes the view out of the page", () => {
    const { element, view } = mount();
    view.destroy();
    view.destroy();
    expect(element.children).toHaveLength(0);
  });
});

describe("the week view, every option and path", () => {
  it("takes the rest of the options: items beside the events, the hours, a minimum length, theme, density, ariaLabel, a now line, no toolbar, the week's first day", () => {
    const { element, view, svg } = mount({
      items: [{ id: "solo", label: "Solo", start: MONDAY + 13 * HOUR, end: MONDAY + 13 * HOUR + 5 * 60_000 }],
      dayStartHour: 8,
      dayEndHour: 18,
      minDurationMs: 30 * 60_000,
      theme: "dark",
      density: "compact",
      ariaLabel: "Team week",
      now: MONDAY + 10 * HOUR,
      toolbar: false,
    });
    expect(svg.getAttribute("aria-label")).toBe("Team week");
    expect(svg.getAttribute("data-tl-theme")).toBe("dark");
    expect(svg.querySelector('[data-item-id="solo"]')).not.toBeNull();
    expect(svg.querySelector(".tl-cal-now")).not.toBeNull();
    expect((element.querySelector(".tl-cal-bar") as HTMLElement).hidden).toBe(true);
    expect(view.layout.dayStartHour).toBe(8);
    view.update({ now: true, date: MONDAY + 9 * DAY });
    expect(view.range[0]).toBe(MONDAY + 7 * DAY);
    view.update({ weekStartsOn: 7, date: MONDAY + 2 * DAY });
    expect(view.range[0]).toBe(MONDAY - DAY);
  });

  it("direction auto reads the container's own direction", () => {
    const element = document.createElement("div");
    element.dir = "rtl";
    element.style.cssText = "width:980px";
    document.body.append(element);
    const view = mountCalendarView(element, { events, date: MONDAY + 2 * DAY, timeZone: ZONE, now: false, direction: "auto" });
    expect(element.querySelector(".tl-cal-view")?.getAttribute("dir")).toBe("rtl");
    view.destroy();
  });

  it("the view's own next, previous and today, the Next and Today buttons and t page alike; an unsubscribed handler hears nothing", async () => {
    // Today is a fixed day: read from the clock, the week could turn between
    // the expectation and the click (a Sunday midnight in the zone).
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(MONDAY + 30 * DAY + 12 * 3_600_000);
    onTestFinished(() => {
      vi.useRealTimers();
    });
    const { element, view } = mount();
    const ranges: number[] = [];
    const off = view.on("rangeChanged", (payload) => ranges.push(payload.start));
    view.next();
    expect(view.range[0]).toBe(MONDAY + 7 * DAY);
    view.previous();
    expect(view.range[0]).toBe(MONDAY);
    const buttons = [...element.querySelectorAll("button")];
    buttons.find((button) => button.textContent === "Next")?.click();
    expect(view.range[0]).toBe(MONDAY + 7 * DAY);
    const thisWeek = weekStartOf(Date.now(), ZONE, 1);
    expect(thisWeek).toBe(MONDAY + 28 * DAY);
    buttons.find((button) => button.textContent === "Today")?.click();
    expect(view.range[0]).toBe(thisWeek);
    view.next();
    (element.querySelector("svg") as SVGSVGElement).focus();
    await userEvent.keyboard("t");
    expect(view.range[0]).toBe(thisWeek);
    view.next();
    view.today();
    expect(view.range[0]).toBe(thisWeek);
    expect(ranges.length).toBeGreaterThan(4);
    const heard = ranges.length;
    off();
    view.next();
    expect(ranges).toHaveLength(heard);
  });

  it("Enter with nothing focused, an unknown key and a key for nothing choose nothing; an arrow past the first stays; a focus whose event is gone is forgotten", async () => {
    const { view, svg } = mount();
    const chosen: string[] = [];
    view.on("itemSelect", (payload) => chosen.push(payload.key));
    svg.focus();
    await userEvent.keyboard("{Enter}");
    await userEvent.keyboard("x");
    view.choose("no such key");
    expect(chosen).toEqual([]);
    expect(view.selectedId).toBeUndefined();
    await userEvent.keyboard("{ArrowDown}");
    const first = view.focusedKey;
    await userEvent.keyboard("{ArrowUp}");
    expect(view.focusedKey).toBe(first);
    view.choose(first ?? "");
    expect(view.selectedId).toBe("standup@20261102T090000Z");
    view.update({ events: [] });
    expect(view.focusedKey).toBeUndefined();
  });

  it("a press that travels, a right button, a cancelled press, another pointer's lift and empty time choose nothing; a still press on an event chooses it", () => {
    const { view, svg } = mount();
    const chosen: string[] = [];
    view.on("itemSelect", (payload) => chosen.push(`${payload.key} ${payload.via}`));
    const review = svg.querySelector('[data-item-id="review"]') as Element;
    const at = centre(review);
    const host = svg.parentElement as HTMLElement;
    const fire = (type: string, init: PointerEventInit = {}): void => {
      host.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 1, button: 0, clientX: at.x, clientY: at.y, ...init }));
    };
    fire("pointerdown");
    fire("pointerup", { clientX: at.x + 20 });
    fire("pointerdown", { button: 2 });
    fire("pointerup");
    fire("pointerdown");
    fire("pointercancel");
    fire("pointerup");
    fire("pointerdown");
    fire("pointerup", { pointerId: 2 });
    const box = svg.getBoundingClientRect();
    fire("pointerdown", { clientX: box.right - 4, clientY: box.bottom - 4 });
    fire("pointerup", { clientX: box.right - 4, clientY: box.bottom - 4 });
    expect(chosen).toEqual([]);
    fire("pointerdown");
    fire("pointerup");
    expect(chosen).toEqual(["review pointer"]);
  });

  it("after destroy an update draws nothing", () => {
    const { element, view } = mount();
    view.destroy();
    view.update({ view: "day" });
    expect(element.children).toHaveLength(0);
  });
});
