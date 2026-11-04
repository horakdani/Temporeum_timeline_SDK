import { describe, expect, it } from "vitest";

import { describeItem, describeSpan, itemDomId } from "../../src/a11y.js";
import { renderTimeline } from "../../src/render.js";
import type { RenderOptions } from "../../src/render.js";
import type { SceneElement } from "../../src/scene.js";
import { planSceneSpace } from "../../src/scene-space.js";
import type { Item } from "../../src/types.js";

/**
 * What a frame tells assistive technology.
 *
 * An interactive frame is a listbox of options. The checks below are the
 * contract a screen reader relies on, stated against the scene the renderer
 * returns — the same object the DOM mount writes, so nothing here depends on
 * a browser. `axe` checks the result in a real one (the axe check).
 */

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 1);

const ITEMS: Item[] = [
  { id: "a", start: T0, end: T0 + 4 * DAY, label: "Planning", laneId: "work" },
  { id: "b", start: T0 + 3 * DAY, end: T0 + 9 * DAY, label: "Building", laneId: "work" },
  { id: "c", start: T0 + 10 * DAY, label: "Milestone", laneId: "ship" },
  { id: "far", start: T0 + 400 * DAY, end: T0 + 401 * DAY, label: "Far away", laneId: "ship" },
];
const LANES = [{ id: "work", label: "Work" }, { id: "ship" }];

function render(options: Partial<RenderOptions> = {}): ReturnType<typeof renderTimeline> {
  return renderTimeline({
    items: ITEMS,
    lanes: LANES,
    domain: [T0 - DAY, T0 + 29 * DAY],
    width: 900,
    height: 240,
    ...options,
  });
}

function all(node: SceneElement, keep: (node: SceneElement) => boolean, into: SceneElement[] = []): SceneElement[] {
  if (keep(node)) {
    into.push(node);
  }
  for (const child of node.children ?? []) {
    all(child, keep, into);
  }
  return into;
}

function layer(scene: SceneElement, name: string): SceneElement {
  const found = scene.children?.find((child) => child.attrs?.class === `tl-layer tl-layer--${name}`);
  if (found === undefined) {
    throw new Error(`no layer ${name}`);
  }
  return found;
}

const options = (scene: SceneElement): SceneElement[] => all(scene, (node) => node.attrs?.role === "option");

