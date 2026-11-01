# Data that does not fit in memory

`items` can be an array, or your own function: `(domain, signal) => Promise<Item[]>`. The timeline asks it for the windows the view needs and aborts the ones the view has left. The [log recipe](../recipes/log.md) runs against a stand-in server:

```js excerpt:example/recipe-log
function queryLog([from, to], signal) {
  // …
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(events), 120);
    // The timeline aborts a window the view has left: stop the work.
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(signal.reason);
    });
  });
}

createTimeline(document.querySelector("#timeline"), {
  items: queryLog,
  // …
});
```

With a real server the function is one line — `fetch(url, { signal }).then((response) => response.json())` — and the server's query is yours. The library never touches the network itself.

## How it behaves

- **Windows are aligned in time, in powers of two**, about half a view wide, plus half a view of overscan on each side. They nest exactly, so a zoom in is served from the window already held — no request — and a pan reuses every window the view still overlaps. Up to 64 are kept, least recently used out first, never one the view is using.
- **A window that leaves the view is aborted on the spot, and an aborted request never shows** — also when the server could not cancel and answered anyway. That is a gate: 240 seeded fast-zoom schedules read the drawn frame back after every step, and a real browser records every name that ever entered the DOM; a deliberately naive loader fails both.
- **Loading is on the axis**: moving dashes along its inner edge while a window loads, still dots where one failed. The root says `aria-busy` while anything in view is loading, and the snapshot's `busy` says the same to the host.
- **Edits go through the loader**: an edit is patched into what is held and replayed on answers already on their way, so a late response from before the edit cannot undo it.
- There is no debounce: a fast zoom starts and aborts the requests of every level it passes through, and nested windows are what keeps that cheap.

Give the view `limits` (`maxSpanMs`) when the source cannot answer for an arbitrarily wide window: the recipe stops at two days.

The windowing is the engine's `createItemLoader`, usable on its own; see the [engine guide](core-engine.md).
