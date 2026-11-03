/**
 * `/intl` at its edges: what is not a frame, a cached name, every tick
 * label's granularity, an era calendar's long steps, and the words' corners.
 */

import { describe, expect, it } from "vitest";

import { calendarFields, calendarTickLabel, calendarTicks } from "../../src/intl/calendars.js";
import { describeHooks } from "../../src/intl/describe.js";
import { mirrorCss, mirrorScene, mirrorTextNodes } from "../../src/intl/mirror.js";
import { DEFAULT_STRINGS, pseudoStrings, resolveStrings, sayIn } from "../../src/intl/strings.js";
import { layoutItems } from "../../src/layout.js";
import { fill, formatAmount } from "../../src/text.js";
import type { Tick } from "../../src/ticks.js";
import { generateTicks } from "../../src/ticks.js";

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 5);

describe("mirroring at the edges", () => {
  it("leaves what is not a frame, or has no width, as it is, and embeds no stylesheet when asked not to", () => {
    const group = { tag: "g", children: [] };
    expect(mirrorScene(group)).toBe(group);
    const empty = { tag: "svg", attrs: { width: 0 } };
    expect(mirrorScene(empty)).toBe(empty);
    const bare = mirrorScene({ tag: "svg", attrs: { width: 100, height: 20 }, children: [{ tag: "rect" }] }, { style: false });
    expect(bare.children?.map((child) => child.tag)).toEqual(["g"]);
    // Without a density, the comfortable padding.
    expect(mirrorScene({ tag: "svg", attrs: { width: 10 } }).children?.[0]?.text).toBe(mirrorCss());
    expect(mirrorCss("dense")).not.toBe(mirrorCss("comfortable"));
  });
});

describe("names at the edges", () => {
  it("keeps a name while its item and span hold, names an open item and a lane-less one, and a cluster of one instant", () => {
    const hooks = describeHooks({ strings: resolveStrings({ openRange: "{start} →" }), lanes: new Map([["a", ""]]) });
    const [open, plain] = layoutItems([
      { id: "o", start: T0, open: true, laneId: "a" },
      { id: "p", label: "P", start: T0 + 3_600_000 },
    ]).items;
    const first = hooks.describeItem(open as never);
    expect(first.endsWith("→")).toBe(true);
    expect(hooks.describeItem(open as never)).toBe(first);
    expect(hooks.describeItem(plain as never)).toContain("P, ");
    const cluster = { id: "c", laneId: "z", start: T0, lastStart: T0, members: [{}, {}] };
    expect(hooks.describeCluster(cluster as never)).toBe(`2 items, ${new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "UTC" }).format(T0)}`);
  });
});

describe("ticks at the edges", () => {
  it("gives no ticks to nothing, and the core's to a Gregorian calendar", () => {
    expect(calendarTicks("hebrew")([T0, T0 + DAY], 0)).toEqual([]);
    expect(calendarTicks("hebrew")([T0, T0], 100)).toEqual([]);
    expect(calendarTicks("gregory")([T0, T0 + 90 * DAY], 1000)).toEqual(generateTicks([T0, T0 + 90 * DAY], 1000, { timeZone: "UTC", targetSpacingPx: 80 }));
  });

  it("gives an era calendar's decades the Gregorian ones, and its single years its own", () => {
    const decades = calendarTicks("japanese")([Date.UTC(1900, 0, 1), Date.UTC(2100, 0, 1)], 2000);
    expect(decades.map((tick) => new Date(tick.time).getUTCFullYear() % 10)).toEqual(decades.map(() => 0));
    const years = calendarTicks("japanese")([Date.UTC(2018, 0, 1), Date.UTC(2021, 0, 1)], 400);
    // Reiwa began on 1 May 2019: a year of the calendar's own.
    expect(years.map((tick) => tick.time)).toContain(Date.UTC(2019, 4, 1));
    expect(calendarFields(Date.UTC(2019, 4, 1), "japanese").era).not.toBe(calendarFields(Date.UTC(2019, 3, 30), "japanese").era);
  });

  it("labels every granularity from Intl", () => {
    const label = calendarTickLabel("en", "hebrew");
    const tick = (granularity: Tick["granularity"], major: boolean): Tick => ({ time: T0 + 3_723_456, granularity, major });
    const as = (options: Intl.DateTimeFormatOptions): string => new Intl.DateTimeFormat("en", { ...options, calendar: "hebrew", timeZone: "UTC" }).format(T0 + 3_723_456);
    expect(label(tick("millisecond", false), "UTC")).toBe(as({ second: "2-digit", fractionalSecondDigits: 3 }));
    expect(label(tick("second", true), "UTC")).toBe(as({ hour: "2-digit", minute: "2-digit", second: "2-digit" }));
    expect(label(tick("minute", true), "UTC")).toBe(as({ hour: "2-digit", minute: "2-digit" }));
    expect(label(tick("hour", true), "UTC")).toBe(as({ month: "short", day: "numeric" }));
    expect(label(tick("hour", false), "UTC")).toBe(as({ hour: "2-digit", minute: "2-digit" }));
    expect(label(tick("century", false), "UTC")).toBe(as({ year: "numeric" }));
    // Without a calendar, the locale's own.
    expect(calendarTickLabel("en")(tick("year", false), "UTC")).toBe("2026");
  });
});

