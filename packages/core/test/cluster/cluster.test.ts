import { describe, expect, it } from "vitest";

import { clusterBox, clusterExtent, clusterLayout, clusterZoom } from "../../src/cluster.js";
import type { Cluster } from "../../src/cluster.js";
import { densityMetrics } from "../../src/density.js";
import { itemRect, layoutItems } from "../../src/layout.js";
import type { Layout } from "../../src/layout.js";
import { renderTimeline } from "../../src/render.js";
import { createTimeScale, panDomainBy } from "../../src/scale.js";
import type { Domain, Item, Lane, PackMode } from "../../src/types.js";
import { describeBothOrientations } from "../orientation.js";
import { forAll, makeRandom } from "../property/harness.js";
import { DAY, denseUniverse, HOUR, ORIGIN, readFrame } from "./fixture.js";

/**
 * What joins a cluster, and what a marker covers.
 *
 * The rules of `cluster.ts`, one by one, each with the case that must NOT
 * cluster next to the one that must — a clusterer that merged everything
 * would pass every "joins" test on its own.
 */

/** One day is ten pixels: 100 days on a 1000-pixel axis. */
const MS_PER_PX = DAY / 10;

function layoutOf(items: readonly Item[], options: { lanes?: readonly Lane[]; packMode?: PackMode } = {}): Layout {
  return layoutItems(items, { ...options, metrics: { rowSize: 20, rowGap: 2, laneGap: 6 } });
}

function ids(cluster: Cluster | undefined): string[] {
  return cluster?.members.map((member) => member.item.id) ?? [];
}

/** Instants `gapPx` apart, starting at day 10. */
function instants(count: number, gapPx: number, prefix = "i"): Item[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `${prefix}${String(index)}`,
    start: ORIGIN + 10 * DAY + index * gapPx * MS_PER_PX,
  }));
}

