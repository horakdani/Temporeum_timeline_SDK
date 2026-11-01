/**
 * `@temporeum/timeline-core` — the public entry point.
 *
 * An editable, responsive timeline engine with zero runtime dependencies.
 * This barrel is the whole public surface: anything not re-exported here is
 * an internal detail and may change without a major version.
 */
export { Emitter } from "./emitter.js";
export type {
  EmitterErrorHandler,
  Listener,
  Unsubscribe,
} from "./emitter.js";

export { toTimeMs } from "./time.js";

export {
  addCalendar,
  DEFAULT_TIME_ZONE,
  daysInMonth,
  fromCalendarParts,
  isLeapYear,
  isoWeekday,
  startOf,
  toCalendarParts,
  zoneOffsetMs,
} from "./calendar.js";
export type { CalendarParts } from "./calendar.js";

export {
  bandIndex,
  decorationLayer,
  renderDecoration,
} from "./decorations.js";
export type {
  BandingDecoration,
  Decoration,
  DecorationContext,
  DecorationLayer,
  EraDecoration,
  MarkerDecoration,
  MarkerShape,
  NowDecoration,
} from "./decorations.js";

export {
  clusterBox,
  clusterExtent,
  clusterLayout,
  clusterZoom,
  DEFAULT_CLUSTER_GAP,
  DEFAULT_CLUSTER_ITEM_SIZE,
  DEFAULT_CLUSTER_MIN_COUNT,
} from "./cluster.js";
export type {
  Cluster,
  ClusterLayoutOptions,
  ClusterMarker,
  ClusterOptions,
  Clustering,
  ClusterZoomOptions,
} from "./cluster.js";

export { createItemLoader, DEFAULT_LOAD_OVERSCAN, DEFAULT_MAX_WINDOWS } from "./data.js";
export type {
  ItemLoader,
  ItemLoaderChange,
  ItemLoaderChangeReason,
  ItemLoaderOptions,
  ItemLoaderStats,
  LoadingRange,
} from "./data.js";

export { DENSITIES, densityMetrics } from "./density.js";
export type { DensityMetrics, MetricsProvider } from "./density.js";

export {
  applyPatches,
  createCommand,
  createHitTester,
  editCommand,
  invertPatch,
  modeForPart,
  movePatch,
  resizePatch,
  snapTime,
} from "./editing.js";
export type {
  EditHit,
  EditMode,
  EditPart,
  HitTester,
  HitTestOptions,
  MoveOptions,
  ResizeOptions,
} from "./editing.js";

export {
  containerExtents,
  createProjector,
  crossAxisOf,
  mainAxisOf,
  ORIENTATIONS,
  projectPoint,
  projectRect,
  unprojectPoint,
  unprojectRect,
} from "./geometry.js";
export type { Projector, ScreenPoint, ScreenRect } from "./geometry.js";

export {
  estimateTextWidth,
  findLabelOverlap,
  LABEL_ELLIPSIS,
  labelSpace,
  MIN_SHORT_LABEL_CHARACTERS,
  placeLabels,
  shortenLabel,
} from "./labels.js";
export type {
  DroppedLabel,
  LabelCandidate,
  LabelDropReason,
  LabelLayout,
  LabelOptions,
  LabelOverflow,
  LabelPlacement,
  MeasureText,
  PlacedLabel,
} from "./labels.js";

export {
  DEFAULT_LANE_ID,
  findSublaneOverlap,
  itemRect,
  layoutItems,
  resolveSpan,
} from "./layout.js";
export type {
  ItemSpan,
  Layout,
  LayoutItem,
  LayoutLane,
  LayoutMetrics,
  LayoutOptions,
} from "./layout.js";

export { createInputMachine } from "./input.js";
export type {
  ActivateEffect,
  EditEndEffect,
  EditMoveEffect,
  EditStartEffect,
  EditTrigger,
  EditingInputOptions,
  FocusEffect,
  GestureEffect,
  GestureKind,
  GesturePhase,
  InputEffect,
  InputMachine,
  InputOptions,
  InputViewportReason,
  JumpRequestEffect,
  KeyboardInputOptions,
  KeyEffect,
  PointerKind,
  PointerPhase,
  PointerSample,
  PressEffect,
  ScheduleEffect,
  TapEffect,
  ViewportEffect,
  WheelSample,
} from "./input.js";

