/**
 * Adaptive tick generation: millennium to millisecond, in any time zone.
 *
 * The axis is where a timeline is either trustworthy or not. Two properties
 * matter more than the label text, which belongs to the render layer:
 *
 * 1. **Round steps.** Ticks land on whole units — midnight, the first of the
 *    month, a multiple of 200 years — never on "every 86 400 000 ms from the
 *    left edge". The ladder below is the set of steps a reader recognises.
 * 2. **Adaptive density.** The step is chosen from the zoom level so that
 *    labels get roughly the same room at every scale. The caller says how
 *    much room a label needs; the engine picks the step.
 *
 * Nothing here touches the DOM, so the axis of a server-rendered timeline is
 * the same array of ticks as the axis in the browser.
 */

import { addCalendar, DEFAULT_TIME_ZONE, isoWeekday, startOf, toCalendarParts, fromCalendarParts, YEARS_PER_UNIT } from "./calendar.js";
import { createTimeScale } from "./scale.js";
import type { CalendarParts } from "./calendar.js";
import type { Domain, Granularity, TimeMs } from "./types.js";

/** One step of the tick ladder: `count` units of `granularity`. */
export interface TickStep {
  readonly granularity: Granularity;
  /** How many units each step spans. `{ granularity: "day", count: 7 }` is a week. */
  readonly count: number;
}

/** One tick on the axis. Position is a time; projecting it is the scale's job. */
export interface Tick {
  readonly time: TimeMs;
  /** The granularity of the step that produced it — what a label should show. */
  readonly granularity: Granularity;
  /** True when the tick also starts the next coarser unit, e.g. midnight for hours. */
  readonly major: boolean;
  /**
   * Set on the axis's context label only: not a tick, but the coarser unit
   * the view starts in — the month of a view of days, the year of a view of
   * months — held at the start of the axis. `time` is the view's start.
   */
  readonly context?: true;
}

/** How the caller tunes the axis. */
export interface TickOptions {
  /** IANA zone name. Defaults to UTC, which keeps generation deterministic. */
  readonly timeZone?: string;
  /** Room a label needs along the main axis, in CSS pixels. */
  readonly targetSpacingPx?: number;
  /** Hard ceiling on the number of ticks returned. A safety net, not a budget. */
  readonly maxTicks?: number;
}

/** Default room per label: comfortable for a short date in a 12px font. */
export const DEFAULT_TICK_SPACING_PX = 80;

/** Default ceiling on tick count. Two thousand is far past useful at any zoom. */
export const DEFAULT_MAX_TICKS = 2000;

const MS_PER_DAY = 86_400_000;

/**
 * Nominal length of each unit, used only to choose a step.
 *
 * Months and years are averages — 30.436875 days and 365.2425 days. They are
 * never used for arithmetic, where the calendar does the work.
 */
const APPROX_MS: Record<Granularity, number> = {
  millisecond: 1,
  second: 1000,
  minute: 60_000,
  hour: 3_600_000,
  day: MS_PER_DAY,
  month: 30.436875 * MS_PER_DAY,
  year: 365.2425 * MS_PER_DAY,
  decade: 3652.425 * MS_PER_DAY,
  century: 36_524.25 * MS_PER_DAY,
  millennium: 365_242.5 * MS_PER_DAY,
};

/**
 * The ladder, ascending.
 *
 * Only steps that divide their next unit are listed, which is what keeps ticks
 * on round values: 15 minutes is on the ladder, 7 minutes is not. The week is
 * carried as `day * 7` because a week is not a calendar unit of its own.
 */
const LADDER: readonly TickStep[] = [
  { granularity: "millisecond", count: 1 },
  { granularity: "millisecond", count: 2 },
  { granularity: "millisecond", count: 5 },
  { granularity: "millisecond", count: 10 },
  { granularity: "millisecond", count: 20 },
  { granularity: "millisecond", count: 50 },
  { granularity: "millisecond", count: 100 },
  { granularity: "millisecond", count: 200 },
  { granularity: "millisecond", count: 500 },
  { granularity: "second", count: 1 },
  { granularity: "second", count: 2 },
  { granularity: "second", count: 5 },
  { granularity: "second", count: 10 },
  { granularity: "second", count: 15 },
  { granularity: "second", count: 30 },
  { granularity: "minute", count: 1 },
  { granularity: "minute", count: 2 },
  { granularity: "minute", count: 5 },
  { granularity: "minute", count: 10 },
  { granularity: "minute", count: 15 },
  { granularity: "minute", count: 30 },
  { granularity: "hour", count: 1 },
  { granularity: "hour", count: 2 },
  { granularity: "hour", count: 3 },
  { granularity: "hour", count: 6 },
  { granularity: "hour", count: 12 },
  { granularity: "day", count: 1 },
  { granularity: "day", count: 7 },
  { granularity: "month", count: 1 },
  { granularity: "month", count: 3 },
  { granularity: "month", count: 6 },
  { granularity: "year", count: 1 },
  { granularity: "year", count: 2 },
  { granularity: "year", count: 5 },
  { granularity: "decade", count: 1 },
  { granularity: "decade", count: 2 },
  { granularity: "decade", count: 5 },
  { granularity: "century", count: 1 },
  { granularity: "century", count: 2 },
  { granularity: "century", count: 5 },
  { granularity: "millennium", count: 1 },
  { granularity: "millennium", count: 2 },
  { granularity: "millennium", count: 5 },
];

