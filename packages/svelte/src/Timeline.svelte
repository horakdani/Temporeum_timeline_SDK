<!--
  @component
  The timeline. Every `TimelineConfig` field is a prop, every instance event
  an `on…` prop (`onItemMoved`, `onSelectionChanged`, …), and
  `bind:timeline` hands over the live instance (`null` after unmount).

  `item` is each item's content, as a snippet (`{#snippet item(item)}`),
  rendered into the box over the item (`slots`): only the items drawn have
  one, and each keeps its state while its item is drawn. The content is a
  picture — the pointer and the keyboard act on the item, and its `label`
  stays its accessible name. Needs the `/items` plugin, as `template` does.

  The view and the selection are where the timeline starts (`defaultDomain`,
  `defaultSelectedIds`): a re-render does not move them; the instance's
  `zoomTo` and `select` do.

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
  import type { ItemSlot, Timeline as TimelineInstance, TimelineComponentConfig, TimelineConfig, TimelineInstanceEventMap, TimelineInstanceEventName, TimelineUpdate } from "@temporeum/timeline-element";
  import { onMount, untrack } from "svelte";
  import type { Snippet } from "svelte";

  type Handlers = { [K in TimelineInstanceEventName as `on${Capitalize<K>}`]?: (payload: TimelineInstanceEventMap<T>[K]) => void };
  type Props = TimelineComponentConfig<T> &
    Handlers & {
      class?: string;
      style?: string;
      /** The box's, as `data-*` and `aria-*` (`aria-label` is `ariaLabel`). */
      id?: string;
      role?: string;
      title?: string;
      [attribute: `${"data" | "aria"}-${string}`]: unknown;
      /** Width the server draws at; the client redraws at the real one. */
      ssrWidth?: number;
      /** The live instance, after mount; `null` before and after. */
      timeline?: TimelineInstance<T> | null;
      /** Each drawn item's content, rendered into the box over it. */
      item?: Snippet<[ItemSlot<T>["item"]]>;
    };

  let { class: className = undefined, style = undefined, ssrWidth = undefined, timeline = $bindable(null), defaultDomain = undefined, defaultSelectedIds = undefined, item = undefined, ...rest }: Props = $props();

  const handlerOf = (type: TimelineInstanceEventName): string => `on${type.charAt(0).toUpperCase()}${type.slice(1)}`;
  const HANDLERS = new Set(TIMELINE_EVENTS.map(handlerOf));
  // Where the view and the selection start, not what they are.
  const STARTS = new Set(["domain", "selectedIds"]);
  // `$props.id()` is the same on the server and the hydrating client; a stylesheet scope wants a plain name.
  const uid = $props.id();
  const scope = `tl${uid.replace(/[^a-zA-Z0-9_-]/g, "")}`;

  // `aria-label` is `ariaLabel`; `onclick` is the box's.
  const BOX = /^(id|role|title|data-.*|aria-(?!label$).*|on[a-z].*)$/;
  // `class` only when given: beside a spread, an absent one is `class=""`.
  const box = $derived({ ...Object.fromEntries(Object.entries(rest).filter(([key]) => BOX.test(key))), ...(className === undefined ? {} : { class: className }) });

  /** The configuration part of the props: everything that is not a callback. */
  function configOf(source: Record<string, unknown>): Record<string, unknown> {
    const config: Record<string, unknown> = {};
    for (const key of Object.keys(source)) {
      // An own `__proto__` is not a prop: assigned, it would set the configuration's prototype.
      if (key !== "__proto__" && !HANDLERS.has(key) && !STARTS.has(key) && !BOX.test(key)) config[key] = source[key];
    }
    config.ariaLabel ??= config["aria-label"];
    delete config["aria-label"];
    // Light DOM: two timelines on one page must not share one stylesheet.
    if (config.instanceId === undefined) config.instanceId = scope;
    // With an `item` snippet every item has a box, unless `slots` picks.
    if (item !== undefined && config.slots === undefined) config.slots = true;
    return config;
  }

  /** The boxes drawn now, each with its item. */
  let drawn: ReadonlyMap<string, ItemSlot<T>> = $state.raw(new Map());

  /** Render where Svelte renders, then live in the item's box: the box is the instance's, the content Svelte's. */
  function into(node: HTMLElement, box: HTMLElement): { update: (next: HTMLElement) => void; destroy: () => void } {
    box.append(node);
    return {
      update: (next) => next.append(node),
      destroy: () => node.remove(),
    };
  }

  let applied = untrack(() => configOf(rest as Record<string, unknown>));
  const initial = untrack(() => ({
    ...applied,
    ...(defaultDomain === undefined ? {} : { domain: defaultDomain }),
    ...(defaultSelectedIds === undefined ? {} : { selectedIds: defaultSelectedIds }),
  }));
  // Computed once, on the server and on a client that hydrates the server's
  // markup: the string never changes. A client-only mount writes no HTML at
  // all — the instance draws with the DOM, which a Trusted Types policy has
  // no say over. Hydrating is when the id came from the server (a client-only
  // mount's is Svelte's `c<n>`) and a drawing of this scope is on the page: the
  // look-up alone took a client mount with a served drawing's instanceId for
  // its hydration (R80). Should Svelte's ids change, the look-up decides, as before.
  const hydrating = typeof document !== "undefined" && !/^c\d+$/.test(uid) && document.querySelector(`svg[data-tl-instance="${String(applied.instanceId)}"]`) !== null;
  const html = untrack(() => {
    if (typeof document !== "undefined" && !hydrating) return "";
    const frame = renderTimelineSvg(initial as TimelineConfig<T>, ssrWidth === undefined ? {} : { width: ssrWidth });
    return frame.svg + frame.groups;
  });
  const height = $derived((rest.height as number | undefined) ?? DEFAULT_HEIGHT);
  let container: HTMLDivElement;

  onMount(() => {
    const instance = createTimeline<T>(container, { ...initial, ...applied } as TimelineConfig<T>, { hydrate: true });
    // Through the latest props: a new callback does not resubscribe, and the one that runs is the current one.
    const stops = TIMELINE_EVENTS.map((type) =>
      instance.on(type, (payload) => {
        const handler = (rest as Record<string, unknown>)[handlerOf(type)];
        if (typeof handler === "function") (handler as (value: unknown) => void)(payload);
      }),
    );
    stops.push(instance.on("slotsChanged", ({ slots: next }) => (drawn = next)));
    drawn = instance.slots;
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
        if (key !== "__proto__" && applied[key] !== next[key]) {
          changed[key] = next[key];
          any = true;
        }
      }
      applied = next;
      if (any) timeline?.update(changed as TimelineUpdate<T>);
    });
  });
</script>

<div {...box} bind:this={container} style="position:relative;overflow:hidden;height:{height}px;{style ?? ''}" data-tl-svelte="">{#if html !== ""}{@html html}{/if}</div>
{#if item !== undefined}
  {#each [...drawn] as [id, slot] (id)}
    <div use:into={slot.element} style="display:contents">{@render item(slot.item)}</div>
  {/each}
{/if}
