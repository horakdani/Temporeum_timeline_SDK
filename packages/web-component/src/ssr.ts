/**
 * Server rendering: the timeline as markup, before any script runs.
 *
 * The core is DOM-free for exactly this. The server calls
 * the same renderer the browser does, with the same configuration resolved
 * the same way (`config.ts`), and prints it with `renderToSvgString`. What
 * reaches the browser is a timeline a reader can see, a screen reader can
 * read and a keyboard can focus before the bundle has loaded — and when it
 * loads, the client takes these very nodes over (`mountScene({ hydrate })`)
 * instead of drawing a second timeline and throwing the first away.
 *
 * The server cannot measure the container, so it draws at a width it is
 * told ({@link DEFAULT_SERVER_WIDTH} otherwise) and the stylesheet scales
 * that drawing to the container until the client draws the real one.
 *
 * Nothing here touches `window` or `document`, at import or at call.
 */

import { renderTimeline, renderToSvgString } from "@temporeum/timeline-core";
import { withParts } from "@temporeum/timeline-core/dom";
import type { Density, Orientation, RenderResult, SceneElement, TimeMs } from "@temporeum/timeline-core";

import { contentOf, DEFAULT_SERVER_WIDTH, directionOf, frameOptions, frameScene, initialDomain, initialSpace, itemsOf, readableOptionsOf, resolveView, usesSceneSpace, wordsOf } from "./config.js";
import type { ResolvedView, TimelineConfig } from "./config.js";
import { plugin, requireKinds, requirePlugins } from "./plugins.js";

/** The tag the element is registered under unless told otherwise. */
export const TAG_NAME = "temporeum-timeline";

/**
 * The element's own stylesheet, in its shadow root.
 *
 * The host's height is CSS — `temporeum-timeline { height: 480px }` or the
 * `--tl-height` property the `height` attribute writes — and the drawing is
 * laid over it rather than in its flow. That is what keeps the measured
 * height from being the drawn height: a drawing in the flow would size its
 * container, and a container that sizes the drawing would never settle.
 */
export const HOST_CSS =
  ":host{display:block;position:relative;height:var(--tl-height,300px);contain:content}" +
  ":host([hidden]){display:none}" +
  "svg{position:absolute;top:0;left:0;width:100%;height:100%;display:block}";

/** How the server draws. */
export interface ServerRenderOptions {
  /** The width to draw at. The client redraws at the real one. */
  readonly width?: number | undefined;
  /** Clock for a configuration with neither a domain nor items. */
  readonly now?: (() => TimeMs) | undefined;
}

/** A server-drawn frame. */
export interface ServerFrame<T = unknown> {
  /** The drawing, as SVG markup. */
  readonly svg: string;
  /**
   * The group headers, as HTML to put right after the drawing — empty
   * without groups. The client takes them over like the drawing.
   */
  readonly groups: string;
  /** The domain it shows — hand it to the client, so both start from one. */
  readonly domain: readonly [TimeMs, TimeMs];
  /** The width it was drawn at, in CSS pixels. */
  readonly width: number;
  /** The height it was drawn at, in CSS pixels. */
  readonly height: number;
  /** The orientation it was drawn in — `auto` resolved at `width`. */
  readonly orientation: Orientation;
  /** The density it was drawn with — `auto` resolved for the rows it fits. */
  readonly density: Density;
  /** The frame the renderer returned: the layout, the scene, the clusters. */
  readonly result: RenderResult<T>;
}

/** Draw a configuration on the server. */
export function renderTimelineSvg<T>(config: TimelineConfig<T>, options: ServerRenderOptions = {}): ServerFrame<T> {
  const { svg, groups, domain, width, height, orientation, density, result } = serverFrame(config, options, false);
  return { svg, groups, domain, width, height, orientation, density, result };
}

/** The server frame with the view it resolved — for the tests, which compare it with the client's. Not on the public entry. */
export function resolvedServerFrame<T>(config: TimelineConfig<T>, options: ServerRenderOptions = {}): ServerFrame<T> & { readonly view: ResolvedView } {
  return serverFrame(config, options, false);
}

/**
 * The scene's `<style>`s with the nonce, which a policy without
 * `'unsafe-inline'` lets them apply by. The client's frame has none:
 * it adopts its sheets instead, and lets the server's `<style>`s go.
 */
function withNonce(scene: SceneElement, nonce: string | undefined): SceneElement {
  if (nonce === undefined) return scene;
  return { ...scene, children: (scene.children ?? []).map((child) => (child.tag === "style" ? { ...child, attrs: { ...child.attrs, nonce } } : child)) };
}

