# @temporeum/timeline-react

The timeline as a React component, built on the shared
instance of [`@temporeum/timeline-element`](https://github.com/horakdani/Temporeum_timeline_SDK/tree/main/packages/web-component#readme).

```bash
npm install @temporeum/timeline-react
```

The peer range is `react ^18.0.0 || ^19.0.0` (everything it uses —
`useSyncExternalStore`, `useId` — is in 18). The suite runs on the newest
React 19 and, in CI, on React 18.0.0, the lowest the range admits.

```jsx excerpt:template/react/src/App.jsx
import { Timeline, useTimelineState } from "@temporeum/timeline-react";
import { useState } from "react";

const DAY = 86_400_000;
const t = Date.UTC(2026, 2, 2);
const items = [
  { id: "design", label: "Design", laneId: "work", start: t, end: t + 7 * DAY, data: { owner: "Ana" } },
  { id: "launch", label: "Launch", laneId: "ship", start: t + 25 * DAY, end: t + 32 * DAY, data: { owner: "Dev" } },
];
const lanes = [
  { id: "work", label: "Work" },
  { id: "ship", label: "Shipping" },
];

export default function App() {
  const [timeline, setTimeline] = useState(null);
  const selected = useTimelineState(timeline, (state) => state.selectedIds);
  const [log, setLog] = useState("Drag an item.");
  return (
    <main style={{ padding: 16 }}>
      <Timeline
        items={items}
        lanes={lanes}
        height={320}
        ariaLabel="Release plan"
        editing={{ enabled: true, snapMs: DAY }}
        onItemMoved={({ item, to }) => setLog(`${item.label} moved to ${new Date(to.start ?? item.start).toDateString()}`)}
        timelineRef={setTimeline}
      />
      <p aria-live="polite">
        {log} {selected?.length ?? 0} selected.
      </p>
    </main>
  );
}
```

The whole project, with Vite, is the [React template](https://github.com/horakdani/Temporeum_timeline_SDK/tree/main/packages/docs/templates/react); a
[Next.js one](https://github.com/horakdani/Temporeum_timeline_SDK/tree/main/packages/docs/templates/next) is beside it.

Every [`TimelineConfig`](https://horakdani.github.io/Temporeum_timeline_SDK/reference/api.html#configuration) field is a prop, and
every event an `on…` prop (`onItemMoved`, `onSelectionChanged`,
`onViewportChanged`, …). A new callback on every render does not
resubscribe; the latest committed one is what runs. `id`, `data-*`,
`aria-*`, `role`, `title` and `ref` go on the box.
`timelineRef` may change after mount: the new ref gets the instance, the old
one `null`.

The view and the selection are where the timeline starts:
`defaultDomain` and `defaultSelectedIds`. A re-render does not move them
back, so a state set from `onViewportChanged` is safe; the instance's
`zoomTo` and `select` move them. Every other prop is compared by what it
says — `editing={{ enabled: true }}` written anew on each render is no
change, and a drag in progress goes on.

## It does not re-render to draw

The component creates the instance once and hands it the props that
changed. A pan, a pinch, a drag are drawn by the instance, imperatively —
React does not hear of them. What React renders from is the instance's
store: `useTimelineState(timeline, selector, isEqual?)` subscribes with
`useSyncExternalStore`, so a component that shows the selection re-renders
when the selection changes, and one that shows the visible range re-renders
at most once per drawn frame, however many pointer events the frame held.

That is measured, with React's own `<Profiler>`: during a pan of 30+ real
pointer events the `<Timeline>` subtree commits 0 times.

## Server rendering

On the server the component prints the same drawing the browser would draw
— the engine is DOM-free — so the page shows a timeline before the bundle
loads. `ssrWidth` is the width it draws at (960 by default); the client
redraws at the real one. On hydration the instance takes the server's nodes
over instead of drawing a second timeline.

In the Next App Router the bundle starts with `"use client"`: render
`<Timeline>` from a server component and it is server-rendered and hydrated;
pass functions (callbacks, `timelineRef`) from a client component.

## Documentation

Guides, recipes and the API reference with live examples are on the
[docs site](https://horakdani.github.io/Temporeum_timeline_SDK/) — the React page is [Frameworks](https://horakdani.github.io/Temporeum_timeline_SDK/frameworks.html). Every
code block in this README is checked against a running template in CI
(`npm run test:examples -w @temporeum/timeline-docs`).
