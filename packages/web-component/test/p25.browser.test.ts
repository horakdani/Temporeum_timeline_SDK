import { afterEach, describe, expect, it, vi } from "vitest";

import type { Item, Lane } from "@temporeum/timeline-core";

import { createTimeline, registerPlugin } from "../src/index.js";
import { exportPlugin } from "../src/export.js";
import type { Timeline, TimelineConfig } from "../src/index.js";

// The parts on entry points of their own (P29), as a page registers them.
registerPlugin(exportPlugin);

/**
 * P25 through the live instance, in a real Chromium: the frame as SVG with
 * its theme pinned, as a PNG the browser lets out of its canvas, the whole
 * range as a PDF, and the print view the browser's print takes — mounted,
 * one section a page, gone after the print.
 */

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 5);
const lanes: Lane[] = Array.from({ length: 8 }, (_, at) => ({ id: `l${String(at)}`, label: `Lane ${String(at)}` }));
const items: Item[] = Array.from({ length: 120 }, (_, at) => ({
  id: `i${String(at)}`,
  label: `Item ${String(at)}`,
  start: T0 + ((at * 13) % 60) * DAY,
  end: T0 + (((at * 13) % 60) + 2 + (at % 4)) * DAY,
  laneId: `l${String(at % 8)}`,
}));

/**
 * A sheet the plan does not fit on: its eight lanes are 300 px tall with the
 * axis, and a landscape A5 holds 464 px — this one, 237.
 */
const SHORT_SHEET = [420, 250] as const;

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

async function mount(config: Partial<TimelineConfig> = {}): Promise<{ element: HTMLDivElement; timeline: Timeline }> {
  const element = document.createElement("div");
  element.style.cssText = "width:900px;height:360px;position:relative";
  document.body.append(element);
  const timeline = createTimeline(element, { items, lanes, domain: [T0, T0 + 10 * DAY], height: 360, timeZone: "UTC", ariaLabel: "Plan", ...config });
  await vi.waitFor(() => {
    if (timeline.result === undefined || element.querySelector("svg [data-tl-id]") === null) throw new Error("not drawn yet");
  });
  return { element, timeline };
}

const latin1 = (bytes: Uint8Array): string => new TextDecoder("latin1").decode(bytes);

describe("export", () => {
  it("pins an auto theme to what the screen shows, and keeps a configured one", async () => {
    const { timeline } = await mount();
    const dark = matchMedia("(prefers-color-scheme: dark)").matches;
    const svg = timeline.exportSvg();
    expect(svg).toContain(`data-tl-theme="${dark ? "dark" : "light"}"`);
    expect(svg).not.toContain("prefers-color-scheme");
    timeline.update({ theme: "dark" });
    expect(timeline.exportSvg()).toContain('data-tl-theme="dark"');
  });

  it("makes a PNG of the view at the scale asked for", async () => {
    const { timeline } = await mount();
    const png = await timeline.exportPng({ scale: 2 });
    expect(png.type).toBe("image/png");
    const bitmap = await createImageBitmap(png);
    expect([bitmap.width, bitmap.height]).toEqual([1800, 720]);
  });

  it("writes the whole range as a PDF, titled from the label, several pages for a tall plan", async () => {
    const { timeline } = await mount();
    const bytes = await timeline.exportPdf({ size: SHORT_SHEET });
    const text = latin1(bytes);
    expect(text.startsWith("%PDF-1.4\n")).toBe(true);
    expect(Number(/\/Count (\d+)/.exec(text)?.[1])).toBeGreaterThan(1);
    // "Plan" as UTF-16BE.
    expect(text).toContain("/Title <feff0050006c0061006e>");
    expect(latin1(await timeline.exportPdf({ title: "Other" }))).toContain("/Title <feff004f0074006800650072>");
  });

  it("prints through a view of one section a page, each item in exactly one, gone after the print", async () => {
    const { timeline } = await mount();
    const print = vi.spyOn(window, "print").mockImplementation(() => undefined);
    let printed = false;
    const done = timeline.print({ size: SHORT_SHEET }).then(() => {
      printed = true;
    });
    expect(print).toHaveBeenCalledOnce();
    const sections = [...document.querySelectorAll("body > [data-tl-print] > section")];
    expect(sections.length).toBeGreaterThan(1);
    const where = new Map<string, number>();
    sections.forEach((section, at) => {
      for (const id of new Set([...section.querySelectorAll("[data-tl-id]")].map((node) => node.getAttribute("data-tl-id") ?? ""))) {
        expect(where.has(id)).toBe(false);
        where.set(id, at);
      }
    });
    expect([...where.keys()].sort()).toEqual(items.map((item) => item.id).sort());
    // The promise is the dialog's: it resolves when the print is over, not before.
    await Promise.resolve();
    expect(printed).toBe(false);
    window.dispatchEvent(new Event("afterprint"));
    await done;
    expect(printed).toBe(true);
    expect(document.querySelector("body > [data-tl-print]")).toBeNull();
  });

  it("has nothing to export before the first frame", async () => {
    const element = document.createElement("div");
    document.body.append(element);
    const timeline = createTimeline(element, { items, lanes, domain: [T0, T0 + DAY] });
    expect(timeline.exportSvg()).toBe("");
    const pdf = timeline.exportPdf();
    expect(pdf).toBeInstanceOf(Promise);
    expect(await pdf).toHaveLength(0);
    await expect(timeline.exportPng()).rejects.toThrow(/Nothing drawn/);
    const print = vi.spyOn(window, "print").mockImplementation(() => undefined);
    await expect(timeline.print()).resolves.toBeUndefined();
    expect(print).not.toHaveBeenCalled();
    timeline.destroy();
  });
});
