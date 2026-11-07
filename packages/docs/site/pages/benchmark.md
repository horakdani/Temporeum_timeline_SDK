# Benchmark

This page measures `@temporeum/timeline-element` in Chromium at a 4× CPU slowdown, at 1 000 and 10 000 items, with real mouse input. Every number below comes from one script run on one machine; nothing is copied by hand. It says where the library falls short, and what the measurement does not cover. The [field benchmark](benchmark-field.md) runs a timeline and a Gantt chart in Firefox and WebKit too.

It measures this library only. The page answers the script through a small contract, described at the top of `packages/docs/bench/temporeum.html`, so a page built the same way for another timeline can be measured with the same data and the same input.

## What is measured, and why

A timeline is opened once and then dragged and zoomed for a long time, so the questions a user feels are:

- **Time to first render.** How long the page stays blank. Two numbers: when the items are on screen (visible), and when the item nodes first exist in the DOM, shown or not.
- **Pan smoothness.** Missed frames and the 95th-percentile frame time while dragging with a mouse.
- **Zoom smoothness.** The same while zooming with ctrl + mouse wheel.
- **Memory.** JavaScript heap after load and after the pan, after a forced garbage collection.
- **DOM size.** Nodes in the document after load, elements inside the timeline's container, item and label nodes.
- **Bytes.** Minified and gzipped size of the JavaScript the page loads for the library.

## Method

**Machine.** The machine, OS, Node and Chromium versions of the run are listed under the results. The published run used an Apple M4 laptop with Chromium (Playwright's `chromium-headless-shell`).

**Throttle.** Chromium's CPU throttle at **4x** (`Emulation.setCPUThrottlingRate`), set on every page before navigation. It approximates a mid-range phone's CPU; GPU and compositor are not throttled. As a check that the throttle is applied, the timeline is also loaded once unthrottled at each size, and at 10 000 items the throttled first render must be more than 1.5x the unthrottled one.

**Viewport.** 1440 x 900 CSS pixels, device pixel ratio 1. The timeline fills a 1440 x 900 container.

**Repetitions.** Every data size x scenario runs on **5 fresh pages**, each in a new browser context (no shared cache, no shared heap). Tables show the median, with min and max. First render has 10 samples, because both the pan page and the zoom page are fresh loads.

**Data.** Deterministic: 60 interleaved streams, an 8-day item every 10 days in each, so items overlap and pack into about 48 rows. Two sizes, **1 000** and **10 000** items. The initial view is the second fifth of the whole range: 257 items overlap it at 1 000, 2 057 at 10 000; an item is then about 330 px and 34 px wide. Every item has a label (`Item 123`).

**Configuration.** The defaults, plus what users ship: `createTimeline(container, { items, domain, height: 900, editing: { enabled: true } })`, imported as `@temporeum/timeline-element` through an import map that points at the built `dist` files. Density and `sceneSpace` are left at `auto`, so at both sizes it draws in the engine's scene space.

**Pan.** 24 real mouse drags (`page.mouse` down, move, up) of 240 px each, 12 towards later time and 12 back, on the time-axis band, so the drag is never an item edit. Each drag lasts 400 ms with a move about every 16 ms, then a 100 ms pause. Frames are recorded over the whole sequence, pauses included.

**Zoom.** The mouse at the centre of the timeline, `Control` held, 8 wheel notches in, then 8 out, 50 ms apart. A plain wheel pans or scrolls; ctrl + wheel zooms. Each notch has a `deltaY` of 45.6, which the engine turns into a 1.2x step. The peak zoom reached is recorded; it was 4.3x.

**Missed frame.** Frames are timed with `requestAnimationFrame` inside the page. With V = 1000 / 60 ms, an interval longer than 1.5 V counts as `round(interval / V) - 1` lost frames. Missed % = lost frames / (lost frames + recorded intervals) x 100. The p95 frame time is the 95th percentile of the intervals.

**First render.** From navigation start to the animation frame at which item nodes are in the container **and visible**, and two consecutive frames have seen no DOM mutation in it. "Items in DOM" is the first animation frame at which item nodes exist, visible or not.

**Heap and DOM.** `HeapProfiler.collectGarbage`, then `Performance.getMetrics`: `JSHeapUsedSize` and `Nodes` (whole document). MB is 10^6 bytes.

**Bytes.** The script records which JavaScript files the page actually loads and checks them against the expected list: the seven ES modules of a plain timeline's page (core `index.mjs`, `dom.mjs` and the shared `chunks/index.mjs` they both import, `live.mjs` for live data and `words.mjs` for the English words, element `index.mjs` and `element.shared.mjs`). The `dist` is not minified, so each file is minified with oxc (the minifier rolldown ships, the only one in the repository's dependencies), gzipped at level 9, and the sizes are summed. kB is 1000 bytes.

**The run is not blind.** The script exits with an error, and writes no results, if any of these fail: fewer item nodes than a quarter of the items in view; no labels at 1 000 items; the pan did not move the view by 2 880 px (within 25%) after 12 drags and back after 24; the zoom did not reach 2x and come back; a drag or wheel edited an item; the page loaded other JavaScript than expected; the throttle check above.

**Reproduce:**

```bash
npm run bench:compare -w @temporeum/timeline-docs
```

It builds the core and the element, serves the page from its own server on port 41764, and writes `packages/docs/site/benchmark/results.json`. `BENCH_REPS` changes the repetitions. The full run takes a few minutes.

## Results

{{bench:results}}

## Analysis

