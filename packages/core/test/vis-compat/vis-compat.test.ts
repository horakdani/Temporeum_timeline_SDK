/**
 * G-COMPAT: vis-timeline's own documentation examples, through the
 * compatibility layer, put the same items at the same time in the same
 * group as vis-timeline itself.
 *
 * The reference is vis-timeline 8.5.6, run: `scripts/sdk_vis_compat_vectors.mjs`
 * opens every example of the vis-timeline repository's `examples/timeline`
 * (tag v8.5.6) in Chromium, in Europe/Budapest, records the raw items, groups
 * and options each `vis.Timeline` was given, and what vis-timeline made of
 * them — each item's type, start, end, group, and whether it is drawn; the
 * groups' order. A page of its own adds the edge cases. Six claims:
 *
 *  - every documentation example, item by item: drawn or not, kind, start,
 *    end, group (`docs-examples`);
 *  - the groups in vis-timeline's order, nested ones under their parent,
 *    hidden ones left out (`group-order`);
 *  - the edge cases — ISO shapes, offsets, ASP.NET and digit strings,
 *    RFC 2822, free text, a gap and a repeated hour — to the millisecond,
 *    whatever zone the test runs in (`edge-times`);
 *  - what does not carry over is a warning that names it (`warnings`);
 *  - options with an equivalent become that equivalent (`options`);
 *  - a reader that takes date-only strings as UTC, the way `Date.parse`
 *    does, disagrees with the vectors: they can tell (`negative-control`).
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { renderTimeline } from "../../src/render.js";
import { fromVis, fromVisItems, parseVisTime, visText } from "../../src/vis-compat/index.js";
import type { VisCompatConfig, VisGroup, VisItem } from "../../src/vis-compat/index.js";

interface Placed {
  readonly id: string;
  readonly kind: string | null;
  /** `null` where vis-timeline's time is invalid (NaN does not survive JSON). */
  readonly start: number | null;
  readonly end: number | null;
  readonly group: string | null;
  readonly drawn: boolean;
}
interface Vector {
  readonly page: string;
  readonly items: unknown;
  readonly itemsTruncated: boolean;
  readonly groups: unknown;
  readonly options: unknown;
  readonly vis: { readonly items: readonly Placed[]; readonly groupOrder: readonly string[] | null };
}
interface Vectors {
  readonly visTimeline: string;
  readonly timeZone: string;
  readonly vectors: readonly Vector[];
  readonly skipped: readonly { readonly page: string; readonly reason: string }[];
}

const here = dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(readFileSync(join(here, "vectors.json"), "utf8")) as Vectors;
const ZONE = data.timeZone;

/** The vectors' tagged values back as what the page had: Dates, moments, elements, functions. */
function untag(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(untag);
  if (value !== null && typeof value === "object") {
    const tagged = value as Record<string, unknown>;
    if ("$date" in tagged) return new Date(tagged.$date as number);
    if ("$moment" in tagged) {
      const ms = tagged.$moment as number;
      return { _isAMomentObject: true, valueOf: () => ms };
    }
    if ("$undefined" in tagged) return undefined;
    if ("$element" in tagged) return { outerHTML: tagged.$element, textContent: tagged.text };
    if ("$function" in tagged) {
      try {
        return new Function(`return (${String(tagged.$function)})`)() as unknown;
      } catch {
        return () => null;
      }
    }
    return Object.fromEntries(Object.entries(tagged).map(([key, each]) => [key, untag(each)]));
  }
  return value;
}

const sameTime = (ours: number | undefined, theirs: number | null | undefined): boolean => ours === (theirs ?? undefined);