export { createNavigator, DEFAULT_KEY_BINDINGS, resolveKey } from "./keyboard.js";
export type { KeyAction, KeyBinding, KeySample, NavEntry, Navigator, NavigatorOptions } from "./keyboard.js";

export {
  DEFAULT_BUDGET,
  DEFAULT_GROWTH,
  DEFAULT_MAX_SHIFT,
  DEFAULT_MAX_STRETCH,
  DEFAULT_OVERSCAN,
  planSceneSpace,
} from "./scene-space.js";
export type { SceneSpace, SceneSpacePlanOptions, SceneSpaceView } from "./scene-space.js";

export {
  defaultClusterNode,
  defaultItemNode,
  defaultLabelNode,
  defaultTickLabel,
  renderTimeline,
  SHORTEN_DENSITY_LIMIT,
} from "./render.js";
export type {
  ClusterRenderContext,
  ItemRenderContext,
  LabelRenderContext,
  RenderHooks,
  RenderOptions,
  RenderResult,
} from "./render.js";

export {
  DEFAULT_BREAKPOINT,
  DENSE_MIN_TARGET,
  DENSITY_HYSTERESIS,
  fitDensity,
  HIT_SLOP_COARSE,
  HIT_SLOP_FINE,
  hitSlopFor,
  ORIENTATION_HYSTERESIS,
  placePopover,
  resolveDensity,
  resolveDetailSurface,
  resolveOrientation,
  slopForExtent,
} from "./responsive.js";
export type {
  DensityFit,
  DensityFitInput,
  DetailSurfaceChoice,
  DetailSurfaceInput,
  DetailTrigger,
  OrientationOptions,
  PopoverOptions,
  PopoverPlacement,
  PopoverSide,
} from "./responsive.js";

export {
  clampDomain,
  createTimeScale,
  MAX_TIME_MS,
  MIN_SPAN_MS,
  panDomainBy,
  spanOf,
  zoomDomainAt,
} from "./scale.js";
export type { TimeScale, TimeWarp } from "./scale.js";

export { countSceneNodes, renderToSvgString } from "./scene.js";
export type { SceneElement, SvgStringOptions } from "./scene.js";

export {
  DARK_THEME,
  LIGHT_THEME,
  resolveTheme,
  THEMES,
  timelineStyleCss,
} from "./theme.js";
export type {
  StyleOptions,
  Theme,
  ThemeSetting,
  ThemeTokenName,
  TouchActionMode,
} from "./theme.js";

export {
  alignToStep,
  chooseTickStep,
  DEFAULT_MAX_TICKS,
  DEFAULT_TICK_SPACING_PX,
  generateTicks,
} from "./ticks.js";
export type { Tick, TickOptions, TickStep } from "./ticks.js";

export { VERSION } from "./version.js";

export type {
  Command,
  CommandPayload,
  Density,
  DensitySetting,
  DetailSurface,
  DetailSurfaceSetting,
  Domain,
  DomainLimits,
  EditingOptions,
  Granularity,
  HoverPayload,
  InteractionOptions,
  Item,
  ItemEventPayload,
  ItemKind,
  ItemMovedPayload,
  ItemPatch,
  ItemResizedPayload,
  ItemsSource,
  Lane,
  LayoutChangedPayload,
  MainCross,
  MainCrossRect,
  MoveTrigger,
  Orientation,
  OrientationSetting,
  PackMode,
  PluginContext,
  SelectionChangedPayload,
  TimeInput,
  TimeMs,
  TimelineEventMap,
  TimelineEventName,
  TimelineOptions,
  TimelinePlugin,
  Viewport,
  ViewportChangeReason,
  ViewportChangedPayload,
} from "./types.js";
