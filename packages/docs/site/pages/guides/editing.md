# Editing

Turn it on with `editing: { enabled: true }`. A drag moves an item, a drag on its edge resizes it, and every gesture has a key ([accessibility](accessibility.md)). The edit is shown while it happens and kept when it ends.

## The library never saves

An edit comes out of the timeline as a **command**: what changed, before and after, and its own `inverse`. What to do with it is the host's — send it to a server, put it on an undo stack, refuse it. The [Gantt recipe](../recipes/gantt.md) keeps an undo and a redo stack in a dozen lines:

```js excerpt:example/recipe-gantt
// Every edit is one reversible command; its inverse is the undo.
timeline.on("command", ({ command }) => {
  undo.push(command);
  redo.length = 0;
  // …
});
undoButton.addEventListener("click", () => {
  const command = undo.pop();
  timeline.applyCommand(command.inverse);
  redo.push(command);
  // …
});
```

`itemMoved` and `itemResized` carry the item, `from`, `to` and the same command. One gesture or one key press is one command, so one undo step. `applyCommand` applies a command (or an inverse) and does not report it back as a new edit.

## Rules

```js excerpt:example/recipe-gantt
  editing: {
    enabled: true,
    snapMs: DAY,
    crossLane: true,
    // The host's rule, asked before every move: nothing starts before kickoff.
    canMove: (item, next) => next.start === undefined || next.start >= KICKOFF,
  },
```

- `snapMs` snaps starts and ends to a multiple of the step.
- `crossLane` lets a drag carry an item into another lane; off by default.
- `canMove(item, next)` is asked before each step of a move or a resize; returning `false` holds the item where it was. It is asked for keyboard moves too.
- `multiSelect` lets the user select several items; a move of one of them moves the selection.
- Per item, `movable: false` and `resizable: false` opt out.

A mouse takes an item at once; a finger holds still for 500 ms first, because on a touch screen the same movement pans the view. That is `interactions.moveTrigger: "auto"`, the default, and it is decided per gesture — a laptop with a touch screen gets both.

## Adding, removing and dropping

Moving and resizing need no plugin. Adding an item from the timeline itself, removing one and dropping one in from outside — `editing.add`, `editing.remove` and `editing.drop` — are the items plugin's, `itemsPlugin` from `@temporeum/timeline-element/items`, with the item kinds and templates:

```js excerpt:example/add-remove
import { createTimeline, registerPlugin } from "@temporeum/timeline-element";
import { itemsPlugin } from "@temporeum/timeline-element/items";

// Adding, removing and dropping items are a plugin: registered once, before the first timeline.
registerPlugin(itemsPlugin);
```

Without it, `add`, `remove` or `drop` set to `true` throws a `TypeError` where the timeline is created or updated — `The editing.add option needs the items plugin: …` — and the instance is left as it was. The gestures, the keys and the commands are in [groups and item kinds](groups-and-item-kinds.md#adding-and-removing-items).
