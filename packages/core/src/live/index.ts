/**
 * `@temporeum/timeline-core/live` — live data: a change to some items, and
 * the layout after it with only the lanes it touched packed again.
 *
 * The same two functions `/tools` exports, from the shared module
 * (`src/shared/live-data.ts`), so that neither entry point carries the other's own code. Their own entry point,
 * because a live instance needs them whatever it shows, and the time tools
 * it shows only on request: the element's base imports this, and a page
 * without hidden dates, time bars or an overview strip no longer downloads
 * the rest of `/tools`.
 */
export { applyItemChanges, relayout } from "../shared/live-data.js";
export type { AppliedChanges, ItemChanges, ItemUpdate } from "../shared/live-data.js";