/** Where an item differs from what vis-timeline did with it. */
function differences(config: VisCompatConfig, placed: Placed): string[] {
  const ours = config.items.find((item) => item.id === placed.id);
  // vis-timeline keeps an item it reads no start for, at NaN; a NaN would
  // stop a Temporeum frame, so the configuration leaves it out, with a warning.
  if (placed.start === null || (placed.kind === "range" && placed.end === null)) return ours === undefined ? [] : ["vis-timeline reads no time, the configuration has it"];
  if (!placed.drawn) return ours === undefined ? [] : ["vis-timeline does not draw it, the configuration has it"];
  if (ours === undefined) return ["vis-timeline draws it, the configuration has not"];
  const problems: string[] = [];
  const kind = ours.kind ?? "range";
  if (kind !== placed.kind) problems.push(`kind ${kind}, vis ${String(placed.kind)}`);
  if (!sameTime(ours.start as number, placed.start)) problems.push(`start ${String(ours.start)}, vis ${String(placed.start)}`);
  // A box or a point is drawn at its start: vis-timeline keeps the end in its data, and draws nothing of it.
  const end = placed.kind === "box" || placed.kind === "point" ? undefined : placed.end;
  if (!(end === undefined ? ours.end === undefined : sameTime(ours.end as number | undefined, end))) problems.push(`end ${String(ours.end)}, vis ${String(end)}`);
  const group = placed.kind === "background" && placed.group === null ? undefined : (placed.group ?? undefined);
  if (ours.laneId !== group) problems.push(`group ${String(ours.laneId)}, vis ${String(group)}`);
  return problems;
}

const convert = (vector: Vector, timeZone = ZONE): VisCompatConfig =>
  fromVis(untag(vector.items) as VisItem[], vector.groups === null ? null : (untag(vector.groups) as VisGroup[]), untag(vector.options) as Record<string, unknown>, { timeZone }).config;

const docs = data.vectors.filter((vector) => !vector.page.startsWith("edge/"));
const edges = data.vectors.filter((vector) => vector.page.startsWith("edge/"));

