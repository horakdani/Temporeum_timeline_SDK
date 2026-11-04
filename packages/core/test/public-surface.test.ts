import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * The public surface, name by name: what each entry point exports at run
 * time. A new export is a decision — it is then on the 1.x contract — so it
 * has to be written here too; a helper the tests need is imported from its
 * own module, not from an entry.
 */

const entries = (JSON.parse(readFileSync(new URL("../entries.json", import.meta.url), "utf8")) as { entries: { name: string; input: string }[] }).entries;

const SURFACE: Readonly<Record<string, readonly string[]>> = {
  index: ["DARK_THEME", "DEFAULT_BREAKPOINT", "DEFAULT_CLUSTER_GAP", "DEFAULT_CLUSTER_ITEM_SIZE", "DEFAULT_CLUSTER_MIN_COUNT", "DEFAULT_KEY_BINDINGS", "DEFAULT_LANE_ID", "DEFAULT_LOAD_OVERSCAN", "DEFAULT_MAX_TICKS", "DEFAULT_MAX_WINDOWS", "DEFAULT_TICK_SPACING_PX", "DEFAULT_TIME_ZONE", "DENSITIES", "Emitter", "LABEL_ELLIPSIS", "LIGHT_THEME", "MAX_TIME_MS", "MIN_SHORT_LABEL_CHARACTERS", "MIN_SPAN_MS", "ORIENTATIONS", "THEMES", "VERSION", "addCalendar", "alignToStep", "applyPatches", "bandIndex", "chooseTickStep", "clampDomain", "clusterBox", "clusterExtent", "clusterLayout", "clusterZoom", "containerExtents", "countSceneNodes", "createCommand", "createHitTester", "createInputMachine", "createItemLoader", "createNavigator", "createProjector", "createTimeScale", "crossAxisOf", "daysInMonth", "decorationLayer", "defaultClusterNode", "defaultItemNode", "defaultLabelNode", "defaultTickLabel", "densityMetrics", "editCommand", "estimateTextWidth", "findLabelOverlap", "findSublaneOverlap", "fitDensity", "fromCalendarParts", "generateTicks", "hitSlopFor", "invertPatch", "isLeapYear", "isoWeekday", "itemRect", "labelSpace", "layoutItems", "mainAxisOf", "modeForPart", "movePatch", "panDomainBy", "placeLabels", "placePopover", "planSceneSpace", "projectPoint", "projectRect", "renderDecoration", "renderTimeline", "renderToSvgString", "resizePatch", "resolveDensity", "resolveDetailSurface", "resolveKey", "resolveOrientation", "resolveSpan", "resolveTheme", "shortenLabel", "slopForExtent", "snapTime", "spanOf", "startOf", "timelineStyleCss", "toCalendarParts", "toTimeMs", "unprojectPoint", "unprojectRect", "zoneOffsetMs", "zoomDomainAt"],
  dom: ["DEFAULT_POOL_LIMIT", "MIRRORED_KEYS", "attachInput", "createFrameLoop", "mountScene", "observeSize", "openDetail", "partNames", "withParts"],
  groups: ["GROUP_HEADER_PREFIX", "applyGroupPatches", "dropPosition", "groupHeaderBoxes", "groupHeaderLane", "groupKeyStep", "groupView", "headerGroupId", "isGroupCommand", "moveGroupCommand", "resolveGroupKey"],
  items: ["DROP_MIME", "TEMPLATE_ATTRIBUTES", "TEMPLATE_TAGS", "addCommand", "addTargetAt", "addTargetFromFocus", "applyItemPatches", "itemForTarget", "itemFromDrop", "itemKindHooks", "onRemoveHandle", "parseTemplate", "removeCommand", "removeHandleBox", "removeTargets", "resolveItemKey", "slotHooks", "splitBackgrounds", "templateHooks", "withoutId"],
  gantt: ["DEPENDENCY_LAYER", "dependencyEdges", "dependencyId", "dependencyKeyStep", "dependencyLinks", "dependencyNodes", "dependencyPaths", "describeBaseline", "describeDependencies", "describeTask", "ganttHooks", "gridKeyStep", "layoutIndex", "progressOf", "resolveDependencyKey", "resolveGridKey", "revealOffset", "routeDependencies", "routePath", "routePoints", "taskBox", "taskGridRows", "withDependencyLayer"],
  schedule: ["CONTINUOUS", "OFFICE_WEEK", "addWorkingMs", "scheduleCommand", "scheduleTasks", "workTime", "workingMs"],
  resources: ["LOAD_EPSILON", "LOAD_LANE_PREFIX", "LOAD_LAYER", "capacityOf", "describeOverload", "loadAt", "loadLaneId", "loadLaneOf", "loadNodes", "overloads", "peakLoad", "resourceHooks", "resourceLanes", "resourceLoad", "unscheduledTasks", "withLoadLanes", "withLoadLayer"],
  tools: ["DEFAULT_MINIMAP_SIZE", "DEFAULT_ZOOM_PRESETS", "MINIMAP_STEP", "MIN_WINDOW_SIZE", "applyItemChanges", "createHiddenDates", "defaultTimeBarStep", "dragTimeBarTime", "laneHeaderCss", "laneHeaderNodes", "minimapCss", "minimapDragDomain", "minimapExtent", "minimapGeometry", "minimapJumpDomain", "minimapKeyDomain", "minimapNodes", "moveTimeBar", "presetDomain", "rangeFromDrag", "rangeKeyStep", "relayout", "resolveAxisKey", "resolveRangeKey", "rollingDomain", "selectRange", "timeBarKeyTime", "timeBarPlacements", "withLaneHeaderLayer"],
  export: ["PAPER_SIZES", "PRINT_VIEW_ATTR", "PX_TO_PT", "bandLayout", "contentRange", "flattenHtmlText", "mountPrintView", "onBand", "paginate", "printCss", "printPages", "resolvePaper", "scenesToPdf", "standaloneSvg", "svgToPng"],
  intl: ["DEFAULT_STRINGS", "MIRROR_CLASS", "PSEUDO_CLOSE", "PSEUDO_OPEN", "calendarFields", "calendarTickLabel", "calendarTicks", "describeHooks", "fill", "formatAmount", "mirrorCss", "mirrorScene", "mirrorTextNodes", "pseudoStrings", "resolveStrings", "sayIn"],
  live: ["applyItemChanges", "relayout"],
  words: ["DEFAULT_STRINGS", "fill", "formatAmount", "resolveStrings", "sayIn"],
  calendar: ["CALENDAR_STRINGS", "WEEKDAYS", "calendarCss", "calendarDays", "calendarDomId", "calendarGeometry", "calendarHit", "calendarKeyStep", "calendarScene", "calendarTimeAt", "dayStartOf", "expandEvents", "formatICal", "formatRRule", "instantOf", "layoutDays", "occurrenceId", "occurrences", "parseDateValue", "parseICal", "parseRRule", "recurringSource", "resolveCalendarKey", "utcStamp", "wallOf", "weekStartOf"],
  "vis-compat": ["fromVis", "fromVisItems", "parseVisTime", "runtimeTimeZone", "visText", "zonedInstant"],
  story: ["fromTimelineJS", "fromTimelineSheet", "parseCsv", "readTimelineSheet", "sheetCsvUrl", "storyDateText", "storyMedia", "storyPlainText"],
};

