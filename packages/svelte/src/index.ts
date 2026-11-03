/**
 * `@temporeum/timeline-svelte` — the timeline as a Svelte 5 component.
 *
 * `<Timeline>` is a shell around the shared instance of
 * `@temporeum/timeline-element`; `timelineState` is its store, as a Svelte
 * store. On a server — SvelteKit, or `render` of your own — the component
 * prints the drawing, and on hydration the instance takes it over.
 */

export { default as Timeline } from "./Timeline.svelte";
export { timelineState } from "./state.js";
export type { Readable } from "./state.js";
export type { Timeline as TimelineInstance, TimelineComponentConfig, TimelineConfig, TimelineSnapshot } from "@temporeum/timeline-element";
/** The element's plugin registry, from the adapter too: an app that installs only the adapter still registers the plugins its configuration needs. */
export { hasPlugin, registerPlugin } from "@temporeum/timeline-element";
export type { PluginName, TimelinePlugin } from "@temporeum/timeline-element";
