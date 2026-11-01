# Changelog

## 1.0.0 — not yet published

The first release, on 1.0.0 of `@temporeum/timeline-element`. From here on the package follows [semantic versioning](https://github.com/horakdani/temporeum-timeline/blob/main/packages/docs/site/pages/stability.md).

- `<Timeline>`: every configuration field a prop, every instance event an `on…` prop (`TIMELINE_EVENTS` of the element); it does not re-render to draw.
- `useTimelineState(timeline, selector, isEqual?)`: subscribe to the part of the state a component renders, through `useSyncExternalStore`.
- Server rendering and hydration without a second drawing; `"use client"` for the Next App Router.
- Options that need a plugin of the element (`gantt`, `resources`, the time tools, `groups`, the item kinds, `strings`, `calendar`, `direction`) need it registered once for the page, with `registerPlugin` from `@temporeum/timeline-element` — in the app's entry, before the first timeline, and where the server renders too. Without it the configuration throws, naming the import.
- For React 18 and 19 (the peer range is React 18 and later).
- `renderItem`: each item's content as React, rendered by a portal into the box over the item — it keeps its state and context while the item is drawn, and is unmounted when it leaves the view. Needs the element's `/items` plugin, registered once.
- `react-dom` is a peer dependency (18 and later), for the portals.
