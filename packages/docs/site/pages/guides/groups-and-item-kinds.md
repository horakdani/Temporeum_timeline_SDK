# Groups and item kinds

Nested groups you can collapse and reorder, four kinds of item, adding and removing items from the timeline itself, and HTML templates. Everything on this page works with the mouse, with a finger and with the keyboard alone, and every change that touches your data leaves as a command with an inverse: the library never saves.

## The plugins

Both halves of this page are plugins, each on its own entry point. Nested groups are `groupsPlugin`, from `@temporeum/timeline-element/groups`:

```js excerpt:example/groups
import { createTimeline, registerPlugin } from "@temporeum/timeline-element";
import { groupsPlugin } from "@temporeum/timeline-element/groups";

// Nested groups are a plugin: registered once, before the first timeline.
registerPlugin(groupsPlugin);
```

The `box`, `point` and `background` kinds, templates, and adding, removing and dropping items are `itemsPlugin`, from `@temporeum/timeline-element/items`:

```js excerpt:example/item-kinds
import { createTimeline, registerPlugin } from "@temporeum/timeline-element";
import { itemsPlugin } from "@temporeum/timeline-element/items";

// Boxes, points and backgrounds are a plugin: registered once, before the first timeline.
registerPlugin(itemsPlugin);
```

They import the core's `@temporeum/timeline-core/groups` and `@temporeum/timeline-core/items`, so a timeline of plain lanes and ranges — a Gantt chart's tasks among them — downloads neither. Moving and resizing need no plugin; nor does `kind: "range"`, the default (`kind: "milestone"` is the [Gantt plugin's](gantt.md)). Without its plugin, `groups`, an item of kind `"box"`, `"point"` or `"background"`, `template`, or `editing.add`, `editing.remove` or `editing.drop` throws a `TypeError` where the timeline is created, updated (`update`, `setItems`, `addItems` with such an item) or rendered on a server, naming the import that is missing — `An item of kind "point" needs the items plugin: import { itemsPlugin } from "@temporeum/timeline-element/items" and call registerPlugin(itemsPlugin) before the timeline draws` — and the instance is left as it was; the items of a [fetched source](async-data.md) are checked when they arrive. `registerPlugin` is the page's: once is enough for every timeline on it, and the server renderer draws with it too. The `<script>`-tag build registers every plugin on load.

## Nested groups

```js excerpt:example/groups
const groups = [
  { id: "web", label: "Web team" },
  { id: "ann", label: "Ann", parentId: "web" },
  { id: "bob", label: "Bob", parentId: "web" },
  { id: "ops", label: "Operations" },
  { id: "eve", label: "Eve", parentId: "ops" },
];
```

A group names its parent with `parentId`, and an item names its group with `laneId`. Each group is drawn as a header row — the group's name, indented by its depth — followed by the rows of its own items and then its subgroups. When `groups` is given, `lanes` is ignored.

::: example groups

- **Collapse and expand:** click or tap a header, or Tab to the groups and press `Enter`, `Space`, or the arrow that points into or out of the tree (right and left in a horizontal timeline, down and up in a vertical one). A collapsed group's items and subgroups are gone from the drawing and from the accessibility tree; expanding it brings back exactly the layout there was. This is view state, like the selection: the timeline reports it (`groupToggle`) and keeps it, and `group.collapsed` is only where it starts.
- **Reorder:** drag a header along its siblings, or press `Alt` with the arrow along the tree. A reorder changes your data, so it comes out as a `groupCommand` whose `command.inverse` undoes it — `timeline.applyCommand(command.inverse)`.
- **Walk the tree:** the arrows along the tree, `Home` and `End`. The headers are a `role="tree"` beside the timeline's `listbox`, with each group's level, position and expanded state.

## Item kinds

```js excerpt:example/item-kinds
    { id: "sprint", kind: "background", start: start, end: start + 14 * day, label: "Sprint 1" },
    { id: "build", start: start + day, end: start + 9 * day, label: "Build" },
    { id: "review", kind: "box", start: start + 11 * day, label: "Review" },
    { id: "freeze", kind: "point", start: start + 13 * day, label: "Code freeze" },
```

| `kind` | Drawn as |
|---|---|
| `range` (default) | A bar over its span. |
| `box` | The item's bar, with a line from its middle to the axis. |
| `point` | A dot at its start, with a line to the axis. |
| `background` | A band behind every row. It is not an item you can select, drag or hit; it never covers one. |

::: example item-kinds

A box and a point are packed in time like any instant, so their rows do not change while you zoom. A background spans every row: a background bound to one group's rows is not supported yet.

## Adding and removing items

```js excerpt:example/add-remove
  editing: {
    enabled: true,
    add: true,
    remove: true,
    drop: true,
    snapMs: day,
    canRemove: (item) => item.id !== "ship",
  },
```

| | Pointer | Keyboard |
|---|---|---|
| Add | Double-click or double-tap empty row space. (On the axis a double tap still zooms.) | `n` or `Insert`: in the focused item's row, in the middle of the view. |
| Remove | The remove handle drawn on a selected item. | `Delete` or `Backspace` on the focused item. |
| Drop in | Drag an element carrying `application/x-temporeum-item` data onto a row. | `timeline.dropItem(payload)`, bound to your list's own key: the focused row, the middle of the view. |

Both ways reach the same command. `editing.createItem(target)` makes the item an add creates (by default a range with a free `item-N` id); `canAdd` and `canRemove` veto, and a removal of a selection is refused whole if one item is refused. The command's patches carry the whole item and its place in the list, so the inverse of a removal puts the item back exactly where it was. Adding and removing is not available with a [fetched source](async-data.md): the source owns its items.

::: example add-remove

## HTML templates

```js excerpt:example/add-remove
  template: (item) => `<strong>${item.label ?? ""}</strong>`,
```

A template draws each item's content as HTML, in place of its label. It is sanitised by default — the string is tokenised by the library, never given to `innerHTML`: `<script>`, `<style>`, `<iframe>` and their content are dropped, every `on…` handler is dropped, and so is every tag and attribute outside an allow-list (formatting tags; `class`, `title`, `lang`, `dir`, `datetime`, `data-*`, `aria-*`). `templateOptions` widens or narrows the lists; `sanitize: false` keeps everything and is only for a template you wrote from data you trust. The same template gives the same markup on the server and in the browser, so a [server-rendered](server-rendering.md) timeline hydrates with it. The item's accessible name stays its label and date range — so a template should show only words that are in that name, in the same order (WCAG 2.5.3, *Label in Name*): a speech-input user says what they see. To show more, put it in the label.

## Without the element

The pieces are pure functions on two entry points of the core, for a host that drives the [engine](core-engine.md) itself: `groupView`, `moveGroupCommand` and `groupKeyStep` on `@temporeum/timeline-core/groups`; `itemKindHooks`, `splitBackgrounds`, `addCommand`, `removeCommand`, `applyItemPatches` and `templateHooks` on `@temporeum/timeline-core/items`. The functions that place and write the tree of group headers — `headerPlacements`, `groupHeaderMarkup`, `groupLayerAttrs`, `groupHeaderCss`, `mirrorStyle` — are the element's, on `@temporeum/timeline-element/groups`. See [entry points](../reference/entry-points.md).
