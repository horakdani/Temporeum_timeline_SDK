/**
 * Large input does not overflow the stack: a value folded over many items
 * is a loop, not a spread into one call's arguments.
 */
import { describe, expect, it } from "vitest";

import type { Item, Lane } from "@temporeum/timeline-core";

import { defaultTaskColumns } from "../src/task-grid.js";

describe("a task-grid row of 300 000 items", () => {
  it("reads its first start and its last end", () => {
    const day = 86_400_000;
    const items: Item[] = Array.from({ length: 300_000 }, (_, i) => ({ id: String(i), start: (i + 1) * day, end: (i + 2) * day }));
    const lane: Lane = { id: "big" };
    const [, start, end] = defaultTaskColumns();
    const row = { lane, items, depth: 0 } as unknown as Parameters<NonNullable<typeof start>["value"]>[0];
    expect(start?.value(row)).toBe("1970-01-02");
    expect(end?.value(row)).toBe(new Date(300_001 * day).toISOString().slice(0, 10));
  });
});

describe("a server render with a bad item or option", () => {
  it("leaves the item out and falls back to the default, instead of throwing", async () => {
    const { renderTimelineHtml } = await import("../src/index.js");
    const day = 86_400_000;
    const good = { id: "ok", start: 0, end: day, label: "Fine" };
    const bad: unknown[] = [{ id: "t", start: "text" }, { id: "n", start: Number.NaN }, { id: "h", start: 1e20 }, { id: "f", start: 0, end: day, sublaneSpan: 1.5 }, { start: 0 }, null];
    for (const each of bad) {
      const html = renderTimelineHtml({ height: 200, items: [good, each] as Item[] }, { width: 800 });
      expect(html).toContain('data-tl-id="ok"');
    }
    for (const option of [{ locale: "not a locale!!" }, { timeZone: "Mars/Olympus" }]) {
      expect(renderTimelineHtml({ height: 200, items: [good], ...option }, { width: 800 })).toContain('data-tl-id="ok"');
    }
  });

  it("leaves out a decoration, a time bar or a hidden stretch it cannot draw, and says so (V2)", async () => {
    // A decoration with a time as text, or of no kind, threw from every frame and from the server render.
    const { renderTimelineHtml } = await import("../src/index.js");
    const { readableOptionsOf } = await import("../src/config.js");
    const good = { id: "ok", start: 0, end: 86_400_000, label: "Fine" };
    const now = { kind: "now", time: 3_600_000 };
    const decorations = [now, { kind: "now", time: "2026-01-05" }, { time: 0 }, { kind: "era", id: "e", start: 0, end: new Date(Number.NaN) }, null];
    const html = renderTimelineHtml({ height: 200, items: [good], decorations } as never, { width: 800 });
    expect(html).toContain('data-tl-id="ok"');
    expect(html).toContain("tl-now");
    const said: { option?: string }[] = [];
    const read = readableOptionsOf({ decorations, timeBars: [{ id: "b", time: "x" }, { id: "c", time: 5 }], hiddenDates: [{ start: 0, end: 1 }, { start: "a", end: 2 }] } as never, (skipped) => said.push(skipped));
    expect(read.decorations).toEqual([now]);
    expect(read.timeBars).toEqual([{ id: "c", time: 5 }]);
    expect(read.hiddenDates).toEqual([{ start: 0, end: 1 }]);
    expect(said.map((each) => each.option)).toEqual(["decorations", "decorations", "decorations", "decorations", "timeBars", "hiddenDates"]);
    // Lists that are fine leave the configuration as it was, the same object.
    const fine = { decorations: [now, { kind: "banding" }], timeBars: [{ id: "c", time: new Date(0) }] } as never;
    expect(readableOptionsOf(fine)).toBe(fine);
  });

  it("reads an enumerated option it does not know as its default, and says which (R20, R52)", async () => {
    // A capital letter or a typo in a choice threw from the render, and the
    // element was left with an empty shadow root.
    const { renderTimelineHtml } = await import("../src/index.js");
    const { readableOptionsOf } = await import("../src/config.js");
    const good = { id: "ok", start: 0, end: 86_400_000, label: "Fine" };
    const wrong = { orientation: "Vertical", density: "Compact", theme: "Dark", packMode: "stack", direction: "sideways", labelOverflow: "wrap", touchAction: "none" };
    for (const [key, value] of Object.entries(wrong)) {
      expect(renderTimelineHtml({ height: 200, items: [good], [key]: value } as never, { width: 800 }), key).toContain('data-tl-id="ok"');
      const said: { option?: string }[] = [];
      const read = readableOptionsOf({ [key]: value } as never, (skipped) => said.push(skipped));
      expect(read, key).not.toHaveProperty(key);
      expect(said.map((each) => each.option), key).toEqual([key]);
    }
    // What is right is kept, as the same object.
    const right = { orientation: "vertical", density: "dense", theme: "dark", packMode: "single", direction: "rtl", labelOverflow: "drop", touchAction: "cooperative" } as const;
    expect(readableOptionsOf(right)).toBe(right);
  });

  it("draws an item whose className is null, and leaves out one whose text field is not a string (Y6, Y19)", async () => {
    // `"className": null` threw inside the frame (`extra.split`) and left the
    // whole timeline blank; a number label or an object lane threw on the
    // server, where the client drew.
    const { renderTimelineHtml } = await import("../src/index.js");
    const { readableItems, readableOptionsOf } = await import("../src/config.js");
    const good = { id: "ok", start: 0, end: 86_400_000, label: "Fine" };
    const nulls = { id: "n", start: 0, label: null, laneId: null, className: null };
    expect(renderTimelineHtml({ height: 200, items: [good, nulls] as never }, { width: 800 })).toContain('data-tl-id="n"');
    const bad: unknown[] = [{ id: "c", start: 0, className: 5 }, { id: "o", start: 0, className: {} }, { id: "l", start: 0, label: 1999 }, { id: "a", start: 0, label: ["a"] }, { id: "z", start: 0, laneId: {} }];
    for (const each of bad) {
      const html = renderTimelineHtml({ height: 200, items: [good, each] as Item[] }, { width: 800 });
      expect(html).toContain('data-tl-id="ok"');
      expect(html).not.toContain(`data-tl-id="${(each as Item).id}"`);
    }
    const said: string[] = [];
    expect(readableItems([good, ...bad] as Item[], (skipped) => said.push(skipped.message))).toEqual([good]);
    expect(said).toEqual([
      'Item "c" is left out: its className (5) is not a string',
      'Item "o" is left out: its className ([object Object]) is not a string',
      'Item "l" is left out: its label (1999) is not a string',
      'Item "a" is left out: its label (a) is not a string',
      'Item "z" is left out: its laneId ([object Object]) is not a string',
    ]);
    const era = { kind: "era", id: "e", start: 0, end: 86_400_000, label: 5 };
    const kept = { kind: "era", id: "k", start: 0, end: 86_400_000, label: "Kept" };
    const options: string[] = [];
    expect(readableOptionsOf({ decorations: [era, kept] } as never, (skipped) => options.push(skipped.message)).decorations).toEqual([kept]);
    expect(options).toEqual(["One of the decorations is left out: its label (5) is not a string"]);
    expect(renderTimelineHtml({ height: 200, items: [good], decorations: [era] } as never, { width: 800 })).toContain('data-tl-id="ok"');
  });

  it("draws a decoration whose label is null on the server, as the client does (Z6)", async () => {
    // The null label went to the text measure, which threw: no markup at all.
    const { renderTimelineHtml } = await import("../src/index.js");
    const items = [{ id: "ok", start: 0, end: 86_400_000 }];
    const decorations = [
      { kind: "marker", id: "m", time: 43_200_000, label: null },
      { kind: "era", id: "e", start: 0, end: 86_400_000, label: null },
      { kind: "now", time: 43_200_000, label: null },
    ];
    for (const decoration of decorations) {
      const html = renderTimelineHtml({ height: 200, domain: [-86_400_000, 172_800_000], items, decorations: [decoration] } as never, { width: 800 });
      expect(html, decoration.kind).toContain('data-tl-id="ok"');
      expect(html, decoration.kind).not.toContain(">null<");
    }
  });

  it("prints only a height the client draws into the host's style (Y20)", async () => {
    // A height from a query string was printed as it was: `--tl-height:100;background:url(…)px`.
    const { renderTimelineHtml } = await import("../src/index.js");
    const items = [{ id: "ok", start: 0, end: 86_400_000 }];
    const hostile = renderTimelineHtml({ height: "100;background:url(https://evil.example/x);x:" as never, items }, { width: 800 });
    // The start tag has no style; the JSON keeps the value, which the client reads as no height and reports.
    expect(hostile.slice(0, hostile.indexOf(">"))).toBe("<temporeum-timeline");
    // Nor a height of 0, which the client leaves out too (Z10).
    for (const height of [Number.NaN, -1, Number.POSITIVE_INFINITY, 0]) {
      const html = renderTimelineHtml({ height, items }, { width: 800 });
      expect(html.slice(0, html.indexOf(">")), String(height)).not.toContain("--tl-height");
    }
    expect(renderTimelineHtml({ height: 240, items }, { width: 800 })).toContain('style="--tl-height:240px"');
  });

  it("carries a BigInt in item data as its digits, and throws JSON's own error on a cycle (Y22)", async () => {
    // `JSON.stringify` threw "Do not know how to serialize a BigInt" for a database's BIGINT id.
    const { renderTimelineHtml } = await import("../src/index.js");
    const html = renderTimelineHtml({ height: 200, items: [{ id: "a", start: 0, label: "x", data: { dbId: 12345678901234567890n } }] }, { width: 800 });
    expect(html).toContain('"dbId":"12345678901234567890"');
    const data: Record<string, unknown> = {};
    data.self = data;
    expect(() => renderTimelineHtml({ height: 200, items: [{ id: "a", start: 0, data }] }, { width: 800 })).toThrow(/circular/);
  });
});
