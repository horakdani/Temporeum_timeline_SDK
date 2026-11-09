# scripts/

The repository's own tooling: the checks that back the claims in the
documentation, the benchmarks behind the published numbers, and the build and
release helpers. Everything here is plain Node (`node scripts/<name>.mjs`);
most checks are also wired to an npm script in a package (`npm run test:… -w …`).

A check prints `<name>: passed` or `<name>: FAILED` and exits non-zero on a
failure. Many read a test runner's JSON report and fail when the report is
missing, so a suite that did not run cannot pass by accident; each has a
negative control that must fail.

Which of these run in CI is in `.github/workflows/ci.yml`; the measurements
that need a quiet machine run before each release
([RELEASING.md](../RELEASING.md#measurements)).

## Checks

| Script | Check | What it does |
|---|---|---|
| `sdk_check_a11y.mjs` | axe | Axe found 0 violations in EVERY measured state of the pages, with the WCAG 2.2 AA tags, in a real browser — and that the harness is not blind. |
| `sdk_check_acr.mjs` | acr | The conformance report (packages/docs/site/conformance/ wcag22.json) lists EVERY A and AA success criterion of WCAG 2.2, and every "supports" row is backed by an existing, PASSING test; no shipped page claims WCAG 2.2 AA without axe or the report behind it. `--static` (in CI) leaves out running the tests. |
| `sdk_check_add_remove.mjs` | add-remove | Adding and removing issue the same command by gesture and by keyboard, the inverse restores the exact starting point, and the host's veto is atomic. |
| `sdk_check_api_docs.mjs` | api-docs | Every name on a public entry point is documented, and every public function is called the way the naming rule says. |
| `sdk_check_async.mjs` | async | During fast zooming the results of cancelled requests NEVER reach the canvas. |
| `sdk_check_backlog.mjs` | backlog | An unscheduled task reaches the canvas by gesture and by keyboard alike, with the same command. |
| `sdk_check_bench_field.mjs` | bench-field | Every number on the field benchmark page comes from results.json, both workloads ran in all three browsers, and the list of what goes over the frame budget is built from the data, not by hand. |
| `sdk_check_bench_labels.mjs` | bench-labels | On the 10,000-item page of the throttled benchmark, panning and wheel zoom stay within the perf check's thresholds (<= 5% missed vsync, <= 100 ms longest frame), and that on the same page, zoomed in with a real wheel up to the density limit (the core's SHORTEN_DENSITY_LIMIT, 1000 items per view width), at least half of the visible items carry a label at rest — by the median of three fresh pages. |
| `sdk_check_calendar_view.mjs` | calendar-view | In the week and day views overlapping events sit side by side, none covers another, and they can be walked with the keyboard. |
| `sdk_check_canmove.mjs` | canmove | The host's rule really stops an edit — on EVERY path, and as a whole. |
| `sdk_check_cluster.mjs` | cluster | The sum of the clusters' counts ALWAYS equals the number of visible items — no item is lost. |
| `sdk_check_dep_routing.mjs` | dep-route | On generated projects, in both orientations and after every packing — every arrow leaves and arrives at the edge its type calls for, is orthogonal, is drawn under the items, and culling never drops a visible arrow (while, per the control, it does drop invisible ones: culling is not a no-op). |
| `sdk_check_deps.mjs` | deps | The core has ZERO runtime dependencies. |
| `sdk_check_drop.mjs` | drop | In a real browser an external item lands at the time and lane under the pointer (within 2 px), and it has a keyboard equivalent that places it in the focused lane, at the middle of the view. |
| `sdk_check_e2e_touch.mjs` | e2e-touch | The browser suite really ran — with real touch, device emulation, and on the SHIPPED package. |
| `sdk_check_e2e_touch_webkit.mjs` | e2e-touch-webkit | The gesture claims of the Chromium e2e-touch check in WebKit, on an emulated iPhone and iPad — and a negative control that fails. |
| `sdk_check_examples.mjs` | examples | EVERY documented example really runs. |
| `sdk_check_export_pdf.mjs` | export-pdf | The exported PDF is valid according to an independent parser (pdf.js, stopAtErrors), its text is selectable, and splitting it across pages loses no item. |
| `sdk_check_export_svg.mjs` | export-svg | In every case of the visual matrix the exported standalone SVG is pixel for pixel the same as the frame drawn on screen. |
| `sdk_check_exports.mjs` | exports | The exports map is correct for ESM, CJS and UMD. |
| `sdk_check_gantt_a11y.mjs` | gantt-a11y | A task's predecessors and successors are in its accessible description (in the rendered option's aria-label), and they can be reached with the keyboard: `[` gets to every predecessor, `]` to every successor, wrapping around. |
| `sdk_check_gesture.mjs` | gesture | The gesture suite really ran, and that what it measures is the REAL pipeline. |
| `sdk_check_gesture_parity.mjs` | no-gesture-only | There is no gesture-only capability: every gesture's route in the source has a key's twin that ends in the same function — proven statically. |
| `sdk_check_groups.mjs` | groups | On generated group trees, in both orientations — the descendants of a collapsed group are neither in the layout nor in the accessibility tree, expanding gives back the same layout, and reordering is a reversible command (dragging and the keyboard give the same one). |
| `sdk_check_hidden_dates.mjs` | hidden-dates | On generated hidden ranges, in both orientations: hidden time is not on the axis (both ends of a range sit on one pixel, a tick only on the seam), an item spanning it is drawn without it (in the scene too), and the zoom anchor holds across a hidden range — in the scale's zoom and in the machine's wheel. |
| `sdk_check_hitslop.mjs` | hitslop | With a coarse pointer even a 2 px item can be hit — and that this is down to the POINTER, not a large zone handed out to everyone. |
| `sdk_check_hybrid.mjs` | hybrid | In the SAME session, on the SAME machine instance, a drag starts at once with a mouse, while a finger needs a long press. |
| `sdk_check_i18n.mjs` | i18n | In a pseudo-locale there is not a single hard-coded string; in at least five locales and three non-Gregorian calendars the ticks align with the calendar's units. |
| `sdk_check_ical.mjs` | ical | Importing and exporting an iCal file round-trips to the same set of events. |
| `sdk_check_inverse.mjs` | inverse | The inverse of every command restores the EXACT starting state — for generated SEQUENCES too. |
| `sdk_check_item_kinds.mjs` | item-kinds | Box, point and background items are drawn, box and point items can be hit and get an accessible name, a background cannot be hit and never covers an item — in both orientations. |
| `sdk_check_keyboard.mjs` | keyboard | EVERY capability reachable by a gesture has a keyboard equivalent — at runtime, in both orientations. |
| `sdk_check_live_data.mjs` | live-data | On generated update sequences the incremental update (applyItemChanges + relayout) gives the same layout and the same frame as a full reload. |
| `sdk_check_memory.mjs` | memory | After a long pan the node count does not grow monotonically — that is, that the pool REALLY recycles, and does not merely exist. |
| `sdk_check_migration.mjs` | migration | Every mapping row of the vis-timeline, frappe-gantt and react-calendar-timeline guides is a running example, and the "not yet" rows really are absent from the configuration — an invented mapping FAILS. |
| `sdk_check_minimap.mjs` | minimap | Dragging the overview bar's window gives the same view as the matching pan (panDomainBy), with hidden dates too; by keyboard too. |
| `sdk_check_narrow_labels.mjs` | narrow-labels | Every item whose truncated label (at least 3 characters and an ellipsis) fits in the item's visible part or in the free space after it gets a label — on generated, dense data, in both orientations, in the exact frame AND in the resting item space; the visible labels do not overlap, none lands on another item, the text is the item's own text (whole, or its start with an ellipsis), and the full text is in the item's accessible name. |
| `sdk_check_nodom.mjs` | nodom | The core works without a DOM — proven on the BUILT package. |
| `sdk_check_orientation.mjs` | orient | EVERY geometry test ran horizontally AND vertically. |
| `sdk_check_pack.mjs` | pack | `npm publish --dry-run` of the packages to be released passes, and what the registry would receive is exactly what it should be. |
| `sdk_check_pan_memory.mjs` | pan-memory | The throttled benchmark's pan at 10,000 items keeps the heap growth to at most 6.5 MB — under two thirds of the earlier measured value (+10.4 MB) — by the median of three fresh pages, and that during the pan it stays within the perf check's thresholds (<= 5% missed vsyncs, <= 100 ms longest frame, by median). |
| `sdk_check_passthrough.mjs` | passthrough | The configuration does not swallow a core option: every option the core knows is passed on by `createTimeline` or left out with a stated reason. |
| `sdk_check_perf.mjs` | perf | 60 fps holds with 2000 visible items out of 10,000 — MEASURED, in real Chromium, with 4x CPU throttling — and that the measurement FAILS below the threshold. |
| `sdk_check_perf_deep.mjs` | perf-deep | The 4x pinch (zoom-deep: from 100 px to 400 px and back, two seconds) also holds the perf check's thresholds — on the core path (bench.html) AND on the public path (bench-public.html, createTimeline from the shipped bundle) — and that the measurement FAILS on two negative controls. |
| `sdk_check_perf_gantt.mjs` | perf-gantt | With 10,000 tasks and 10,000 dependencies, pan and wheel zoom are within the perf check's thresholds (<= 5% missed vsyncs, <= 100 ms longest frame, by the median of three fresh pages) — and without arrow culling (`gantt.cull: false`, the negative control) it FAILS: the pan or the zoom is over the threshold. |
| `sdk_check_perf_resources.mjs` | perf-resources | With 500 resources and 10,000 assignments, with load bands, pan and wheel zoom are within the perf check's thresholds (<= 5% missed vsyncs, <= 100 ms longest frame, by the median of three fresh pages) — and the sensitivity control (`?burn=24`: one and a half vsyncs of extra work on every frame during a gesture) FAILS: both the pan AND the zoom are over the threshold. |
| `sdk_check_perf_wheel.mjs` | perf-wheel | The throttled benchmark's zoom — on a fresh, quiet page, Control + a real wheel, 8 notches in and 8 out, every 50 ms, 1.2x per notch, a 4.3x peak — also holds the perf check's thresholds, on the core path (bench.html, the README's loop) AND on the public path (bench-public.html, createTimeline from the shipped bundle, with the throttled benchmark page's settings: editing on, the default density), and that the measurement FAILS on three negative controls. |
| `sdk_check_print.mjs` | print | With print media, every item of the full range appears on exactly one page. |
| `sdk_check_property.mjs` | prop | The property-based test really ran on generated input, and that it checked the overlap invariant with the core's own exported checker. |
| `sdk_check_public_any.mjs` | types | The second half of the types check — proves that there is no `any` in the PUBLIC API. |
| `sdk_check_range_select.mjs` | range-select | Range selection by gesture and by keyboard emits the same event (selectRange on both paths). |
| `sdk_check_resources.mjs` | resources | On generated assignments, utilisation in every time slot is the sum of the assignments, overallocation is marked exactly where it is over capacity, and dragging an item across is an undoable command. |
| `sdk_check_responsive.mjs` | responsive | At 320 / 375 / 768 / 1440 px the orientation and the density switch to the EXPECTED values, and there is no horizontal page scroll — in a real browser, on the SHIPPED package. |
| `sdk_check_rest_labels.mjs` | rest-labels | At rest the item area shows every label the exact frame keeps — on generated data, in both orientations. |
| `sdk_check_rrule.mjs` | rrule | The output matches the RFC 5545 examples and test vectors produced by an independent reference implementation exactly, across daylight-saving transitions too. |
| `sdk_check_rtl.mjs` | rtl | In RTL, horizontal time flows right to left, gestures and keys work mirrored, and the visual matrix's RTL cases pass. |
| `sdk_check_schedule.mjs` | schedule | On generated projects, scheduling honours every dependency, constraint and working calendar, is idempotent, matches an exhaustive reference solver on small cases, and the critical path is exactly the chain of zero-slack tasks. |
| `sdk_check_schedule_command.mjs` | schedule-cmd | Auto-scheduling is a single command, its inverse restores the exact starting point, and the core saves nothing while scheduling. |
| `sdk_check_schedule_cycles.mjs` | cycle | A dependency graph with a cycle reports an error naming the cycle's members in finite time, and changes nothing. |
| `sdk_check_ssr.mjs` | ssr | Importing in Node does not throw; the HTML rendered on the server hydrates. |
| `sdk_check_task_grid.mjs` | task-grid | After every scroll and collapse the grid rows line up with the lanes (measured against the lanes of the rendered frame), and on 10 000 rows too it is virtualised: only the rows in view plus the overscan go into the DOM. |
| `sdk_check_template.mjs` | template | The HTML template renders the same on the client and the server, the element keeps its accessible name, and a template containing a script does not run by default — WITH A NEGATIVE CONTROL: with `sanitize: false` the same template does reach the DOM. |
| `sdk_check_templates.mjs` | examples | The examples check, third part: every framework template (packages/docs/templates) builds and draws — with the PACKED tarballs, the way a user would get them. |
| `sdk_check_time_bars.mjs` | time-bars | A custom time bar can be moved by gesture and by keyboard, and the same move emits the same event (moveTimeBar on both paths). |
| `sdk_check_tooltip.mjs` | tooltip | The tooltip appears on mouse hover, on focus and on long press, disappears on Esc (focus and selection do not change), and the pointer can be moved onto it — WCAG 1.4.13: dismissible, hoverable, persistent. |
| `sdk_check_treeshake.mjs` | treeshake | A consumer gets only what it imports: no source module in two entry points, each entry point isolated, and an unused export costs nothing. |
| `sdk_check_vis_compat.mjs` | compat | The vis-timeline documentation's examples, run through the compatibility layer, put the same items at the same time and in the same group. |
| `sdk_check_visual.mjs` | visual | The second half of the visual check: proves that the visual MATRIX really ran to the end. |
| `sdk_check_wheel_run.mjs` | wheel-run | A run of wheel steps is ONE gesture in the machine — on generated runs, with the browser binding's single wake-up timer, the way attachInput drives it. |
| `sdk_check_zoom_anchor.mjs` | anchor | Zoom is anchored to the gesture's focus — and that the tolerance used for the measurement really is tight. |
| `sdk_check_zoom_labels.mjs` | zoom-labels | A label visible both before and after a zoom is missing from none of the zoom's frames — on generated, monotonic zoom gestures, driven by the README's loop (stepwise re-anchoring, redrawing until pendingTiles, at rest until the overscan is complete). |

