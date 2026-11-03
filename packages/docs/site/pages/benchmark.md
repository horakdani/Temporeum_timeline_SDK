# Benchmark: Temporeum vs vis-timeline

This page compares `@temporeum/timeline-element` with [vis-timeline](https://github.com/visjs/vis-timeline), the most widely used open-source timeline for the web, on the same data, in the same browser, with the same real input. Every number below comes from one script run on one machine; nothing is copied by hand. The page says where we lose, and what the comparison does not cover.

## What is measured, and why

A timeline is opened once and then dragged and zoomed for a long time, so the questions a user feels are:

- **Time to first render.** How long the page stays blank. Two numbers: when the items are on screen (visible), and when the item nodes first exist in the DOM, shown or not. They differ for vis-timeline, see below.
- **Pan smoothness.** Missed frames and the 95th-percentile frame time while dragging with a mouse.
- **Zoom smoothness.** The same while zooming with ctrl + mouse wheel.
- **Memory.** JavaScript heap after load and after the pan, after a forced garbage collection.
- **DOM size.** Nodes in the document after load, elements inside the timeline's container, item and label nodes.
- **Bytes.** Minified and gzipped size of the JavaScript the page loads for the library.

## Method

**Machine.** The machine, OS, Node and Chromium versions of the run are listed under the results. The published run used an Apple M4 laptop with Chromium (Playwright's `chromium-headless-shell`).

**Throttle.** Chromium's CPU throttle at **4x** (`Emulation.setCPUThrottlingRate`), set on every page before navigation. It approximates a mid-range phone's CPU; GPU and compositor are not throttled. As a check that the throttle is applied, each library is also loaded once unthrottled, and at 10 000 items the throttled first render must be more than 1.5x the unthrottled one.

**Viewport.** 1440 x 900 CSS pixels, device pixel ratio 1. Both timelines fill a 1440 x 900 container.

**Repetitions.** Every library x data size x scenario runs on **5 fresh pages**, each in a new browser context (no shared cache, no shared heap). Tables show the median, with min and max. First render has 10 samples, because both the pan page and the zoom page are fresh loads.

**Data.** Deterministic, the same generator on both pages: 60 interleaved streams, an 8-day item every 10 days in each, so items overlap and pack into about 48 rows. Two sizes, **1 000** and **10 000** items. The initial view is the second fifth of the whole range: 257 items overlap it at 1 000, 2 057 at 10 000; an item is then about 330 px and 34 px wide. Every item has a label (`Item 123`).

**Configuration.** Each library with its defaults, plus what users ship:

- Temporeum: `createTimeline(container, { items, domain, height: 900, editing: { enabled: true } })`, imported as `@temporeum/timeline-element` through an import map that points at the built `dist` files. Density and `sceneSpace` are left at `auto`, so at both sizes it draws in the engine's scene space.
- vis-timeline 8.5.6 (vis-data 8.0.6), the standalone UMD build: `new vis.Timeline(container, new vis.DataSet(items), { start, end, height: "900px", editable: true, showCurrentTime: false })`. The now line is turned off because Temporeum draws none by default.

**Pan.** 24 real mouse drags (`page.mouse` down, move, up) of 240 px each, 12 towards later time and 12 back, on the time-axis band, so neither library treats the drag as an item edit. Each drag lasts 400 ms with a move about every 16 ms, then a 100 ms pause. Frames are recorded over the whole sequence, pauses included.

**Zoom.** The mouse at the centre of the timeline, `Control` held, 8 wheel notches in, then 8 out, 50 ms apart. Both libraries zoom on ctrl + wheel with their defaults: vis-timeline zooms on any wheel, Temporeum only on ctrl + wheel (a plain wheel pans or scrolls). They turn the wheel's `deltaY` into zoom differently, so the per-notch `deltaY` is chosen per library to make every notch the same 1.2x step: 100 for vis-timeline, 45.6 for Temporeum. The peak zoom reached is recorded; it was 4.3x for both.

**Missed frame.** Frames are timed with `requestAnimationFrame` inside the page. With V = 1000 / 60 ms, an interval longer than 1.5 V counts as `round(interval / V) - 1` lost frames. Missed % = lost frames / (lost frames + recorded intervals) x 100. The p95 frame time is the 95th percentile of the intervals.

**First render.** From navigation start to the animation frame at which item nodes are in the container **and visible**, and two consecutive frames have seen no DOM mutation in it. "Items in DOM" is the first animation frame at which item nodes exist, visible or not.

**Heap and DOM.** `HeapProfiler.collectGarbage`, then `Performance.getMetrics`: `JSHeapUsedSize` and `Nodes` (whole document). MB is 10^6 bytes.

**Bytes.** The script records which JavaScript files each page actually loads and checks them against the expected list: five ES modules for Temporeum (core `index.mjs`, `dom.mjs` and the shared `chunks/index.mjs` they both import, element `index.mjs` and `element.shared.mjs`), one file for vis-timeline. Each file is gzipped at level 9 and the sizes are summed. Our `dist` is not minified, so ours is minified with oxc (the minifier rolldown ships, the only one in the repository's dependencies); vis-timeline's `.min.js` is measured as shipped. A second row re-minifies both with the same oxc minifier. kB is 1000 bytes.

**The run is not blind.** The script exits with an error, and writes no results, if any of these fail: fewer item nodes than a quarter of the items in view; no labels at 1 000 items; the pan did not move the view by 2 880 px (within 25%) after 12 drags and back after 24; the zoom did not reach 2x and come back; a drag or wheel edited an item; a page loaded other JavaScript than expected; the throttle check above.

**Reproduce:**

```bash
npm run bench:compare -w @temporeum/timeline-docs
```

It builds the core and the element, installs the pinned vis-timeline and vis-data into `packages/docs/.bench-work` (outside the workspace, no dependency is added), serves both pages from its own server on port 41764, and writes `packages/docs/site/benchmark/results.json`. `BENCH_REPS` changes the repetitions. The full run takes about 7 minutes.

## Results

{{bench:results}}

## Analysis

**First render.** At 1 000 items Temporeum shows its items after about 160 ms, vis-timeline after about 1 170 ms. Most of vis-timeline's time is a timer, not work: given a `start` and `end`, it inserts its items early (about 300 ms, the "items in DOM" row) but keeps its root `visibility: hidden` until its once-a-second auto-resize poll triggers the redraw that reveals them. Unthrottled, it still takes about 1 090 ms. A user sees that blank second, so the visible number is the one that counts, but the CPU comparison is the "items in DOM" row: about 140 ms against 300 ms. At 10 000 items the work dominates: about 710 ms against 3 720 ms in the DOM, 720 ms against 3 940 ms visible.

**Pan.** At 1 000 items both are smooth: Temporeum misses 0% of frames, vis-timeline about 1.3%, and the p95 frame time is one frame (16.7 to 16.8 ms) for both. At 10 000 items Temporeum misses about 0.8% of frames with a p95 of one frame (16.8 ms), vis-timeline about 62% with a p95 of about 217 ms. The first drag after load is the most expensive one: until the reader touches it, Temporeum draws only what is in view, so that drag draws the strips that come in (see Memory).

**Zoom.** At 1 000 items Temporeum misses 0% in every repetition, vis-timeline in four of the five (one 1.6%). At 10 000 items Temporeum's median is 1.6% — two of the five repetitions miss nothing, three about 1.6% — with a p95 of one frame (16.7 ms), vis-timeline about 67% (p95 about 167 ms). No label blinks on the way: the tiles a zoom draws anew carry the labels the view had where it rested, and the labels of items the edges cut off stay on the visible part. The run zooms 4.3× and back in 16 notches. A wheel has no lift, so the engine makes a run of notches one gesture, which ends 150 ms after the last; inside it, past a 1.5× stretch on the way in, or squeezed to half on the way out, the scene space re-anchors to half or twice its scale — never coarser than the screen — while the old scale's tiles stand in, and the view is drawn again two tiles (an eighth of a view) a frame — on the way back too, though the tiles of the scale it returns to are still drawn. At rest the overscan fills in one tile, a sixteenth of a view, per frame.

**Memory.** After load Temporeum's heap is 2.7 MB at 1 000 items and 6.7 MB at 10 000; vis-timeline's is 6.4 MB and 37.5 MB. Over the pan, Temporeum's grows to 4.2 MB and 11.9 MB, vis-timeline's to 7.1 MB and 38.8 MB. Temporeum's growth is deliberate: once the timeline has been touched, it draws a viewport of overscan on each side while it rests, so the next pan does not have to draw it — that is three viewports of nodes instead of one.

**DOM.** After load Temporeum has 1 628 and 6 345 nodes in the document, vis-timeline 1 735 and 15 214. The two libraries do not draw the same thing, so these are not the same workload:

- vis-timeline renders every item in (and a little around) the time window, including rows below the 900 px box: at 10 000 items 3 014 item nodes, of which 695 are on screen; at 1 000, 314 nodes and 112 on screen. Its default rows are taller, so fewer rows fit.
- Temporeum picks a row height at which all rows fit (`density: auto`) and culls across the rows too: 2 079 item nodes, 2 057 on screen, which is every item that overlaps the view (257 of 257 at 1 000). It shows two to three times as many items in the same box.
- vis-timeline puts the text in every item and clips it: 3 014 label nodes. Temporeum draws a label where it fits, shortened with an ellipsis where it does not fit whole: 253 labels on 257 items at 1 000. At 10 000, where a viewport holds about 2 000 items each about 34 px wide, it draws **none**: past 1 000 items in a viewport's width it draws only labels that fit whole, because a label on each of 2 000 items made the pan miss a third of its frames (see below).

**Bytes.** 52.9 kB minified and gzipped for Temporeum against 155.8 kB for vis-timeline's standalone build (154.2 kB re-minified with the same minifier). The standalone build carries vis-data, moment, hammer.js, its stylesheet and Graph2d; vis-timeline's peer build, with its dependencies installed separately, can share them with the rest of an app. Ours is what a plain timeline's page loads without a bundler — the core's main entry point, `/dom`, `/live` and `/words`, and the element's base; the plugins (Gantt, groups, time tools, other languages…) are not in it, and a bundler tree-shakes it further.

## Where it loses

Every metric where vis-timeline is better, or where Temporeum is not clearly better:

- **Labels at 10 000 items.** Temporeum draws no item text at this density; vis-timeline draws clipped text in every item. Shortened labels exist (`labelOverflow`) and are on by default up to 1 000 items in a viewport's width, but here a label on each of the 2 000 items in view made the pan miss about a third of its frames in Chromium at a 4× slowdown, and 600 of them still a fifth: every label is a node the browser paints on every frame of a pan, as SVG text and as HTML alike. Temporeum lists dropped labels in `labels.dropped` and keeps the full text in each item's `<title>` and accessible name, but what you see at a glance is less text. Drawing labels at this density needs them painted off the DOM; that is not built yet.
- **Pan and zoom at 1 000 items.** A tie: 0–1.3% missed on the pan, 0% on the zoom, p95 16.7 to 16.8 ms for both.
- **Pan at 10 000 items.** About 0.8% missed is under the 5% budget but not 0: it is mostly the first drag after load, which draws what comes into view; a timeline that has been touched draws ahead while it rests (the [performance guide](guides/performance.md)).
- **Zoom at 10 000 items, through the engine's own loop.** The comparison zoom misses about 1.6% here; the check that runs the same zoom on the README's loop and through `createTimeline` (`npm run bench:wheel -w @temporeum/timeline-docs`) measures about 3.1% on both. That is the price of drawing a zoom's new tiles never coarser than the screen, so that a label that fits at both ends of a zoom is on every frame of it. The budget is 5%.
- **Memory over a pan.** Temporeum's heap still grows over the pan, from 6.7 to 11.9 MB at 10 000 items (vis-timeline 37.5 to 38.8 MB): the overscan it draws once touched. Well under vis-timeline's in absolute terms, but it grows and vis-timeline's barely does.
- **Bytes, against lighter libraries.** A third of vis-timeline's standalone build, but not small: the [field benchmark](benchmark-field.md) measures a Gantt page of frappe-gantt at about a quarter of ours.
- **Variance between runs.** The five repetitions of this run spread 0.6–1.0% (pan) and 0–1.6% (zoom) at 10 000 items, with a desktop session and a download running beside it; an earlier run on a quiet machine spread 0–0.4% and 0–1.6%, and vis-timeline's numbers moved by as much (58% and 63% then, 62% and 67% now). In another run, while another project's test suite loaded the same machine, the same zoom measured up to 15–17%. Differences of a few points between the two libraries should not be read as meaningful.

## What this comparison does not cover

- **Browsers other than Chromium for the labels.** An item's label is a line of HTML in an SVG `foreignObject`; it is measured here in Chromium only.
- **Features vis-timeline has and Temporeum does not:** subgroups (rows inside a group's rows) and backgrounds bound to one group, and Graph2d. Nested groups, box, point and background items, HTML item templates, adding and deleting items from the UI, hidden date ranges, draggable custom time bars, rolling mode and right-to-left layout are plugins, which this page does not load: it measures a plain timeline.
- **Features Temporeum has and vis-timeline is not measured on here:** a vertical orientation on the same code path and automatic orientation and density per container width, a keyboard equivalent for every gesture (with a parity test against the gesture), listbox semantics for screen readers, server rendering with hydration (`renderTimelineHtml`), export to SVG, PNG and a PDF of its own and a print of the whole range with no server, right to left, a dictionary for every word it says and the axis in any calendar `Intl` knows, recurring events by RFC 5545, week and day views and iCalendar import and export (on entry points of their own, so the timeline's download does not grow), a vis-timeline compatibility layer, a windowed async item loader that aborts requests the view has left, reversible edit commands, and zero runtime dependencies.
- **Other browsers and devices.** Only Chromium, only headless, only a throttled desktop CPU. The [field benchmark](benchmark-field.md) runs Firefox and WebKit too, unthrottled, against four rivals. No Firefox, no Safari, no real phone, no touch or trackpad pinch; the zoom is a mouse wheel with `Control` held.
- **Editing.** Both pages have editing enabled, but no item is dragged or resized; the checks make sure of that.
- **Data changes.** No `setItems` or `DataSet` updates, no async loading, no grouped data, no multiple instances on one page.
- **Long sessions.** Heap is measured once after a 24-drag pan, not over minutes of use.
- **Bundled builds.** No tree-shaken bundle of either library, and not vis-timeline's peer build.
