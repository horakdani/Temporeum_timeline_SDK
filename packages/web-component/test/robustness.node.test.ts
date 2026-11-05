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
});