## Benchmarks

| Script | What it does |
|---|---|
| `sdk_bench.mjs` | The perf check and the memory check: the measurement. |
| `sdk_bench_browsers.mjs` | The field benchmark: a Temporeum timeline and a Temporeum Gantt chart in Chromium, Firefox and WebKit. |
| `sdk_bench_compare.mjs` | The throttled benchmark: @temporeum/timeline-element in Chromium at a 4x CPU slowdown, at 1 000 and 10 000 items. |
| `sdk_bench_field.mjs` | The bench-labels check and the pan-memory check: the measurement on the throttled benchmark's OWN page (packages/docs/bench/temporeum.html), with 10 000 items and the same input as sdk_bench_compare.mjs: 1440 x 900, DPR 1, 4x CPU throttling before navigation, a fresh browser context for every page. |
| `sdk_bench_gantt.mjs` | The perf-gantt check's measurement: 10 000 tasks and 10 000 dependencies on the public path (packages/docs/bench/gantt.html, the shipped dist), pan and wheel zoom, with 4x CPU throttling, on fresh pages — and the same without arrow culling (`?cull=0`), as the negative control. |
| `sdk_bench_resources.mjs` | The perf-resources check's measurement: 500 resources and 10 000 assignments on the public path (packages/docs/bench/resources.html, the shipped dist), with load bands, pan and wheel zoom, with 4x CPU throttling, on fresh pages — and the same without load culling (`?cull=0`, for the record: culling is not load-bearing at this size), and a sensitivity control (`?burn=24`): during a gesture (drag, wheel) every frame of the page does one and a half vsyncs' worth (24 ms) of extra work — the negative control, which must fail. |
| `sdk_bench_schedule.mjs` | Scheduling 10 000 tasks and 20 000 dependencies in Node stays within its budget. |

