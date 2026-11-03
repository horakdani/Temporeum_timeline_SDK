# Clusters at dense zoom

When fifty events shrink to three pixels each, `cluster: true` draws one marker over the run, with their count on it. Zoom out in the [log recipe](../recipes/log.md) to see them form; tap one, or focus it and press `Enter`, and it opens.

```js excerpt:example/recipe-log
  // Events too close to tell apart become one marker with their count.
  cluster: true,
```

## What joins

Neighbours in one row whose drawn boxes are less than `gap` pixels apart (4), when each is drawn shorter than `itemSize` (12). An open interval, a band taller than a row, or anything long enough to read stays itself and ends the run. A run shorter than `minCount` (2) is drawn as items. Pass `{ gap, itemSize, minCount }` instead of `true` to tune it.

- **Decided in time, from the zoom level alone.** A pan never splits a cluster or changes a count; only a zoom does. A cluster never spans rows.
- **A cluster is all of its members.** It is drawn when any of them would be, and its count is its size, not the part on screen.
- **Opening** zooms so the cluster's time fills half the view (at least 2×), anchored where the user tapped. Members that are still too many come apart into smaller clusters — the next tap's target. Every opening emits `clusterOpened` with the cluster; at the zoom limit, where a cluster still holds, its `members` are the host's to show as a list.
- **One stop for the keyboard and the reader**: the arrows step over a cluster as one entry, and a cluster is never edited.

`hooks.describeCluster` names it in your language, `hooks.renderCluster` draws it. Without `cluster`, a frame is byte for byte what it was.

That is a gate: about 29 000 seeded frames are read back and compared with the same frame unclustered — every visible item is represented exactly once — and a real browser checks the live DOM after every wheel zoom, drag, tap and key.
