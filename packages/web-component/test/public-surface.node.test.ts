import { describe, expect, it } from "vitest";

/**
 * The element's public surface, name by name: what each entry point exports
 * at run time. A new export is a decision — it is then on the 1.x contract —
 * so it has to be written here too; a helper the tests need is imported from
 * its own module, not from an entry (D3 of the quality round).
 */

const SURFACE: Readonly<Record<string, readonly string[]>> = {
  index: ["DEFAULT_HEIGHT", "DEFAULT_SERVER_WIDTH", "HOST_CSS", "OBSERVED_ATTRIBUTES", "TAG_NAME", "TIMELINE_EVENTS", "TemporeumTimelineElement", "createTimeline", "defineTimelineElement", "hasPlugin", "registerPlugin", "renderTimelineHtml", "renderTimelineSvg", "serializeConfig"],
  define: [],
  calendar: ["calendarViewCss", "mountCalendarView"],
  gantt: ["defaultTaskColumns", "ganttPlugin", "mountTaskGrid", "taskGridCss"],
  resources: ["backlogCss", "describeBacklogTask", "mountBacklog", "resourcesPlugin"],
  export: ["exportPlugin"],
  tools: ["toolsPlugin"],
  groups: ["groupsPlugin"],
  items: ["itemsPlugin"],
  intl: ["intlPlugin"],
  story: ["STORY_STRINGS", "mountStory", "storyCss", "storyHtml"],
};

/** What the review of 2026-11-03 found exported for the tests only. None of it may come back. */
const INTERNAL: Readonly<Record<string, readonly string[]>> = {
  index: ["contentOf", "frameOptions", "frameScene", "initialDomain", "initialSpace", "resolveView", "usesSceneSpace", "directionOf", "hiddenDatesOf", "minimapGeometryOf", "minimapSize", "wordsOf", "exportTheme", "configFromAttributes", "eventNameOf"],
  groups: ["mountGroupLayer", "groupLayerAttrs", "headerPlacements", "groupHeaderMarkup", "mirrorStyle", "groupHeaderCss"],
  tools: ["mountToolsLayer"],
  export: ["printScenes"],
};

const modules: Readonly<Record<string, () => Promise<Record<string, unknown>>>> = {
  index: () => import("../src/index.js"),
  define: () => import("../src/define.js"),
  calendar: () => import("../src/calendar.js"),
  gantt: () => import("../src/gantt.js"),
  resources: () => import("../src/resources.js"),
  export: () => import("../src/export.js"),
  tools: () => import("../src/tools.js"),
  groups: () => import("../src/groups.js"),
  items: () => import("../src/items.js"),
  intl: () => import("../src/intl.js"),
  story: () => import("../src/story.js"),
};

describe("the element's public surface", () => {
  for (const [name, load] of Object.entries(modules)) {
    it(`${name} exports exactly its listed names`, async () => {
      const module = await load();
      expect(Object.keys(module).sort()).toEqual([...(SURFACE[name] ?? [])].sort());
      for (const internal of INTERNAL[name] ?? []) expect(module, `${name} exports ${internal}`).not.toHaveProperty(internal);
    });
  }

  it("the server frame carries no internal view", async () => {
    const { renderTimelineSvg } = await import("../src/index.js");
    const frame = renderTimelineSvg({ items: [{ id: "a", start: 0, end: 86_400_000 }], domain: [0, 2 * 86_400_000] });
    expect(Object.keys(frame).sort()).toEqual(["density", "domain", "groups", "height", "orientation", "result", "svg", "width"]);
  });
});
