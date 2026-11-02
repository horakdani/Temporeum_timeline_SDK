# Changelog

## 1.0.0 — Unreleased

The first release. From here on the package follows [semantic versioning](https://github.com/horakdani/Temporeum_timeline_SDK/blob/main/packages/docs/site/pages/stability.md): nothing public is removed before 2.0.

### The engine (`@temporeum/timeline-core`)

- The `(main, cross)` projector, the time scale and an adaptive axis: round ticks from milliseconds to millennia, in the reader's time zone, with daylight saving handled, without a date library. Hidden time as a `TimeWarp` (`RenderOptions.hiddenDates`), and the axis's ticks from a source of the host's (`RenderOptions.ticks`).
- Layout: collision-free packing in time, lanes, pinned lanes, sublane spans, open intervals, granularity-aware instants; cached per items array, or given by the host (`RenderOptions.layout`).
- Rendering: a DOM-free scene and `renderToSvgString`; themes as CSS custom properties, light and dark, contrast-checked; density levels; labels placed, shortened with an ellipsis where they do not fit whole (`labelOverflow`), and reported; decorations (banding, now, eras, markers).
- Input: one pointer pipeline for mouse, pen and touch — pan, pinch, double tap, two-finger tap, wheel (a run of wheel steps is one gesture) — anchored to the instant under each pointer; cooperative touch.
- Editing: move, resize, snap, `canMove`, cross-lane moves, multi-select, and reversible commands with an `inverse`.
- Responsive: orientation, density and detail surface resolved from the container; pointer-aware hit slop.
- Performance: the scene space — tiles a sixteenth of a viewport, a deep zoom that re-anchors a step at a time, an overscan that grows while the view rests — with culling, node reuse and pooling in `mountScene`, and `createFrameLoop`.
- The axis's context label: the month a view of days is in (the year of a view of months, the day of a view of hours), held at the start of the axis over a surface the ticks slide under — `formatTick` writes it too, with `tick.context` set; `axisContext: false` turns it off.
- Accessibility: a listbox with `aria-activedescendant`, a keyboard twin for every gesture, reduced motion. The timeline's focus ring is drawn inside its box, so a parent with `overflow: hidden` cannot cut it. In forced colours (Windows High Contrast) every token is a system colour, the plugins' shapes included, and what is selected or focused is the highlight, drawn wider. An item's dates are read with their era before year 1 ("15 Mar 44 BC", not "15 Mar 44").
- Data: `createItemLoader`, windowed and aborting. Clusters at dense zoom, with `clusterZoom`.
- Server rendering: `mountScene(container, { hydrate: true })` adopts a server-rendered `<svg>`.
- `VERSION` is `"1.0.0"`.

### Entry points

The engine keeps a budget of 31 kB minified and gzipped. Everything else is on an entry point of its own, budgeted by what it adds on top of the engine, and a page downloads only the ones it imports. `entries.json` lists them; the build, the `exports` map and the size checks follow from it.

- **`/dom`** — the browser binding: `attachInput` (mirrored for right to left), mounting and hydration.
- **`/gantt`** — dependencies (`FS`, `SS`, `FF`, `SF`, with a lag or a lead) routed as arrows in both orientations and culled to the view; progress, baselines and milestones; the task grid's rows and keys; accessible names that say what a task depends on.
- **`/schedule`** — `scheduleTasks`: dependencies, eight kinds of constraint, working calendars (`WorkCalendar`, `workTime`), slack and the critical path, conflicts and cycles. `scheduleCommand` turns the result into one command, undone by its inverse.
- **`/resources`** — load against capacity (`resourceLoad`, `loadAt`, `overloads`), load lanes, overbooked assignments, and the backlog of unscheduled tasks.
- **`/groups`** — nested groups as header lanes, collapsing, reordering as commands, and the keys of a WAI-ARIA tree.
- **`/items`** — item kinds (`box`, `point`, `background`); adding and removing as commands, with vetoes; drops; HTML templates, sanitised by a DOM-free parser against an allow-list.
- **`/tools`** — hidden dates (fixed and repeating, on a zone's wall clock), time bars, the overview strip, range selection, rolling mode, zoom presets and lane headers.
- **`/live`** — live data: `applyItemChanges` and `relayout`, which packs only the lanes a change touched.
- **`/words`** — the library's words in English: `DEFAULT_STRINGS`, `resolveStrings`, `sayIn`, `fill`, `formatAmount`.
- **`/intl`** — right to left (`mirrorScene`, `mirrorCss`), dictionaries (`describeHooks`, `pseudoStrings` to find a word a translation missed), and the axis in any calendar `Intl` knows (`calendarTicks`).
- **`/calendar`** — RFC 5545 recurrence (`parseRRule`, `formatRRule`, `occurrences`), events and their expansion, iCalendar read and written (`parseICal`, `formatICal`), and the layout of the week and the day.
- **`/export`** — print pages across the whole range, a PDF writer of the library's own (`scenesToPdf`, with selectable text), standalone SVG and PNG, and the print view.
- **`/vis-compat`** — `fromVis(items, groups, options)`: a vis-timeline 8 setup as a configuration, with a warning for everything that did not carry over; `parseVisTime` reads times by vis-timeline's rules.
- **`/story`** — TimelineJS's JSON and Google Sheets template as items, lanes and eras (below).

### Styling

- `RenderOptions.metrics` (`MetricsProvider`): the sizes a frame draws, packs and measures with, by level and orientation — `densityMetrics` by default. `fitDensity` decides `auto` with them, the lane headers and the printed pages draw with them.
- `partNames` and `withParts` (`/dom`), and `MountOptions.parts`: every node's classes as its `part`s, without the `tl-` prefix (`item item-selected`, `timeline`), a host's own class as it is — written by the mount where a class changed, for a drawing in a shadow root.
- `slotHooks` (`/items`): an empty box over each item, for a framework to render into.

### Stories (`@temporeum/timeline-core/story`)

- `fromTimelineJS`: TimelineJS's JSON as items, lanes and eras — each event's slide in `data.story`, a lane per group, the eras as `era` decorations, the title slide apart — with a warning for everything that does not carry over (`background-image`, `cosmological`, `no-date`, `out-of-range`, `end-before-start`, `duplicate-id`).
- `fromTimelineSheet`, `readTimelineSheet`, `parseCsv`, `sheetCsvUrl`: TimelineJS's Google Sheets template, read from the CSV the sheet publishes.
- `storyMedia`: a media link sorted by its address — an image, a video, a sound file, a YouTube (without cookies), Vimeo (without tracking), SoundCloud, Spotify or Google Maps player, or a link.
- `storyDateText`: a slide's date written to its precision, a span by its ends, a year before 1 AD with its era.

### Packaging

- ESM, CommonJS and UMD builds — the UMD files, for a `<script>` tag, minified; code shared between entry points ships once (`dist/chunks/`). CommonJS types (`.d.cts`) and `typesVersions` for `moduleResolution: "node10"`.
- Zero runtime dependencies. MIT, published with npm provenance.