describe("an interactive frame", () => {
  it("is one focus stop, a listbox named and oriented for the reader", () => {
    const { scene } = render({ ariaLabel: "Project" });
    expect(scene.attrs).toMatchObject({ role: "listbox", tabindex: 0, "aria-label": "Project", "aria-orientation": "horizontal" });
    expect(scene.attrs?.["aria-multiselectable"]).toBeUndefined();
    expect(render({ multiSelect: true }).scene.attrs?.["aria-multiselectable"]).toBe("true");
    expect(render({ orientation: "vertical" }).scene.attrs?.["aria-orientation"]).toBe("vertical");
    // Nothing else in the frame takes focus.
    expect(all(scene, (node) => node !== scene && node.attrs?.tabindex !== undefined)).toEqual([]);
  });

  it("makes every drawn item an option with a unique id, a name with its dates, and its place among all items", () => {
    const { scene } = render({ selectedIds: ["b"] });
    const drawn = options(scene);
    // Culled: the far item is not in the document, but it still counts.
    expect(drawn.map((node) => node.attrs?.["data-tl-id"])).toEqual(["a", "b", "c"]);
    expect(new Set(drawn.map((node) => node.attrs?.id)).size).toBe(3);
    expect(drawn.map((node) => node.attrs?.["aria-setsize"])).toEqual([4, 4, 4]);
    expect(drawn.map((node) => node.attrs?.["aria-posinset"])).toEqual([1, 2, 3]);
    expect(drawn.map((node) => node.attrs?.["aria-selected"])).toEqual(["false", "true", "false"]);
    expect(drawn[0]?.attrs?.["aria-label"]).toBe("Planning, Jan 1, 2026 – Jan 5, 2026, Work");
    expect(drawn[2]?.attrs?.["aria-label"]).toBe("Milestone, Jan 11, 2026");
    // The tooltip says the same, so nothing is read twice.
    expect(drawn[0]?.children?.[0]).toEqual({ tag: "title", text: "Planning, Jan 1, 2026 – Jan 5, 2026, Work" });
  });

  it("hides everything that repeats or decorates what the items say", () => {
    const { scene } = render();
    for (const name of ["background", "axis", "lanes", "labels", "foreground", "overlay"]) {
      expect(layer(scene, name).attrs?.["aria-hidden"]).toBe("true");
    }
    expect(layer(scene, "items").attrs?.role).toBe("none");
    expect(scene.children?.find((child) => child.attrs?.class === "tl-surface")?.attrs?.["aria-hidden"]).toBe("true");
  });

  it("points at the keyboard's item, and rings it — only while it is drawn", () => {
    const focused = render({ focusedId: "b" });
    const item = options(focused.scene).find((node) => node.attrs?.["data-tl-id"] === "b");
    expect(focused.scene.attrs?.["aria-activedescendant"]).toBe(item?.attrs?.id);
    const rings = all(layer(focused.scene, "overlay"), (node) => node.attrs?.class === "tl-focus-ring");
    expect(rings).toHaveLength(1);
    const ring = rings[0]?.attrs ?? {};
    const box = item?.attrs ?? {};
    // Around the item, clear of its outline.
    expect(Number(ring.x)).toBeLessThan(Number(box.x));
    expect(Number(ring.y)).toBeLessThan(Number(box.y));
    expect(Number(ring.x) + Number(ring.width)).toBeGreaterThan(Number(box.x) + Number(box.width));
    expect(Number(ring.y) + Number(ring.height)).toBeGreaterThan(Number(box.y) + Number(box.height));
    // Culled: no dangling reference, no ring.
    const culled = render({ focusedId: "far" });
    expect(culled.scene.attrs?.["aria-activedescendant"]).toBeUndefined();
    expect(all(culled.scene, (node) => node.attrs?.class === "tl-focus-ring")).toEqual([]);
    expect(render({ focusedId: null }).scene.attrs?.["aria-activedescendant"]).toBeUndefined();
  });

  it("makes an item drawn by a hook an option too, and lets the hook's own attributes win", () => {
    const { scene } = render({
      hooks: {
        renderItem: (context) => ({ tag: "circle", attrs: { "data-tl-id": context.placed.item.id, "aria-label": `custom ${context.placed.item.id}` } }),
        describeItem: (placed) => `described ${placed.item.id}`,
      },
    });
    const drawn = options(scene);
    expect(drawn.map((node) => node.tag)).toEqual(["circle", "circle", "circle"]);
    expect(drawn[0]?.attrs?.["aria-label"]).toBe("custom a");
    const described = render({ hooks: { describeItem: (placed) => `described ${placed.item.id}` } });
    expect(options(described.scene)[1]?.attrs?.["aria-label"]).toBe("described b");
  });

  it("keeps the ids apart for two timelines that say who they are", () => {
    const one = options(render({ instanceId: "one" }).scene)[0]?.attrs?.id;
    const two = options(render({ instanceId: "two" }).scene)[0]?.attrs?.id;
    expect(one).toBe("one-i-a");
    expect(two).toBe("two-i-a");
  });

  it("says the same in a stable space, tiles and all", () => {
    const view = { domain: [T0 - DAY, T0 + 29 * DAY] as const, mainSize: 900 };
    const space = planSceneSpace(undefined, view, { settle: true });
    const { scene } = render({ space, focusedId: "a", selectedIds: ["a"] });
    const tiles = all(scene, (node) => node.attrs?.class === "tl-tile" && node.attrs["role"] === "none");
    expect(tiles.length).toBeGreaterThan(0);
    const drawn = options(scene);
    expect(drawn.map((node) => node.attrs?.["data-tl-id"])).toEqual(["a", "b", "c"]);
    expect(drawn[0]?.attrs?.["aria-selected"]).toBe("true");
    expect(scene.attrs?.["aria-activedescendant"]).toBe("tl-i-a");
    expect(all(layer(scene, "overlay"), (node) => node.attrs?.class === "tl-focus-ring")).toHaveLength(1);
    // A new locale is a new name on every item, not a stale tile: the same
    // frame twice, only the locale differs.
    const english = render({ space, focusedId: "a", selectedIds: ["a"], locale: "en" });
    expect(options(english.scene)[0]?.attrs?.["aria-label"]).toMatch(/^Planning, Jan 1, 2026/);
    const hungarian = render({ space, focusedId: "a", selectedIds: ["a"], locale: "hu" });
    expect(options(hungarian.scene)[0]?.attrs?.["aria-label"]).toMatch(/^Planning, 2026\. jan\. 1\./);
  });

  // This contract changed: an empty frame used to be a listbox too.
  // A listbox with no option is not one anybody can choose from, and axe
  // cannot decide it (aria-required-children) — a state the async page
  // reaches whenever a window fails. The root stays the one focus stop.
  it("gives an empty frame the same root element and focus stop, as a group with nothing to choose", () => {
    const empty = render({ width: 0, ariaLabel: "Project" });
    expect(empty.scene.attrs).toMatchObject({ role: "group", tabindex: 0, "aria-label": "Project" });
    expect(empty.scene.attrs?.["aria-orientation"]).toBeUndefined();
    expect(empty.scene.attrs?.["aria-activedescendant"]).toBeUndefined();
    expect(empty.scene.children?.filter((child) => child.attrs?.["aria-hidden"] === "true")).toHaveLength(7);
  });

  it("is a focusable group while no option is drawn, and a listbox again as soon as one is", () => {
    const none = render({ items: [], ariaLabel: "Project", multiSelect: true });
    expect(none.scene.attrs).toMatchObject({ role: "group", tabindex: 0, "aria-label": "Project" });
    expect(none.scene.attrs?.["aria-multiselectable"]).toBeUndefined();
    // Panned to a stretch with nothing in it.
    const away = render({ domain: [T0 + 900 * DAY, T0 + 930 * DAY], focusedId: "a" });
    expect(options(away.scene)).toEqual([]);
    expect(away.scene.attrs).toMatchObject({ role: "group", tabindex: 0 });
    // Through a scene space, where the options sit inside tile groups.
    const domain: readonly [number, number] = [T0, T0 + 30 * DAY];
    const space = planSceneSpace(undefined, { domain, mainSize: 800 });
    expect(render({ space }).scene.attrs?.role).toBe("listbox");
    // A hook that draws nothing leaves nothing to choose either.
    expect(render({ hooks: { renderItem: () => null } }).scene.attrs?.role).toBe("group");
    expect(render().scene.attrs?.role).toBe("listbox");
  });
});

