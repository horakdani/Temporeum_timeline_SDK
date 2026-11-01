# Changelog

## 1.0.0 — not yet published

The first release, on 1.0.0 of `@temporeum/timeline-element`. From here on the package follows [semantic versioning](https://github.com/horakdani/temporeum-timeline/blob/main/packages/docs/site/pages/stability.md).

- `<Timeline>` and `useTimelineState` for Vue 3: every `TimelineConfig` field as an attribute, every instance event as an emit (`TIMELINE_EVENTS` of the element), `ready` with the instance.
- Server-rendered by Vue's own renderer (Nuxt included) and hydrated without a second drawing.
- Options that need a plugin of the element (`gantt`, `resources`, the time tools, `groups`, the item kinds, `strings`, `calendar`, `direction`) need it registered once for the page, with `registerPlugin` from `@temporeum/timeline-element` — in the app's entry, before the first timeline, and where the server renders too. Without it the configuration throws, naming the import.
- The `#item` slot: each item's content as Vue, teleported into the box over the item — it keeps its state while the item is drawn, and is unmounted when it leaves the view. Needs the element's `/items` plugin, registered once.
