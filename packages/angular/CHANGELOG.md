# Changelog

## 1.0.2 — 2026-11-09

On 1.0.2 of `@temporeum/timeline-element`; no change of the component's own.

### Fixed

- An era's name is in the axis band, where the items cannot cover it, not at the top of the lane area under the first row's items.

## 1.0.1 — 2026-11-09

On 1.0.1 of `@temporeum/timeline-element`; no change of the component's own.

### Fixed

- The keyboard's focus ring on a point is a circle round its dot, on a Gantt milestone a diamond round its diamond.
- A vertical timeline's lane headers sit at the top of their column, not over its first items.

## 1.0.0 — 2026-11-07

The first release, on 1.0.0 of `@temporeum/timeline-element`. From here on the package follows [semantic versioning](https://horakdani.github.io/Temporeum_timeline_SDK/stability.html).

- With zone.js, the instance runs outside Angular's zone (no change detection per pointer move or frame, and `rolling` does not keep the application from being stable); a listened-to output is emitted in the zone.
- `<ng-template tlItem let-item>` (`TimelineItemDirective`): each item's content as an Angular template, rendered into the box over the item while it is drawn — a template that comes later, behind an `@if`, or goes, is followed; the `slotsChanged` output. Needs the element's `/items` plugin, registered once.
- `<tl-timeline>` (standalone, `OnPush`, zoneless) and `timelineState`: the whole `TimelineConfig` as `[config]`, every instance event as an output (`TIMELINE_EVENTS` of the element), `(ready)` for the instance.
- `registerPlugin` and `hasPlugin` (and the `TimelinePlugin` type) are handed on from `@temporeum/timeline-element`, so an app that installs only the adapter registers the plugins it needs; the element is a `^1.0.0` dependency.
- The view and the selection are defaults — `defaultDomain` and `defaultSelectedIds` — and stay where the reader moved them on a re-render; the instance's `zoomTo` and `select` move them. Every other field is compared by what it says: an option object written anew on each render is no change, and a drag in progress goes on.
- Server-rendered with `@angular/ssr` and hydrated with `provideClientHydration()` without a second drawing.
- Partially compiled (`ngc`, Angular Package Format), for Angular 21 and 22 (`>=21.0.0 <23.0.0`). Its peers are `@angular/core` and `@angular/common` alone — no `rxjs`.
- Options that need a plugin of the element (`gantt`, `resources`, the time tools, `groups`, the item kinds, `strings`, `calendar`, `direction`) need it registered once for the page, with `registerPlugin` from `@temporeum/timeline-element` — in the app's entry, before the first timeline, and where the server renders too. Without it the configuration throws, naming the import.
