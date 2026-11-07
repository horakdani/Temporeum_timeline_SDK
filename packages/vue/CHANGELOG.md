# Changelog

## 1.0.0 — 2026-11-07

The first release, on 1.0.0 of `@temporeum/timeline-element`. From here on the package follows [semantic versioning](https://horakdani.github.io/Temporeum_timeline_SDK/stability.html).

- `<Timeline>` and `useTimelineState` for Vue 3: every `TimelineConfig` field as a declared, typed prop (`TimelineProps<T>`, generic over the items' data; a bare boolean attribute is `true`, a reactive value reaches the instance as the plain object), every instance event as an emit (`TIMELINE_EVENTS` of the element), `ready` with the instance.
- `registerPlugin` and `hasPlugin` (and the `TimelinePlugin` type) are handed on from `@temporeum/timeline-element`, so an app that installs only the adapter registers the plugins it needs; the element is a `^1.0.0` dependency.
- The view and the selection are defaults — `defaultDomain` and `defaultSelectedIds` — and stay where the reader moved them on a re-render; the instance's `zoomTo` and `select` move them. Every other field is compared by what it says: an option object written anew on each render is no change, and a drag in progress goes on.
- Server-rendered by Vue's own renderer (Nuxt included) and hydrated without a second drawing.
- Options that need a plugin of the element (`gantt`, `resources`, the time tools, `groups`, the item kinds, `strings`, `calendar`, `direction`) need it registered once for the page, with `registerPlugin` from `@temporeum/timeline-element` — in the app's entry, before the first timeline, and where the server renders too. Without it the configuration throws, naming the import.
- The `#item` slot: each item's content as Vue, teleported into the box over the item — it keeps its state while the item is drawn, and is unmounted when it leaves the view. Needs the element's `/items` plugin, registered once.
