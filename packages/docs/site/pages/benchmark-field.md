# Field benchmark: three browsers

This page measures a Temporeum timeline and a Temporeum Gantt chart in Chromium, Firefox and WebKit, on the same data, in the same box, with the same real input. Every number on this page, the list of what goes over the frame budget included, is generated from one file, `site/benchmark/field/results.json`, which one script run writes; the release check rebuilds the page and reads every number back from that file. No number on this page is typed by hand.

It measures this library only. Each page answers the script through a small contract, described at the top of `packages/docs/bench/field/kit.js`, so a page built the same way for another library can be measured with the same data and the same input.

## What is measured

- **First render.** From navigation until the items are on screen and the drawing has stopped changing.
- **Pan.** Missed frames and the slowest frames while the view is moved along time, the way each chart moves: a mouse drag for the timeline, a horizontal wheel for the Gantt chart, which scrolls.
- **Zoom.** The same while zooming with `Control` and the wheel.
- **Size of the page.** Elements in the box after load, item nodes, and how many items are on screen.
- **Memory.** The JavaScript heap after load and after the pan, in Chromium, the one browser that reports it.
- **Bytes.** The JavaScript each page loaded for the library, minified and gzipped.

## Method

Each workload runs on a page of its own, with the defaults and editing on, as users ship it. The timeline workload is items in interleaved streams across groups; the Gantt workload is one task per row, chained in runs. The run is not blind: it fails, and writes no results, if a page shows too few items, if a pan does not move the view and bring it back, if a zoom does not zoom and come back, if a pan or a zoom edits an item, or if a page throws.

There is no CPU slowdown in this run: only Chromium has one, and the point here is to measure the three browsers like for like. The slowed-down measurement, in Chromium, is the [benchmark](benchmark.md).

{{bench:field-method}}

**Reproduce:**

```bash
npm run bench:field -w @temporeum/timeline-docs
```

It builds the library, serves every page from its own server, runs the three browsers, writes the results, and checks them.

## Results

{{bench:field}}

## Over the frame budget

Generated from the results: every pan and zoom — the same workload, size and browser — whose median misses more frames than the budget the [performance guide](guides/performance.md) sets.

{{bench:field-budget}}

## What this measurement does not cover

- **A slowed-down CPU, a real phone, touch.** Every browser runs on the same desktop machine at full speed; the charts are dragged with a mouse, and nothing is pinched.
- **Features.** The pages show a plain timeline with groups and a Gantt chart with dependencies; the other plugins are not loaded.
- **Editing, data changes, long sessions, bundled builds.** No item is dragged; nothing is added or removed; the heap is read once after a pan; the library is measured as the files a no-build page loads.
