# Performance

A frame is cheap when it writes little. The engine can draw the whole frame — items, labels, axis, lanes, decorations — in a stable space wider than the viewport, so that a pan or a zoom step inside it changes nothing but one transform per layer, and the browser half keeps nodes and writes only what changed.

`createTimeline` — and with it the element and the React component — draws in that space at every size (`sceneSpace: "auto"`, the default). At rest it shows the labels an exact frame shows; during a gesture, the ones each sixteenth of a view could place, and the labels of the items the view's edges cut off, as at rest.

## The budget

Measured in Chromium at a 4× CPU slowdown, 1440 × 900, 10 000 items, missed frames:

| View | `createTimeline` | The engine, by hand | Without a scene space |
|---|---|---|---|
| pan, ~2 050 items visible | 0% | 0% | ~40% |
| 2× pinch zoom from there | ~2–3% | ~2–3% | ~35–40% |
| 4× pinch zoom from there | ~2–3% | ~2–3% | ~30–40% |
| pan at 2×, ~1 050 items and ~1 030 labels | 0–2% | 0% | ~50% |
| 4.3× ctrl+wheel zoom from a fresh page, 8 notches in and out | ~1–2% | ~0–2% | ~15–20% |

The budget is 5%, and both of the first two columns are checked by scripts in the repository, which fail when a view goes over it: `npm run bench:assert -w @temporeum/timeline-core` drives the engine the way the [engine guide](core-engine.md) shows, `npm run bench:public -w @temporeum/timeline-docs` drives `createTimeline` from the shipped bundle, with nothing but `density: "dense"` set, `bench:deep` runs the 4× pinch on both, and `bench:wheel` the [benchmark](../benchmark.md)'s ctrl+wheel zoom, on a fresh page, the median of three. Each also runs its page without a scene space, and that run has to fail the budget, or the measurement could not tell good from bad; the 4× pinch also runs without steps (below), and fails at about 9–12%, and the wheel zoom without wheel runs (below), and fails at about 37%. The numbers move by a point or two with what else the machine is doing.

By hand, with the engine alone, the loop that keeps the space is this — `createTimeline` runs the same one:

```js excerpt:example/core-engine
const loop = createFrameLoop(element, () => {
  space = planSceneSpace(space, view(), { settle: !gesture, levels: true });
  // …
  mount.update(result.scene);
  // At rest the overscan fills in a strip per frame: plan again, and draw
  // again while the plan still changes.
  if (!gesture && planSceneSpace(space, view(), { settle: true }) !== space) loop.request();
  // A zoom re-anchors a step at a time: the old scale stands in until the
  // view is drawn again, a tile a frame.
  if (result.pendingTiles > 0) loop.request();
});
```

## What makes it cheap

- **The scene space** is drawn for the viewport plus, at rest, an overscan of one viewport per side that grows a tile per frame, on the side with more still to draw — about what a frame of a pan brings in. A gesture never draws ahead. While it runs the frame may be stretched up to 1.5×, text included, and the plan re-anchors exactly when it ends.
- **Steps** (`levels: true`). A zoom past the stretch re-anchors to half or twice the scale around the same origin, so the old tiles nest in the new ones: they stand in, scaled by one transform, and a frame draws two of the new ones in view (`budget`), nearest the middle first — and going back to a scale it came from, whose tiles are still drawn, it brings them back on screen a budget at a time too, since showing them moves every item back in. A re-anchor otherwise rewrites everything in view in one frame — at 2 000 items and a 4× slowdown, about three missed frames, six times in a 4× pinch. A step lands on the coarsest scale not coarser than the screen, so what it draws has the room the screen shows, and its tiles carry the labels the view had where it rested (`rest`): a label is not lost on the way, and a zoom in does not bring in, step by step, the hundreds of labels that only fit once it is in. Labels are lines of HTML, which the browser does not lay out again when the scale changes — SVG text it does, on every frame.
- **Wheel runs.** A wheel has no lift: the input machine makes a run of wheel steps one gesture (`kind: "wheel"`), from the first step that moves the view to 150 ms after the last, so `settle: !gesture` does not settle between notches. Without it, each notch re-anchors the space and starts filling the overscan before the next one arrives.
- **Tiles.** The drawn range is cut into tiles a sixteenth of a viewport wide, each drawn once and handed back as the same nodes, so a pan past what is drawn pays for the tile coming in, not for the range — and drawing a tile looks only at the items that start near it. Labels never collide across a tile edge, and a label after an item may run into the next tile.
- **Culling** in `(main, cross)` space with a one-row margin: nothing outside what is drawn gets a node, along time or across the lanes.
- **The layout is cached** per items array and checked element by element, so a pan does not re-pack 10 000 items. Replace items, do not write into them.
- **`mountScene`** skips a subtree handed back as the same object, matches items by id — across tiles too, out of a tile it let go of — and pools what leaves the screen: a long pan stops creating nodes once the pool is warm (`npm run bench:memory -w @temporeum/timeline-core`: under 0.5% of the live tree in the second half of a long pan, besides the labels the view gains).
- **One draw per frame**, however many pointer events arrive in it; the instance's store notifies at most once per frame too, and once more only when the selection or the focus changes, so what a listener reads is the change.

## For a host

- Leave `sceneSpace` at `"auto"` (the same as `true`). `false` draws every frame exact, which costs about 40% of the frames at 2 000 items in view. During a gesture a label is the one a sixteenth of a view could place, fitted to the room it had where the view rested; at rest the frame shows every label an exact frame does, `maxLabels` held over the whole view. `bare: true` on the space adds no labels during a gesture.
- Give a timeline with thousands of items `density: "dense"` or let `"auto"` choose; labels that do not fit are shortened up to a thousand items in a viewport's width and dropped past it — every label is a node the browser paints on every frame of a pan — reported in `result.labels.dropped`, and kept in each item's accessible name.
- Use `cluster: true` when items crowd: one marker is cheaper than fifty slivers, and easier to read.
- For data that does not fit in memory, pass a function as `items` ([async data](async-data.md)).
