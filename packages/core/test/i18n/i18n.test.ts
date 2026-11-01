/**
 * G-I18N: the library has no word of its own that a dictionary cannot
 * replace, and in at least five languages and three calendars that are not
 * Gregorian, the axis's ticks are where the calendar's own units begin.
 *
 * - **pseudo**: frames with every part that speaks — names, clusters, Gantt
 *   tasks, loads, load lanes, lane headers — drawn with `pseudoStrings` in
 *   Japanese: once the marked phrases, the host's words and `Intl`'s dates
 *   and numbers are taken out, not a Latin letter is left.
 * - **calendar-units**: a daily scan over years, in three zones — every
 *   month tick is a day whose day-of-month is 1 and every such day is a
 *   tick; every year tick is a year's first day and every first day is a
 *   tick; longer steps fall on the calendar's own multiples.
 * - **five-locales**: tick labels are `Intl`'s, in the locale and calendar.
 * - **english-equal**: the dictionary's English is the words the entry
 *   points say without one, to the letter.
 */

import { describe, expect, it } from "vitest";

import { describeCluster, describeItem } from "../../src/a11y.js";
import { addCalendar, startOf } from "../../src/calendar.js";
import type { Cluster } from "../../src/cluster.js";
import { describeTask, ganttHooks } from "../../src/gantt/index.js";
import type { Dependency } from "../../src/gantt/index.js";
import { calendarFields, calendarTickLabel, calendarTicks } from "../../src/intl/calendars.js";
import { describeHooks } from "../../src/intl/describe.js";
import { DEFAULT_STRINGS, PSEUDO_CLOSE, PSEUDO_OPEN, pseudoStrings, sayIn } from "../../src/intl/strings.js";
import { layoutItems } from "../../src/layout.js";
import { renderTimeline } from "../../src/render.js";
import { describeOverload, resourceHooks, resourceLanes, resourceLoad, withLoadLanes } from "../../src/resources/index.js";
import type { SceneElement } from "../../src/scene.js";
import { fill } from "../../src/text.js";
import { createHiddenDates } from "../../src/tools/hidden.js";
import { laneHeaderNodes } from "../../src/tools/lanes.js";
import type { Item } from "../../src/types.js";
import { describeBothOrientations } from "../orientation.js";
import { makeRandom } from "../property/harness.js";

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 5);

/** Every string of a scene a reader is given: text, and the attributes read out. */
function spoken(node: SceneElement, out: string[] = []): string[] {
  if (node.tag === "style") return out;
  if (node.text !== undefined && node.text.trim() !== "") out.push(node.text);
  for (const name of ["aria-label", "aria-valuetext", "aria-roledescription", "title"]) {
    const value = node.attrs?.[name];
    if (typeof value === "string" && value.trim() !== "") out.push(value);
  }
  for (const child of node.children ?? []) spoken(child, out);
  return out;
}

function unmarked(text: string, host: readonly string[]): string {
  let rest = text;
  for (let guard = 0; guard < 10 && rest.includes(PSEUDO_OPEN); guard += 1) {
    rest = rest.replace(new RegExp(`${PSEUDO_OPEN}[^${PSEUDO_OPEN}${PSEUDO_CLOSE}]*${PSEUDO_CLOSE}`, "g"), " ");
  }
  for (const word of host) rest = rest.split(word).join(" ");
  return rest;
}

