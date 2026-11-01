# Responsive

A responsive timeline is not the same timeline smaller — it is a different projection. Make the frame below narrow and the timeline turns vertical: same items, same code path, a different axis.

::: example responsive

```js excerpt:example/responsive
const timeline = createTimeline(document.querySelector("#timeline"), {
  items,
  ariaLabel: "Research sprint",
  // Both follow the container, not the window: horizontal from 640 px, vertical below.
  orientation: "auto",
  density: "auto",
});
```

## What decides

- **Orientation** is horizontal from 640 px of *container* width, vertical below — with a 24 px band on the way back, because the scrollbar an orientation change brings would otherwise flip it forever. `breakpoint` moves the threshold; `"horizontal"` and `"vertical"` pin it.
- **Density** (`comfortable`, `compact`, `dense`) is the denser of two answers: the coarsest level at which every lane fits across, and the level the median item's drawn length allows along time.
- **Targets come from the pointer.** A hit grows each item by 4 px for a mouse or a pen and 12 px for a finger, and at `dense` up to the 24 px of WCAG 2.2. An exact hit always wins, the nearest item wins in the slop, and a slop hit never starts a resize.

Each decision is a pure function of a measurement, so a server render, a test and a browser get the same answer. The instance reports a change with `orientationChanged` and `densityChanged`, and its snapshot carries both:

```js excerpt:example/responsive
timeline.subscribe(() => {
  const { orientation, density } = timeline.getSnapshot();
  // …
});
```

## Gestures

One finger pans, two pinch, a double tap zooms in, a two-finger tap zooms out, and `ctrl` + wheel zooms where the cursor is — which is also what a trackpad pinch sends. A plain wheel scrolls the lanes when they have room to scroll and pans time when they do not; `shift` + wheel always pans time.

A pointer holds an *instant*, not a delta: every move re-solves the view from what each finger grabbed, so the content stays under the hand, and two fingers pin two instants. Measured over 2 000 generated gestures, the worst anchor error is 2.3e-10 px.

A timeline inside a scrolling article may want to give the page its wheel and its vertical swipe back: `touchAction: "cooperative"` (or `<temporeum-timeline touch-action="cooperative">`). A vertical swipe then scrolls the page and a horizontal one pans time; a plain wheel scrolls the page unless the lanes have room to scroll, and `ctrl` + wheel and `shift` + wheel stay with the timeline, because they are explicit. The default, `"own"`, claims every gesture — right for a timeline that is the page.

Both are measured in Safari on iOS, in Xcode's iOS Simulator rather than on a device: with the default a drag on the timeline leaves the page where it was, even past the timeline's edge, and with `"cooperative"` a vertical swipe scrolls the page and the timeline lets go. A long press that picks an item up is not taken over by iOS. Whether a two-finger pinch zooms the timeline rather than the page has been measured in WebKit's emulation only.
