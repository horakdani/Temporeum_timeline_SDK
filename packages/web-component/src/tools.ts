/**
 * `@temporeum/timeline-element/tools` — the time tools, as a plugin: hidden
 * dates, time bars, a rolling window, zoom presets, the overview strip,
 * range selection, sticky lane headers and the item tooltip.
 *
 *     import { registerPlugin } from "@temporeum/timeline-element";
 *     import { toolsPlugin } from "@temporeum/timeline-element/tools";
 *     registerPlugin(toolsPlugin);
 *
 * Its own entry point: the tools import the core's `/tools`, and a page that
 * uses none of them does not download it. Live data is not a tool — the base
 * takes `addItems` and its kin without this plugin. What the plugin holds is
 * the element's own business: register it, do not call into it.
 */
export { toolsPlugin } from "./tools/layer.js";