describeBothOrientations("a pseudo-translated frame", (orientation) => {
  it("[claim:pseudo] says no word the dictionary did not give it", () => {
    const strings = pseudoStrings();
    const say = sayIn(strings, "ja");
    const resources = [
      { id: "r1", label: "鈴木", capacity: 1 },
      { id: "r2", label: "佐藤", capacity: 0 },
    ];
    const random = makeRandom(26);
    const items: Item[] = [
      { id: "plan", label: "企画", start: T0, end: T0 + 5 * DAY, laneId: "r1", progress: 0.4, baseline: { start: T0, end: T0 + 3 * DAY } },
      { id: "build", label: "実装", start: T0 + 2 * DAY, end: T0 + 9 * DAY, laneId: "r1" },
      { id: "ship", label: "出荷", start: T0 + 12 * DAY, laneId: "r2", kind: "milestone" },
      { id: "late", label: "遅延", start: T0 + 3 * DAY, end: T0 + 4 * DAY, laneId: "r2" },
      ...Array.from({ length: 40 }, (_, n) => ({ id: `d${String(n)}`, label: `点${String(n)}`, start: T0 + 15 * DAY + Math.floor(random() * 600) * 1000, laneId: "r1" })),
    ];
    const dependencies: Dependency[] = [
      { from: "plan", to: "build", type: "SS", lagMs: 2 * DAY },
      { from: "build", to: "ship", lagMs: -3 * 3_600_000 },
    ];
    const lanes = withLoadLanes(resourceLanes(resources), resources, 24, say);
    const laneNames = new Map(lanes.map((lane) => [lane.id, lane.label]));
    const named = describeHooks({ strings, locale: "ja", timeZone: "UTC", lanes: laneNames });
    const hooks = resourceHooks(
      ganttHooks({ ...named }, { dependencies, items, lanes: laneNames, locale: "ja", say }),
      { load: resourceLoad(items, resources), lanes: laneNames, locale: "ja", say },
    );
    const result = renderTimeline({
      items,
      lanes,
      domain: [T0 - DAY, T0 + 20 * DAY],
      width: orientation === "horizontal" ? 1200 : 500,
      height: orientation === "horizontal" ? 500 : 1000,
      orientation,
      locale: "ja",
      ariaLabel: say("timeline"),
      formatTick: calendarTickLabel("ja", "japanese"),
      ticks: calendarTicks("japanese"),
      cluster: true,
      hooks,
    });
    const headers = laneHeaderNodes(result.layout, { orientation, density: "comfortable", crossOffset: 0, crossSize: 500 });
    const host = [...items.map((item) => item.label ?? ""), ...resources.map((resource) => resource.label)];
    const texts = [...spoken(result.scene), ...headers.flatMap((node) => spoken(node))];
    // Every kind of phrase was said: a cluster, a dependency, a plan, progress, a milestone, an overload, a load lane.
    const all = texts.join("\n");
    for (const key of ["cluster", "SS", "dependencyLag", "behindPlan", "progress", "milestone", "overbooked", "loadLane", "timeline"] as const) {
      const phrase = DEFAULT_STRINGS[key] as string;
      const first = phrase.replace(/\{\w+\}/g, "\u0000").split("\u0000").find((part) => part.trim() !== "") ?? phrase;
      expect(all, key).toContain(first.trim());
    }
    const leaks = texts.filter((text) => /[A-Za-z]/.test(unmarked(text, host)));
    expect(leaks).toEqual([]);
  });
});

/** The instants, at a zone's midnights in `[from, to)`, where a field changes. */
function boundaries(calendar: string, timeZone: string, from: number, to: number): { months: number[]; years: number[] } {
  const months: number[] = [];
  const years: number[] = [];
  let day = startOf(from, "day", timeZone);
  let previous = calendarFields(addCalendar(day, "day", -1, timeZone), calendar, timeZone);
  while (day <= to) {
    const fields = calendarFields(day, calendar, timeZone);
    // A zone's first midnight can be before `from`: the axis starts at `from`.
    if (day >= from) {
      if (fields.day === 1) months.push(day);
      if (fields.year !== previous.year || fields.era !== previous.era) years.push(day);
    }
    previous = fields;
    day = addCalendar(day, "day", 1, timeZone);
  }
  return { months, years };
}

const CALENDARS = ["hebrew", "islamic-umalqura", "persian", "chinese", "ethiopic"] as const;
const ZONES = ["UTC", "Europe/Budapest", "Asia/Tehran"] as const;