describe("a frame that is only an image", () => {
  it("is a named group with no focus stop and no options", () => {
    const { scene } = render({ interactive: false, focusedId: "a" });
    expect(scene.attrs).toMatchObject({ role: "group", "aria-label": "Timeline" });
    expect(scene.attrs?.tabindex).toBeUndefined();
    expect(options(scene)).toEqual([]);
    expect(all(scene, (node) => node.attrs?.["aria-hidden"] !== undefined)).toEqual([]);
    expect(all(scene, (node) => node.attrs?.class === "tl-focus-ring")).toEqual([]);
  });
});

describe("accessible names", () => {
  const span = (start: number, end: number, open = false) => ({ start, end, open });

  it("gives a time of day only when it carries information", () => {
    const item: Item = { id: "x", start: T0 + 9 * 3_600_000, end: T0 + 17 * 3_600_000 };
    expect(describeSpan(item, span(T0 + 9 * 3_600_000, T0 + 17 * 3_600_000), "en", "UTC")).toBe(
      "Jan 1, 2026, 9:00 AM – Jan 1, 2026, 5:00 PM",
    );
    const day: Item = { id: "d", start: T0 + 9 * 3_600_000, granularity: "day" };
    expect(describeSpan(day, span(T0, T0 + DAY), "en", "UTC")).toBe("Jan 1, 2026");
    const minute: Item = { id: "m", start: T0, granularity: "minute" };
    expect(describeSpan(minute, span(T0, T0 + 60_000), "en", "UTC")).toBe("Jan 1, 2026, 12:00 AM");
    const odd: Item = { id: "o", start: T0 + 1 };
    expect(describeSpan(odd, span(T0 + 1, T0 + 1), "en", "UTC")).toBe("Jan 1, 2026, 12:00 AM");
  });

  it("names the last day a date-granular item covers, not the day after it", () => {
    // Known to the day, Jan 1 to Jan 3: the span runs to the start of Jan 4.
    const days: Item = { id: "d3", start: T0, end: T0 + 2 * DAY, granularity: "day" };
    expect(describeSpan(days, span(T0, T0 + 3 * DAY), "en", "UTC")).toBe("Jan 1, 2026 – Jan 3, 2026");
    // One day, given as its own start and end: one date.
    const one: Item = { id: "d1", start: T0, end: T0, granularity: "day" };
    expect(describeSpan(one, span(T0, T0 + DAY), "en", "UTC")).toBe("Jan 1, 2026");
    const months: Item = { id: "m", start: T0, end: Date.UTC(2026, 2, 1), granularity: "month" };
    expect(describeSpan(months, span(T0, Date.UTC(2026, 3, 1)), "en", "UTC")).toBe("Jan 1, 2026 – Mar 31, 2026");
    // An hour is a time of day: 10 to 11 is what a reader says.
    const hour: Item = { id: "h", start: T0 + 10 * 3_600_000, end: T0 + 10 * 3_600_000, granularity: "hour" };
    expect(describeSpan(hour, span(T0 + 10 * 3_600_000, T0 + 11 * 3_600_000), "en", "UTC")).toBe("Jan 1, 2026, 10:00 AM – Jan 1, 2026, 11:00 AM");
  });

  it("tells a midnight in UTC without Intl, as Intl does", () => {
    // The UTC midnight is arithmetic. The same zone under another name
    // still goes through Intl: both must say the same, before 1970 too.
    const times = [T0, T0 + 1, T0 + 1000, T0 - DAY, Date.UTC(1969, 11, 31), Date.UTC(1969, 11, 31, 23, 59, 59), -1, 0];
    for (const start of times) {
      for (const end of [start, start + DAY, start + DAY + 3_600_000]) {
        const item: Item = { id: "t", start, end };
        expect(describeSpan(item, span(start, end), "en", "UTC")).toBe(describeSpan(item, span(start, end), "en", "Etc/UTC"));
      }
    }
  });

  it("writes an open interval as a start and a dash, in the host's zone", () => {
    const item: Item = { id: "o", start: T0, open: true };
    expect(describeSpan(item, span(T0, T0 + 30 * DAY, true), "en", "UTC")).toBe("Jan 1, 2026 –");
    // Midnight in UTC is one in the morning in Budapest: a time is worth saying.
    expect(describeSpan({ id: "z", start: T0, end: T0 + DAY }, span(T0, T0 + DAY), "en", "Europe/Budapest")).toBe(
      "Jan 1, 2026, 1:00 AM – Jan 2, 2026, 1:00 AM",
    );
  });

  it("is cached per item, and rebuilt when the locale or the lane's label changes", () => {
    const item: Item = { id: "c", start: T0, label: "C" };
    const first = describeItem(item, span(T0, T0), undefined, "en", "UTC");
    expect(describeItem(item, span(T0, T0), undefined, "en", "UTC")).toBe(first);
    expect(describeItem(item, span(T0, T0), "Lane", "en", "UTC")).toBe("C, Jan 1, 2026, Lane");
    expect(describeItem(item, span(T0, T0), "", "hu", "UTC")).toMatch(/^C, 2026\. jan\. 1\.$/);
  });

  it("makes a document id of any item id, never the same for two", () => {
    expect(itemDomId("tl", "plain-id_1")).toBe("tl-i-plain-id_1");
    const ids = ["a b", "a.20.b", "a/b", "á", "a.", "a.2e."];
    const mapped = ids.map((id) => itemDomId("tl", id));
    expect(new Set(mapped).size).toBe(ids.length);
    for (const id of mapped) {
      expect(id).toMatch(/^[A-Za-z0-9_.-]+$/);
    }
  });
});

describe("accessible names before year 1", () => {
  // 15 March 44 BC (the Ides), as a proleptic Gregorian instant.
  const IDES = new Date(Date.UTC(2000, 2, 15)).setUTCFullYear(-43);

  it("say the era, so 44 BC is not read as AD 44", () => {
    const item: Item = { id: "ides", start: IDES, label: "Caesar", granularity: "day", laneId: "a" };
    const name = describeSpan(item, { start: IDES, end: IDES, open: false }, "en", "UTC");
    expect(name).toMatch(/BC/);
    expect(name).toMatch(/44/);
  });

  it("give a range its era on the end that needs it, and leave AD dates alone", () => {
    const adEnd = new Date(0).setUTCFullYear(14, 7, 19);
    const item: Item = { id: "r", start: IDES, end: adEnd, label: "Principate", granularity: "day", laneId: "a" };
    const name = describeSpan(item, { start: IDES, end: adEnd, open: false }, "en", "UTC");
    expect(name).toMatch(/BC .* 14$/);
    const modern = describeSpan({ id: "m", start: T0, label: "Now", laneId: "a" }, { start: T0, end: T0, open: false }, "en", "UTC");
    expect(modern).not.toMatch(/BC|AD/);
  });
});
