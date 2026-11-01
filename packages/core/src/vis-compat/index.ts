/**
 * `@temporeum/timeline-core/vis-compat` — a vis-timeline setup as a
 * Temporeum configuration, for moving over without rewriting the data.
 *
 * - {@link fromVis}: `new vis.Timeline(container, items, groups, options)`'s
 *   arguments as a configuration for `createTimeline`, and a warning for
 *   everything that did not carry over;
 * - {@link parseVisTime}: a time the way vis-timeline 8 reads it — numbers,
 *   `Date`s, moments, ASP.NET dates and strings by moment's rules, local
 *   times in the zone asked for.
 *
 * Pure functions, Node or browser; no DataSet is needed (one is read with
 * its `get()`), and nothing of vis-timeline is loaded.
 */
export { fromVis, fromVisItems, visText } from "./convert.js";
export type { FromVisOptions, VisCompatConfig, VisConversion, VisData, VisGroup, VisItem, VisOptions, VisWarning } from "./convert.js";
export { parseVisTime, runtimeTimeZone, zonedInstant } from "./time.js";
export type { VisTime, VisTimeOptions } from "./time.js";
