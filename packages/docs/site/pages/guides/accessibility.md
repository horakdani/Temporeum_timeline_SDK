# Accessibility

Nothing in the timeline is reachable only by a gesture, and that is a gate, not a promise: the capabilities are derived from the input machine's own types, each one must have a key, the key must call the gesture's own programmatic twin, and a parity suite drives every capability both ways in both orientations — a key move and a drag of the same distance produce the same command, byte for byte.

## Keys

| Key (horizontal; vertical swaps the arrows' axes) | Does |
|---|---|
| `←` `→` | previous / next item in time — one key reaches every item |
| `↑` `↓` | the nearest item in the row above / below |
| `Home` `End` | first / last item |
| `PageUp` `PageDown` | pan half a view; `Shift` scrolls the lanes |
| `+` `-` | zoom about the focused item (or the middle) |
| `Enter` `Space` | activate — what a tap does |
| `Escape` | let go of focus and selection — what a tap on nothing does |
| `g` | jump to a date: emits `jumpRequest`, the host asks for the date |
| `Alt` + `←` `→` | move the item (the selection, if it is part of one) |
| `Alt` + `↑` `↓` | move it to the previous / next lane |
| `Shift` + `←` `→` | move its end; `Shift` + `Alt` moves its start |

Nothing is bound with `ctrl` or `meta` — those belong to the browser. One key press is one command, so one undo step, and the host's `canMove` rule holds for keys as it does for the pointer.

The date prompt for `g` is the host's on purpose: it is the one piece that has to look like the rest of the page. Answer the `jumpRequest` event with `timeline.scrollTo(date)`.

## What a screen reader gets

- An interactive timeline is a `listbox` with one focus stop and `aria-activedescendant` on the keyboard's item.
- Every item is an `option` with a name that says **what, when and where** — the label, the dates, the lane, with dates by `Intl` in the configured `locale` and `timeZone` — with `aria-selected` and its position among **all** items, not only the drawn ones (`aria-setsize`, `aria-posinset`).
- A cluster is one `option` named, for example, "23 items, Jan 3, 2024 – Mar 5, 2024, Releases"; `Enter` opens it.
- A timeline with nothing to choose from — no data yet, or a pan into an empty stretch — is a `group` with the same name and focus stop rather than an empty `listbox`. While a window of data loads, the root says `aria-busy`.
- Layers that repeat or decorate the items are hidden from it. The focus ring is its own shape outside the item, so it never reads as the selection.
- `hooks.describeItem` and `hooks.describeCluster` name things in the host's own words. `ariaLabel` names the timeline itself; give every timeline one.

## Motion and contrast

The keyboard's view changes travel for 200 ms, so the eye can follow where the view went; with `prefers-reduced-motion` they arrive in one frame, and the timeline follows the setting while the page is open. The loading dashes stop too.

Both built-in themes are contrast-checked token by token against WCAG AA (4.5:1 for text, 3:1 for lines and the now marker). A custom theme should be held to the same ratios.

In forced colours (Windows High Contrast and its kin) the reader's palette wins: every token becomes a system colour — the surface `Canvas`, text and outlines `CanvasText`, minor lines `GrayText`, focus and selection `Highlight`, drawn wider — so the plugins' shapes follow too, whatever theme the page set. The timeline's own focus outline is drawn inside its box, so a container with `overflow: hidden` cannot cut it.

## Measured

On every check, axe-core with the WCAG 2.2 AA rule set finds **0 violations** across every state of the demo pages — focused, selected, multi-select, the date dialog, dark, after an edit, popover and sheet, loading and failed windows — and across every page of this site, on a desktop and on a phone viewport. A deliberately broken page proves the harness sees.

What a scan cannot judge is measured in the same browser, on the element and on the demo: reflow at 320 CSS pixels and at 256 pixels tall, the browser's zoom at 200%, text-only enlargement, WCAG's text-spacing override, forced colours in a light and a dark palette, and the focus outline inside a container that clips — by boxes, computed styles and pixels; where a check judges label boxes or pixels, a negative control shows that it can fail.

The criterion-by-criterion picture, with the test behind each line, is the [conformance report](../conformance.md).

## Where the report says "partially"

What a host can do about each gap until the library closes it:

- **One-pointer panning and zooming out.** Turn on `zoomPresets` for one-tap zoom buttons (with `toolsPlugin` from `@temporeum/timeline-element/tools` registered — see [time tools](time-tools.md#the-plugin)), and add previous and next buttons that call `scrollTo`.
- **Moving an item without a drag.** Keep `editing` on: the keyboard moves and resizes the focused item. For pointer-only users, a form in the item's detail that sets its dates and calls `updateItems` is the alternative WCAG 2.5.7 asks for.
- **Small mouse targets.** `density: "dense"` raises every mouse target to 24 pixels, and under touch every item is hit from beyond its edges.
- **A refused edit.** `canMove` is the host's rule, so the host's message says why: listen for `command` and say so in a live region of the page.
- **Text spacing.** A reader's own spacing (WCAG 1.4.12) widens labels past the box they were fitted to, so they end in an ellipsis even where the item has room; the whole label stays in the item's accessible name and in its native tooltip on hover. Turn on `tooltip` (see [time tools](time-tools.md#tooltips)): it shows the item's whole label on keyboard focus and on a long press too.
- **Text-only enlargement.** The timeline's type sizes are pixels, so a larger root font or default font does not reach them; the browser's zoom does, and the timeline lays itself out again at 200% and at 400% (320 CSS pixels). For larger text inside the timeline itself, set `metrics` (see [theming](theming.md#sizes-and-type)).
- **Lanes at 320 pixels.** Below the breakpoint the timeline turns vertical and its lanes run across; when they are wider than the view they scroll across inside it, and the keys bring the focused item into view.
- **A screen reader.** No manual test with one has been done yet; what it announces rests on the roles, names and states the tests check. Reports from screen-reader users are welcome in the issue tracker.