## Build, release and shared helpers

| Script | What it does |
|---|---|
| `sdk_changelog.mjs` | The release heading of the six changelogs. |
| `sdk_cjs_types.mjs` | Types for CommonJS consumers: a `.d.cts` next to every `dist/**\/*.d.ts`. |
| `sdk_custom_elements.mjs` | The element's Custom Elements Manifest (`custom-elements.json`, schema 2.1.0): what an editor, Storybook or a framework's tooling reads to know `<temporeum-timeline>` — its attributes, its properties and its events, each with its type and its description. |
| `sdk_entries.mjs` | The core's entry points: entries.json -> package.json fields. |
| `sdk_gesture_vocabulary.mjs` | The gesture vocabulary — derived from the input machine's OWN types. |
| `sdk_ios_touch.mjs` | The touch-action measurement in real Mobile Safari (half of the e2e-touch-webkit check). |
| `sdk_nodom_probe.mjs` | The server-side probe: does the BUILT package run without a DOM. |
| `sdk_npm_dry_run.mjs` | The flags every `npm publish --dry-run` of the release checks runs with: a registry that is not there, so a version already on npm does not fail it under npm 11. |
| `sdk_page_bytes.mjs` | What a page of ours loads, in bytes, measured the one way the benchmarks and the numbers check share. |
| `sdk_property_reset.mjs` | Deletes the property reports BEFORE the run. |
| `sdk_rtl_snapshots.mjs` | The visual half of the rtl check: the visual matrix right-to-left, on the SHIPPED bundle. |
| `sdk_size.mjs` | The size budget of the non-base entry points: marginal cost. |
| `sdk_size_packages.mjs` | The size budgets of the element (with its engine, and the UMD file) and of the four components (their own bytes), with the core's meter; CI runs it on every Node. |
| `sdk_suite_report.mjs` | The shared half of the suite-report checks: reading a vitest JSON report. |
| `sdk_test_all.mjs` | The full suite (`npm run test:all`) is green, in EVERY package, not just in core. |
| `sdk_test_browsers.mjs` | The element's browser suite in Firefox and WebKit too, not only in Chromium, and proof that each run ran in the engine it was asked for. |
| `sdk_test_claims.mjs` | Every claim check of the core and the docs site (`test:<name>`: a suite and the checker that reads its report) in CI, and none forgotten. |
| `sdk_test_lowest_peers.mjs` | Every framework package's suite on the LOWEST version its peer range admits (with `--highest`: on the NEWEST, where development is not already there), and every peer range closed. |
| `sdk_vis_compat_vectors.mjs` | The vis-compat reference: vis-timeline 8.5.6 itself. |
| `sdk_visual_snapshots.mjs` | The first half of the visual check: visual regression on the SHIPPED bundle. |

One generator is not here but in the core package, because it is Python:
`packages/core/scripts/rrule-vectors.py` writes the rrule check's reference
vectors (`packages/core/test/rrule/vectors.json`) with python-dateutil, an
implementation independent of ours.
