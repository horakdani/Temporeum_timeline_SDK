import { describe, expect, it } from "vitest";

import { DENSITIES, densityMetrics } from "../src/density.js";
import { containerExtents } from "../src/geometry.js";
import { renderTimeline } from "../src/render.js";
import {
  DEFAULT_BREAKPOINT,
  DENSITY_HYSTERESIS,
  fitDensity,
  ORIENTATION_HYSTERESIS,
  placePopover,
  resolveDensity,
  resolveDetailSurface,
  resolveOrientation,
} from "../src/responsive.js";
import type { DensityFitInput } from "../src/responsive.js";
import type { Density, Item, Lane, Orientation } from "../src/types.js";
import { describeBothOrientations } from "./orientation.js";

const DAY = 86_400_000;
const START = Date.UTC(2026, 0, 1);
/** 600 px of main axis over 30 days: twenty pixels to the day. */
const DOMAIN = [START, START + 30 * DAY] as const;
const MAIN = 600;

describe("orientation: auto", () => {
  it("is horizontal at and above the breakpoint, vertical below it", () => {
    expect(DEFAULT_BREAKPOINT).toBe(640);
    expect(resolveOrientation("auto", 375)).toBe("vertical");
    expect(resolveOrientation("auto", 639)).toBe("vertical");
    expect(resolveOrientation("auto", 640)).toBe("horizontal");
    expect(resolveOrientation("auto", 1440)).toBe("horizontal");
    expect(resolveOrientation(undefined, 375)).toBe("vertical");
  });

  it("an explicit setting beats the measurement", () => {
    expect(resolveOrientation("vertical", 1440)).toBe("vertical");
    expect(resolveOrientation("horizontal", 375)).toBe("horizontal");
  });

  it("honours a host breakpoint", () => {
    expect(resolveOrientation("auto", 700, { breakpoint: 800 })).toBe("vertical");
    expect(resolveOrientation("auto", 800, { breakpoint: 800 })).toBe("horizontal");
  });

  it("keeps a horizontal timeline inside the hysteresis band", () => {
    const edge = DEFAULT_BREAKPOINT - ORIENTATION_HYSTERESIS;
    expect(resolveOrientation("auto", edge, { previous: "horizontal" })).toBe("horizontal");
    expect(resolveOrientation("auto", edge - 1, { previous: "horizontal" })).toBe("vertical");
    // The way back is the plain breakpoint: the band is on one side only.
    expect(resolveOrientation("auto", 639, { previous: "vertical" })).toBe("vertical");
    expect(resolveOrientation("auto", 640, { previous: "vertical" })).toBe("horizontal");
    expect(resolveOrientation("auto", 630, { previous: "horizontal", hysteresis: 0 })).toBe(
      "vertical",
    );
  });

  it("does not oscillate when its own scrollbar takes the width away", () => {
    // A host whose horizontal layout is the taller one: horizontal brings a
    // page scrollbar and leaves 633 px, vertical removes it and gives 650
    // back. Without the band this is a ResizeObserver loop.
    const widthUnder = (orientation: Orientation) => (orientation === "horizontal" ? 633 : 650);
    const run = (hysteresis?: number): Orientation[] => {
      let orientation = resolveOrientation("auto", 650);
      const seen: Orientation[] = [orientation];
      for (let frame = 0; frame < 4; frame += 1) {
        orientation = resolveOrientation("auto", widthUnder(orientation), {
          previous: orientation,
          ...(hysteresis === undefined ? {} : { hysteresis }),
        });
        seen.push(orientation);
      }
      return seen;
    };
    expect(run()).toEqual(["horizontal", "horizontal", "horizontal", "horizontal", "horizontal"]);
    // The same host without the band does flip — the test is not vacuous.
    expect(run(0)).toEqual(["horizontal", "vertical", "horizontal", "vertical", "horizontal"]);
  });

  it("a container with no width keeps what is on screen", () => {
    expect(resolveOrientation("auto", 0)).toBe("horizontal");
    expect(resolveOrientation("auto", 0, { previous: "vertical" })).toBe("vertical");
    expect(resolveOrientation("auto", Number.NaN, { previous: "vertical" })).toBe("vertical");
  });
});

const LANES: readonly Lane[] = [{ id: "l1" }, { id: "l2" }];

