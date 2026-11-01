/**
 * `@temporeum/timeline-angular` — the timeline as an Angular standalone
 * component, `<tl-timeline [config]="…">`, and its store as a signal,
 * `timelineState`. Built on the shared instance of
 * `@temporeum/timeline-element`; server-rendered with `@angular/ssr`, and
 * hydrated with `provideClientHydration()`.
 */

export { TimelineComponent, TimelineIds } from "./timeline.component.js";
export { timelineState } from "./state.js";
export type { Timeline as TimelineInstance, TimelineConfig, TimelineSnapshot } from "@temporeum/timeline-element";
