import { describe, expect, it } from "vitest";

import { densityMetrics } from "../src/density.js";
import { bandIndex, decorationLayer, renderDecoration } from "../src/decorations.js";
import type { DecorationContext } from "../src/decorations.js";
import { createProjector } from "../src/geometry.js";
import { estimateTextWidth, labelSpace } from "../src/labels.js";
import { createTimeScale } from "../src/scale.js";
import { generateTicks } from "../src/ticks.js";
import type { Domain, Orientation } from "../src/types.js";

const DAY = 86_400_000;
const BUDAPEST = "Europe/Budapest";

function context(
  domain: Domain,
  options: {
    readonly orientation?: Orientation;
    readonly mainSize?: number;
    readonly crossSize?: number;
    readonly timeZone?: string;
  } = {},
): DecorationContext {
  const orientation = options.orientation ?? "horizontal";
  const metrics = densityMetrics("compact", orientation);
  const mainSize = options.mainSize ?? 800;
  const timeZone = options.timeZone ?? "UTC";
  return {
    scale: createTimeScale(domain, mainSize),
    projector: createProjector(orientation),
    metrics,
    crossSize: options.crossSize ?? 200,
    ticks: generateTicks(domain, mainSize, { timeZone, targetSpacingPx: metrics.tickSpacing }),
    timeZone,
    measure: labelSpace(metrics, estimateTextWidth, metrics.tickFontSize),
  };
}

function number(value: string | number | undefined): number {
  return typeof value === "number" ? value : Number.NaN;
}

describe("bandIndex", () => {
  it("counts local days exactly", () => {
    const first = bandIndex(Date.UTC(2025, 2, 1), "day", "UTC");
    expect(bandIndex(Date.UTC(2025, 2, 2), "day", "UTC")).toBe(first + 1);
    expect(bandIndex(Date.UTC(2025, 2, 1, 23, 59, 59), "day", "UTC")).toBe(first);
  });

  it("counts the day of the zone, not of UTC", () => {
    // 23:30 UTC is already the next day in Budapest.
    const at = Date.UTC(2025, 2, 1, 23, 30);
    expect(bandIndex(at, "day", BUDAPEST)).toBe(bandIndex(at, "day", "UTC") + 1);
  });

  it("alternates month to month and year to year", () => {
    expect(bandIndex(Date.UTC(2025, 1, 15), "month", "UTC") % 2).not.toBe(
      bandIndex(Date.UTC(2025, 2, 15), "month", "UTC") % 2,
    );
    expect(bandIndex(Date.UTC(2025, 0, 1), "year", "UTC")).toBe(2025);
  });

  it("groups the coarse units by their decade, century and millennium", () => {
    expect(bandIndex(Date.UTC(2025, 0, 1), "decade", "UTC")).toBe(202);
    expect(bandIndex(Date.UTC(2025, 0, 1), "century", "UTC")).toBe(20);
    expect(bandIndex(Date.UTC(2025, 0, 1), "millennium", "UTC")).toBe(2);
  });

  it("counts hours, minutes, seconds and milliseconds", () => {
    const at = Date.UTC(2025, 2, 1, 5, 7, 9, 11);
    expect(bandIndex(at, "hour", "UTC")).toBe(Math.floor(at / 3_600_000));
    expect(bandIndex(at, "minute", "UTC")).toBe(Math.floor(at / 60_000));
    expect(bandIndex(at, "second", "UTC")).toBe(Math.floor(at / 1000));
    expect(bandIndex(at, "millisecond", "UTC")).toBe(at);
  });
});