/** Items of one length, two per lane, packed into one sublane each. */
function itemsOfLength(days: number): Item[] {
  return [
    { id: "a", start: START + 1 * DAY, end: START + (1 + days) * DAY, laneId: "l1" },
    { id: "b", start: START + 12 * DAY, end: START + (12 + days) * DAY, laneId: "l1" },
    { id: "c", start: START + 2 * DAY, end: START + (2 + days) * DAY, laneId: "l2" },
    { id: "d", start: START + 20 * DAY, end: START + (20 + days) * DAY, laneId: "l2" },
  ];
}

function sizeFor(orientation: Orientation, crossSize: number): { width: number; height: number } {
  return orientation === "horizontal"
    ? { width: MAIN, height: crossSize }
    : { width: crossSize, height: MAIN };
}

function fit(
  orientation: Orientation,
  overrides: Partial<DensityFitInput> & { readonly cross?: number } = {},
) {
  const { cross, ...rest } = overrides;
  return fitDensity({
    items: itemsOfLength(4),
    lanes: LANES,
    domain: DOMAIN,
    orientation,
    ...sizeFor(orientation, cross ?? 5000),
    ...rest,
  });
}

describeBothOrientations("density: auto", (orientation) => {
  const room = (density: Density) => densityMetrics(density, orientation).autoMainRoom;
  /** Days an item needs to be `px` long on this axis. */
  const days = (px: number) => px / 20;

  it("needs exactly the cross extent the renderer reports, at every level", () => {
    const items = itemsOfLength(4);
    const result = fit(orientation, { items });
    for (const density of DENSITIES) {
      const frame = renderTimeline({
        items,
        lanes: LANES,
        domain: DOMAIN,
        ...sizeFor(orientation, 400),
        orientation,
        density,
      });
      expect(result.contentCrossSize[density], density).toBe(frame.contentCrossSize);
    }
  });

  it("across the lanes: the coarsest level that fits the container", () => {
    const needs = fit(orientation).contentCrossSize;
    expect(fit(orientation, { cross: needs.comfortable }).byCross).toBe("comfortable");
    expect(fit(orientation, { cross: needs.comfortable - 1 }).byCross).toBe("compact");
    expect(fit(orientation, { cross: needs.compact - 1 }).byCross).toBe("dense");
    // Nothing fits: dense, and the lanes scroll.
    expect(fit(orientation, { cross: needs.dense - 1 }).byCross).toBe("dense");
  });

  it("along time: the typical item's length against each level's room", () => {
    const at = (px: number) => fit(orientation, { items: itemsOfLength(days(px)) });
    expect(at(room("comfortable")).byMain).toBe("comfortable");
    expect(at(room("comfortable") - 2).byMain).toBe("compact");
    expect(at(room("compact")).byMain).toBe("compact");
    expect(at(room("compact") - 2).byMain).toBe("dense");
    expect(at(room("comfortable")).typicalMainSize).toBeCloseTo(room("comfortable"), 6);
  });

  it("the denser criterion wins", () => {
    const needs = fit(orientation).contentCrossSize;
    const short = itemsOfLength(days(room("compact")));
    const both = fit(orientation, { items: short, cross: needs.comfortable });
    expect(both.byCross).toBe("comfortable");
    expect(both.byMain).toBe("compact");
    expect(both.density).toBe("compact");
    const tight = fit(orientation, { cross: needs.compact - 1 });
    expect(tight.byMain).toBe("comfortable");
    expect(tight.density).toBe("dense");
  });

  it("uses the median, so one instant among long items does not take the labels", () => {
    const items: Item[] = [
      ...itemsOfLength(days(room("comfortable") + 20)),
      { id: "moment", start: START + 9 * DAY, laneId: "l1" },
    ];
    expect(fit(orientation, { items }).byMain).toBe("comfortable");
  });

  it("measures only what is visible, clipped to the domain", () => {
    const items: Item[] = [
      // Entirely before the window: not counted.
      { id: "gone", start: START - 10 * DAY, end: START - 9 * DAY, laneId: "l1" },
      // Straddles the start: counts with its visible part only.
      { id: "edge", start: START - 20 * DAY, end: START + 2 * DAY, laneId: "l1" },
      // Open: reaches the end of the window, not infinity.
      { id: "open", start: START + 26 * DAY, open: true, laneId: "l2" },
    ];
    const result = fit(orientation, { items });
    expect(result.typicalMainSize).toBeCloseTo(((2 + 4) / 2) * 20, 6);
  });

  it("with nothing visible, the main axis does not restrict", () => {
    const result = fit(orientation, {
      items: [{ id: "far", start: START + 90 * DAY, end: START + 91 * DAY, laneId: "l1" }],
    });
    expect(result.typicalMainSize).toBeUndefined();
    expect(result.byMain).toBe("comfortable");
  });

  it("holds the level on screen inside the hysteresis band", () => {
    const sag = room("comfortable") * (1 - DENSITY_HYSTERESIS / 2);
    const lift = room("comfortable") * (1 + DENSITY_HYSTERESIS / 2);
    const clear = room("comfortable") * (1 + DENSITY_HYSTERESIS * 1.5);
    const at = (px: number, previous?: Density) =>
      fit(orientation, {
        items: itemsOfLength(days(px)),
        ...(previous === undefined ? {} : { previous }),
      }).byMain;
    // Below the threshold, but comfortable is what is shown: it stays.
    expect(at(sag)).toBe("compact");
    expect(at(sag, "comfortable")).toBe("comfortable");
    // Above the threshold, but compact is shown: it has to clear the band.
    expect(at(lift)).toBe("comfortable");
    expect(at(lift, "compact")).toBe("compact");
    expect(at(clear, "compact")).toBe("comfortable");
    // From dense, compact also has to clear its band.
    const compactLift = room("compact") * (1 + DENSITY_HYSTERESIS / 2);
    expect(at(compactLift, "dense")).toBe("dense");
    expect(at(compactLift, "compact")).toBe("compact");
  });

  it("a container with no extent keeps what is on screen", () => {
    const zero = fitDensity({
      items: itemsOfLength(4),
      lanes: LANES,
      domain: DOMAIN,
      orientation,
      width: 0,
      height: 0,
      previous: "dense",
    });
    expect(zero.density).toBe("dense");
    expect(zero.typicalMainSize).toBeUndefined();
    const fresh = fitDensity({
      items: [],
      domain: DOMAIN,
      orientation,
      width: 0,
      height: 0,
    });
    expect(fresh.density).toBe("comfortable");
  });

  it("an explicit density beats the fit", () => {
    const result = fit(orientation, { cross: 10 });
    expect(result.density).toBe("dense");
    expect(resolveDensity("comfortable", result)).toBe("comfortable");
    expect(resolveDensity("auto", result)).toBe("dense");
    expect(resolveDensity(undefined, result)).toBe("dense");
  });

  it("passes pack mode and time zone through to the layout it measures", () => {
    const overlapping: Item[] = [
      { id: "x", start: START + 1 * DAY, end: START + 9 * DAY, laneId: "l1" },
      { id: "y", start: START + 2 * DAY, end: START + 10 * DAY, laneId: "l1" },
    ];
    const packed = fit(orientation, { items: overlapping });
    const overlaid = fit(orientation, { items: overlapping, packMode: "overlap" });
    expect(overlaid.contentCrossSize.comfortable).toBeLessThan(packed.contentCrossSize.comfortable);
    const zoned = fit(orientation, {
      items: [{ id: "day", start: START, granularity: "day", laneId: "l1" }],
      timeZone: "Europe/Budapest",
    });
    // A day-granular instant is drawn as its day, not as a point.
    expect(zoned.typicalMainSize).toBeGreaterThan(10);
    const { mainSize } = containerExtents(
      sizeFor(orientation, 100).width,
      sizeFor(orientation, 100).height,
      orientation,
    );
    expect(mainSize).toBe(MAIN);
  });
});