**First render.** At 1 000 items the timeline shows its items after about 160 ms, at 10 000 after about 270 ms. The item nodes are in the DOM a little earlier: about 140 ms and 250 ms. Unthrottled, the first render takes about 110 ms at 1 000 items.

**Pan.** At 1 000 items the pan misses 0% of frames. At 10 000 items it misses about 0.9% of frames with a p95 of one frame (16.8 ms). The first drag after load is the most expensive one: until the reader touches it, the timeline draws only what is in view, so that drag draws the strips that come in (see Memory).

**Zoom.** At 1 000 items the zoom misses 0% at the median. At 10 000 items the median is 3% — 1.6–4.6% over the five repetitions — with a p95 of one frame (16.8 ms). No label blinks on the way: the tiles a zoom draws anew carry the labels the view had where it rested, and the labels of items the edges cut off stay on the visible part. The run zooms 4.3× and back in 16 notches. A wheel has no lift, so the engine makes a run of notches one gesture, which ends 150 ms after the last; inside it, past a 1.5× stretch on the way in, or squeezed to half on the way out, the scene space re-anchors to half or twice its scale — never coarser than the screen — while the old scale's tiles stand in, and the view is drawn again two tiles (an eighth of a view) a frame — on the way back too, though the tiles of the scale it returns to are still drawn. At rest the overscan fills in one tile, a sixteenth of a view, per frame.

**Memory.** After load the heap is 2.7 MB at 1 000 items and 6.7 MB at 10 000. Over the pan it grows to 4.3 MB and 12.0 MB. The growth is deliberate: once the timeline has been touched, it draws a viewport of overscan on each side while it rests, so the next pan does not have to draw it — that is three viewports of nodes instead of one.

**DOM.** After load the document has 1 627 and 6 344 nodes. The timeline picks a row height at which all rows fit (`density: auto`) and culls across the rows too: 2 079 item nodes, 2 057 on screen, which is every item that overlaps the view (257 of 257 at 1 000). It draws a label where it fits, shortened with an ellipsis where it does not fit whole: 253 labels on 257 items at 1 000. At 10 000, where a viewport holds about 2 000 items each about 34 px wide, it draws **none**: past 1 000 items in a viewport's width it draws only labels that fit whole, because a label on each of 2 000 items made the pan miss a third of its frames (see below).

**Bytes.** 58.4 kB minified and gzipped: what a plain timeline's page loads without a bundler — the core's main entry point, `/dom`, `/live` and `/words`, and the element's base. The plugins (Gantt, groups, time tools, other languages…) are not in it, and a bundler tree-shakes it further.

## Where it falls short

- **Labels at 10 000 items.** At this density the timeline draws no item text. Shortened labels exist (`labelOverflow`) and are on by default up to 1 000 items in a viewport's width, but here a label on each of the 2 000 items in view made the pan miss about a third of its frames in Chromium at a 4× slowdown, and 600 of them still a fifth: every label is a node the browser paints on every frame of a pan, as SVG text and as HTML alike. Dropped labels are listed in `labels.dropped`, and each item keeps its full text in its `<title>` and accessible name, but what you see at a glance is less text. Drawing labels at this density needs them painted off the DOM; that is not built yet.
- **Pan at 10 000 items.** About 0.9% missed is under the 5% budget but not 0: it is mostly the first drag after load, which draws what comes into view; a timeline that has been touched draws ahead while it rests (the [performance guide](guides/performance.md)).
- **Zoom at 10 000 items, through the engine's own loop.** The zoom misses about 3% here at the median (1.6–4.6% over the five repetitions); the check that runs the same zoom on the README's loop and through `createTimeline` (`npm run bench:wheel -w @temporeum/timeline-docs`) measures about 3.0% through `createTimeline` and 4.6% on the README's loop. That is the price of drawing a zoom's new tiles never coarser than the screen, so that a label that fits at both ends of a zoom is on every frame of it. The budget is 5%.
- **Memory over a pan.** The heap grows over the pan, from 6.7 MB to 12.0 MB at 10 000 items: the overscan it draws once touched.
- **Bytes.** Not small for a timeline, and the `<script>` tag's UMD file, which carries every plugin, is nearly twice a plain timeline's page; a page that minds its bytes imports the modules.
- **Variance between runs.** The five repetitions of this run spread 0.6–1.0% (pan) and 1.6–4.6% (zoom) at 10 000 items. Between runs on the same machine the numbers move by a point or more. With other work loading the machine, the same zoom measured up to 15–17%, which is why the numbers come from an otherwise idle machine. Differences of a few points should not be read as meaningful.

## What this measurement does not cover

- **Browsers other than Chromium for the labels.** An item's label is a line of HTML in an SVG `foreignObject`; it is measured here in Chromium only.
- **Features.** It measures a plain timeline: no plugin is loaded — nested groups, box, point and background items, HTML item templates, adding and deleting items from the UI, hidden date ranges, draggable custom time bars, rolling mode, right to left — and none of the vertical layout, the keyboard, server rendering, export, the calendar views or the async loader is exercised.
- **Other browsers and devices.** Only Chromium, only headless, only a throttled desktop CPU. The [field benchmark](benchmark-field.md) runs Firefox and WebKit too, unthrottled. No real phone, no touch or trackpad pinch; the zoom is a mouse wheel with `Control` held.
- **Editing.** Editing is enabled, but no item is dragged or resized; the checks make sure of that.
- **Data changes.** No `setItems` updates, no async loading, no grouped data, no multiple instances on one page.
- **Long sessions.** Heap is measured once after a 24-drag pan, not over minutes of use.
- **Bundled builds.** No tree-shaken bundle: the files a page without a build step loads.