/** The frame; `host` for the element's shadow root, with the tokens on `:host` and the classes as parts. */
function serverFrame<T>(given: TimelineConfig<T>, options: ServerRenderOptions, host: boolean): ServerFrame<T> & { readonly view: ResolvedView } {
  // A plugin the client would need is needed here: the server throws where the client would.
  requirePlugins(given);
  // What cannot be read is left out, as on the client — which says so, with `inputSkipped`, when it hydrates.
  const config = readableOptionsOf(given);
  const items = itemsOf(config);
  requireKinds(items);
  const domain = initialDomain(config, options.now);
  const view = resolveView(config, items, domain, options.width ?? DEFAULT_SERVER_WIDTH, 0);
  const state = {
    items,
    domain,
    view,
    selectedIds: config.selectedIds ?? [],
    focusedId: null,
    crossOffset: 0,
    loading: [],
    // The client's first frame is drawn in this space too: the same
    // nodes, so hydration takes them over instead of redrawing.
    ...(usesSceneSpace(config) ? { space: initialSpace(domain, view) } : {}),
    ...(host ? { host: true } : {}),
  };
  const result = renderTimeline(frameOptions(config, state));
  const content = contentOf(config, { items });
  const tree = content.view === undefined ? undefined : plugin("groups", "The groups option");
  const groups =
    content.view === undefined || tree === undefined
      ? ""
      : tree.groupHeaderMarkup(
          tree.groupLayerAttrs(view.orientation, view.density, config.theme, config.strings === undefined ? undefined : wordsOf(config).say("groups"), directionOf(config), view.metrics),
          tree.headerPlacements(content.view.rows, result.layout, view.orientation, 0, undefined, directionOf(config)),
          config.nonce,
        );
  // The dependency arrows are not the renderer's: the same function adds them here as in the client.
  const scene = withNonce(frameScene(config, state, result), config.nonce);
  const { width, height, orientation, density } = view;
  return { svg: renderToSvgString(host ? withParts(scene) : scene), groups, domain, width, height, orientation, density, view, result };
}

/**
 * The configuration as JSON a `<script type="application/json">` can carry.
 *
 * Dates become epoch milliseconds (the core reads those, not ISO strings),
 * functions — hooks, `canMove`, a fetching source — are dropped, because
 * they cannot travel and the client sets them as properties. `<` is escaped,
 * so an item labelled `</script>` cannot end the script early.
 */
export function serializeConfig<T>(config: TimelineConfig<T>): string {
  const json = JSON.stringify(config, function (this: Record<string, unknown>, key: string, value: unknown) {
    const raw = this[key];
    return raw instanceof Date ? raw.getTime() : value;
  });
  return json.replace(/[<\u2028\u2029]/g, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

const escapeAttr = (value: string): string =>
  value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** How the element's markup is printed. */
export interface ServerHtmlOptions extends ServerRenderOptions {
  /** The registered tag, when the page defined the element under another name: a valid custom element name. */
  readonly tagName?: string | undefined;
  /**
   * More attributes for the element itself: `id`, `class`, `style`. Values are
   * escaped; a name that is not an attribute name, or an `on…` handler, throws.
   */
  readonly attributes?: Readonly<Record<string, string>> | undefined;
}

/**
 * The whole `<temporeum-timeline>`, server-rendered.
 *
 * A declarative shadow root holds the stylesheet and the drawing, so the
 * browser paints it without the element being defined; a JSON script in
 * the light DOM holds the configuration the drawing came from, so the
 * element, once defined, continues from exactly that state. The shadow root
 * has no slot, so the script is never shown.
 */
export function renderTimelineHtml<T>(config: TimelineConfig<T>, options: ServerHtmlOptions = {}): string {
  const tag = options.tagName ?? TAG_NAME;
  // Printed as they are: a name could otherwise close the tag and open another.
  if (!/^[a-z][a-z0-9._-]*-[a-z0-9._-]*$/.test(tag)) throw new TypeError(`${JSON.stringify(tag)} is not a custom element name`);
  for (const name of Object.keys(options.attributes ?? {})) {
    if (!/^[a-z_][\w.:-]*$/i.test(name) || /^on/i.test(name)) throw new TypeError(`${JSON.stringify(name)} is not an attribute the timeline prints`);
  }
  const frame = serverFrame(config, options, true);
  // On the element, where the client reads it — not in the JSON, which any
  // script could read, while the browser hides an attribute's nonce.
  const attributes: Record<string, string> = { ...options.attributes, ...(config.nonce === undefined ? {} : { nonce: config.nonce }) };
  if (config.height !== undefined) {
    const style = attributes.style === undefined ? "" : `${attributes.style.replace(/;?\s*$/, "")};`;
    attributes.style = `${style}--tl-height:${String(config.height)}px`;
  }
  const printed = Object.entries(attributes)
    .map(([name, value]) => ` ${name}="${escapeAttr(value)}"`)
    .join("");
  const state = serializeConfig({ ...config, domain: frame.domain, nonce: undefined });
  const nonce = config.nonce === undefined ? "" : ` nonce="${escapeAttr(config.nonce)}"`;
  return (
    `<${tag}${printed}>` +
    `<template shadowrootmode="open" shadowrootdelegatesfocus><style${nonce}>${HOST_CSS}</style>${frame.svg}${frame.groups}</template>` +
    `<script type="application/json" data-tl-config>${state}</script>` +
    `</${tag}>`
  );
}