describe("banding", () => {
  const domain: Domain = [Date.UTC(2025, 2, 1), Date.UTC(2025, 2, 11)];

  it("shades every other step and leaves a gap between bands", () => {
    const nodes = renderDecoration({ kind: "banding" }, context(domain));
    expect(nodes.length).toBeGreaterThan(2);
    for (let i = 1; i < nodes.length; i += 1) {
      const previous = nodes[i - 1]?.attrs;
      const current = nodes[i]?.attrs;
      const previousEnd = number(previous?.x) + number(previous?.width);
      expect(previousEnd).toBeLessThan(number(current?.x));
    }
  });

  it("keeps the same days shaded while the viewport pans", () => {
    // The bug this guards against: taking the parity from the first visible
    // tick instead of from the band's real start, which makes the stripes swap
    // every time the user pans.
    for (let step = 0; step < 40; step += 1) {
      const offset = step * DAY * 0.25;
      const panned: Domain = [domain[0] + offset, domain[1] + offset];
      const ctx = context(panned);
      for (const node of renderDecoration({ kind: "banding" }, ctx)) {
        const x = number(node.attrs?.x);
        const width = number(node.attrs?.width);
        if (x <= 0 || x + width >= ctx.scale.mainSize) {
          continue; // A band clipped by the edge is only partly visible.
        }
        const start = ctx.scale.toTime(x);
        const end = ctx.scale.toTime(x + width);
        expect(Math.round(end - start)).toBe(DAY);
        expect(start % DAY).toBeCloseTo(0, 3);
        expect(bandIndex(Math.round(start), "day", "UTC") % 2).toBe(1);
      }
    }
  });

  it("covers the lanes but not the axis band", () => {
    const ctx = context(domain);
    const node = renderDecoration({ kind: "banding" }, ctx)[0];
    expect(number(node?.attrs?.y)).toBe(ctx.metrics.axisSize);
    expect(number(node?.attrs?.height)).toBe(ctx.crossSize - ctx.metrics.axisSize);
  });

  it("carries the caller's class alongside its own", () => {
    const node = renderDecoration({ kind: "banding", className: "mine" }, context(domain))[0];
    expect(node?.attrs?.class).toBe("tl-band mine");
  });
});

describe("the now line", () => {
  const domain: Domain = [Date.UTC(2025, 2, 1), Date.UTC(2025, 2, 11)];

  it("draws across every lane at the given instant", () => {
    const ctx = context(domain);
    const nodes = renderDecoration({ kind: "now", time: Date.UTC(2025, 2, 6) }, ctx);
    expect(nodes).toHaveLength(1);
    const line = nodes[0];
    expect(line?.tag).toBe("line");
    expect(number(line?.attrs?.x1)).toBeCloseTo(ctx.scale.mainSize / 2);
    expect(number(line?.attrs?.y1)).toBe(0);
    expect(number(line?.attrs?.y2)).toBe(ctx.crossSize);
  });

  it("renders nothing outside the visible domain", () => {
    const ctx = context(domain);
    expect(renderDecoration({ kind: "now", time: Date.UTC(2024, 0, 1) }, ctx)).toEqual([]);
    expect(renderDecoration({ kind: "now", time: Date.UTC(2026, 0, 1) }, ctx)).toEqual([]);
  });

  it("accepts a Date as well as epoch milliseconds", () => {
    const ctx = context(domain);
    expect(renderDecoration({ kind: "now", time: new Date(Date.UTC(2025, 2, 6)) }, ctx)).toHaveLength(
      1,
    );
  });

  it("puts the label after the line, and before it at the right edge", () => {
    const ctx = context(domain);
    const middle = renderDecoration(
      { kind: "now", time: Date.UTC(2025, 2, 6), label: "now" },
      ctx,
    );
    expect(middle).toHaveLength(2);
    expect(number(middle[1]?.attrs?.x)).toBeGreaterThan(number(middle[0]?.attrs?.x1));
    const edge = renderDecoration(
      { kind: "now", time: Date.UTC(2025, 2, 10, 23), label: "now" },
      ctx,
    );
    expect(number(edge[1]?.attrs?.x)).toBeLessThan(number(edge[0]?.attrs?.x1));
  });

  it("gives the label up when the viewport is too narrow for it", () => {
    const ctx = context(domain, { mainSize: 30 });
    const nodes = renderDecoration(
      { kind: "now", time: Date.UTC(2025, 2, 6), label: "a long caption" },
      ctx,
    );
    expect(nodes).toHaveLength(1);
  });
});

