# Items and lanes

An item is a stretch of time, or an instant, with an id. A lane is a block of rows the items of one group are packed into. Everything else is optional.

## Items

| Field | Means |
|---|---|
| `id` | Unique and stable: selection, focus, edits and the drawing's node reuse are keyed by it. |
| `start` | Epoch milliseconds or a `Date`. |
| `end` | Omitted for an instant. An instant still covers its `granularity` unit. |
| `granularity` | What the host knows: `"day"`, `"year"`, `"second"` … An event known to the day covers the whole day, so two same-day events never share a row. |
| `open` | The end is unknown or ongoing: the item reaches past the view and nothing is packed after it in its row. |
| `laneId` | The lane it belongs to; without one, the default lane. |
| `label` | The text drawn on or after it, and the start of its accessible name. |
| `className` | Added to its node, for [theming](theming.md). |
| `kind` | `range` (default), `box`, `point` or `background` — see [groups and item kinds](groups-and-item-kinds.md). A `box`, `point` or `background` item needs `itemsPlugin` (`@temporeum/timeline-element/items`) registered, and throws without it; `milestone` is the [Gantt plugin's](gantt.md). |
| `selectable`, `movable`, `resizable`, `removable` | Per-item opt-outs of the interactions. |
| `data` | Anything; it comes back in every event. |

Items are treated as immutable: to change one, replace it (and the array). The layout is cached per array and checked element by element, so a host that replaces one item gets a fresh layout without re-packing ten thousand.

## Lanes

```js excerpt:example/recipe-log
  lanes: [
    { id: "error", label: "Error", pinned: true },
    { id: "warn", label: "Warning" },
    { id: "info", label: "Info" },
  ],
```

A lane is a row block, so grouping is not a mode — and for groups inside groups, with headers you can collapse and reorder, give `groups` instead, with `groupsPlugin` from `@temporeum/timeline-element/groups` registered ([groups and item kinds](groups-and-item-kinds.md)): put everything in one lane for the densest packing, give items a `laneId` to group them. A `pinned` lane keeps its place when the rest scroll. `packMode` decides how its items share rows.

## The packing

Layout packs into collision-free rows, and it does so in time rather than in pixels — so the result survives a zoom:

```js excerpt:example/core-static
const scale = createTimeScale(domain, 960);
const layout = layoutItems(items);
for (const placed of layout.items) {
  lines.push(`${placed.item.id}: row ${String(placed.row)}, x ${itemRect(placed, scale).main.toFixed(0)}`);
}
```

That is the engine's own call; `createTimeline` does it for you. See the [engine guide](core-engine.md) for the rest of what it can do without a DOM.

## The view

`domain` is the initial view, `[start, end]`. Without one the timeline shows the items' extent with a margin. `limits` bounds the view: `min`, `max`, `minSpanMs`, `maxSpanMs`. The instance moves it with `zoomTo([start, end])`, `zoomBy(factor, around?)` and `scrollTo(time)`; each reports a `viewportChanged` event with the reason `"api"`, so a host can tell its own calls from the user's.

All options are listed, from the source, in the [API reference](../reference/api.md).
