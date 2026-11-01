/**
 * The `<script>`-tag build: everything in one file, the core included, the
 * plugins registered and the element registered on load. For a page with no
 * bundler, this is the whole installation:
 *
 *     <script src="https://unpkg.com/@temporeum/timeline-element"></script>
 *     <temporeum-timeline height="320">
 *       <script type="application/json">{"items": [...]}</script>
 *     </temporeum-timeline>
 */
import { defineTimelineElement } from "./element.js";
import { exportPlugin } from "./export.js";
import { ganttPlugin } from "./gantt.js";
import { groupsPlugin } from "./groups.js";
import { intlPlugin } from "./intl.js";
import { itemsPlugin } from "./items.js";
import { registerPlugin } from "./plugins.js";
import { resourcesPlugin } from "./resources.js";
import { toolsPlugin } from "./tools.js";

export * from "./index.js";
export * from "./calendar.js";
export * from "./gantt.js";
export * from "./resources.js";
export * from "./export.js";
export * from "./tools.js";
export * from "./groups.js";
export * from "./items.js";
export * from "./intl.js";
export * from "./story.js";

registerPlugin(ganttPlugin, resourcesPlugin, exportPlugin, toolsPlugin, groupsPlugin, itemsPlugin, intlPlugin);
defineTimelineElement();
