# Recipe: a Gantt-style plan

Tasks in work streams, a milestone, a kickoff the plan cannot start before, and undo. Drag a task to move it — also into another stream — drag its end to resize it, or use the keys (`Alt` + arrows).

::: example recipe-gantt

## How it is made

- **Streams are lanes**, tasks are items with a `laneId`, and the milestone is an item without an `end`: an instant, which covers its day (`granularity: "day"`).
- **Colour per stream** is a class on the item that sets the fill token: `className: "phase-design"` and `#timeline .phase-design { --tl-item-fill: #d6e4ff; }`. See [theming](../guides/theming.md).
- **The kickoff is a rule, not a check afterwards.** `canMove` is asked before every step of a move or a resize, by pointer and by key, and a `false` holds the item where it was.
- **Undo is the command's inverse.** The timeline emits one `command` per edit; the page keeps two stacks.
- **Decorations** draw what is not an item: `banding` stripes the weeks, a `marker` calls out the kickoff on the axis, an `era` shades the code freeze behind the tasks.

```js excerpt:example/recipe-gantt
  decorations: [
    { kind: "banding" },
    { kind: "marker", id: "kickoff", time: KICKOFF, label: "Kickoff" },
    { kind: "era", id: "freeze", start: at(31), end: at(35), label: "Code freeze" },
  ],
```

## Arrows, progress and a task table

This recipe draws the plan with decorations and rules. Dependency arrows, progress, baselines, milestone diamonds and a task table beside the chart are built in: see [Gantt charts](../guides/gantt.md). [The scheduler](../guides/scheduling.md) puts tasks back in order and finds the critical path when you call it; nothing reschedules on its own — `canMove` can refuse a move that would break an order, and a `command` handler can call the scheduler.