describe("clusterLayout — what joins", () => {
  it("[claim:joins] items closer than the gap, as drawn, are one cluster; further apart they are not", () => {
    // Drawn 3 px wide, 5 px apart start to start: a 2 px gap, under the default 4.
    const close = clusterLayout(layoutOf(instants(5, 5)), MS_PER_PX, { minItemMainSize: 3 });
    expect(close.clusters).toHaveLength(1);
    expect(ids(close.clusters[0])).toEqual(["i0", "i1", "i2", "i3", "i4"]);
    expect(close.clusters[0]?.id).toBe("i0");
    // 8 px apart: a 5 px gap.
    const apart = clusterLayout(layoutOf(instants(5, 8)), MS_PER_PX, { minItemMainSize: 3 });
    expect(apart.clusters).toHaveLength(0);
    expect(apart.clusterOf("i2")).toBeUndefined();
  });

  it("[claim:joins] measures the gap between items as drawn, not as stored", () => {
    // Instants 6 px apart: as stored, almost 6 px of gap; drawn 3 px wide, 3.
    const items = instants(3, 6);
    expect(clusterLayout(layoutOf(items), MS_PER_PX, { minItemMainSize: 0 }).clusters).toHaveLength(0);
    expect(clusterLayout(layoutOf(items), MS_PER_PX, { minItemMainSize: 3 }).clusters).toHaveLength(1);
  });

  it("[claim:item-size] an item drawn at least itemSize long stays itself and ends the run", () => {
    const items: Item[] = [
      ...instants(3, 3, "a"),
      // 2 days = 20 px, starting right after the last instant.
      { id: "bar", start: ORIGIN + 10 * DAY + 7 * MS_PER_PX, end: ORIGIN + 10 * DAY + 27 * MS_PER_PX },
      ...instants(3, 3, "b").map((item) => ({ ...item, start: (item.start as number) + 29 * MS_PER_PX })),
    ];
    const clustering = clusterLayout(layoutOf(items), MS_PER_PX, { minItemMainSize: 3 });
    expect(clustering.clusters.map(ids)).toEqual([
      ["a0", "a1", "a2"],
      ["b0", "b1", "b2"],
    ]);
    expect(clustering.clusterOf("bar")).toBeUndefined();
    // Zoomed out ten times the bar is 2 px, and everything is one run.
    expect(clusterLayout(layoutOf(items), MS_PER_PX * 10, { minItemMainSize: 3 }).clusters).toHaveLength(1);
  });

  it("[claim:breakers] an open interval and a band taller than a row never join, and end the run", () => {
    const open: Item[] = [...instants(2, 3, "a"), { id: "open", start: ORIGIN + 10 * DAY + 6 * MS_PER_PX, open: true }];
    const layout = layoutOf(open, { packMode: "overlap" });
    const clustering = clusterLayout(layout, MS_PER_PX * 1000, { minItemMainSize: 3 });
    expect(clustering.clusterOf("open")).toBeUndefined();
    expect(ids(clustering.clusters[0])).toEqual(["a0", "a1"]);

    // A 1-pixel band two rows tall, between instants in its second row.
    const tall: Item[] = [
      { id: "top", start: ORIGIN, end: ORIGIN + 400 * DAY },
      { id: "left", start: ORIGIN + 10 * DAY },
      { id: "band", start: ORIGIN + 10 * DAY + 2 * MS_PER_PX, end: ORIGIN + 10 * DAY + 3 * MS_PER_PX, sublaneSpan: 2 },
      { id: "right", start: ORIGIN + 10 * DAY + 4 * MS_PER_PX },
    ];
    const packed = layoutOf(tall);
    const band = packed.items.find((placed) => placed.item.id === "band");
    const right = packed.items.find((placed) => placed.item.id === "right");
    expect(band?.sublaneSpan).toBe(2);
    // Without the band, left and right would be 2 px apart.
    expect(clusterLayout(packed, MS_PER_PX, { minItemMainSize: 1 }).clusterOf("left")).toBeUndefined();
    expect(right).toBeDefined();
  });

  it("[claim:min-count] a run shorter than minCount is drawn as items", () => {
    const layout = layoutOf(instants(3, 3));
    expect(clusterLayout(layout, MS_PER_PX, { minItemMainSize: 3, minCount: 3 }).clusters).toHaveLength(1);
    expect(clusterLayout(layout, MS_PER_PX, { minItemMainSize: 3, minCount: 4 }).clusters).toHaveLength(0);
  });

  it("[claim:rows] clusters never span rows or lanes", () => {
    const items: Item[] = [
      ...instants(3, 3, "a").map((item) => ({ ...item, laneId: "x" })),
      ...instants(3, 3, "b").map((item) => ({ ...item, laneId: "y" })),
    ];
    const clustering = clusterLayout(layoutOf(items, { lanes: [{ id: "x" }, { id: "y" }] }), MS_PER_PX, { minItemMainSize: 3 });
    expect(clustering.clusters.map(ids)).toEqual([
      ["a0", "a1", "a2"],
      ["b0", "b1", "b2"],
    ]);
    expect(clustering.clusters.map((cluster) => cluster.laneId)).toEqual(["x", "y"]);
  });

  it("finds the same clusters in a layout built by hand, out of order", () => {
    const layout = layoutOf(instants(4, 3));
    const shuffled: Layout = { ...layout, items: [...layout.items].reverse() };
    expect(ids(clusterLayout(shuffled, MS_PER_PX, { minItemMainSize: 3 }).clusters[0])).toEqual(["i0", "i1", "i2", "i3"]);
  });

  it("is memoised per layout and settings, so a frame and its hit tester share one", () => {
    const layout = layoutOf(instants(4, 3));
    const first = clusterLayout(layout, MS_PER_PX, { minItemMainSize: 3 });
    expect(clusterLayout(layout, MS_PER_PX, { minItemMainSize: 3 })).toBe(first);
    expect(clusterLayout(layout, MS_PER_PX * 2, { minItemMainSize: 3 })).not.toBe(first);
    expect(clusterLayout(layout, MS_PER_PX, { minItemMainSize: 3, gap: 5 }).gap).toBe(5);
    expect(clusterLayout(layout, MS_PER_PX, { minItemMainSize: 3, itemSize: 8 }).itemSize).toBe(8);
    expect(clusterLayout(layout, MS_PER_PX, { minItemMainSize: 3, minCount: 3 }).minCount).toBe(3);
    expect(clusterLayout(layout, MS_PER_PX, { minItemMainSize: 2 }).minItemMainSize).toBe(2);
    expect(clusterLayout(layout, MS_PER_PX).byId("i0")?.id).toBe("i0");
    expect(clusterLayout(layout, MS_PER_PX).byId("i1")).toBeUndefined();
  });

  it("refuses settings that mean nothing", () => {
    const layout = layoutOf(instants(2, 3));
    expect(() => clusterLayout(layout, 0)).toThrow(RangeError);
    expect(() => clusterLayout(layout, Number.NaN)).toThrow(RangeError);
    expect(() => clusterLayout(layout, MS_PER_PX, { gap: -1 })).toThrow(RangeError);
    expect(() => clusterLayout(layout, MS_PER_PX, { itemSize: 0 })).toThrow(RangeError);
    expect(() => clusterLayout(layout, MS_PER_PX, { minCount: 1 })).toThrow(RangeError);
    expect(() => clusterLayout(layout, MS_PER_PX, { minCount: 2.5 })).toThrow(RangeError);
    expect(() => clusterLayout(layout, MS_PER_PX, { minItemMainSize: Number.POSITIVE_INFINITY })).toThrow(RangeError);
  });
});

