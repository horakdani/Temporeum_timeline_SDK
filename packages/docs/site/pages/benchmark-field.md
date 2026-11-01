# Field benchmark: four rivals, three browsers

This page compares Temporeum with the libraries people move from — vis-timeline and react-calendar-timeline for a timeline, frappe-gantt and SVAR React Gantt for a Gantt chart — on the same data, in the same box, with the same real input, in Chromium, Firefox and WebKit. Every number on this page, the list of where Temporeum loses included, is generated from one file, `site/benchmark/field/results.json`, which one script run writes; the release check rebuilds the page and reads every number back from that file. No number on this page is typed by hand.

## The trade-off

Temporeum is not the smallest download, and this section says so next to what the bytes buy. On the largest workload of each kind, it puts four things side by side: the JavaScript each page loads, how soon the first drawing is done, how many elements the page keeps, and how many frames a pan misses. A rival's bytes are what its page loads, its peers included. Every word that compares and every number below is generated from the results with the noise rule of the losses list: where the difference is within the noise, the sentence says "about".

{{bench:field-tradeoff}}

## What is measured

- **First render.** From navigation until the items are on screen and the drawing has stopped changing.
- **Pan.** Missed frames and the slowest frames while the view is moved along time, by each library's own way of moving it: a mouse drag for the timelines, a horizontal wheel for the Gantt charts, which scroll.
- **Zoom.** The same while zooming with `Control` and the wheel, where the library zooms that way. frappe-gantt switches between day, week and month views instead, so it has no zoom rows.
- **Size of the page.** Elements in the box after load, item nodes, and how many items are on screen.
- **Memory.** The JavaScript heap after load and after the pan, in Chromium, the one browser that reports it.
- **Bytes.** The JavaScript each page loaded for its library, minified and gzipped. The React libraries are bundled with React, so React's own share is a row of its own.

## Method

Each library runs on a page of its own, with its defaults and editing on, as users ship it, built by the same generator. The timeline workload is items in interleaved streams across groups; the Gantt workload is one task per row, chained in runs. The Gantt charts show about the same span: the day columns frappe-gantt draws by default, SVAR's cells sized to match, and Temporeum's view set to it. The run is not blind: it fails, and writes no results, if a page shows too few items, if a pan does not move the view and bring it back, if a zoom does not zoom and come back, if a pan or a zoom edits an item, or if a page throws.

There is no CPU slowdown in this run: only Chromium has one, and the point here is to compare like with like across browsers. The slowed-down comparison with vis-timeline, in Chromium, is the [benchmark](benchmark.md).

{{bench:field-method}}

**Reproduce:**

```bash
npm run bench:field -w @temporeum/timeline-docs
```

It installs the pinned rivals into `packages/docs/.bench-work` (outside the workspace; no dependency is added), bundles the React libraries with their peers, serves every page from its own server, runs the three browsers, writes the results, and checks them.

## Results

{{bench:field}}

## Where it loses

Generated from the results: every comparison — the same workload, size, browser and metric — in which a rival's median is lower than Temporeum's by more than the noise, with the rule in the method table above.

{{bench:field-losses}}

## What this comparison does not cover

- **A slowed-down CPU, a real phone, touch.** Every browser runs on the same desktop machine at full speed; the timelines are dragged with a mouse, and nothing is pinched.
- **The same zoom depth everywhere.** Each library turns a wheel notch into a zoom step its own way; where its rule allows, the step is the same for all, and the depth each reached is in the results.
- **Features.** The libraries do not draw the same things: frappe-gantt has no task table, SVAR's is hidden here, and only some of them stack overlapping items. The migration guides map one feature set onto the other.
- **Editing, data changes, long sessions, bundled builds.** No item is dragged; nothing is added or removed; the heap is read once after a pan; the React libraries are measured as one bundle each, Temporeum as the files a no-build page loads.
