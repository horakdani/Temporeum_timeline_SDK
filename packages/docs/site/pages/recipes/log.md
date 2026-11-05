# Recipe: an event log

A day of service events, fetched window by window from a server as the view moves, in lanes by severity, and merged into counted markers where they crowd. Zoom with `ctrl` + wheel (or `+` and `-`) and pan: the line below the timeline counts the requests.

::: example recipe-log

## How it is made

- **`items` is a function.** The timeline calls it with the window it needs and an `AbortSignal`, and aborts the request when the view moves on. Zoom in and nothing is asked: the window already held covers it. See [async data](../guides/async-data.md).
- **Clusters** (`cluster: true`) merge events too close to tell apart into one marker with their count; tap it, or focus it and press `Enter`, and it opens. See [clustering](../guides/clustering.md).
- **Severity is a lane and a class.** The error lane is `pinned`, so it comes first, at the top, with the pinned lanes' fill; each event's class (`level-…`) sets its colour.
- **Limits** keep the view between a minute and two days, so the server is never asked for a year.
- **No editing**: a log is read, so `editing` is left off and a drag only pans.

```js excerpt:example/recipe-log
  domain: [T0, T0 + 2 * HOUR],
  // A log is read, not edited; keep the zoom between a minute and two days.
  limits: { minSpanMs: 60 * SECOND, maxSpanMs: 48 * HOUR },
```

Each event is an instant with `granularity: "second"`: it covers its second, so two events in the same second take two rows instead of drawing over each other.
