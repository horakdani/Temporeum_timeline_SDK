/**
 * `@temporeum/timeline-core/tools` — the time tools: hidden dates, custom
 * time bars, a rolling window, zoom presets, the overview strip, range
 * selection, sticky lane headers and live data.
 *
 * Each is pure, like the rest of the core: it computes what to draw and
 * where a gesture or a key leads, and the element (`createTimeline`) puts it
 * on screen and wires the events. Every capability a pointer reaches has a
 * keyboard path that ends in the same function — G-KEYBOARD's promise. The
 * entry point is separate so that the core's own budget does not grow with
 * it: the core takes hidden dates as a two-function `TimeWarp`, and the rest
 * of this lives here.
 */

export { createHiddenDates, HIDDEN_BUDGET } from "./hidden.js";
export type { HiddenDateRange, HiddenDates, HiddenDatesOptions, HiddenRepeat, HiddenStretch } from "./hidden.js";
export { PAGE_STEPS, resolveAxisKey, snapTime, stepsOf } from "./keys.js";
export type { AxisKeyAction } from "./keys.js";
export { defaultTimeBarStep, dragTimeBarTime, moveTimeBar, timeBarKeyTime, timeBarPlacements } from "./time-bars.js";
export type { TimeBar, TimeBarMovedPayload, TimeBarMoveOptions, TimeBarPlacement } from "./time-bars.js";
export { DEFAULT_ZOOM_PRESETS, presetDomain, rollingDomain } from "./view.js";
export type { RollingOptions, ZoomPreset } from "./view.js";
export {
  DEFAULT_MINIMAP_SIZE,
  MIN_WINDOW_SIZE,
  MINIMAP_STEP,
  minimapCss,
  minimapDragDomain,
  minimapExtent,
  minimapGeometry,
  minimapJumpDomain,
  minimapKeyDomain,
  minimapNodes,
} from "./minimap.js";
export type { MinimapDrawOptions, MinimapGeometry } from "./minimap.js";
export { rangeFromDrag, rangeKeyStep, resolveRangeKey, selectRange } from "./range.js";
export type { RangeDraft, RangeKeyAction, RangeSelectOptions, TimeRange } from "./range.js";
export { laneHeaderCss, laneHeaderNodes, withLaneHeaderLayer } from "./lanes.js";
export type { LaneHeaderOptions } from "./lanes.js";
export { applyItemChanges, relayout } from "../shared/live-data.js";
export type { AppliedChanges, ItemChanges, ItemUpdate } from "../shared/live-data.js";
