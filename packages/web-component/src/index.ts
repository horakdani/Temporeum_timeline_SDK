/**
 * `@temporeum/timeline-element` — the timeline as a live instance, a
 * custom element, and server-rendered markup.
 *
 * - {@link createTimeline}: the live instance every wrapper shares. An
 *   external store (`subscribe`/`getSnapshot`) and a typed event emitter.
 * - `<temporeum-timeline>`: the custom element. {@link defineTimelineElement}
 *   registers it, or import `@temporeum/timeline-element/define`.
 * - {@link renderTimelineHtml} / {@link renderTimelineSvg}: the same
 *   drawing on a server, for the client to take over.
 * - {@link registerPlugin}: the parts on entry points of their own — the
 *   Gantt chart (`/gantt`), the resource view (`/resources`), export and
 *   print (`/export`), the time tools (`/tools`), nested groups (`/groups`),
 *   item kinds, templates and adding and removing (`/items`), other
 *   languages, directions and calendars (`/intl`) — and the week and day
 *   views (`/calendar`), which mount on their own.
 *
 * Importing this module never touches `window` or `document`.
 */
export { DEFAULT_HEIGHT, DEFAULT_SERVER_WIDTH } from "./config.js";
export type {
  MetricsSetting,
  SizeOverrides,
  TimelineConfig,
  TimelineEditingOptions,
  TimelineGanttOptions,
  TimelineResourceOptions,
  TimelineRollingOptions,
  TimelineTimeBarOptions,
  TimelineComponentConfig,
  TimelineUpdate,
} from "./config.js";
export { defineTimelineElement, OBSERVED_ATTRIBUTES, TemporeumTimelineElement } from "./element.js";
export type { TimelineElementEventMap, TimelineElementEventName } from "./element.js";
export { hasPlugin, registerPlugin } from "./plugins.js";
export type { PluginName, TimelinePlugin } from "./plugins.js";
export { HOST_CSS, renderTimelineHtml, renderTimelineSvg, serializeConfig, TAG_NAME } from "./ssr.js";
export type { ServerFrame, ServerHtmlOptions, ServerRenderOptions } from "./ssr.js";
export { createTimeline, TIMELINE_EVENTS } from "./timeline.js";
export type {
  ClusterOpenedPayload,
  CreateTimelineOptions,
  DensityChangedPayload,
  GroupMovedPayload,
  GroupToggledPayload,
  ItemsAddedPayload,
  ItemSlot,
  ItemsChangedPayload,
  ItemsRemovedPayload,
  JumpRequestPayload,
  OrientationChangedPayload,
  SlotsChangedPayload,
  Timeline,
  TimelineInstanceEventMap,
  TimelineInstanceEventName,
  TimelineSnapshot,
} from "./timeline.js";
