/**
 * Decorations: the marks that are not items.
 *
 * A now line, alternating bands, a named era, a marker — every timeline needs
 * some of these, and a library that treats them as "draw it yourself on an
 * overlay" pushes the hardest part onto the host: they have to be culled,
 * clipped, projected and kept out of each other's way exactly like items are.
 * So they are first-class here, with the same geometry pipeline.
 *
 * One decision is visible in the types: **the now line takes its time as an
 * argument.** The core never reads a clock. That keeps rendering a pure
 * function of its input — which is what makes a frame reproducible in a
 * fixture, and what lets a host drive the "now" of a replay or a simulation
 * rather than the wall clock.
 *
 * The band parity is the other detail worth stating. Bands alternate on a
 * value derived from the calendar — the local day number, the month index,
 * the year — never on the index of the tick in the current viewport. Parity
 * from the viewport would make the stripes swap every time the user pans.
 */

import { toCalendarParts, zoneOffsetMs } from "./calendar.js";
import type { DensityMetrics } from "./density.js";
import { lineAttrs, polygonPoints, rectAttrs, textNode, withClass } from "./draw.js";
import type { Projector } from "./geometry.js";
import type { SceneElement } from "./scene.js";
import type { TimeScale } from "./scale.js";
import { toTimeMs } from "./time.js";
import { alignToStep, chooseTickStep } from "./ticks.js";
import type { Tick } from "./ticks.js";
import type { Granularity, MainCross, MainCrossRect, TimeInput } from "./types.js";

/** Alternating stripes along the time axis, one band per tick step. */
export interface BandingDecoration {
  readonly kind: "banding";
  readonly className?: string;
}

/** A line at one instant, across every lane. */
export interface NowDecoration {
  readonly kind: "now";
  /** Explicit: the core never reads a clock. The host passes `Date.now()`. */
  readonly time: TimeInput;
  readonly label?: string;
  readonly className?: string;
}

/** A named stretch of time behind the items. */
export interface EraDecoration {
  readonly kind: "era";
  readonly id: string;
  readonly start: TimeInput;
  readonly end: TimeInput;
  readonly label?: string;
  readonly className?: string;
}

/** The shapes a marker can take. */
export type MarkerShape = "diamond" | "circle" | "triangle";

/** A point in time called out on the axis. */
export interface MarkerDecoration {
  readonly kind: "marker";
  readonly id: string;
  readonly time: TimeInput;
  readonly label?: string;
  readonly shape?: MarkerShape;
  readonly className?: string;
}

/** Everything the renderer can draw besides items and the axis. */
export type Decoration =
  | BandingDecoration
  | NowDecoration
  | EraDecoration
  | MarkerDecoration;

/** Behind the items, or in front of them. */
export type DecorationLayer = "background" | "foreground";

/** Which layer a decoration belongs in. Bands never cover an item. */
export function decorationLayer(decoration: Decoration): DecorationLayer {
  return decoration.kind === "banding" || decoration.kind === "era"
    ? "background"
    : "foreground";
}

/** What a decoration needs to know about the frame it is drawn into. */
export interface DecorationContext {
  readonly scale: TimeScale;
  readonly projector: Projector;
  readonly metrics: DensityMetrics;
  /** Cross extent of the whole drawable area, axis band included. */
  readonly crossSize: number;
  readonly ticks: readonly Tick[];
  readonly timeZone: string;
  /** Room a line of text needs. {@link labelSpace} builds this. */
  readonly measure: (text: string) => MainCross;
  /**
   * Ask for room in the axis band, and take it.
   *
   * Returns false when the range is off the viewport or already spoken for.
   * The renderer hands the same function to the axis and to the decorations,
   * which is what keeps a marker's label off a date — two labels drawn on top
   * of each other is the oldest timeline bug there is. The axis asks first:
   * a date carries more than a marker's name.
   */
  readonly claimLabelRoom?: (start: number, end: number) => boolean;
}

const MS_PER_DAY = 86_400_000;

/** The units counted on the local clock: a day of the zone, an hour of it. */
const LOCAL_UNIT_MS: Partial<Record<Granularity, number>> = { second: 1000, minute: 60_000, hour: 3_600_000, day: MS_PER_DAY };

/**
 * A stable alternation index for an instant at a granularity.
 *
 * Exact in every case — local day number, month index, year — so the stripes
 * of a given day are the same stripes after panning, zooming or re-rendering
 * in another zone.
 */