describe("ticks in a calendar's own units", () => {
  for (const calendar of CALENDARS) {
    for (const timeZone of ZONES) {
      it(`[claim:calendar-units] ${calendar} in ${timeZone}: every month and year start is a tick, and every tick is one`, () => {
        const from = Date.UTC(2024, 0, 10);
        // Two years over 2000 px: a month step; twenty: a year step.
        const monthTicks = calendarTicks(calendar)([from, from + 2 * 365 * DAY], 2000, { timeZone, targetSpacingPx: 80 });
        expect(monthTicks.every((tick) => tick.granularity === "month")).toBe(true);
        const scan = boundaries(calendar, timeZone, from, from + 2 * 365 * DAY);
        expect(monthTicks.map((tick) => tick.time)).toEqual(scan.months);
        // Major exactly where a year begins.
        expect(monthTicks.filter((tick) => tick.major).map((tick) => tick.time)).toEqual(scan.years.filter((time) => scan.months.includes(time)));
        const yearTicks = calendarTicks(calendar)([from, from + 20 * 365 * DAY], 2000, { timeZone, targetSpacingPx: 80 });
        expect(yearTicks.every((tick) => tick.granularity === "year")).toBe(true);
        const long = boundaries(calendar, timeZone, from, from + 20 * 365 * DAY);
        expect(yearTicks.map((tick) => tick.time)).toEqual(long.years);
      });
    }
  }

  it("[claim:calendar-units] puts longer steps on the calendar's own multiples, and quarters on its own months", () => {
    const from = Date.UTC(1990, 0, 1);
    for (const calendar of ["hebrew", "islamic-umalqura", "persian"] as const) {
      const decades = calendarTicks(calendar)([from, from + 200 * 365 * DAY], 2000, { timeZone: "UTC", targetSpacingPx: 80 });
      expect(decades.length).toBeGreaterThan(5);
      for (const tick of decades) {
        const fields = calendarFields(tick.time, calendar, "UTC");
        expect(fields.year % 10, calendar).toBe(0);
        // A year's first day: the day before is the year before.
        expect(calendarFields(tick.time - DAY, calendar, "UTC").year).toBe(fields.year - 1);
      }
      // Six years over 2000 px: quarters — every third month from each year's first.
      const quarters = calendarTicks(calendar)([from, from + 6 * 365 * DAY], 2000, { timeZone: "UTC", targetSpacingPx: 80 });
      const months = boundaries(calendar, "UTC", from - 400 * DAY, from + 6 * 365 * DAY);
      for (const tick of quarters) {
        expect(tick.granularity).toBe("month");
        const yearStart = [...months.years].reverse().find((time) => time <= tick.time) ?? 0;
        const index = months.months.filter((time) => time >= yearStart && time < tick.time).length;
        expect(index % 3).toBe(0);
      }
    }
  });

  it("[claim:calendar-units] marks a calendar's month start major among day ticks, and leaves the Gregorian calendar to the core", () => {
    const from = Date.UTC(2026, 2, 1);
    const days = calendarTicks("persian")([from, from + 40 * DAY], 2400, { timeZone: "UTC", targetSpacingPx: 50 });
    expect(days.every((tick) => tick.granularity === "day")).toBe(true);
    for (const tick of days) expect(tick.major).toBe(calendarFields(tick.time, "persian", "UTC").day === 1);
    expect(days.some((tick) => tick.major)).toBe(true);
  });

  it("[claim:hidden-calendar] chooses the step at the shown zoom, and gathers the ticks a hidden stretch swallows at its seam", () => {
    // Every night and the weekend hidden: about a third of the time shows.
    const hidden = createHiddenDates([
      { start: T0 + 18 * 3_600_000, end: T0 + DAY + 8 * 3_600_000, repeat: "daily" },
      { start: T0 + 5 * DAY, end: T0 + 7 * DAY, repeat: "weekly" },
    ]);
    const domain = [T0, T0 + 120 * DAY] as const;
    const ticks = calendarTicks("hebrew", { hidden })(domain, 1200, { timeZone: "UTC", targetSpacingPx: 80 });
    const plain = calendarTicks("hebrew")(domain, 1200, { timeZone: "UTC", targetSpacingPx: 80 });
    expect(ticks.length).toBeGreaterThan(3);
    // A shorter shown span is a closer zoom: never a coarser step.
    const order = ["millisecond", "second", "minute", "hour", "day", "month", "year", "decade", "century", "millennium"];
    expect(order.indexOf(ticks[0]?.granularity ?? "")).toBeLessThanOrEqual(order.indexOf(plain[0]?.granularity ?? ""));
    // One tick per position on the axis, in order.
    for (let index = 1; index < ticks.length; index += 1) {
      expect(hidden.toShown(ticks[index]?.time ?? 0)).toBeGreaterThan(hidden.toShown(ticks[index - 1]?.time ?? 0));
    }
    // At the same step without hidden time, every tick either stays or is gathered into a later one on its seam.
    const same = calendarTicks("hebrew")(domain, (1200 * (domain[1] - domain[0])) / (hidden.toShown(domain[1]) - hidden.toShown(domain[0])), {
      timeZone: "UTC",
      targetSpacingPx: 80,
    });
    const kept = new Set(ticks.map((tick) => tick.time));
    for (const tick of same) {
      if (kept.has(tick.time)) continue;
      expect(ticks.some((other) => other.time > tick.time && hidden.toShown(other.time) === hidden.toShown(tick.time))).toBe(true);
    }
  });

  it("[claim:hidden-calendar] leaves a Gregorian axis with hidden dates to their own ticks", () => {
    const hidden = createHiddenDates([{ start: T0 + 18 * 3_600_000, end: T0 + DAY + 8 * 3_600_000, repeat: "daily" }]);
    const domain = [T0, T0 + 30 * DAY] as const;
    expect(calendarTicks("gregory", { hidden })(domain, 1000, { timeZone: "UTC" })).toEqual(hidden.ticks(domain, 1000, { timeZone: "UTC" }));
  });
});

