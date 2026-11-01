# Migrating from react-calendar-timeline

A react-calendar-timeline setup moves over by renaming a handful of fields — `title` to `label`, `group` to `laneId`, `start_time` to `start` — and a handful of props. This page maps every react-calendar-timeline prop, item and group field, marker and header that has an equivalent, and lists, honestly, the ones that don't have one yet. Each mapping in the tables below is a running example in the test suite, and each "Not yet" row is checked against the configuration's types. A row that maps to something that doesn't exist fails the build.

::: example migration-react-calendar-timeline

## The plugins

Groups, items and the view as this example has them need nothing more. Some mappings below land on a plugin — a part on an entry point of its own, registered once with `registerPlugin` from `@temporeum/timeline-element`, before the first timeline (in a React app, in its entry module):

| Mapping | Plugin | From |
|---|---|---|
| `laneHeaders` (the sidebar), `timeBars` (a marker the reader drags), `rangeSelect` (a click on the canvas) | `toolsPlugin` | `@temporeum/timeline-element/tools` |
| `template` (an item renderer), `editing.add` (a double click on the canvas) | `itemsPlugin` | `@temporeum/timeline-element/items` |

Without its plugin, a configuration with one of these throws a `TypeError` where the timeline is created, naming the import that is missing. `hooks.renderItem` and `decorations` (`TodayMarker`, `CustomMarker`) need no plugin.

## What changes

- **The same keys in React and outside it.** The examples on this page use `createTimeline`; in React, the configuration is the props of `<Timeline>` from `@temporeum/timeline-react`, and each event `x` is an `onX` prop ([frameworks](../frameworks.md)).
- **No date library.** Times are a `Date` or epoch milliseconds; a moment or a dayjs converts with `.valueOf()`. Ids are strings.
- **Items pack into rows.** react-calendar-timeline overlaps items in a group unless `stackItems`; Temporeum packs them unless `packMode: "overlap"`.
- **Read-only until told.** react-calendar-timeline moves, resizes and changes groups unless told otherwise; Temporeum does none of it until `editing.enabled` (and `crossLane` to change lanes). Each edit is one reversible command, and the library never saves ([editing](editing.md)).
- **The timeline owns its view.** Instead of controlled `visibleTimeStart` and `visibleTimeEnd`, set the view with `zoomTo` and hear about it with `viewportChanged`.
- **Markers are decorations.** `TodayMarker` and `CustomMarker` are `decorations`; a marker the reader can drag is a time bar ([time tools](time-tools.md)).
- **The keyboard works by default.** Every gesture has a key, and screen readers see the timeline as a listbox ([accessibility](accessibility.md)).

## The mapping

The timeline in each row's example has five items in two lanes; the row's code is the only difference.

{{migration:react-calendar-timeline}}

## What is not here yet

The "Not yet" rows above, in short: an event per frame of a drag, context-menu events, a resize handle, a right sidebar, custom group and header renderers, custom time steps, classes per time or per lane, inline item styles, a cursor marker and a scroll element of the host's. If your app depends on one of them, say so in an issue: the order is decided by what users need.
