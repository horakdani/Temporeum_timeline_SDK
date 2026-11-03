# Changelog

## 1.0.0 — Unreleased

The first release, on 1.0.0 of `@temporeum/timeline-element`. From here on the package follows [semantic versioning](https://github.com/horakdani/Temporeum_timeline_SDK/blob/main/packages/docs/site/pages/stability.md).

- `<Timeline>` (Svelte 5, runes) and `timelineState`: every `TimelineConfig` field as a prop, every instance event as an `on…` prop (`TIMELINE_EVENTS` of the element), `bind:timeline` for the instance.
- The `item` snippet: each item's content as Svelte, rendered into the box over the item while it is drawn. Needs the element's `/items` plugin, registered once.
- `registerPlugin` and `hasPlugin` (and the `TimelinePlugin` type) are handed on from `@temporeum/timeline-element`, so an app that installs only the adapter registers the plugins it needs; the element is a `^1.0.0` dependency.
- The view and the selection are defaults — `defaultDomain` and `defaultSelectedIds` — and stay where the reader moved them on a re-render; the instance's `zoomTo` and `select` move them. Every other field is compared by what it says: an option object written anew on each render is no change, and a drag in progress goes on.
- Server-rendered by Svelte's own renderer (SvelteKit included) and hydrated without a second drawing.
- Ships `Timeline.d.svelte.ts` too, for `moduleResolution: node16` and `nodenext`.
- Options that need a plugin of the element (`gantt`, `resources`, the time tools, `groups`, the item kinds, `strings`, `calendar`, `direction`) need it registered once for the page, with `registerPlugin` from `@temporeum/timeline-element` — in the app's entry, before the first timeline, and where the server renders too. Without it the configuration throws, naming the import.
