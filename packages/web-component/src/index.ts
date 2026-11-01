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
export { contentOf, DEFAULT_HEIGHT, DEFAULT_SERVER_WIDTH, exportTheme, frameOptions, initialDomain, initialSpace, resolveView, usesSceneSpace } from "./config.js";
export { directionOf, frameScene, hiddenDatesOf, minimapGeometryOf, minimapSize, wordsOf } from "./config.js";
export type {
  FrameState,
  MetricsSetting,
  ResolvedView,
  SizeOverrides,
  TimelineConfig,
  TimelineEditingOptions,
  TimelineGanttOptions,
  TimelineResourceOptions,
  TimelineRollingOptions,
  TimelineTimeBarOptions,
  TimelineUpdate,
  Words,
} from "./config.js";
export { configFromAttributes, defineTimelineElement, eventNameOf, OBSERVED_ATTRIBUTES, TemporeumTimelineElement } from "./element.js";
export { hasPlugin, registerPlugin } from "./plugins.js";
export type { PluginName, TimelinePlugin } from "./plugins.js";
export { HOST_CSS, renderTimelineHtml, renderTimelineSvg, serializeConfig, TAG_NAME } from "./ssr.js";
export type { ServerFrame, ServerHtmlOptions, ServerRenderOptions } from "./ssr.js";
export { createTimeline, TIMELINE_EVENTS } from "./timeline.js";
export type {
  ClusterOpenPayload,
  CreateTimelineOptions,
  DensityChangedPayload,
  GroupCommandPayload,
  GroupTogglePayload,
  ItemAddedPayload,
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
