# Migrating from frappe-gantt

A frappe-gantt chart moves over by turning each task into an item in a lane of its own, its `dependencies` string into a list of arrows, and its `progress` from a percentage into a fraction. This page maps every frappe-gantt option, task field, method and event that has an equivalent, and lists, honestly, the ones that don't have one yet. Each mapping in the tables below is a running example in the test suite, and each "Not yet" row is checked against the configuration's types. A row that maps to something that doesn't exist fails the build.

::: example migration-frappe-gantt

## The plugins

```js excerpt:example/migration-frappe-gantt
import { createTimeline, registerPlugin } from "@temporeum/timeline-element";
import { ganttPlugin, mountTaskGrid } from "@temporeum/timeline-element/gantt";
import { toolsPlugin } from "@temporeum/timeline-element/tools";

// The Gantt chart, and the zoom presets for frappe-gantt's view modes.
registerPlugin(ganttPlugin, toolsPlugin);
```

frappe-gantt is all chart; here the chart is a plugin, and so are some of the tools a frappe-gantt setup maps to. The Gantt plugin draws the arrows, the progress, the baselines and milestones. The time tools plugin, `toolsPlugin` from `@temporeum/timeline-element/tools`, is what the zoom presets for the view modes (`zoomPresets`), the popup (`tooltip`), ignored weekends (`hiddenDates`) and a click on a date (`rangeSelect`) need. Register both once, before the first timeline; a configuration that needs a plugin that is not registered throws a `TypeError` where the timeline is created, naming the import that is missing.

## What changes

- **A task is an item in a lane.** frappe-gantt draws one task per row; give each task a lane with the same id, and the lanes are the rows. With `gantt` and the Gantt plugin (`registerPlugin(ganttPlugin)`, from `@temporeum/timeline-element/gantt`), the timeline draws the arrows, the progress fill, the baseline and milestones ([Gantt](gantt.md)); `mountTaskGrid`, from the same entry point, draws the table beside it.
- **Times are `Date` objects or epoch milliseconds.** frappe-gantt reads `"2026-03-02"` as local midnight, and a date-only `end` as the end of that day. `new Date("2026-03-02")` is UTC midnight, so convert the way the example does: local midnight, and a day added to a date-only end.
- **Progress is 0 to 1**, not 0 to 100.
- **Dependencies are one list for the chart**, `{ from, to, type, lagMs }`, not a string on each task. The type is finish-to-start unless it says otherwise.
- **Read-only until told.** frappe-gantt is editable until `readonly`; a Temporeum timeline is read-only until `editing.enabled`. A move moves one task: the scheduler of `@temporeum/timeline-core/schedule` says where the ones after it go ([scheduling](scheduling.md)).
- **Views are zooms.** Day, week, month and year are the default `zoomPresets` (with `toolsPlugin` registered); the axis follows the zoom instead of being redrawn per mode.
- **The keyboard works by default.** Every gesture has a key, the arrows follow the dependencies with `]` and `[`, and screen readers see the chart as a listbox ([accessibility](accessibility.md)).

## The mapping

The chart in each row's example has five tasks with progress, each in its own lane, joined by a chain of dependencies; the row's code is the only difference.

{{migration:frappe-gantt}}

## What is not here yet

The "Not yet" rows above, in short: dragging progress (and its event), expected progress, curved arrows, switching the grid lines off, header heights, and a picture on the bar. If your chart depends on one of them, say so in an issue: the order is decided by what users need.
