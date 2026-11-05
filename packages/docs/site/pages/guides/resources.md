# Resources

A resource view is a timeline of who does what: the lanes are people, rooms or machines, and the items are the work assigned to them. Give the timeline `resources` and it draws, under each one, how loaded it is against what it can take, bands the stretches where it is overbooked, and lets the reader move work between resources and place the tasks not on the timeline yet.

```js excerpt:example/resources
const timeline = createTimeline(element, {
  items,
  resources,
  // How much of a person a task takes: all of them, unless it says.
  resourceOptions: { unitsOf: (item) => item.data?.units ?? 1 },
  editing: { enabled: true, crossLane: true, drop: true, snapMs: day },
```

::: example resources

## The plugin

```js excerpt:example/resources
import { createTimeline, registerPlugin } from "@temporeum/timeline-element";
import { mountTaskGrid } from "@temporeum/timeline-element/gantt";
import { itemsPlugin } from "@temporeum/timeline-element/items";
import { mountBacklog, resourcesPlugin } from "@temporeum/timeline-element/resources";

// The resource view is a plugin: registered once, before the first timeline.
// Dropping an unscheduled task onto it is the items plugin's.
registerPlugin(resourcesPlugin, itemsPlugin);
```

The resource view is a plugin on its own entry point, `@temporeum/timeline-element/resources`, with the list of unscheduled tasks (`mountBacklog`); the table of people beside it is the Gantt chart's task table (`mountTaskGrid`, from `/gantt`). A page that shows a plain timeline downloads none of it. Registered once, it serves every timeline on the page and the server renderer; a configuration with `resources` and no plugin throws where the timeline is created, naming the import that is missing. Dropping an unscheduled task onto the timeline is `editing.drop`, which is the items plugin's (`itemsPlugin`, from `@temporeum/timeline-element/items`): without it, `drop: true` throws the same way.

## Resources and assignments

```js excerpt:example/resources
// The people are the lanes. Dana works half time: a capacity of 0.5.
const resources = [
  { id: "ana", label: "Ana" },
  { id: "ben", label: "Ben" },
  { id: "dana", label: "Dana", capacity: 0.5 },
  { id: "lab", label: "Test lab", capacity: 2 },
];
```

- **A resource is a lane.** `{ id, label, capacity }`; the capacity is 1 when it is not given. An item whose `laneId` is a resource's id is work assigned to it.
- **`unitsOf` says how much of a resource an item takes** — 1 by default, all of a capacity of one. A half-time task is 0.5; a test lab with two benches has a capacity of 2.
- **A booking by the day takes the whole day.** An item with a `granularity` loads its resource over the units it is drawn over, in the timeline's `timeZone`; `resourceLoad` takes the same `timeZone` when you call it yourself.
- **With `lanes` or `groups`, the resources say which of those lanes are resources.** A team can be a group, and its people the groups inside it, each a resource.

## The load

Under each resource is a load lane. Its bars are the load at every moment: the sum of the units of the work running then, against the capacity — the dashed line, two thirds of the way up, so half as much again still fits. Where the load is above the capacity the bars turn red, the resource's own lane is banded, and each item running then gets the `tl-item--overbooked` class and says "overbooked, 200% of capacity" in its accessible name.

The load is exact, not sampled: the timeline sweeps each resource's work once, and an overload one minute long is found at any zoom. An instant, a background band and an item of no resource take nothing; an `open` item runs on. Only the lanes and the time in view are drawn — four paths at most, under the items — so 500 resources cost what the ones on screen cost.

`resourceOptions.histogram: false` leaves the load lanes out and keeps the bands and the names; `loadSize` sets the load lane's size across, 24 px by default.

## Moving work between resources

With `editing.crossLane`, the move that changes an item's lane is the move between resources: drag it onto another person, or press `Alt` with the arrow across the lanes. A load lane is not a place to put work — a drag that ends on one gives the item to the resource above it, and the keys step over it. Either way it is one `move` command, and `command.inverse` gives the work back.

## Placing the unscheduled tasks

```js excerpt:example/resources
// The tasks still to place, beside it.
mountBacklog(document.querySelector("#backlog"), timeline, { tasks, ariaLabel: "Unscheduled tasks", focusTarget: element });
```

`mountBacklog(container, timeline, options)` lists the tasks no item has the id of. A task is an item without its time, with a `durationMs`.

- **Drag a row onto the timeline** — with a mouse, a pen or a finger — and it is added where it was let go: the time under the pointer, the lane under it. A finger moving down the list scrolls it; moving across, it drags the row out.
- **Select a row and press `Enter`**, and it is added where the keyboard is: the middle of the view, in the focused item's lane. The new item is selected and focused, so the arrows move it in time and `Alt` and an arrow to another resource.
- Both are the same `add` command. **Undo it and the task is back on the list**: the list is the tasks not on the timeline, so it follows the items, with nothing to keep in step.

The timeline needs `editing: { enabled: true, drop: true }`, and `itemsPlugin` registered for the drop. The list does not save anything: storing the plan is yours, like every other edit.

## What it does not do yet

- **Levelling.** An overload is shown, not solved: nothing moves work to make room.
- **Capacity over time.** A resource's capacity is one number; holidays and part-time weeks are not in it. The [scheduler](scheduling.md)'s working calendars are per task.
- **Several resources on one item.** An item is in one lane, so it is assigned to one resource.