export function bandIndex(
  time: number,
  granularity: Granularity,
  timeZone: string,
): number {
  if (granularity === "millisecond") {
    return Math.floor(time);
  }
  const unit = LOCAL_UNIT_MS[granularity];
  if (unit !== undefined) {
    return Math.floor((time + zoneOffsetMs(time, timeZone)) / unit);
  }
  const parts = toCalendarParts(time, timeZone);
  switch (granularity) {
    case "month":
      return parts.year * 12 + parts.month;
    case "year":
      return parts.year;
    case "decade":
      return Math.floor(parts.year / 10);
    case "century":
      return Math.floor(parts.year / 100);
    default:
      return Math.floor(parts.year / 1000);
  }
}

function clampMain(main: number, scale: TimeScale): number {
  return main < 0 ? 0 : main > scale.mainSize ? scale.mainSize : main;
}

function laneArea(ctx: DecorationContext): { cross: number; crossSize: number } {
  const cross = ctx.metrics.axisSize;
  return { cross, crossSize: Math.max(ctx.crossSize - cross, 0) };
}

/**
 * A label that fits after a main-axis position, or nothing.
 *
 * Decorations give their labels up exactly like items do, for the same
 * reason: text drawn past the edge of the viewport is worse than no text.
 */
function labelAfter(
  ctx: DecorationContext,
  main: number,
  cross: number,
  crossRoom: number,
  text: string,
  className: string,
): SceneElement | undefined {
  const need = ctx.measure(text);
  const claim = ctx.claimLabelRoom ?? (() => true);
  const forward = main + ctx.metrics.labelPadding;
  const backward = main - ctx.metrics.labelPadding - need.main;
  // Forward first, because that is where a reader looks for it; backward is
  // what keeps a label near the right edge on screen.
  const start =
    forward + need.main <= ctx.scale.mainSize && claim(forward, forward + need.main)
      ? forward
      : backward >= 0 && claim(backward, backward + need.main)
        ? backward
        : undefined;
  if (start === undefined) {
    return undefined;
  }
  const box: MainCrossRect = {
    main: start,
    mainSize: need.main,
    cross: cross + Math.max(crossRoom - need.cross, 0) / 2,
    crossSize: need.cross,
  };
  return textNode(box, text, ctx.projector, className, 0);
}

function renderBanding(
  decoration: BandingDecoration,
  ctx: DecorationContext,
): readonly SceneElement[] {
  const [domainStart, domainEnd] = ctx.scale.domain;
  const area = laneArea(ctx);
  // The step, not the tick list: the band the viewport opens inside started
  // BEFORE the first visible tick, and taking its parity from the domain edge
  // instead of from its real start is what makes the stripes at the left edge
  // double up. Both are then clamped to the viewport.
  const step = chooseTickStep(ctx.scale.msPerPx, ctx.metrics.tickSpacing);
  const granularity = step.granularity;
  const boundaries: number[] = [alignToStep(domainStart, step, ctx.timeZone)];
  for (const tick of ctx.ticks) {
    const last = boundaries[boundaries.length - 1];
    if (tick.time > (last ?? domainStart) && tick.time < domainEnd) {
      boundaries.push(tick.time);
    }
  }
  boundaries.push(domainEnd);

  const nodes: SceneElement[] = [];
  for (let i = 0; i < boundaries.length - 1; i += 1) {
    const from = boundaries[i];
    const to = boundaries[i + 1];
    if (from === undefined || to === undefined) {
      continue;
    }
    // The parity of the step, not of its first unit: a step of two hours
    // always starts on an even hour, and one of six months in January or July.
    if (Math.floor(bandIndex(from, granularity, ctx.timeZone) / step.count) % 2 === 0) {
      continue;
    }
    const main = clampMain(ctx.scale.toMain(from), ctx.scale);
    const end = clampMain(ctx.scale.toMain(to), ctx.scale);
    if (end - main <= 0) {
      continue;
    }
    nodes.push({
      tag: "rect",
      attrs: {
        class: withClass("tl-band", decoration.className),
        ...rectAttrs(
          { main, mainSize: end - main, cross: area.cross, crossSize: area.crossSize },
          ctx.projector,
        ),
      },
    });
  }
  return nodes;
}

