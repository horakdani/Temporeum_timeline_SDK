<!--
  @component
  The timeline. Every `TimelineConfig` field is a prop, every instance event
  an `on…` prop (`onItemMoved`, `onSelectionChanged`, …), and
  `bind:timeline` hands over the live instance (`null` after unmount).

  The component is a shell around the shared instance (`createTimeline`,
  from `@temporeum/timeline-element`), as the React one is: it creates the
  instance once, on mount, hands it every prop that changed, and lets go of
  it on destroy. It does not re-render to draw — a pan is the instance's,
  imperatively; Svelte does not hear of it.

  Server rendering: the server prints the drawing the browser would draw,
  through `{@html}`. The same string is computed once on the client too:
  while hydrating, Svelte takes the server's nodes for it, and since the
  string never changes, Svelte never writes it again — the instance owns
  what is in the node, and on hydration takes the server's nodes over.
-->
<script lang="ts" generics="T = unknown">
  import { createTimeline, DEFAULT_HEIGHT, renderTimelineSvg, TIMELINE_EVENTS } from "@temporeum/timeline-element";
  import type { Timeline as TimelineInstance, TimelineConfig, TimelineInstanceEventMap, TimelineInstanceEventName, TimelineUpdate } from "@temporeum/timeline-element";
  import { onMount, untrack } from "svelte";

  type Handlers = { [K in TimelineInstanceEventName as `on${Capitalize<K>}`]?: (payload: TimelineInstanceEventMap<T>[K]) => void };
  type Props = TimelineConfig<T> &
    Handlers & {
      class?: string;
      style?: string;
      /** Width the server draws at; the client redraws at the real one. */
      ssrWidth?: number;
      /** The live instance, after mount; `null` before and after. */
      timeline?: TimelineInstance<T> | null;
    };

  let { class: className = undefined, style = undefined, ssrWidth = undefined, timeline = $bindable(null), ...rest }: Props = $props();

  const handlerOf = (type: TimelineInstanceEventName): string => `on${type.charAt(0).toUpperCase()}${type.slice(1)}`;
  const HANDLERS = new Set(TIMELINE_EVENTS.map(handlerOf));
  // `$props.id()` is the same on the server and the hydrating client; a stylesheet scope wants a plain name.
  const uid = $props.id();
  const scope = `tl${uid.replace(/[^a-zA-Z0-9_-]/g, "")}`;

  /** The configuration part of the props: everything that is not a callback. */
  function configOf(source: Record<string, unknown>): Record<string, unknown> {
    const config: Record<string, unknown> = {};
    for (const key of Object.keys(source)) {
      if (!HANDLERS.has(key)) config[key] = source[key];
    }
    // Light DOM: two timelines on one page must not share one stylesheet.
    if (config.instanceId === undefined) config.instanceId = scope;
    return config;
  }

  let applied = untrack(() => configOf(rest as Record<string, unknown>));
  // Computed once, on the server and on the client: the string never changes.
  const html = untrack(() => {
    const frame = renderTimelineSvg(applied as TimelineConfig<T>, ssrWidth === undefined ? {} : { width: ssrWidth });
    return frame.svg + frame.groups;
  });
  const height = $derived((rest.height as number | undefined) ?? DEFAULT_HEIGHT);
  let container: HTMLDivElement;

  onMount(() => {
    const instance = createTimeline<T>(container, applied as TimelineConfig<T>, { hydrate: true });
    // Through the latest props: a new callback does not resubscribe, and the one that runs is the current one.
    const stops = TIMELINE_EVENTS.map((type) =>
      instance.on(type, (payload) => {
        const handler = (rest as Record<string, unknown>)[handlerOf(type)];
        if (typeof handler === "function") (handler as (value: unknown) => void)(payload);
      }),
    );
    timeline = instance;
    return () => {
      for (const stop of stops) stop();
      instance.destroy();
      timeline = null;
    };
  });

  // Hand the instance what changed, and only that: an unchanged `items` array must not look like new data.
  $effect(() => {
    const next = configOf(rest as Record<string, unknown>);
    untrack(() => {
      const changed: Record<string, unknown> = {};
      let any = false;
      for (const key of new Set([...Object.keys(applied), ...Object.keys(next)])) {
        if (applied[key] !== next[key]) {
          changed[key] = next[key];
          any = true;
        }
      }
      applied = next;
      if (any) timeline?.update(changed as TimelineUpdate<T>);
    });
  });
</script>

<div bind:this={container} class={className} style="position:relative;overflow:hidden;height:{height}px;{style ?? ''}" data-tl-svelte="">{@html html}</div>