describe("words at the edges", () => {
  it("falls back to `other`, fills percentages, and pseudo-translates plural forms", () => {
    expect(fill({ other: "{count} things" }, { count: 1 })).toBe("1 things");
    expect(formatAmount(0.25, { locale: "en", percent: true })).toBe("25%");
    const pseudo = pseudoStrings({ ...DEFAULT_STRINGS, cluster: { one: "{count} item", other: "{count} items" } });
    expect(pseudo.cluster).toEqual({ one: "⟦{count} item⟧", other: "⟦{count} items⟧" });
    expect(sayIn(pseudo)("cluster", { count: 1 })).toBe("⟦1 item⟧");
  });

  it("turns text back by attributes: about its own x, a middle anchor stays, a leaf without children is kept", () => {
    const scene = {
      tag: "g",
      children: [
        { tag: "text", attrs: { "text-anchor": "middle" }, text: "a" },
        { tag: "text", attrs: { x: 10, transform: "translate(5 0)" }, text: "b" },
        { tag: "rect", attrs: { x: 1 } },
      ],
    };
    const [middle, start, rect] = mirrorTextNodes(scene).children ?? [];
    expect(middle?.attrs).toEqual({ "text-anchor": "middle", transform: "matrix(-1 0 0 1 0 0)" });
    expect(start?.attrs).toEqual({ x: 10, "text-anchor": "end", transform: "translate(5 0) matrix(-1 0 0 1 20 0)" });
    expect(rect).toBe(scene.children[2]);
  });
});

describe("the axis's context label, in a locale and a calendar", () => {
  const at = Date.UTC(2026, 0, 5, 13, 45, 7);
  const context = (locale: string, calendar: string | undefined, granularity: Tick["granularity"]): string =>
    calendarTickLabel(locale, calendar)({ time: at, granularity, major: true, context: true }, "UTC");

  it("names the coarser unit each granularity leaves out", () => {
    expect(context("en-GB", "gregory", "day")).toBe("January 2026");
    expect(context("en-GB", "gregory", "month")).toBe("2026");
    expect(context("en-GB", "gregory", "hour")).toBe("5 Jan 2026");
    expect(context("en-GB", "gregory", "minute")).toBe("5 Jan 2026");
    expect(context("en-GB", "gregory", "second")).toMatch(/^5 Jan 2026,? 13:45$/);
    expect(context("en-GB", "gregory", "millisecond")).toBe("13:45:07");
    expect(context("en-GB", "gregory", "year")).toBe("");
  });

  it("is the calendar's own month", () => {
    expect(context("en", "hebrew", "day")).toMatch(/Tevet 5786/);
    expect(context("de", undefined, "day")).toBe("Januar 2026");
  });
});