describe("clusterLayout — what a marker covers", () => {
  it("[claim:contiguous] in a packed row, nothing that is not a member starts between the first and the last member", () => {
    forAll(
      "a cluster is a contiguous run of its row",
      500,
      0xc1a5,
      (random) => denseUniverse(random),
      (generated) => {
        const layout = layoutOf(generated.items, { lanes: [{ id: "l0" }, { id: "l1" }, { id: "l2" }] });
        const msPerPx = DAY * (0.05 + 3 * Math.abs(Math.sin(generated.items.length)));
        const clustering = clusterLayout(layout, msPerPx, { minItemMainSize: 3 });
        for (const cluster of clustering.clusters) {
          const members = new Set(cluster.members);
          for (const placed of layout.items) {
            const inRow = placed.row <= cluster.row && placed.row + placed.sublaneSpan > cluster.row;
            if (
              inRow &&
              !members.has(placed) &&
              placed.span.start >= cluster.start &&
              placed.span.start <= cluster.lastStart
            ) {
              return `${placed.item.id} sits inside cluster ${cluster.id}`;
            }
          }
        }
        return undefined;
      },
    );
  });

  it("[claim:room] a marker grown for its count stays in its room: growing never adds an overlap", () => {
    forAll(
      "a grown marker meets nothing new",
      500,
      0xb0c5,
      (random) => denseUniverse(random),
      (generated) => {
        const layout = layoutOf(generated.items, { lanes: [{ id: "l0" }, { id: "l1" }, { id: "l2" }] });
        const msPerPx = DAY * (0.05 + 3 * Math.abs(Math.cos(generated.items.length)));
        const scale = createTimeScale([ORIGIN, ORIGIN + 1000 * msPerPx], 1000);
        const clustering = clusterLayout(layout, msPerPx, { minItemMainSize: 3 });
        // Every unit of a row as drawn, and as its members alone would be:
        // where two members' own boxes already overlapped, they did so
        // without clustering too, and only what growing adds is asked about.
        interface Unit { readonly id: string; readonly rows: readonly [number, number]; readonly box: readonly [number, number]; readonly own: readonly [number, number]; readonly grown: boolean }
        const units: Unit[] = [];
        for (const cluster of clustering.clusters) {
          const union = clusterExtent(cluster, scale, 3);
          const box = clusterBox(cluster, scale, 3, 18);
          if (box.main > union.main + 1e-6 || box.main + box.mainSize < union.main + union.mainSize - 1e-6) {
            return `marker ${cluster.id} does not cover its members`;
          }
          if (box.main < Math.min(scale.toMain(cluster.room[0]), union.main) - 1e-6) {
            return `marker ${cluster.id} grows past the start of its room`;
          }
          if (box.main + box.mainSize > Math.max(scale.toMain(cluster.room[1]), union.main + union.mainSize) + 1e-6) {
            return `marker ${cluster.id} grows past the end of its room`;
          }
          units.push({
            id: cluster.id,
            rows: [cluster.row, cluster.row + 1],
            box: [box.main, box.main + box.mainSize],
            own: [union.main, union.main + union.mainSize],
            grown: box.mainSize > union.mainSize,
          });
        }
        for (const placed of layout.items) {
          if (clustering.clusterOf(placed.item.id) === undefined) {
            const rect = itemRect(placed, scale);
            const span = [rect.main, rect.main + Math.max(rect.mainSize, 3)] as const;
            units.push({ id: placed.item.id, rows: [placed.row, placed.row + placed.sublaneSpan], box: span, own: span, grown: false });
          }
        }
        const overlap = (a: readonly [number, number], b: readonly [number, number]): number =>
          Math.max(0, Math.min(a[1], b[1]) - Math.max(a[0], b[0]));
        for (const unit of units) {
          if (!unit.grown) {
            continue;
          }
          for (const other of units) {
            const sameRow = other.rows[0] < unit.rows[1] && unit.rows[0] < other.rows[1];
            if (other === unit || !sameRow) {
              continue;
            }
            if (overlap(unit.box, other.box) > overlap(unit.own, other.own) + 1e-6) {
              return `marker ${unit.id}, grown for its count, now meets ${other.id}`;
            }
          }
        }
        return undefined;
      },
    );
  });

  it("[claim:room] grows to the count's width where there is room, and takes all of it where there is not", () => {
    const scale = createTimeScale([ORIGIN, ORIGIN + 1000 * MS_PER_PX], 1000);
    const layout = layoutOf([...instants(3, 2, "a"), { id: "far", start: ORIGIN + 10 * DAY + 60 * MS_PER_PX, end: ORIGIN + 20 * DAY }]);
    const cluster = clusterLayout(layout, MS_PER_PX, { minItemMainSize: 3 }).clusters[0] as Cluster;
    expect(clusterExtent(cluster, scale, 3)).toEqual({ main: 100, mainSize: 7 });
    // Wide enough already: the union.
    expect(clusterBox(cluster, scale, 3, 5)).toEqual(clusterExtent(cluster, scale, 3));
    // Grown around its middle: 103.5 ± 10.
    const grown = clusterBox(cluster, scale, 3, 20);
    expect(grown.main).toBeCloseTo(93.5, 6);
    expect(grown.mainSize).toBeCloseTo(20, 6);
    // The neighbour on the right is 53 px away: the room ends halfway, at 133.5.
    const wide = clusterBox(cluster, scale, 3, 200);
    expect(wide.main + wide.mainSize).toBeCloseTo(133.5, 6);
    expect(cluster.room[0]).toBe(Number.NEGATIVE_INFINITY);
  });
});

