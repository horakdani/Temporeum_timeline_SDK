# @temporeum/timeline-core

An editable, responsive timeline engine for the web — from millennia down to
seconds, with collision-free lanes and **zero runtime dependencies**.

> **Status: 1.0.0.** Stable: the API follows semantic versioning
> ([stability policy](https://horakdani.github.io/Temporeum_timeline_SDK/stability.html)). Most
> hosts want the live timeline on top of this engine —
> [`@temporeum/timeline-element`](https://github.com/horakdani/Temporeum_timeline_SDK/tree/main/packages/web-component#readme) (`createTimeline`
> and `<temporeum-timeline>`), or its component for
> [React](https://github.com/horakdani/Temporeum_timeline_SDK/tree/main/packages/react#readme), [Vue](https://github.com/horakdani/Temporeum_timeline_SDK/tree/main/packages/vue#readme),
> [Svelte](https://github.com/horakdani/Temporeum_timeline_SDK/tree/main/packages/svelte#readme) or [Angular](https://github.com/horakdani/Temporeum_timeline_SDK/tree/main/packages/angular#readme).
> This package is the engine itself, for a host that builds its own shell.

```bash
npm install @temporeum/timeline-core
```

## Why another timeline

Not because the world needs one more read-only chronology widget. The gap is
five properties held at the same time:

- **editable** — drag and resize with reversible commands, not just a view
- **genuinely responsive** — a vertical phone layout is the same code path as
  the horizontal desktop one, not a separate build
- **zero runtime dependencies** — the scale and tick maths are our own
- **accessible** — every gesture has a keyboard equivalent, WCAG 2.2 AA
- **typed** — no `any` on the public surface, enforced in CI

## Without a DOM

The engine is pure: layout, ticks and rendering are functions of their
arguments, and the renderer produces a scene — plain objects — that a
serialiser writes out. The same call renders in a browser, on a server, in a
worker or in a test:

```js excerpt:example/core-static
import { createTimeScale, generateTicks, itemRect, layoutItems, renderTimeline, renderToSvgString } from "@temporeum/timeline-core";

// Layout packs in time, not pixels: the rows survive a zoom.
const scale = createTimeScale(domain, 960);
const layout = layoutItems(items);
for (const placed of layout.items) {
  lines.push(`${placed.item.id}: row ${String(placed.row)}, x ${itemRect(placed, scale).main.toFixed(0)}`);
}

// Round ticks, in the reader's own zone.
const ticks = generateTicks(domain, 960, { timeZone: "Europe/Budapest" });

// A frame is plain objects; the serialiser writes it out. The same call runs on a server.
const frame = renderTimeline({
  items,
  lanes: [{ id: "work", label: "Work", pinned: true }, { id: "travel", label: "Travel" }],
  domain,
  width: 960,
  height: 220,
  theme: "light",
  timeZone: "Europe/Budapest",
  decorations: [{ kind: "banding" }, { kind: "marker", id: "ship", time: Date.UTC(2025, 5, 3), label: "release" }],
});
document.querySelector("#picture").innerHTML = renderToSvgString(frame.scene);
```

Times are epoch milliseconds or `Date` objects. Four things about a frame are
worth knowing before you adopt it:

- **No colour is in the markup.** Items carry classes, the classes read
  `var(--tl-*)`, and the stylesheet is generated per render. Restyle with CSS
  alone; dark mode is not a second render. Both built-in themes are
  contrast-checked against WCAG AA in the test suite.
- **A label too long for its room is shortened** — at least three
  characters, then an ellipsis — inside its item or in the free room after
  it (`labelOverflow`). Past a thousand items in a viewport's width only
  whole labels are drawn, and what is given up is reported in
  `labels.dropped`, with the reason. The full text stays in the item's
  `<title>` and accessible name. A label is a line of HTML in a
  `foreignObject`: style its text with `color`.
- **Density is orientation-dependent.** A horizontal lane is a 22-pixel row;
  a vertical one is a column, because the label still has to read
  horizontally.
- **The renderer is a pure function.** Two renders of the same input produce
  the same bytes, so the visual regression suite is committed SVG files, with
  no browser involved.

Ticks are **round** (midnight, the first of the month, a multiple of 200
years), in the **reader's time zone** with daylight saving handled, from
**milliseconds to millennia**, without a date library.

## Interactive, by hand

An input machine turns pointer, wheel and keyboard events into effects; the
`/dom` entry point is the only code that touches the DOM, and it receives the
element as an argument. This is the loop the performance budget below is
measured on:

```js excerpt:example/core-engine
import { createInputMachine, createNavigator, densityMetrics, planSceneSpace, renderTimeline } from "@temporeum/timeline-core";
import { attachInput, createFrameLoop, mountScene } from "@temporeum/timeline-core/dom";

const machine = createInputMachine({ domain, mainSize: width, crossSize: height });
const mount = mountScene(element); // patches, pools, never reads the DOM

const loop = createFrameLoop(element, () => {
  space = planSceneSpace(space, view(), { settle: !gesture, levels: true });
  const result = renderTimeline({ items, domain, width, height, density: "compact", crossOffset, space, focusedId: machine.focusedId, ariaLabel: "Two thousand items" });
  mount.update(result.scene);
  machine.setKeyboard({ navigator: createNavigator(result.layout, { crossInset: metrics.axisSize }) });
  // …
  if (result.pendingTiles > 0) loop.request();
});

attachInput(element, {
  machine,
  onEffects(effects) {
    for (const e of effects) {
      if (e.type === "viewport") ({ domain, crossOffset } = e);
      if (e.type === "gestureStart") gesture = true;
      if (e.type === "gestureEnd") gesture = false;
    }
    loop.request(); // one draw per frame, however many events
  },
});
```

- **A pointer holds an *instant*, not a delta.** Every move re-solves the
  viewport from what each pointer grabbed; two fingers pin two instants.
  Over 2000 generated gestures the worst anchor error is **2.3e-10 px**.
- **No clock, no timers in the machine.** A gesture is a replayable sequence
  of plain objects, so its tests are not flaky. What waits — a long press,
  the end of a wheel run — asks to be woken (`schedule`), and the binding
  calls `machine.elapse` when it is due. `machine.pan` and
  `machine.zoom` are the programmatic twins of the gestures.
- **The keyboard** reaches every capability a gesture does — that is a gate,
  derived from the machine's own types — and walks the order a navigator
  builds from the frame just drawn.
- **Editing, async data and clusters** are `machine.setEditing` with a hit
  tester, `createItemLoader`, and `cluster` with `clusterZoom`. The source of
  `createTimeline` in `@temporeum/timeline-element` is the complete wiring.

The guides — editing, responsive, accessibility, async data, clustering,
theming, server rendering, performance — are on the [docs site](https://horakdani.github.io/Temporeum_timeline_SDK/), each
with a live example; the [core engine guide](https://horakdani.github.io/Temporeum_timeline_SDK/guides/core-engine.html) is this
loop in full.

## Performance

Measured in Chromium at a 4x CPU slowdown, 1440 x 900, 10 000 items
(`npm run bench:assert -w packages/core`), missed frames:

| view | with a scene space | without |
|---|---|---|
| pan, ~2050 items visible | 0% | ~35–40% |
| 2x pinch zoom from there | ~2–3% | ~30–35% |
| 4x pinch zoom from there | ~2–3% | ~30–35% |
| pan at 2x, ~1050 items and ~1030 labels | 0% | ~45–50% |
| 4.3x ctrl+wheel zoom from a fresh page, 8 notches in and out | ~0–2% | ~15–20% |

The "with" column is the loop above: `levels: true` re-anchors a zoom a
power of two at a time, the old scale's tiles standing in until the view is
drawn again — without it the 4x pinch misses ~12% (`npm run bench:deep -w
@temporeum/timeline-docs` runs that as a control, and it has to fail). `createTimeline` in
`@temporeum/timeline-element` runs the same loop at every size
(`sceneSpace: "auto"`), and the same views through it, from the shipped
bundle, are measured on their own (`bench:public` and `bench:deep` in
`@temporeum/timeline-docs`): a budget only the engine's own page keeps would
not be a promise.

A wheel has no lift, so the machine makes a run of wheel steps one gesture
(`kind: "wheel"`): it starts with the first step that moves the view and ends
150 ms after the last, through the machine's own wake-up. That is what keeps
`settle: !gesture` from settling between two notches — without it the same
loop misses ~37% of the wheel zoom's frames (`npm run bench:wheel -w
@temporeum/timeline-docs` runs that as a control too).

## Formats

| Entry | Format | For |
|---|---|---|
| `dist/index.mjs` | ESM | bundlers, modern Node |
| `dist/index.cjs` | CJS | `require()` |
| `dist/index.umd.js` | UMD | `<script>` tag (`window.TemporeumTimeline`), AMD |
| `dist/dom.mjs` / `.cjs` / `.umd.js` | the `/dom` subpath | `attachInput`, `observeSize`, `openDetail`, `mountScene`, `createFrameLoop` — the browser bindings |

The other entry points, each a subpath with the same three formats and a
budget of its own on top of the core: `/groups`, `/items`, `/gantt`,
`/schedule`, `/resources`, `/tools`, `/export`, `/intl`, `/calendar`,
`/vis-compat`, `/story`, and two small ones — `/live` (`applyItemChanges`, `relayout`:
live data, the same functions `/tools` exports) and `/words` (the English
dictionary: `DEFAULT_STRINGS`, `resolveStrings`, `sayIn`, `fill`,
`formatAmount`, the same objects `/intl` exports), 2 kB each. The base of
`@temporeum/timeline-element` loads these two instead of `/tools` and
`/intl`, which come only with its plugins. The docs site's
[entry points page](https://horakdani.github.io/Temporeum_timeline_SDK/reference/entry-points.html) lists them all, with
their budgets.

The entry points are listed once, in `entries.json`; the build, the exports
map and the size gates follow from it. The ES and CommonJS builds share code:
the engine's code is in `dist/chunks/index.*`, `dist/index.*` re-exports it,
and `/dom` imports it from there rather than carrying a copy. The UMD files
are self-contained. Import through the package name, not `dist/` paths.

The package is `sideEffects: false`, so an unused export costs nothing.
`require()` gets CommonJS types (`.d.cts`), `import` gets ESM types, and
`moduleResolution: "node10"` finds `/dom` through `typesVersions` — the
exports map is checked against a packed tarball in a foreign project
(`scripts/sdk_check_exports.mjs`), not against this workspace.

**Server rendering and hydration.** In the browser,
`mountScene(container, { hydrate: true })` takes a server-rendered `<svg>`
over — it reads it once and patches from there — instead of drawing a second
one beside it. The element and the React component do it for you.

## Budgets

Checked by CI on every push and pull request
(`.github/workflows/ci.yml`; a failing one fails the build):

| Budget | Limit |
|---|---|
| core, minified + gzipped, on its own | 31.2 kB |
| `/dom` entry point, minified + gzipped, on top of the core | 4.25 kB |
| a source module shipped in two files | 0 |
| runtime dependencies | 0 |
| `any` on the public surface | 0 |
| coverage, per file | 90% |
| visual regression | 3 widths x 2 orientations x 2 themes |
| zoom anchor error after a gesture | 0.01 px |
| labels an exact frame keeps that a scene space at rest does not show | 0 |
| items with room for a shortened label that show none, up to 1 000 items in a viewport's width | 0 |
| labels shown before and after a zoom that a frame of it does not show | 0 |
| core options the element's configuration drops without a stated reason | 0 |
| capabilities reachable only by a gesture | 0 |
| items of an aborted request on the canvas, during fast zoom | 0 |
| axe violations, WCAG 2.2 AA, every state of the demo pages and every page of the docs site | 0 |

Measured before each release, on a quiet machine — a shared CI runner's
timing is no yardstick, and the last one needs the iOS Simulator. The
commands are in
[RELEASING.md](https://github.com/horakdani/Temporeum_timeline_SDK/blob/main/RELEASING.md#measurements):

| Budget | Limit |
|---|---|
| frames missed, pan / zoom / labelled pan, 2000 visible items, 4x CPU slowdown, with a scene space | 5% |
| the same, through `createTimeline` from the shipped bundle | 5% |
| frames missed, 4x pinch zoom, on both paths | 5% |
| frames missed, 4.3x ctrl+wheel zoom from a fresh page, on both paths, median of three | 5% |
| JavaScript heap growth over the comparison benchmark's pan, 10 000 items, median of three | 5.2 MB |
| nodes created in the second half of a long pan | 0.5% of the live tree, plus the labels the view gains |
| page scroll under a one-finger drag on the timeline, Mobile Safari in the iOS Simulator, iPhone and iPad | 0 px |

Every code block in this README is checked against a running example in CI
(`npm run test:examples -w @temporeum/timeline-docs`).

## License

MIT
