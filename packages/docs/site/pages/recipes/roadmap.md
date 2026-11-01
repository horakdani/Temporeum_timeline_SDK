# Recipe: a product roadmap

Quarters as eras, teams as lanes, a line for today, an ongoing item with no end anyone would promise, and a detail line for the selection. Read-only: a roadmap is shown more often than it is edited.

::: example recipe-roadmap

## How it is made

- **Quarters** are `era` decorations, generated in a loop; the axis still finds its own ticks.
- **Today** is a `now` decoration. The engine never reads a clock, so the time is the host's: `Date.now()` in a real page, a fixed date here so the example looks the same every day.
- **Ongoing work** is an `open` item: it reaches past the view, and nothing is packed after it in its row.
- **Status** is a class that sets the fill.
- **The detail** comes from the selection: click an item, or focus it with `Tab` and the arrows and press `Enter`.

```js excerpt:example/recipe-roadmap
timeline.on("selectionChanged", ({ ids }) => {
  const item = items.find((candidate) => candidate.id === ids[0]);
  detail.textContent = item === undefined ? "Select an item to read about it." : `${item.label}: ${item.data}`;
});
```

To let a product manager move items, add `editing: { enabled: true, snapMs }` and send the `command` events to your server — the [Gantt recipe](gantt.md) shows the undo.
