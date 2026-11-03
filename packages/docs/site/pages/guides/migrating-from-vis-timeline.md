# Migrating from vis-timeline

Most vis-timeline setups move over by changing the shape of the data and renaming a handful of options — or in one call: `fromVis` from `@temporeum/timeline-core/vis-compat` reads vis-timeline's items, groups and options by vis-timeline's own rules and returns the configuration, with a warning for everything that did not carry over. This page maps every vis-timeline option, item field, method and event that has an equivalent, and lists, honestly, the ones that don't have one yet. Each mapping in the tables below is a running example in the test suite, and each "Not yet" row is checked against the configuration's types. A row that maps to something that doesn't exist fails the build.

::: example migration-vis-timeline

## The plugins

vis-timeline draws everything it can draw on every page. Here the parts a plain timeline does not need are plugins, each on its own entry point, registered once before the first timeline:

```js excerpt:example/migration-vis-timeline
import { createTimeline, registerPlugin } from "@temporeum/timeline-element";
import { itemsPlugin } from "@temporeum/timeline-element/items";
import { fromVis } from "@temporeum/timeline-core/vis-compat";

// vis-timeline draws every kind of item and lets the reader remove one:
// here those are the items plugin's. Groups, the time tools and right to
// left are plugins too (`/groups`, `/tools`, `/intl`) — register what the
// converted configuration uses.
registerPlugin(itemsPlugin);
```

What `fromVis` can put in a configuration, and the plugin each needs:

| In the converted configuration | Plugin | From |
|---|---|---|
| `groups` (from vis-timeline's groups with `nestedGroups`) | `groupsPlugin` | `@temporeum/timeline-element/groups` |
| item kinds `box` (vis-timeline's kind for an item without an end), `point`, `background`; `template`; `editing.add`, `editing.remove` (`editable: true` sets both, as in vis-timeline) | `itemsPlugin` | `@temporeum/timeline-element/items` |
| `hiddenDates`, `rolling`, `tooltip` | `toolsPlugin` | `@temporeum/timeline-element/tools` |
| `direction: "rtl"` | `intlPlugin` | `@temporeum/timeline-element/intl` |

A converted configuration that needs a plugin that is not registered throws a `TypeError` where the timeline is created, naming the import that is missing — it does not draw a timeline that quietly lacks the option. When in doubt, register all four; the `<script>`-tag build registers every plugin on load.

## What changes

- **No DataSet.** Items and groups are plain arrays. To change them, give the timeline the next array with `setItems` or `update({ groups })`.
- **Ids are strings and times are `Date` objects or epoch milliseconds.** vis-timeline also accepts date strings, and reads them with moment: `"2026-03-02"` is local midnight there, but UTC midnight for `new Date("2026-03-02")`. `fromVis` reads them the way vis-timeline does — in the runtime's zone, or the `timeZone` it is given — and its tests hold it to vis-timeline 8.5.6 itself, on every example of vis-timeline's own documentation.
- **Groups name their parent.** An item's `group` becomes `laneId`, a group's `content` becomes its `label`, and a nested group says `parentId` instead of its parent listing `nestedGroups` ([groups](groups-and-item-kinds.md)).
- **Labels are text; templates are sanitised HTML.** A `template` is run through the library's own sanitiser, which drops scripts and handlers, so no separate XSS filter is needed. For full control, `hooks.renderItem` returns scene nodes. Both also render on the server.
- **Editing produces commands.** A drag or a key press produces one reversible command, and `on("command")` receives it. The library never saves; what happens next is up to you ([editing](editing.md)).
- **The keyboard works by default.** Every gesture has a key, and screen readers see the timeline as a listbox ([accessibility](accessibility.md)).

## The mapping

The timeline in each row's example has five items in two lanes; the row's code is the only difference.

{{migration:vis-timeline}}

## What is not here yet

The "Not yet" rows above, in short:

- rows inside a group's rows (vis-timeline's `subgroup`), and a background bound to one group;
- the axis on top, item alignment, a custom time axis, hiding the major or minor labels;
- inline item styles, group templates and context-menu events.

Nested groups, item types and adding and removing from the timeline are [plugins](groups-and-item-kinds.md); so are hidden dates, draggable time bars, rolling mode, tooltips ([time tools](time-tools.md)), and right to left and a dictionary for the timeline's words ([internationalisation](internationalisation.md)). Live changes without a reload are in the base, and `fromVis` converts a setup in one call. If your app depends on one of the rest, say so in an issue: the order is decided by what users need.
