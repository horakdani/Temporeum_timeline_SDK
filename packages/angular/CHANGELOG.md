# Changelog

## 1.0.0 — Unreleased

The first release, on 1.0.0 of `@temporeum/timeline-element`. From here on the package follows [semantic versioning](https://github.com/horakdani/Temporeum_timeline_SDK/blob/main/packages/docs/site/pages/stability.md).

- `<tl-timeline>` (standalone, `OnPush`, zoneless) and `timelineState`: the whole `TimelineConfig` as `[config]`, every instance event as an output (`TIMELINE_EVENTS` of the element), `(ready)` for the instance.
- Server-rendered with `@angular/ssr` and hydrated with `provideClientHydration()` without a second drawing.
- Partially compiled (`ngc`, Angular Package Format), for Angular 21 and later.
- Options that need a plugin of the element (`gantt`, `resources`, the time tools, `groups`, the item kinds, `strings`, `calendar`, `direction`) need it registered once for the page, with `registerPlugin` from `@temporeum/timeline-element` — in the app's entry, before the first timeline, and where the server renders too. Without it the configuration throws, naming the import.