describe("G-COMPAT: vis-timeline's documentation examples through the compatibility layer", () => {
  it("[claim:docs-examples] the vectors are vis-timeline 8.5.6's, from enough of its examples", () => {
    expect(data.visTimeline).toBe("8.5.6");
    expect(docs.length).toBeGreaterThanOrEqual(80);
    expect(docs.reduce((sum, vector) => sum + vector.vis.items.length, 0)).toBeGreaterThanOrEqual(2000);
  });

  for (const vector of docs) {
    it(`[claim:docs-examples] ${vector.page}: every item drawn where vis-timeline draws it`, () => {
      const config = convert(vector);
      const problems = vector.vis.items.flatMap((placed) => differences(config, placed).map((problem) => `${placed.id}: ${problem}`));
      expect(problems).toEqual([]);
    });
  }

  it("[claim:group-order] every grouped example: the groups vis-timeline shows, in its order", () => {
    const grouped = docs.filter((vector) => vector.vis.groupOrder !== null);
    expect(grouped.length).toBeGreaterThanOrEqual(10);
    for (const vector of grouped) {
      const config = convert(vector);
      const ours = (config.groups ?? config.lanes ?? []).map((group) => group.id);
      expect(ours, vector.page).toEqual(vector.vis.groupOrder);
    }
  });

  it("[claim:group-order] nested groups name their parent; a hidden group and what is nested in it are left out", () => {
    const vector = edges.find((each) => each.vis.groupOrder !== null);
    expect(vector).toBeDefined();
    if (vector === undefined) return;
    const config = convert(vector);
    expect(config.groups?.map((group) => group.id)).toEqual(vector.vis.groupOrder);
    expect(config.groups?.find((group) => group.id === "121")?.parentId).toBe("12");
    expect(config.groups?.some((group) => group.id === "2" || group.id === "4" || group.id === "41")).toBe(false);
    expect(config.groups?.find((group) => group.id === "x")?.label).toBe("Ex");
  });

  it(`[claim:edge-times] the edge cases, to the millisecond, read in ${ZONE} whatever zone the runtime is in`, () => {
    expect(edges.length).toBeGreaterThanOrEqual(3);
    for (const vector of edges) {
      const config = convert(vector);
      const problems = vector.vis.items.flatMap((placed) => differences(config, placed).map((problem) => `${placed.id}: ${problem}`));
      expect(problems, vector.page).toEqual([]);
    }
  });

  for (const zone of ["UTC", "America/Los_Angeles", "Asia/Kolkata"]) {
    it(`[claim:edge-times] read in ${zone}, a wall clock moves with the zone; a time that names its offset does not`, () => {
      expect(parseVisTime("2026-03-02T10:15", { timeZone: zone })).toBe((parseVisTime("2026-03-02T10:15Z", { timeZone: zone }) as number) - offsetAt(zone));
      expect(parseVisTime("2026-03-02T10:15:30+05:30", { timeZone: zone })).toBe(Date.UTC(2026, 2, 2, 4, 45, 30));
      expect(parseVisTime("Mon, 02 Mar 2026 10:15:30 +0100", { timeZone: zone })).toBe(Date.UTC(2026, 2, 2, 9, 15, 30));
    });
  }

  it("[claim:edge-times] a gap takes the offset before it, a repeated hour the first pass — as new Date(y, m, d, h) does", () => {
    const gap = parseVisTime("2026-03-29T02:30", { timeZone: "Europe/Budapest" });
    expect(gap).toBe(Date.UTC(2026, 2, 29, 1, 30));
    const repeated = parseVisTime("2026-10-25T02:30", { timeZone: "Europe/Budapest" });
    expect(repeated).toBe(Date.UTC(2026, 9, 25, 0, 30));
    expect(parseVisTime("2014", {})).toBe(2014);
    expect(parseVisTime("/Date(1198908717056-0700)/")).toBe(1198908717056);
    expect(parseVisTime(undefined)).toBeUndefined();
    expect(parseVisTime(null)).toBeNull();
  });

  it("[claim:warnings] what does not carry over is named: subgroups, a hidden group, an item without its group, unknown options", () => {
    const { warnings } = fromVis(
      [
        { id: 1, start: "2026-03-02", group: "a", subgroup: "s" },
        { id: 2, start: "2026-03-02", group: "hidden" },
        { id: 3, start: "2026-03-02", group: "nowhere" },
        { id: 4, start: "2026-03-02" },
        { id: 5, start: "2026-03-02", type: "chevron" },
      ],
      [
        { id: "a", content: "A" },
        { id: "hidden", content: "H", visible: false },
      ],
      { orientation: "top", stackSubgroups: true, height: "50%", showCurrentTime: true, xss: { disabled: false } },
      { timeZone: "UTC" },
    );
    const named = warnings.map((warning) => warning.option);
    for (const option of ["items[0].subgroup", "groups[1].visible", "items[1].group", "items[2].group", "items[3].group", "items[4].type", "orientation", "stackSubgroups", "height", "showCurrentTime"]) {
      expect(named, option).toContain(option);
    }
    expect(named).not.toContain("xss");
    for (const warning of warnings) expect(warning.message.length).toBeGreaterThan(10);
  });

  it("[claim:options] options with an equivalent become it: window, limits, editing, stacking, direction, hidden dates, rolling, tooltips, markup", () => {
    const { config, warnings } = fromVis(
      [
        { id: "a", start: "2026-03-02", end: "2026-03-05", content: "<b>Build</b> &amp; ship", title: "The build" },
        { id: "b", start: "2026-03-06", editable: false, selectable: false },
      ],
      null,
      {
        start: "2026-03-01",
        end: "2026-04-01",
        min: "2026-01-01",
        max: "2026-12-31",
        zoomMin: 86_400_000,
        zoomMax: 31_536_000_000,
        height: "320px",
        stack: false,
        moveable: false,
        editable: { updateTime: true, updateGroup: true, add: true, remove: true },
        multiselect: true,
        rtl: true,
        locale: "nl",
        hiddenDates: [{ start: "2026-03-07 00:00:00", end: "2026-03-09 00:00:00", repeat: "weekly" }],
        rollingMode: { follow: true, offset: 0.25 },
        cluster: true,
      },
      { timeZone: "UTC" },
    );
    expect(warnings).toEqual([]);
    expect(config.domain).toEqual([Date.UTC(2026, 2, 1), Date.UTC(2026, 3, 1)]);
    expect(config.limits).toEqual({ min: Date.UTC(2026, 0, 1), max: Date.UTC(2026, 11, 31), minSpanMs: 86_400_000, maxSpanMs: 31_536_000_000 });
    expect(config.height).toBe(320);
    expect(config.packMode).toBe("overlap");
    expect(config.interactions).toEqual({ pan: false });
    expect(config.editing).toEqual({ enabled: true, crossLane: true, add: true, remove: true, multiSelect: true });
    expect(config.direction).toBe("rtl");
    expect(config.locale).toBe("nl");
    expect(config.timeZone).toBe("UTC");
    expect(config.hiddenDates).toEqual([{ start: Date.UTC(2026, 2, 7), end: Date.UTC(2026, 2, 9), repeat: "weekly" }]);
    expect(config.rolling).toEqual({ offset: 0.25 });
    expect(config.cluster).toBe(true);
    const [a, b] = config.items;
    expect(a?.label).toBe("Build & ship");
    expect(a !== undefined && config.template?.(a)).toBe("<b>Build</b> &amp; ship");
    expect(a !== undefined && config.tooltip?.(a)).toBe("The build");
    expect(b).toMatchObject({ id: "b", kind: "box", movable: false, resizable: false, removable: false, selectable: false });
    expect(a?.data).toMatchObject({ id: "a", title: "The build" });
    expect(visText({ textContent: "  from an element " })).toBe("from an element");
  });

  it("[claim:options] a DataSet is read with its get(), and items without an id get one, with a warning", () => {
    const set = { get: () => [{ start: 0, content: "first" }, { id: 7, start: 1, end: 2 }] };
    const { config, warnings } = fromVis(set, null, {}, { timeZone: "UTC" });
    expect(config.items.map((item) => item.id)).toEqual(["vis-1", "7"]);
    expect(warnings.map((warning) => warning.option)).toEqual(["items[0].id"]);
  });

  it("[claim:negative-control] a reader that takes date-only strings as UTC disagrees with vis-timeline on the examples", () => {
    let disagreements = 0;
    for (const vector of docs) {
      const raw = untag(vector.items) as VisItem[];
      for (const placed of vector.vis.items) {
        const item = raw.find((each) => String(each.id) === placed.id);
        if (item === undefined || typeof item.start !== "string" || !placed.drawn) continue;
        const naive = Date.parse(item.start);
        if (naive !== placed.start) disagreements += 1;
      }
    }
    expect(disagreements).toBeGreaterThan(100);
  });
});

