# Stability

What 1.0 promises, and what it does not.

## Versions

The six packages follow [semantic versioning](https://semver.org), and they are released together, with one version number: a host never has to work out which element goes with which engine.

- A **patch** release fixes a bug and changes nothing a correct program relies on.
- A **minor** release adds: a new option, a new event, a new export. Defaults do not change in a minor release in a way a reader would see.
- A **major** release is the only one that removes or renames, changes a default, or changes what an event means.

## What is public

The public API is exactly what the packages export, with the types they ship:

- every export of `@temporeum/timeline-core`, `@temporeum/timeline-core/dom`, `@temporeum/timeline-element` and `@temporeum/timeline-element/define`, and of the other [entry points](reference/entry-points.md) of the core and the element — the element's plugins (`/gantt`, `/resources`, `/export`, `/tools`, `/groups`, `/items`, `/intl`) among them. What is inside a plugin object is not: register it, do not call into it;
- every export of the four framework adapters — `@temporeum/timeline-react`, `@temporeum/timeline-vue`, `@temporeum/timeline-svelte` and `@temporeum/timeline-angular` — with their components' props, events, slots and templates (`renderItem`, `#item`, the `item` snippet, `tlItem`), and their peer ranges;
- the `<temporeum-timeline>` element: its tag name, attributes, properties and events;
- the CSS custom properties (`--tl-*`) and the class names on the drawing's nodes (`tl-item`, `tl-label`, `tl-cluster` …), because hosts style them;
- the accessible structure: the roles, names and states a screen reader gets. A change that makes them worse is a breaking change even when no type changes.

## How the names are made

One rule, so a name says what it does and the next one can be guessed:

- **Events.** An event that reports a change that happened is in the past tense: `itemMoved`, `selectionChanged`, `groupToggled`, `clusterOpened`. An event that reports what the reader asked for is in the present: `itemClick`, `itemHover`, `jumpRequest`. The plural is the payload's: `itemsAdded` and `itemsRemoved` both carry `items`. On the element an event is its kebab-case name (`item-moved`), with one exception: the instance's `command` is `timeline-command`, because `command` is the platform's own event.
- **Acronyms** are written as words: `exportSvg`, `exportPng`, `exportPdf`, `renderTimelineHtml`. A product or a format keeps its own spelling: `fromTimelineJS`, `parseICal`, `parseRRule`.
- **One name, one signature.** `zoomTo([start, end])` is the same on the instance and the element; the accessible name is `ariaLabel` in every configuration, and `aria-label` as an attribute.
- **Queries.** What costs nothing and changes nothing is a getter (`timeline.items`, `timeline.layout`, `timeline.slots`, `timeline.metrics`); what computes is a method. `getSnapshot()` is a method because the store protocol React's `useSyncExternalStore` reads names it so.
- **Parameters.** A public function takes at most four positional parameters, then an options object, and never a positional `boolean`: `removeTargets(id, selected, { multiSelect: true })`, not `removeTargets(id, selected, true)`. Every public name carries its documentation in the types. Both are checked on every change (`scripts/sdk_check_api_docs.mjs`).

## What is not

- **The exact drawing**: pixel positions, the label a frame drops when there is no room, tick placement at a given width. They get better in minor releases. The visual-regression suite pins them for the library, not for hosts.
- **The markup structure** beyond the classes above: the order and nesting of SVG groups.
- **Anything underscored or undocumented**, and the file layout of `dist/`: import through the entry points.
- **Performance numbers** are measured, not promised: the frame and memory budgets are measured before each release, on a quiet machine, and listed with the CI-checked ones in the core's README.

## Deprecation

Before anything public is removed it is deprecated for at least one minor release: marked `@deprecated` in the types, with the replacement named, and listed in the changelog. Removal waits for the next major.

## Support

- **Browsers**: the current and previous major version of Chrome, Edge, Firefox and Safari, on desktop and mobile. Server rendering needs declarative shadow DOM, which all four have. What is measured, and where:
  - Every browser suite runs in Chromium, on the desktop and with phone emulation.
  - The element's browser suite — drawing, mouse and keyboard input, editing, the tools, right to left, Trusted Types — also runs in Firefox and in WebKit, Safari's engine, in CI.
  - The touch suite also runs in WebKit, Safari's engine, with iPhone and iPad emulation: one-finger pan, two-finger pinch, double tap, two-finger tap, long press, moving and resizing, the host's rules, undo, and a mouse on the same page. Two fingers are the browser's own touch input, not events made up in the page.
  - In the real Mobile Safari 26.5, in Xcode's iOS Simulator, on an iPhone 17 and an iPad Pro 11: a drag on the timeline does not scroll the page, not even when it carries on past the timeline's edge; with `touchAction: "cooperative"` a vertical swipe scrolls the page and the timeline lets go of the gesture; a long press picks an item up, and iOS does not take the touch away. A control run with `touch-action: auto` scrolls the page, so the measurement is able to fail.
  - Not measured: a physical iPhone or iPad, and whether a two-finger pinch on iOS zooms the timeline rather than the page. The simulator's automation delivers one finger, so the pinch is measured in WebKit's emulation only. In Firefox, the framework components and the docs site's end-to-end suites.
  - The WebKit touch suite runs in CI too; the Mobile Safari measurement runs on a developer machine before a release: the simulator needs macOS and Xcode.
- **Node**: 22.12 and later (the `engines` range) for server rendering and the CommonJS build; CI runs the core's suites on Node 22.12, 24 and 26, and the rest on 24.
- **React**: 18 and 19 are the peer range; the test suite runs on 19 only.
- **TypeScript**: the packages are built and checked with TypeScript 6, and a packed tarball is compiled in a foreign project under `moduleResolution` `node10`, `node16` (CommonJS and ESM) and `bundler`. Older compilers are likely to work and are not tested.

## Releases

The packages are at **1.0.0**, the first release, and no version has been published to npm yet. The parts a plain timeline does not need are plugins on entry points of their own (`/gantt`, `/resources`, `/export`, `/tools`, `/groups`, `/items`, `/intl`): a configuration that uses one of them needs its plugin registered (`registerPlugin`), and throws without it. Moving a part from one entry point to another is a breaking change, and follows the rules above. Every release is published from the repository's release workflow with npm provenance, so the registry can show which commit and which workflow run built a tarball. The six packages are released together and always carry the same version.
