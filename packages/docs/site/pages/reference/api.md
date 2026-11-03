# API reference

The tables on this page are generated from the TypeScript source of `@temporeum/timeline-element` when the site is built, so they cannot fall behind it. The types themselves ship with the packages: an editor shows every one of these with its documentation.

## `createTimeline(container, config, options?)`

Creates the live timeline in `container` and returns a `Timeline`. `options.hydrate` adopts a server-rendered `<svg>` already in the container; `options.root` draws into a shadow root or a fragment instead. The custom element and the React component are shells around this call.

## Configuration

Every field is optional, and every field can change later through `timeline.update({ … })`: a key present with `undefined` goes back to its default, an absent key keeps its value. On the element, the same fields are properties (`element.items`), the simple ones also attributes in kebab-case; on the React component, props.

{{api:TimelineConfig}}

## The instance

{{api:Timeline}}

## The snapshot

What `getSnapshot()` returns: frozen, a new object only when something in it changed, and at most once per drawn frame.

{{api:TimelineSnapshot}}

## Events

`timeline.on(name, listener)` returns the function that removes the listener. On the element every event is also dispatched as a DOM event under its kebab-case name (`itemMoved` → `item-moved`), with the payload as `detail`; on the React component it is an `on…` prop (`onItemMoved`).

{{api:TimelineInstanceEventMap}}

## Server rendering

- `renderTimelineHtml(config, { width?, attributes? })` — the whole `<temporeum-timeline>` element as a string: the drawing in a declarative shadow root, and the configuration beside it as JSON.
- `renderTimelineSvg(config, { width? })` — the drawing alone, and the stylesheet it needs.

## Plugins and the other entry points

`registerPlugin(...plugins)` from `@temporeum/timeline-element` registers plugins for the page: every instance, every `<temporeum-timeline>` and the server renderer draw with what is registered. `hasPlugin(name)` says whether one is. A configuration that needs a plugin that is not registered throws a `TypeError` naming the import (see [entry points](entry-points.md#the-elements-entry-points)). Each plugin, and what else its entry point exports:

- `@temporeum/timeline-element/gantt` — `ganttPlugin`; the task table, `mountTaskGrid`.
- `@temporeum/timeline-element/resources` — `resourcesPlugin`; the unscheduled tasks, `mountBacklog`.
- `@temporeum/timeline-element/export` — `exportPlugin`.
- `@temporeum/timeline-element/tools` — `toolsPlugin`.
- `@temporeum/timeline-element/groups` — `groupsPlugin`.
- `@temporeum/timeline-element/items` — `itemsPlugin`.
- `@temporeum/timeline-element/intl` — `intlPlugin`.

`@temporeum/timeline-element/calendar` (`mountCalendarView`, the week and day views) and `@temporeum/timeline-element/define` (registers the element) are entry points, not plugins.

## The engine

`@temporeum/timeline-core` has its own, larger surface — the renderer, the layout, the input machine, the loader. Its types are its reference; [the engine guide](../guides/core-engine.md) is the map. Its entry points — `/dom`, `/live`, `/words`, `/groups`, `/items`, `/gantt`, `/schedule`, `/resources`, `/tools`, `/export`, `/intl`, `/calendar`, `/vis-compat` — are listed with their budgets under [entry points](entry-points.md).