describe("labels in five locales", () => {
  const LOCALES = ["en", "hu", "he", "ar", "ja", "fa"] as const;
  for (const locale of LOCALES) {
    it(`[claim:five-locales] ${locale}: every tick label is Intl's own, in the calendar`, () => {
      for (const calendar of ["hebrew", "islamic-umalqura", "persian", "gregory"] as const) {
        for (const [span, size] of [
          [40 * DAY, 2000],
          [2 * 365 * DAY, 2000],
          [20 * 365 * DAY, 2000],
        ] as const) {
          const ticks = calendarTicks(calendar)([T0, T0 + span], size, { timeZone: "UTC", targetSpacingPx: 80 });
          const label = calendarTickLabel(locale, calendar);
          expect(ticks.length).toBeGreaterThan(3);
          for (const tick of ticks) {
            const options: Intl.DateTimeFormatOptions =
              tick.granularity === "day"
                ? tick.major
                  ? { month: "short", day: "numeric" }
                  : { day: "numeric" }
                : tick.granularity === "month"
                  ? tick.major
                    ? { year: "numeric", month: "short" }
                    : { month: "short" }
                  : { year: "numeric" };
            expect(label(tick, "UTC")).toBe(new Intl.DateTimeFormat(locale, { ...options, calendar, timeZone: "UTC" }).format(tick.time));
          }
        }
      }
      // And a name, in the locale's own date.
      const item: Item = { id: "x", label: "X", start: T0, end: T0 + 2 * DAY };
      const placed = layoutItems([item]).items[0];
      const name = describeHooks({ strings: DEFAULT_STRINGS, locale, timeZone: "UTC" }).describeItem(placed as never);
      expect(name).toContain(new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(T0));
    });
  }
});