describe("eras", () => {
  const domain: Domain = [Date.UTC(2025, 2, 1), Date.UTC(2025, 2, 11)];

  it("clips to the visible domain at both ends", () => {
    const ctx = context(domain);
    const nodes = renderDecoration(
      { kind: "era", id: "e", start: Date.UTC(2024, 0, 1), end: Date.UTC(2026, 0, 1) },
      ctx,
    );
    expect(number(nodes[0]?.attrs?.x)).toBe(0);
    expect(number(nodes[0]?.attrs?.width)).toBe(ctx.scale.mainSize);
    expect(nodes[0]?.attrs?.["data-tl-era"]).toBe("e");
  });

  it("renders nothing when it falls outside, or has no extent", () => {
    const ctx = context(domain);
    expect(
      renderDecoration(
        { kind: "era", id: "e", start: Date.UTC(2020, 0, 1), end: Date.UTC(2021, 0, 1) },
        ctx,
      ),
    ).toEqual([]);
    expect(
      renderDecoration(
        { kind: "era", id: "e", start: Date.UTC(2025, 2, 6), end: Date.UTC(2025, 2, 5) },
        ctx,
      ),
    ).toEqual([]);
  });

  it("labels an era that is wide enough, and gives up on one that is not", () => {
    const ctx = context(domain);
    const wide = renderDecoration(
      {
        kind: "era",
        id: "e",
        start: Date.UTC(2025, 2, 2),
        end: Date.UTC(2025, 2, 8),
        label: "First phase",
      },
      ctx,
    );
    expect(wide).toHaveLength(2);
    expect(wide[1]?.text).toBe("First phase");
    const narrow = renderDecoration(
      {
        kind: "era",
        id: "e",
        start: Date.UTC(2025, 2, 2),
        end: Date.UTC(2025, 2, 2, 2),
        label: "First phase",
      },
      ctx,
    );
    expect(narrow).toHaveLength(1);
  });
});

describe("markers", () => {
  const domain: Domain = [Date.UTC(2025, 2, 1), Date.UTC(2025, 2, 11)];
  const at = Date.UTC(2025, 2, 6);

  it("draws a diamond by default", () => {
    const node = renderDecoration({ kind: "marker", id: "m", time: at }, context(domain))[0];
    expect(node?.tag).toBe("polygon");
    expect(String(node?.attrs?.points).split(" ")).toHaveLength(4);
    expect(node?.attrs?.["data-tl-marker"]).toBe("m");
  });

  it("draws a triangle with three points and a circle as a circle", () => {
    const ctx = context(domain);
    const triangle = renderDecoration(
      { kind: "marker", id: "m", time: at, shape: "triangle" },
      ctx,
    )[0];
    expect(String(triangle?.attrs?.points).split(" ")).toHaveLength(3);
    const circle = renderDecoration({ kind: "marker", id: "m", time: at, shape: "circle" }, ctx)[0];
    expect(circle?.tag).toBe("circle");
    expect(number(circle?.attrs?.cx)).toBeCloseTo(ctx.scale.mainSize / 2);
  });

  it("renders nothing outside the visible domain", () => {
    expect(
      renderDecoration({ kind: "marker", id: "m", time: Date.UTC(2030, 0, 1) }, context(domain)),
    ).toEqual([]);
  });

  it("labels the marker when there is room beside it", () => {
    const nodes = renderDecoration(
      { kind: "marker", id: "m", time: at, label: "release" },
      context(domain),
    );
    expect(nodes).toHaveLength(2);
    expect(nodes[1]?.text).toBe("release");
  });
});

describe("decorationLayer", () => {
  it("puts bands and eras behind the items, the rest in front", () => {
    expect(decorationLayer({ kind: "banding" })).toBe("background");
    expect(
      decorationLayer({ kind: "era", id: "e", start: 0, end: 1 }),
    ).toBe("background");
    expect(decorationLayer({ kind: "now", time: 0 })).toBe("foreground");
    expect(decorationLayer({ kind: "marker", id: "m", time: 0 })).toBe("foreground");
  });
});
