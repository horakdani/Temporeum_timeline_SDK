# Gantt charts

Dependency arrows between tasks, how far each task has got, the plan it is measured against, milestones — and the table of tasks beside the chart. All of it is a plugin on its own entry point, `@temporeum/timeline-element/gantt` (and, under it, the core's `@temporeum/timeline-core/gantt`): a page that shows a plain timeline does not download it, and a timeline without `gantt` draws exactly what it drew before.

## The plugin

```js excerpt:example/gantt
import { createTimeline, registerPlugin } from "@temporeum/timeline-element";
import { ganttPlugin, mountTaskGrid } from "@temporeum/timeline-element/gantt";

// The Gantt chart is a plugin: registered once, before the first timeline.
registerPlugin(ganttPlugin);
```

`registerPlugin` is the page's, not one timeline's: every instance, every `<temporeum-timeline>` and the server renderer draw with what is registered. Once is enough. A configuration with `gantt` and no plugin throws where the timeline is created, naming the import that is missing. The `<script>`-tag build (`timeline-element.umd.js`) registers every plugin on load.

## Dependencies

```js excerpt:example/gantt
const dependencies = [
  { from: "spec", to: "design" },
  { from: "spec", to: "api", type: "SS", lagMs: 2 * day },
  { from: "design", to: "ui" },
  { from: "api", to: "test" },
  { from: "ui", to: "test", type: "FF", lagMs: 3 * day },
  { from: "test", to: "launch" },
];
```

A dependency joins two items, `from` the predecessor `to` the successor. Its `type` names the two edges — the first letter the predecessor's, the second the successor's:

| `type` | Leaves | Lands on |
|---|---|---|
| `FS` (default) | the predecessor's finish | the successor's start |
| `SS` | the predecessor's start | the successor's start |
| `FF` | the predecessor's finish | the successor's finish |
| `SF` | the predecessor's start | the successor's finish |

::: example gantt

- **Arrows are routes.** Each one runs straight out of its edge, across, and straight into the other edge, turning back through the gap after the predecessor's row when the successor's edge is behind it. The routes are the same in a vertical timeline, turned.
- **Under the items.** The arrows are a layer of their own, right under the items, and they move with them: a pan or a zoom does not redraw them.
- **Only what can be seen is drawn.** At 10 000 dependencies a frame draws the arrows that cross the view, and no others. An arrow is kept whenever any part of it could be on screen.
- **A lag is said, not drawn.** `lagMs` is part of the item's accessible name ("lag 2 d", "lead 1 h"); the arrow still joins the two edges. The timeline does not move a task to honour a dependency: that is [the scheduler](scheduling.md)'s job, and saving is yours.
- **An arrow is not an item.** It takes no pointer and has no focus stop: everything it says is in the names of the two items it joins.

## Progress, baseline and milestones

```js excerpt:example/gantt
  { id: "design", label: "Design", start: at(5), end: at(12), progress: 0.6, baseline: { start: at(4), end: at(10) } },
```

| Field | Drawn as |
|---|---|
| `progress` (0 to 1) | The done part of the bar, filled. |
| `baseline` (`{ start, end? }`) | A thin bar under the item over the planned span, so a slip is a visible gap. |
| `kind: "milestone"` | A diamond on the item's start. Arrows end on the diamond. |

Each item's accessible name says it too: "Design, Apr 11, 2026 – Apr 18, 2026, Design, 60% done, 2 d behind plan, after Spec (finish-to-start); before UI (finish-to-start)".

## The keyboard

| Key | Does |
|---|---|
| `]` | Moves the focus to a successor of the focused item, bringing it into view. Pressed again, to the next successor of the same item, round the list. |
| `[` | The same, for predecessors. |

Every other key of the timeline works as before — see [accessibility](accessibility.md).

## The task table

```js excerpt:example/gantt
mountTaskGrid(document.querySelector("#grid"), timeline, { label: "Release tasks", focusTarget: element });
```

`mountTaskGrid(container, timeline, options)` draws the table in an element of its own, which you place beside the timeline — here a CSS grid of two columns. It is not drawn over the timeline: it would cover the items.

- **One row per lane, on the lane's line.** The rows are placed from the timeline's own layout and its scroll, so they stay with their lanes through every scroll, collapse and reorder. One task per row is one item per lane.
- **Virtualized.** Only the rows in view, and a few beyond, are in the document. A table of 10 000 rows holds about as many nodes as the view has rows; `aria-rowcount` and `aria-rowindex` still tell a screen reader where it is.
- **Columns.** `columns: [{ id, header, width?, value(row) }]`, where `row` is `{ lane, items }`. The default is `defaultTaskColumns()`: name, start, end and progress.
- **Keys and pointer.** Tab into the table; the arrows walk the rows (up and down beside a horizontal timeline, left and right beside a vertical one), `Home`, `End`, `Page Up` and `Page Down` jump, and `Enter` — or a click on a row — moves the timeline's focus to the row's first item and the keyboard to `focusTarget`. The wheel over the table scrolls the lanes.
- **Your own table.** The rows are `taskGridRows(layout, { crossInset, crossOffset, crossSize })` from the entry point, from `timeline.getLayout()` and the snapshot's `crossOffset`; `timeline.scrollLanes(delta)`, `revealLane(id)` and `focusItem(id)` are what the table calls.

## What it does not do yet

- **Scheduling on its own.** Nothing moves a task when its predecessor moves; the arrows follow the items wherever you put them. [The scheduler](scheduling.md) (`/schedule`) puts them back in order — dependencies, constraints, working calendars, the critical path — when you call it.
- **Editing dependencies with the pointer.** Dependencies are your data, given in `gantt.dependencies`; dragging an arrow from one task to another is not built in.