describe("detailSurface: auto", () => {
  it("a mouse at a roomy level gets a popover on hover", () => {
    expect(
      resolveDetailSurface("auto", { pointerType: "mouse", density: "comfortable", width: 1440 }),
    ).toEqual({ surface: "popover", trigger: "hover" });
    expect(resolveDetailSurface(undefined, { density: "compact", width: 1440 })).toEqual({
      surface: "popover",
      trigger: "hover",
    });
  });

  it("a finger or a pen gets the popover on tap", () => {
    expect(
      resolveDetailSurface("auto", { pointerType: "touch", density: "comfortable", width: 1440 }),
    ).toEqual({ surface: "popover", trigger: "tap" });
    expect(
      resolveDetailSurface("auto", { pointerType: "pen", density: "comfortable", width: 1440 }),
    ).toEqual({ surface: "popover", trigger: "tap" });
  });

  it("a narrow container or the dense level gets a sheet, opened by tap", () => {
    expect(
      resolveDetailSurface("auto", { pointerType: "touch", density: "comfortable", width: 375 }),
    ).toEqual({ surface: "sheet", trigger: "tap" });
    expect(
      resolveDetailSurface("auto", { pointerType: "mouse", density: "dense", width: 1440 }),
    ).toEqual({ surface: "sheet", trigger: "tap" });
    expect(
      resolveDetailSurface("auto", {
        pointerType: "mouse",
        density: "comfortable",
        width: 700,
        breakpoint: 800,
      }),
    ).toEqual({ surface: "sheet", trigger: "tap" });
  });

  it("an explicit surface beats the measurement", () => {
    expect(
      resolveDetailSurface("popover", { pointerType: "mouse", density: "dense", width: 375 }),
    ).toEqual({ surface: "popover", trigger: "hover" });
    expect(
      resolveDetailSurface("sheet", { pointerType: "mouse", density: "comfortable", width: 1440 }),
    ).toEqual({ surface: "sheet", trigger: "tap" });
  });
});