describe("clusterZoom", () => {
  const scale = createTimeScale([ORIGIN, ORIGIN + 1000 * MS_PER_PX], 1000);
  const cluster = clusterLayout(layoutOf(instants(5, 2)), MS_PER_PX, { minItemMainSize: 3 }).clusters[0] as Cluster;

  it("[claim:zoom-factor] makes the cluster's time fill half the view, at least doubling", () => {
    const width = (cluster.end - cluster.start) / MS_PER_PX;
    expect(clusterZoom(cluster, scale).factor).toBeCloseTo(500 / width, 6);
    expect(clusterZoom(cluster, scale, { fill: 1 }).factor).toBeCloseTo(1000 / width, 6);
    expect(clusterZoom(cluster, scale, { fill: 0.001, minFactor: 3 }).factor).toBe(3);
  });

  it("[claim:zoom-factor] anchors at the tap, or without one at the middle of the cluster's visible part", () => {
    const inside = scale.toMain(cluster.start + 3 * MS_PER_PX);
    expect(clusterZoom(cluster, scale, { anchor: inside }).anchor).toBe(inside);
    // Past the members, on the marker's padding: the nearest member instant.
    expect(clusterZoom(cluster, scale, { anchor: scale.toMain(cluster.end) + 4 }).anchor).toBeCloseTo(scale.toMain(cluster.end), 6);
    expect(clusterZoom(cluster, scale, { anchor: scale.toMain(cluster.start) - 4 }).anchor).toBeCloseTo(scale.toMain(cluster.start), 6);
    const middle = scale.toMain((cluster.start + cluster.end) / 2);
    expect(clusterZoom(cluster, scale).anchor).toBeCloseTo(middle, 6);
    // Half off the left edge: the middle of what is on screen.
    const shifted = createTimeScale([cluster.start + 2 * MS_PER_PX, cluster.start + 1002 * MS_PER_PX], 1000);
    const visibleMiddle = shifted.toMain((cluster.start + 2 * MS_PER_PX + cluster.end) / 2);
    expect(clusterZoom(cluster, shifted).anchor).toBeCloseTo(visibleMiddle, 6);
    // Wholly off screen: its own middle, clamped to the view.
    const away = createTimeScale([cluster.end + DAY, cluster.end + DAY + 1000 * MS_PER_PX], 1000);
    expect(clusterZoom(cluster, away).anchor).toBe(0);
  });

  it("refuses a fill or a step that means nothing", () => {
    expect(() => clusterZoom(cluster, scale, { fill: 0 })).toThrow(RangeError);
    expect(() => clusterZoom(cluster, scale, { fill: 1.5 })).toThrow(RangeError);
    expect(() => clusterZoom(cluster, scale, { minFactor: 0 })).toThrow(RangeError);
  });
});

