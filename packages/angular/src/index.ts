/**
 * `@temporeum/timeline-angular` — the timeline as an Angular standalone
 * component, `<tl-timeline [config]="…">`, and its store as a signal,
 * `timelineState`. Built on the shared instance of
 * `@temporeum/timeline-element`; server-rendered with `@angular/ssr`, and
 * hydrated with `provideClientHydration()`.
 */

export { TimelineComponent, TimelineItemDirective } from "./timeline.component.js";
export type { TimelineItemContext } from "./timeline.component.js";
export { timelineState } from "./state.js";
export type { Timeline as TimelineInstance, TimelineComponentConfig, TimelineConfig, TimelineSnapshot } from "@temporeum/timeline-element";
/** The element's plugin registry, from the adapter too: an app that installs only the adapter still registers the plugins its configuration needs. */
export { hasPlugin, registerPlugin } from "@temporeum/timeline-element";
export type { PluginName, TimelinePlugin } from "@temporeum/timeline-element";