describe("popover placement", () => {
  const bounds = { width: 375, height: 667 };
  const size = { width: 240, height: 120 };

  it("opens below the anchor, centred on it, when there is room", () => {
    const wide = { width: 1440, height: 900 };
    const placed = placePopover({ x: 100, y: 100, width: 40, height: 20 }, size, wide);
    expect(placed.side).toBe("below");
    expect(placed.y).toBe(128);
    // Centring would put it at 0; the margin holds it at 8.
    expect(placed.x).toBe(8);
    const roomy = placePopover({ x: 400, y: 100, width: 40, height: 20 }, size, wide);
    expect(roomy.x).toBe(420 - 120);
  });

  it("opens above when only above has room", () => {
    const placed = placePopover({ x: 100, y: 600, width: 40, height: 20 }, size, bounds);
    expect(placed.side).toBe("above");
    expect(placed.y + placed.height).toBe(592);
  });

  it("takes the roomier side when neither fits", () => {
    const tall = { width: 200, height: 500 };
    expect(placePopover({ x: 10, y: 100, width: 10, height: 10 }, tall, bounds).side).toBe("below");
    const high = placePopover({ x: 10, y: 500, width: 10, height: 10 }, tall, bounds);
    expect(high.side).toBe("above");
    expect(high.y).toBe(8);
  });

  it("never leaves the bounds sideways, and is never wider than them", () => {
    for (let x = -50; x <= bounds.width + 50; x += 5) {
      const placed = placePopover({ x, y: 50, width: 10, height: 10 }, size, bounds);
      expect(placed.x).toBeGreaterThanOrEqual(8);
      expect(placed.x + placed.width).toBeLessThanOrEqual(bounds.width - 8);
    }
    const anchor = { x: 10, y: 50, width: 10, height: 10 };
    const huge = placePopover(anchor, { width: 900, height: 50 }, bounds);
    expect(huge.width).toBe(bounds.width - 16);
    expect(huge.x).toBe(8);
    const none = placePopover({ x: 0, y: 0, width: 1, height: 1 }, size, { width: 10, height: 10 });
    expect(none.width).toBe(0);
  });

  it("honours a custom gap and margin", () => {
    const placed = placePopover({ x: 100, y: 100, width: 40, height: 20 }, size, bounds, {
      gap: 2,
      margin: 0,
    });
    expect(placed.y).toBe(122);
  });
});

describe("density: auto with the host's own metrics (E13)", () => {
  it("measures the room along time with them, as it measures the room across", () => {
    // Items typically 80 px long: room enough for the built-in comfortable
    // level, not for a host's that asks every level for 200 px.
    const demanding = (density: Density, orientation: Orientation) => ({ ...densityMetrics(density, orientation), autoMainRoom: 200 });
    const base = { items: itemsOfLength(4), lanes: LANES, domain: DOMAIN, orientation: "horizontal" as const, ...sizeFor("horizontal", 5000) };
    const builtIn = fitDensity(base);
    expect(builtIn.typicalMainSize).toBeLessThan(200);
    expect(builtIn.byMain).toBe("comfortable");
    expect(fitDensity({ ...base, metrics: demanding }).byMain).toBe("dense");
  });
});