/** What the review of 2026-11-03 found exported for the tests only. None of it may come back. */
const INTERNAL: Readonly<Record<string, readonly string[]>> = {
  index: ["DEFAULT_BUDGET", "DEFAULT_GROWTH", "DEFAULT_MAX_SHIFT", "DEFAULT_MAX_STRETCH", "DEFAULT_OVERSCAN", "SHORTEN_DENSITY_LIMIT", "ORIENTATION_HYSTERESIS", "DENSITY_HYSTERESIS", "DENSE_MIN_TARGET", "HIT_SLOP_COARSE", "HIT_SLOP_FINE"],
  export: ["glyphName", "pathOps", "parseTransform", "parseColor", "textWidth", "computeStyle", "parseStyleSheet", "sheetOf"],
  calendar: ["escapeText", "foldLine", "unescapeText", "formatWall", "wallMs"],
  gantt: ["milestoneHalf", "edgePoint"],
  tools: ["PAGE_STEPS", "stepsOf", "HIDDEN_BUDGET", "snapTime"],
};

describe("the core's public surface", () => {
  it("has one snapTime and one TaskGrid options name: the root's snapTime, the element's TaskGridOptions", async () => {
    const tools = (await import("../src/tools/index.js")) as Record<string, unknown>;
    expect(tools).not.toHaveProperty("snapTime");
    const gantt = await import("../src/gantt/index.js");
    expect(gantt.taskGridRows).toBeTypeOf("function");
  });

  it("covers every entry point", () => {
    expect(Object.keys(SURFACE).sort()).toEqual(entries.map((entry) => entry.name).sort());
  });

  for (const entry of entries) {
    it(`${entry.name} exports exactly its listed names`, async () => {
      const module = (await import(`../${entry.input.replace(/\.ts$/, ".js")}`)) as Record<string, unknown>;
      expect(Object.keys(module).sort()).toEqual([...(SURFACE[entry.name] ?? [])].sort());
      for (const name of INTERNAL[entry.name] ?? []) expect(module, `${entry.name} exports ${name}`).not.toHaveProperty(name);
    });
  }
});
