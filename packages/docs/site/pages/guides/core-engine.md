# The engine

`@temporeum/timeline-core` is what the element and the React component are built on, and it is usable on its own: geometry, layout, rendering, input, keyboard, loading and clustering, as pure functions and plain objects. Nothing in it touches a DOM global — the `/dom` entry point is the only code that touches the DOM, and even it receives the element as an argument — which is what keeps server rendering honest.

```bash
npm install @temporeum/timeline-core
```

## Without a DOM

The renderer produces a scene — plain objects — and a serialiser writes it out, so the same call renders on a server, in a worker or in a test:

::: example core-static

```js excerpt:example/core-static
const frame = renderTimeline({
  items,
  domain,
  width: 960,
  height: 220,
  theme: "light",
  timeZone: "Europe/Budapest",
});
document.querySelector("#picture").innerHTML = renderToSvgString(frame.scene);
```

The renderer is a pure function: the now line takes its time as an argument, the default tick format is locale-free, and two renders of the same input produce the same bytes. Ticks are **round** (midnight, the first of the month, a multiple of 200 years), generated in the **reader's time zone** with daylight saving handled, from milliseconds to millennia, without a date library.

## By hand, interactive

An input machine turns pointer, wheel and key events into effects; you draw. This is the loop the engine's performance budget is measured on:

::: example core-engine

- **No clock, no timers.** The machine takes plain objects with their own timestamps, so a gesture is a replayable sequence and its tests are not flaky. `machine.pan` and `machine.zoom` are the programmatic twins of the gestures.
- **The keyboard** walks the order a navigator built from the frame just drawn (`machine.setKeyboard({ navigator })`).
- **Editing** needs a hit tester from the same frame (`createHitTester`, `machine.setEditing`); `createTimeline`'s source is the complete wiring, and the shortest correct one.
- **`createItemLoader`** is the windowed async loader, `createHitTester` and `clusterZoom` the cluster opening, `fitDensity` and `resolveOrientation` the responsive decisions — each a pure function of a measurement.

## Formats

| Entry | Format | For |
|---|---|---|
| `dist/index.mjs` / `.cjs` | ESM / CJS | bundlers, Node |
| `dist/index.umd.js` | UMD | `<script>` tag (`window.TemporeumTimeline`) |
| `dist/dom.mjs` / `.cjs` / `.umd.js` | the `/dom` subpath | `attachInput`, `observeSize`, `openDetail`, `mountScene`, `createFrameLoop` |

The package is `sideEffects: false`; `require()` gets CommonJS types, `import` gets ESM types, and `moduleResolution: "node10"` finds `/dom` through `typesVersions` — checked against a packed tarball in a foreign project.
