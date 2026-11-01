# Changelog

## 1.0.0 — not yet published

The first release, on 1.0.0 of `@temporeum/timeline-element`. From here on the package follows [semantic versioning](https://github.com/horakdani/temporeum-timeline/blob/main/packages/docs/site/pages/stability.md).

- `<Timeline>` (Svelte 5, runes) and `timelineState`: every `TimelineConfig` field as a prop, every instance event as an `on…` prop (`TIMELINE_EVENTS` of the element), `bind:timeline` for the instance.
- Server-rendered by Svelte's own renderer (SvelteKit included) and hydrated without a second drawing.
- Ships `Timeline.d.svelte.ts` too, for `moduleResolution: node16` and `nodenext`.
- Options that need a plugin of the element (`gantt`, `resources`, the time tools, `groups`, the item kinds, `strings`, `calendar`, `direction`) need it registered once for the page, with `registerPlugin` from `@temporeum/timeline-element` — in the app's entry, before the first timeline, and where the server renders too. Without it the configuration throws, naming the import.
