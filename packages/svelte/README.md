# @temporeum/timeline-svelte

The timeline as a Svelte 5 component, built on the shared instance of
[`@temporeum/timeline-element`](../web-component/README.md).

```bash
npm install @temporeum/timeline-svelte
```

The peer range is `svelte >=5.20` (`$props.id()` is new in 5.20). The
package ships the component's source (`Timeline.svelte`), as Svelte
libraries do: your compiler builds it with the rest of your app.

```svelte excerpt:template/svelte/src/App.svelte
<script>
  import { Timeline, timelineState } from "@temporeum/timeline-svelte";

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
    onItemMoved={({ item, to }) => (log = `${item.label} moved to ${new Date(to.start).toDateString()}`)}
    bind:timeline
  />
  <p aria-live="polite">{log} {$selected?.length ?? 0} selected.</p>
</main>
```

The whole project, with Vite, is the Svelte template
(`packages/docs/templates/svelte`).

Every [`TimelineConfig`](../web-component/src/config.ts) field is a prop,
and every instance event an `on…` prop (`onItemMoved`, `onSelectionChanged`,
`onViewportChanged`, …); a new callback does not resubscribe, the latest one
is what runs. `bind:timeline` hands over the live instance, and `null` after
the component is destroyed.

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

## Licence

MIT
