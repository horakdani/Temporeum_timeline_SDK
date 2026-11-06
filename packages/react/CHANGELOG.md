# Changelog

## 1.0.0 — Unreleased

The first release, on 1.0.0 of `@temporeum/timeline-element`. From here on the package follows [semantic versioning](https://horakdani.github.io/Temporeum_timeline_SDK/stability.html).

- `<Timeline>`: every configuration field a prop, every instance event an `on…` prop (`TIMELINE_EVENTS` of the element); it does not re-render to draw.
- `registerPlugin` and `hasPlugin` (and the `TimelinePlugin` type) are handed on from `@temporeum/timeline-element`, so an app that installs only the adapter registers the plugins it needs; the element is a `^1.0.0` dependency.
- The view and the selection are defaults — `defaultDomain` and `defaultSelectedIds` — and stay where the reader moved them on a re-render; the instance's `zoomTo` and `select` move them. Every other field is compared by what it says: an option object written anew on each render is no change, and a drag in progress goes on.
- `useTimelineState(timeline, selector, isEqual?)`: subscribe to the part of the state a component renders, through `useSyncExternalStore`; a new selector reads the snapshot again.
- The callbacks that run are the last committed render's; a new `timelineRef` gets the instance and the old one `null`; `id`, `data-*`, `aria-*`, `role`, `title` and `ref` are the box's, but `aria-label` names the timeline (`ariaLabel`), as on the element — `ref` on React 18 too, through `forwardRef`.
- Server rendering and hydration without a second drawing; `"use client"` for the Next App Router.
- Options that need a plugin of the element (`gantt`, `resources`, the time tools, `groups`, the item kinds, `strings`, `calendar`, `direction`) need it registered once for the page, with `registerPlugin` from `@temporeum/timeline-element` — in the app's entry, before the first timeline, and where the server renders too. Without it the configuration throws, naming the import.
- For React 18 and 19 (the peer range is `^18.0.0 || ^19.0.0`).
- Every optional prop takes an explicit `undefined`, the box's (`className`, `style`, `ssrWidth`, `renderItem` …) as well as the configuration's, so a host forwarding its own optional value compiles under `exactOptionalPropertyTypes`.
- `renderItem`: each item's content as React, rendered by a portal into the box over the item — it keeps its state and context while the item is drawn, and is unmounted when it leaves the view. Needs the element's `/items` plugin, registered once.
- `react-dom` is a peer dependency (`^18.0.0 || ^19.0.0`, as `react`), for the portals.