/** The unit a tick of this granularity is "major" against. */
const COARSER: Partial<Record<Granularity, Granularity>> = {
  millisecond: "second",
  second: "minute",
  minute: "hour",
  hour: "day",
  day: "month",
  month: "year",
  year: "decade",
  decade: "century",
  century: "millennium",
};

function approxStepMs(step: TickStep): number {
  return APPROX_MS[step.granularity] * step.count;
}

/**
 * The coarsest step that still fits the requested label spacing.
 *
 * Reads as: given this zoom level, what is the smallest round step whose
 * neighbours are at least `targetSpacingPx` apart on screen.
 */
export function chooseTickStep(
  msPerPx: number,
  targetSpacingPx: number = DEFAULT_TICK_SPACING_PX,
): TickStep {
  if (!Number.isFinite(msPerPx) || msPerPx <= 0) {
    throw new RangeError(`msPerPx must be a positive number, got ${String(msPerPx)}`);
  }
  if (!Number.isFinite(targetSpacingPx) || targetSpacingPx <= 0) {
    throw new RangeError(
      `Target spacing must be a positive number of pixels, got ${String(targetSpacingPx)}`,
    );
  }
  const wanted = msPerPx * targetSpacingPx;
  for (const step of LADDER) {
    if (approxStepMs(step) >= wanted) {
      return step;
    }
  }
  // Zoomed out past five millennia per label: the top of the ladder is the
  // honest answer, and the axis gets sparser rather than wrong.
  return LADDER[LADDER.length - 1] as TickStep;
}

function floorToMultiple(value: number, step: number): number {
  return Math.floor(value / step) * step;
}

function alignedParts(parts: CalendarParts, step: TickStep): CalendarParts {
  const years = YEARS_PER_UNIT[step.granularity];
  if (years !== undefined) {
    return {
      year: floorToMultiple(parts.year, years * step.count),
      month: 1,
      day: 1,
      hour: 0,
      minute: 0,
      second: 0,
      millisecond: 0,
    };
  }
  const zeroedTime = { hour: 0, minute: 0, second: 0, millisecond: 0 };
  switch (step.granularity) {
    case "month":
      return {
        ...parts,
        ...zeroedTime,
        month: floorToMultiple(parts.month - 1, step.count) + 1,
        day: 1,
      };
    case "day":
      return { ...parts, ...zeroedTime };
    case "hour":
      return { ...parts, ...zeroedTime, hour: floorToMultiple(parts.hour, step.count) };
    case "minute":
      return {
        ...parts,
        second: 0,
        millisecond: 0,
        minute: floorToMultiple(parts.minute, step.count),
      };
    case "second":
      return { ...parts, millisecond: 0, second: floorToMultiple(parts.second, step.count) };
    default:
      return { ...parts, millisecond: floorToMultiple(parts.millisecond, step.count) };
  }
}

/**
 * The last tick position at or before `t`.
 *
 * A week step aligns to Monday, which is the ISO week start; a 200-year step
 * aligns to a multiple of 200 years, not to the left edge of the viewport.
 */
export function alignToStep(t: TimeMs, step: TickStep, timeZone: string = DEFAULT_TIME_ZONE): TimeMs {
  if (step.granularity === "day" && step.count > 1) {
    const dayStart = startOf(t, "day", timeZone);
    const backToMonday = isoWeekday(dayStart, timeZone) - 1;
    return backToMonday === 0 ? dayStart : addCalendar(dayStart, "day", -backToMonday, timeZone);
  }
  return fromCalendarParts(alignedParts(toCalendarParts(t, timeZone), step), timeZone);
}

/**
 * The ticks of an axis, ascending.
 *
 * The step is chosen from the zoom level, the first tick is aligned to a
 * round value at or before the domain start, and each following tick is
 * re-aligned after the calendar step. That last detail is what keeps hour
 * labels on round hours across a daylight-saving transition instead of
 * drifting by an hour for the rest of the day.
 */
export function generateTicks(
  domain: Domain,
  mainSize: number,
  options: TickOptions = {},
): readonly Tick[] {
  // Validates the domain and the extent, and gives the zoom level the step
  // choice needs. An unusable viewport fails here, not with an empty axis.
  const scale = createTimeScale(domain, mainSize);
  const timeZone = options.timeZone ?? DEFAULT_TIME_ZONE;
  const maxTicks = options.maxTicks ?? DEFAULT_MAX_TICKS;
  if (!Number.isFinite(maxTicks) || maxTicks < 1) {
    throw new RangeError(`maxTicks must be at least 1, got ${String(maxTicks)}`);
  }
  const step = chooseTickStep(scale.msPerPx, options.targetSpacingPx);
  const coarser = COARSER[step.granularity];
  const [start, end] = domain;

  const ticks: Tick[] = [];
  let t = alignToStep(start, step, timeZone);
  while (t <= end && ticks.length < maxTicks) {
    if (t >= start) {
      ticks.push({
        time: t,
        granularity: step.granularity,
        major: coarser === undefined ? true : t === startOf(t, coarser, timeZone),
      });
    }
    const stepped = addCalendar(t, step.granularity, step.count, timeZone);
    const realigned = alignToStep(stepped, step, timeZone);
    const next = realigned > t ? realigned : stepped;
    if (next <= t) {
      // Cannot happen with the ladder above; a step that fails to advance
      // would be an infinite loop, so the axis ends instead.
      break;
    }
    t = next;
  }
  return ticks;
}
