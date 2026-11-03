/**
 * `@temporeum/timeline-element/groups` — nested groups, as a plugin: the
 * groups' header rows and lanes, collapsing and reordering, and the tree of
 * headers over them.
 *
 *     import { registerPlugin } from "@temporeum/timeline-element";
 *     import { groupsPlugin } from "@temporeum/timeline-element/groups";
 *     registerPlugin(groupsPlugin);
 *
 * Its own entry point: a timeline with `lanes` — a Gantt chart's tasks, a
 * resource view's people — does not download the core's `/groups` or the
 * tree. What the plugin holds is the element's own business: register it,
 * do not call into it.
 */
export { groupsPlugin } from "./groups/layer.js";