describe("the compatibility layer at its edges", () => {
  it("reads moment's other ISO shapes — ordinal and week dates, a year and a month, an hour alone — and rejects what moment rejects", () => {
    const utc = (text: string): number | null | undefined => parseVisTime(text, { timeZone: "UTC" });
    expect(utc("2026-060")).toBe(Date.UTC(2026, 2, 1));
    expect(utc("2024-366")).toBe(Date.UTC(2024, 11, 31));
    expect(utc("2000-366")).toBe(Date.UTC(2000, 11, 31));
    expect(utc("2026-366")).toBeNaN();
    expect(utc("1900-366")).toBeNaN();
    expect(utc("2026-W10-1")).toBe(Date.UTC(2026, 2, 2));
    expect(utc("2026-W10")).toBe(Date.UTC(2026, 2, 2));
    expect(utc("2026W101")).toBe(Date.UTC(2026, 2, 2));
    expect(utc("2026-W10-0")).toBeNaN();
    expect(utc("2026-W54")).toBeNaN();
    expect(utc("2026-W10T10:00")).toBeNaN();
    expect(utc("2026-03")).toBe(Date.UTC(2026, 2, 1));
    expect(utc("2026-13")).toBeNaN();
    expect(utc(" 2026")).toBe(Date.UTC(2026, 0, 1));
    expect(utc("2026-03-02T10")).toBe(Date.UTC(2026, 2, 2, 10));
  });

  it("reads RFC 2822 the way moment does — short years, zone names, a wrong weekday or day is invalid — and free text with its own zone as it says", () => {
    expect(parseVisTime("Mon, 02 Mar 26 10:15:30 +0100")).toBe(Date.UTC(2026, 2, 2, 9, 15, 30));
    expect(parseVisTime("Thu, 02 Mar 95 10:15 GMT")).toBe(Date.UTC(1995, 2, 2, 10, 15));
    expect(parseVisTime("02 Mar 126 10:15 Z")).toBe(Date.UTC(2026, 2, 2, 10, 15));
    expect(parseVisTime("02 Mar 2026 10:00 EST")).toBe(Date.UTC(2026, 2, 2, 15));
    expect(parseVisTime("02 Mar 2026 10:00 -0430")).toBe(Date.UTC(2026, 2, 2, 14, 30));
    expect(parseVisTime("31 Feb 2026 10:00 GMT")).toBeNaN();
    expect(parseVisTime("Tue, 02 Mar 2026 10:00 GMT")).toBeNaN();
    expect(parseVisTime("March 2, 2026 10:15 GMT", { timeZone: "Asia/Tokyo" })).toBe(Date.UTC(2026, 2, 2, 10, 15));
    expect(parseVisTime("not a date", { timeZone: "Asia/Tokyo" })).toBeNaN();
    expect(parseVisTime({ valueOf: () => Number.NaN })).toBeNaN();
    expect(parseVisTime(true as never)).toBeNaN();
  });

  it("names the rest of what does not carry over, and maps the rest of what does", () => {
    const { config, warnings } = fromVis(
      [
        { id: "a", start: "2026-03-02", end: "2026-03-05", title: "A", style: "color: red", align: "left" },
        { id: "b", type: "range", start: "2026-03-03" },
        { id: "c", end: "2026-03-04" } as unknown as VisItem,
      ],
      null,
      {
        start: "2026-03-01",
        zoomable: false,
        editable: true,
        hiddenDates: { start: "2026-03-07", end: "2026-03-09", repeat: "hourly" },
        rollingMode: { follow: true },
        cluster: { maxItems: 3 },
        showTooltips: false,
        groupOrder: 5,
      },
      { timeZone: "UTC" },
    );
    expect(warnings.map((warning) => warning.option)).toEqual(["items[0].style", "items[0].align", "items[1].end", "items[2].start", "start", "hiddenDates[0].repeat", "cluster"]);
    expect(config.items.map((item) => item.id)).toEqual(["a", "b"]);
    expect(config.items[1]?.end).toBeUndefined();
    expect(config.items[0]).not.toHaveProperty("movable");
    expect(config.domain).toBeUndefined();
    expect(config.interactions).toEqual({ zoom: false });
    expect(config.editing).toEqual({ enabled: true, crossLane: true, add: true, remove: true });
    expect(config.hiddenDates).toEqual([{ start: Date.UTC(2026, 2, 7), end: Date.UTC(2026, 2, 9) }]);
    expect(config.rolling).toBe(true);
    expect(config.cluster).toBe(true);
    expect(config.tooltip).toBeUndefined();
    expect(fromVis([], null, { end: "2026-03-01" }, { timeZone: "UTC" }).warnings.map((warning) => warning.option)).toEqual(["end"]);
    expect(fromVis([], null, { multiselect: true }).config.editing).toEqual({ multiSelect: true });
    expect(fromVisItems(null as never).config.items).toEqual([]);
  });

  it("leaves out an item with a time vis-timeline cannot read either, so one bad row does not stop the timeline (M3)", () => {
    const { config, warnings } = fromVis(
      [
        { id: "good", start: "2026-03-02", end: "2026-03-05" },
        { id: "start", start: "the second of March" },
        { id: "end", type: "range", start: "2026-03-02", end: "2026-02-30T25:00" },
        { id: "box", type: "box", start: "2026-03-03", end: "never" },
      ],
      null,
      { start: "soon", end: "2026-03-09", min: "dawn", hiddenDates: [{ start: "x", end: "2026-03-08" }] },
      { timeZone: "UTC" },
    );
    expect(config.items.map((item) => item.id)).toEqual(["good", "box"]);
    for (const item of config.items) {
      expect(Number.isFinite(item.start)).toBe(true);
      if (item.end !== undefined) expect(Number.isFinite(item.end)).toBe(true);
    }
    expect(warnings.map((warning) => warning.option)).toEqual(["items[1].start", "items[2].end", "start", "min", "hiddenDates[0].start"]);
    expect(warnings[0]?.message).toMatch(/is not a time vis-timeline reads either; the item is left out\.$/);
    expect(warnings[2]?.message).toMatch(/the view fits the items\.$/);
    expect(config.domain).toBeUndefined();
    expect(config.limits).toBeUndefined();
    expect(config.hiddenDates).toEqual([]);
    // The converted configuration draws.
    expect(() => renderTimeline({ items: config.items, domain: [Date.UTC(2026, 2, 1), Date.UTC(2026, 2, 9)], width: 800, height: 200 })).not.toThrow();
  });

  it("takes editable: true for every right vis-timeline gives it, adding items included (M11)", () => {
    expect(fromVis([], null, { editable: true }).config.editing).toEqual({ enabled: true, crossLane: true, add: true, remove: true });
    expect(fromVis([], null, { editable: { add: false, updateTime: true } }).config.editing).toEqual({ enabled: true });
    expect(fromVis([], null, { editable: false }).config.editing).toBeUndefined();
  });

  it("groups without a name, a nested group's class and style, an element without text", () => {
    const flat = fromVis([{ id: 1, start: 0, group: "x" }], [{ id: "x" }], {}, { timeZone: "UTC" });
    expect(flat.config.lanes).toEqual([{ id: "x" }]);
    const nested = fromVis(
      [{ id: 1, start: 0, group: "c" }],
      [
        { id: "p", content: "P", nestedGroups: ["c"], className: "team" },
        { id: "c", style: "color: red" },
      ],
      {},
      { timeZone: "UTC" },
    );
    expect(nested.config.groups).toEqual([
      { id: "p", label: "P", className: "team" },
      { id: "c", parentId: "p" },
    ]);
    expect(nested.warnings.map((warning) => warning.option)).toEqual(["groups[1].style"]);
    expect(visText({ outerHTML: "<b>x</b>" } as never)).toBe("");
  });

  it("a tooltip template and an item template are called with the vis-timeline item; what is not text is no text", () => {
    const { config, warnings } = fromVis(
      [
        { id: "a", start: 0, content: "A" },
        { id: "b", start: 1, content: "B" },
        { id: "c", start: 2, content: "C" },
      ],
      null,
      {
        tooltip: { template: (data: { id: string }) => (data.id === "a" ? "tip" : 3) },
        template: (data: { id: string }) => (data.id === "a" ? "<i>A</i>" : data.id === "b" ? { outerHTML: "<b>B</b>" } : null),
      },
      { timeZone: "UTC" },
    );
    expect(warnings).toEqual([]);
    const [a, b, c] = config.items;
    expect(a !== undefined && config.tooltip?.(a)).toBe("tip");
    expect(b !== undefined && config.tooltip?.(b)).toBeNull();
    expect(a !== undefined && config.template?.(a)).toBe("<i>A</i>");
    expect(b !== undefined && config.template?.(b)).toBe("<b>B</b>");
    expect(c !== undefined && config.template?.(c)).toBeNull();
  });
});

/** A zone's offset on 2026-03-02, for the same-wall-clock check. */
function offsetAt(zone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(Date.UTC(2026, 2, 2, 10, 15));
  const get = (type: string): number => Number(parts.find((part) => part.type === type)?.value);
  return Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute")) - Date.UTC(2026, 2, 2, 10, 15);
}