function renderNow(decoration: NowDecoration, ctx: DecorationContext): readonly SceneElement[] {
  const time = toTimeMs(decoration.time);
  const [start, end] = ctx.scale.domain;
  if (time < start || time > end) {
    return [];
  }
  const main = ctx.scale.toMain(time);
  const nodes: SceneElement[] = [
    {
      tag: "line",
      attrs: {
        class: withClass("tl-now", decoration.className),
        ...lineAttrs({ main, cross: 0 }, { main, cross: ctx.crossSize }, ctx.projector),
      },
    },
  ];
  if (decoration.label) {
    const label = labelAfter(
      ctx,
      main,
      0,
      ctx.metrics.axisSize,
      decoration.label,
      "tl-now-label",
    );
    if (label !== undefined) {
      nodes.push(label);
    }
  }
  return nodes;
}

function renderEra(decoration: EraDecoration, ctx: DecorationContext): readonly SceneElement[] {
  const from = toTimeMs(decoration.start);
  const to = toTimeMs(decoration.end);
  const [domainStart, domainEnd] = ctx.scale.domain;
  if (to <= domainStart || from >= domainEnd || to <= from) {
    return [];
  }
  const area = laneArea(ctx);
  const main = clampMain(ctx.scale.toMain(from), ctx.scale);
  const end = clampMain(ctx.scale.toMain(to), ctx.scale);
  const nodes: SceneElement[] = [
    {
      tag: "rect",
      attrs: {
        class: withClass("tl-era", decoration.className),
        "data-tl-era": decoration.id,
        ...rectAttrs(
          { main, mainSize: Math.max(end - main, 0), cross: area.cross, crossSize: area.crossSize },
          ctx.projector,
        ),
      },
    },
  ];
  if (decoration.label) {
    const need = ctx.measure(decoration.label);
    if (need.main <= end - main) {
      nodes.push(
        textNode(
          {
            main,
            mainSize: need.main,
            cross: area.cross,
            crossSize: need.cross,
          },
          decoration.label,
          ctx.projector,
          "tl-era-label",
          ctx.metrics.labelPadding,
        ),
      );
    }
  }
  return nodes;
}

function markerShape(
  shape: MarkerShape,
  main: number,
  cross: number,
  radius: number,
  projector: Projector,
  className: string,
  id: string,
): SceneElement {
  if (shape === "circle") {
    const center = projector.projectPoint({ main, cross });
    return {
      tag: "circle",
      attrs: { class: className, "data-tl-marker": id, cx: center.x, cy: center.y, r: radius },
    };
  }
  const points: readonly MainCross[] =
    shape === "triangle"
      ? [
          { main, cross: cross - radius },
          { main: main + radius, cross: cross + radius },
          { main: main - radius, cross: cross + radius },
        ]
      : [
          { main, cross: cross - radius },
          { main: main + radius, cross },
          { main, cross: cross + radius },
          { main: main - radius, cross },
        ];
  return {
    tag: "polygon",
    attrs: {
      class: className,
      "data-tl-marker": id,
      points: polygonPoints(points, projector),
    },
  };
}

function renderMarker(
  decoration: MarkerDecoration,
  ctx: DecorationContext,
): readonly SceneElement[] {
  const time = toTimeMs(decoration.time);
  const [start, end] = ctx.scale.domain;
  if (time < start || time > end) {
    return [];
  }
  const main = ctx.scale.toMain(time);
  const radius = Math.max(ctx.metrics.tickFontSize / 2, 3);
  const cross = Math.min(ctx.metrics.axisSize / 2, ctx.crossSize / 2);
  const nodes: SceneElement[] = [
    markerShape(
      decoration.shape ?? "diamond",
      main,
      cross,
      radius,
      ctx.projector,
      withClass("tl-marker", decoration.className),
      decoration.id,
    ),
  ];
  if (decoration.label) {
    const label = labelAfter(
      ctx,
      main + radius,
      0,
      ctx.metrics.axisSize,
      decoration.label,
      "tl-marker-label",
    );
    if (label !== undefined) {
      nodes.push(label);
    }
  }
  return nodes;
}

/**
 * One decoration as scene nodes.
 *
 * A decoration outside the visible domain renders nothing at all — culling is
 * part of the contract, not an optimisation a host has to remember.
 */
export function renderDecoration(
  decoration: Decoration,
  ctx: DecorationContext,
): readonly SceneElement[] {
  switch (decoration.kind) {
    case "banding":
      return renderBanding(decoration, ctx);
    case "now":
      return renderNow(decoration, ctx);
    case "era":
      return renderEra(decoration, ctx);
    default:
      return renderMarker(decoration, ctx);
  }
}