describeBothOrientations("the clustered frame", (orientation) => {
  const metrics = densityMetrics("comfortable", orientation);
  const width = orientation === "horizontal" ? 1000 : 400;
  const height = orientation === "horizontal" ? 300 : 1000;
  const domain: Domain = [ORIGIN, ORIGIN + 1000 * MS_PER_PX];

  it(`[claim:marker] draws one marker per cluster, with its count, in the members' row [${orientation}]`, () => {
    const items = [...instants(7, 2), { id: "solo", start: ORIGIN + 60 * DAY, end: ORIGIN + 70 * DAY, label: "Solo" }];
    const result = renderTimeline({ items, domain, width, height, orientation, cluster: true });
    const reading = readFrame(result.scene);
    expect(reading.markers).toEqual([{ id: "i0", count: 7 }]);
    expect(reading.singles).toEqual(["solo"]);
    expect(result.visibleCount).toBe(8);
    const marker = result.clusters[0];
    expect(marker?.cluster.members).toHaveLength(7);
    // In (main, cross): the row of the members, below the axis band.
    expect(marker?.box.cross).toBe(metrics.axisSize + (result.layout.items[0]?.cross ?? 0));
    expect(marker?.box.main).toBeLessThanOrEqual(100);
    // The count is a label, inside the marker.
    const count = result.labels.kept.find((label) => label.id === "i0");
    expect(count?.text).toBe("7");
    expect(count?.placement).toBe("inside");
    // Projected the orientation's way.
    const node = JSON.stringify(result.scene);
    expect(node).toContain('"class":"tl-cluster"');
    expect(node).toContain('"tl-label tl-cluster-count"');
  });

  it(`[claim:pan-invariant] a pan at one zoom keeps every marker's members and count [${orientation}]`, () => {
    const { items, lanes } = denseUniverse(makeRandom(7));
    let view: Domain = [ORIGIN + 200 * DAY, ORIGIN + 400 * DAY];
    const before = renderTimeline({ items, lanes, domain: view, width, height, orientation, cluster: true });
    const counts = new Map(readFrame(before.scene).markers.map((marker) => [marker.id, marker.count]));
    expect(counts.size).toBeGreaterThan(0);
    let compared = 0;
    for (let step = 0; step < 12; step += 1) {
      view = panDomainBy(view, 1000, (step % 2 === 0 ? 1 : -1) * 137 * (step + 1));
      const after = renderTimeline({ items, lanes, domain: view, width, height, orientation, cluster: true });
      for (const marker of readFrame(after.scene).markers) {
        const known = counts.get(marker.id);
        if (known !== undefined) {
          compared += 1;
          expect(marker.count).toBe(known);
        }
      }
    }
    expect(compared).toBeGreaterThan(0);
  });

  it(`[claim:off] leaves the frame exactly as it was when clustering is off [${orientation}]`, () => {
    const items = instants(7, 2);
    const plain = renderTimeline({ items, domain, width, height, orientation });
    const off = renderTimeline({ items: [...items], domain, width, height, orientation, cluster: false });
    expect(JSON.stringify(off.scene)).toBe(JSON.stringify(plain.scene));
    expect(off.clusters).toEqual([]);
    expect(off.clustering).toBeUndefined();
    expect(readFrame(plain.scene).singles).toHaveLength(7);
  });

  it(`[claim:marker] takes its settings, and dissolves when zoomed in [${orientation}]`, () => {
    const items = instants(7, 2);
    const strict = renderTimeline({ items, domain, width, height, orientation, cluster: { minCount: 8 } });
    expect(readFrame(strict.scene).markers).toEqual([]);
    const near: Domain = [ORIGIN + 10 * DAY - HOUR, ORIGIN + 10 * DAY + 2 * DAY];
    const zoomed = renderTimeline({ items: [...items], domain: near, width, height, orientation, cluster: true });
    expect(readFrame(zoomed.scene).markers).toEqual([]);
    expect(readFrame(zoomed.scene).singles).toHaveLength(7);
  });
});
