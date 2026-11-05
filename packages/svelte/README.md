# @temporeum/timeline-svelte

The timeline as a Svelte 5 component, built on the shared instance of
[`@temporeum/timeline-element`](https://github.com/horakdani/Temporeum_timeline_SDK/tree/main/packages/web-component#readme).

```bash
npm install @temporeum/timeline-svelte @temporeum/timeline-element
```

The element is the adapter's own dependency; list it beside the adapter, as
above, to import its plugins (`@temporeum/timeline-element/items`, `/gantt`,
`/resources` …): pnpm and Yarn PnP let an app import only what it lists. The
types an app writes — `Item`, `Lane`, `Group`, `TimeMs` and every event's
payload (`ItemMovedPayload`, `SelectionChangedPayload` …) — come from
`@temporeum/timeline-svelte` itself.

The peer range is `svelte ^5.46.4`: the oldest Svelte the suite can run on
(Vite's Svelte plugin under it needs 5.46.4), and it runs there in CI as well
as on the newest Svelte 5. Under a Trusted Types policy
(`require-trusted-types-for 'script'`) it needs Svelte 5.53 or later, whose own
runtime builds its templates through Trusted Types. The package ships the component's source (`Timeline.svelte`), as Svelte
libraries do: your compiler builds it with the rest of your app.

```svelte excerpt:template/svelte/src/App.svelte
<script>
  import { Timeline, timelineState } from "@temporeum/timeline-svelte";

  const DAY = 86_400_000;
  const t = Date.UTC(2026, 2, 2);
  const items = [
    { id: "design", label: "Design", laneId: "work", start: t, end: t + 7 * DAY },
    { id: "launch", label: "Launch", laneId: "ship", start: t + 25 * DAY, end: t + 32 * DAY },
  ];
  const lanes = [
    { id: "work", label: "Work" },
    { id: "ship", label: "Shipping" },
  ];

  let timeline = $state(null);
  const selected = $derived(timelineState(timeline, (state) => state.selectedIds));
  let log = $state("Drag an item.");
</script>

<main style="padding: 16px">
  <Timeline
    {items}
    {lanes}
    height={320}
    ariaLabel="Release plan"
    editing={{ enabled: true, snapMs: DAY }}
    onItemMoved={({ item, to }) => (log = `${item.label} moved to ${new Date(to.start ?? item.start).toDateString()}`)}
    bind:timeline
  />
  <p aria-live="polite">{log} {$selected?.length ?? 0} selected.</p>
</main>
```

The whole project, with Vite, is the [Svelte template](https://github.com/horakdani/Temporeum_timeline_SDK/tree/main/packages/docs/templates/svelte).

Every [`TimelineConfig`](https://horakdani.github.io/Temporeum_timeline_SDK/reference/api.html#configuration) field is a prop,
and every instance event an `on…` prop (`onItemMoved`, `onSelectionChanged`,
`onViewportChanged`, …); a new callback does not resubscribe, the latest one
is what runs. `bind:timeline` hands over the live instance, and `null` after
the component is destroyed.

Each item's content can be a snippet, `item`:
`{#snippet item(item)}<b>{item.label}</b>{/snippet}` inside `<Timeline>`. It
is rendered into the box over the item, only for the items drawn, and keeps
its state while its item is drawn; it needs the element's `/items` plugin,
as `template` does.

The view and the selection are where the timeline starts: `defaultDomain`
and `defaultSelectedIds`. A change of props does not move them back; the
instance's `zoomTo` and `select` do. Every other prop is compared by what it
says, so an `editing={{ enabled: true }}` written anew is no change.

## It does not re-render to draw

The component creates the instance once, on mount, and hands it the props
that changed — the same `items` array is not new data. A pan, a pinch, a
drag are drawn by the instance, imperatively; Svelte does not hear of them.
What a component renders from is the instance's store:
`timelineState(timeline, selector, isEqual?)` is a Svelte store (`$selected`)
that emits when the selected part changes, and at most once per drawn frame,
however many pointer events the frame held. It holds nothing until there is
an instance: make it again when the instance arrives, with `$derived`.

## Server rendering

On the server — SvelteKit, or `render` from `svelte/server` — the component
prints the drawing the browser would draw, at `ssrWidth` (960 by default),
and on hydration the instance takes those nodes over instead of drawing
again. Nothing else is needed.

The drawing is a `{@html}` of one string, computed once — on the server, and
again on the client: while hydrating, Svelte takes the server's nodes for it,
and since the string never changes, Svelte never writes it again.

## Documentation

Guides, recipes and the API reference with live examples are on the
[docs site](https://horakdani.github.io/Temporeum_timeline_SDK/) — the Svelte page is [Frameworks](https://horakdani.github.io/Temporeum_timeline_SDK/frameworks.html). Every
code block in this README is checked against a running template in CI
(`npm run test:examples -w @temporeum/timeline-docs`).

## Licence

MIT