describe("the dictionary's English", () => {
  it("[claim:english-equal] names items and clusters as the core does", () => {
    const random = makeRandom(7);
    const items: Item[] = Array.from({ length: 50 }, (_, n) => {
      const start = T0 + Math.floor(random() * 40) * DAY + (random() < 0.3 ? Math.floor(random() * 24) * 3_600_000 : 0);
      const kind = random();
      return {
        id: `i${String(n)}`,
        label: `Item ${String(n)}`,
        start,
        ...(kind < 0.15 ? { open: true } : kind < 0.3 ? {} : { end: start + (1 + Math.floor(random() * 5)) * DAY }),
        ...(random() < 0.2 ? { granularity: "day" as const } : {}),
        laneId: random() < 0.5 ? "a" : "b",
      } as Item;
    });
    const lanes = new Map([
      ["a", "Lane A"],
      ["b", undefined],
    ]);
    const named = describeHooks({ strings: DEFAULT_STRINGS, locale: "en", timeZone: "Europe/Budapest", lanes });
    for (const placed of layoutItems(items).items) {
      expect(named.describeItem(placed)).toBe(describeItem(placed.item, placed.span, lanes.get(placed.laneId), "en", "Europe/Budapest"));
    }
    const cluster = { id: "c", laneId: "a", start: T0, lastStart: T0 + 3 * DAY, members: [{}, {}, {}] } as unknown as Cluster;
    expect(named.describeCluster(cluster)).toBe(describeCluster(3, T0, T0 + 3 * DAY, "Lane A", "en", "Europe/Budapest"));
  });

  it("[claim:english-equal] says what the Gantt and resource views say without it", () => {
    const say = sayIn(DEFAULT_STRINGS, "en");
    const random = makeRandom(3);
    const items: Item[] = Array.from({ length: 30 }, (_, n) => {
      const start = T0 + Math.floor(random() * 30) * DAY;
      return {
        id: `t${String(n)}`,
        label: `Task ${String(n)}`,
        start,
        end: start + (1 + Math.floor(random() * 6)) * DAY,
        laneId: `r${String(n % 3)}`,
        ...(random() < 0.4 ? { progress: Math.floor(random() * 100) / 100 } : {}),
        ...(random() < 0.4 ? { baseline: { start, end: start + Math.floor(random() * 9 - 2) * DAY } } : {}),
        ...(random() < 0.1 ? { kind: "milestone" as const } : {}),
      } as Item;
    });
    const types = ["FS", "SS", "FF", "SF"] as const;
    const dependencies: Dependency[] = Array.from({ length: 25 }, (_, n) => ({
      from: `t${String(Math.floor(random() * 30))}`,
      to: `t${String(Math.floor(random() * 30))}`,
      type: types[n % 4] ?? "FS",
      ...(random() < 0.6 ? { lagMs: Math.round((random() * 6 - 3) * 2) * 3_600_000 * (random() < 0.5 ? 1 : 24) } : {}),
    }));
    for (const placed of layoutItems(items).items) {
      expect(describeTask(placed, { dependencies, items, say })).toBe(describeTask(placed, { dependencies, items }));
    }
    const resources = [0, 1, 2].map((n) => ({ id: `r${String(n)}`, label: `R${String(n)}`, capacity: n }));
    const load = resourceLoad(items, resources);
    for (const placed of layoutItems(items).items) expect(describeOverload(placed, load, say)).toBe(describeOverload(placed, load));
    const lanes = resourceLanes(resources);
    expect(withLoadLanes(lanes, resources, 24, say)).toEqual(withLoadLanes(lanes, resources, 24));
    const hooked = resourceHooks({}, { load, say });
    const plain = resourceHooks({}, { load });
    for (const placed of layoutItems(items).items) expect(hooked.describeItem?.(placed)).toBe(plain.describeItem?.(placed));
  });

  it("[claim:plurals] chooses a plural form by the locale's rules, and writes numbers the locale's way", () => {
    const items = { one: "{count} item", other: "{count} items" };
    expect(fill(items, { count: 1 }, "en")).toBe("1 item");
    expect(fill(items, { count: 3 }, "en")).toBe("3 items");
    expect(fill(items, { count: 1234 }, "en")).toBe("1,234 items");
    const arabic = { zero: "z{count}", one: "o{count}", two: "t{count}", few: "f{count}", many: "m{count}", other: "x{count}" };
    const rules = new Intl.PluralRules("ar");
    const letter: Record<string, string> = { zero: "z", one: "o", two: "t", few: "f", many: "m", other: "x" };
    for (const count of [0, 1, 2, 5, 11, 100]) {
      expect(fill(arabic, { count }, "ar")).toBe(`${letter[rules.select(count)] ?? "x"}${new Intl.NumberFormat("ar", { maximumFractionDigits: 1 }).format(count)}`);
    }
    const polish = { one: "{count} plik", few: "{count} pliki", many: "{count} plików", other: "{count} pliku" };
    expect(fill(polish, { count: 1 }, "pl")).toBe("1 plik");
    expect(fill(polish, { count: 3 }, "pl")).toBe("3 pliki");
    expect(fill(polish, { count: 5 }, "pl")).toBe("5 plików");
    expect(fill(polish, { count: 1.5 }, "pl")).toBe("1,5 pliku");
    // A missing value shows, rather than vanishing.
    expect(fill("{name} – {missing}", { name: "A" })).toBe("A – {missing}");
  });
});
