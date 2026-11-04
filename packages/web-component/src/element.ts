/**
 * `<temporeum-timeline>` — the timeline as a custom element.
 *
 * One tag, and the timeline works in plain HTML, in Angular, in Vue, in a
 * CMS template, anywhere an element does. The element is a shell: it turns
 * attributes and properties into a {@link TimelineConfig}, hands it to
 * {@link createTimeline}, and re-dispatches the instance's events as DOM
 * events. It draws nothing itself.
 *
 * **Data.** Simple settings are attributes (`orientation`, `density`,
 * `theme`, `start`, `end`, `height`, `editable`, …). Items and lanes are
 * properties, or — for a page with no script of its own — a
 * `<script type="application/json">` child holding a configuration. That
 * script is also what a server-rendered element carries, so the element
 * continues from the server's state (`renderTimelineHtml`).
 *
 * **Events.** Every instance event is dispatched on the element under its
 * kebab-case name (`itemMoved` → `item-moved`), bubbling and composed, with
 * the payload as `detail`. Kebab-case because it is the one spelling Vue's
 * `@item-moved`, Angular's `(item-moved)` and `addEventListener` all reach.
 * For typed listeners, `element.timeline.on(...)` is the instance itself.
 *
 * **Server.** Importing this module in Node does not touch the DOM: the
 * class extends a stand-in when `HTMLElement` does not exist, and nothing
 * is registered until {@link defineTimelineElement} is called.
 */

import type { DensitySetting, Lane, OrientationSetting, PackMode, RenderHooks, ThemeSetting, TimeInput } from "@temporeum/timeline-core";

import { sameValue } from "./config.js";
import { adoptCss } from "./css.js";
import type { TimelineConfig, TimelineUpdate } from "./config.js";
import { HOST_CSS, TAG_NAME } from "./ssr.js";
import { createTimeline, TIMELINE_EVENTS } from "./timeline.js";
import type { Timeline, TimelineInstanceEventMap, TimelineInstanceEventName } from "./timeline.js";

const EVENTS = TIMELINE_EVENTS;

/**
 * `itemMoved` → `item-moved`: the event name the element dispatches. One
 * exception: `command` is `timeline-command`, because `command` is the
 * platform's own event (the Invoker Commands API's `CommandEvent`), which a
 * `<button commandfor>` fires at its target.
 */
export function eventNameOf(type: TimelineInstanceEventName): string {
  if (type === "command") return "timeline-command";
  return type.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

/** The attributes the element reads. Everything else is a property. */
export const OBSERVED_ATTRIBUTES = [
  "orientation",
  "density",
  "theme",
  "locale",
  "time-zone",
  "aria-label",
  "aria-labelledby",
  "start",
  "end",
  "height",
  "breakpoint",
  "pack-mode",
  "cluster",
  "editable",
  "multi-select",
  "snap-ms",
  "touch-action",
  "direction",
  "calendar",
] as const;

type Attribute = (typeof OBSERVED_ATTRIBUTES)[number];

/** A time attribute: epoch milliseconds, or anything `Date.parse` reads. */
function timeAttr(value: string | null): number | undefined {
  if (value === null || value.trim() === "") return undefined;
  const number = Number(value);
  const time = Number.isFinite(number) ? number : Date.parse(value);
  return Number.isFinite(time) ? time : undefined;
}

function numberAttr(value: string | null): number | undefined {
  if (value === null || value.trim() === "") return undefined;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

/**
 * What a set of attribute values means as configuration.
 *
 * Exported so the mapping is testable without a browser: it is the part of
 * the element most likely to be wrong in a way nobody notices (a misspelt
 * attribute is silently ignored by every browser).
 */
export function configFromAttributes(read: (name: Attribute) => string | null): TimelineConfig {
  const config: Record<string, unknown> = {};
  const set = (key: string, value: unknown): void => {
    if (value !== undefined && value !== null) config[key] = value;
  };
  set("orientation", read("orientation") as OrientationSetting | null);
  set("density", read("density") as DensitySetting | null);
  set("theme", read("theme") as ThemeSetting | null);
  set("locale", read("locale"));
  set("timeZone", read("time-zone"));
  set("ariaLabel", read("aria-label"));
  set("packMode", read("pack-mode") as PackMode | null);
  set("height", numberAttr(read("height")));
  set("breakpoint", numberAttr(read("breakpoint")));
  // Anything but "cooperative" is the default: a typo must not leave a
  // timeline that the page can no longer scroll past, nor one that can.
  const touch = read("touch-action");
  if (touch !== null) set("touchAction", touch === "cooperative" ? "cooperative" : "own");
  // Only the three values: a typo draws left to right, as a page without `dir` does.
  const direction = read("direction");
  if (direction === "rtl" || direction === "ltr" || direction === "auto") set("direction", direction);
  set("calendar", read("calendar"));
  if (read("cluster") !== null) set("cluster", read("cluster") !== "false");
  const start = timeAttr(read("start"));
  const end = timeAttr(read("end"));
  if (start !== undefined && end !== undefined && end > start) set("domain", [start, end]);
  const editable = read("editable");
  const multi = read("multi-select");
  const snap = numberAttr(read("snap-ms"));
  if (editable !== null || multi !== null || snap !== undefined) {
    set("editing", {
      enabled: editable !== null && editable !== "false",
      ...(multi === null ? {} : { multiSelect: multi !== "false" }),
      ...(snap === undefined ? {} : { snapMs: snap }),
    });
  }
  return config as TimelineConfig;
}

/** The configuration a child `<script type="application/json">` carries. */
function scriptConfig(host: HTMLElement): TimelineConfig {
  const script = host.querySelector(":scope > script[type='application/json']");
  if (script === null || script.textContent === null || script.textContent.trim() === "") return {};
  try {
    const config = JSON.parse(script.textContent) as Record<string, unknown>;
    // A hand-written page writes dates as text; the core reads milliseconds.
    const time = (value: unknown): unknown => (typeof value === "string" ? (timeAttr(value) ?? value) : value);
    if (Array.isArray(config.items)) {
      config.items = (config.items as Record<string, unknown>[]).map((item) => ({
        ...item,
        start: time(item.start),
        ...(item.end === undefined ? {} : { end: time(item.end) }),
      }));
    }
    if (Array.isArray(config.domain)) config.domain = config.domain.map(time);
    return config as TimelineConfig;
  } catch {
    // A broken script is the page's bug; the element still draws what the
    // attributes say rather than nothing.
    return {};
  }
}

// In Node there is no HTMLElement. The class still has to be importable —
// a server bundle that imports the element module for its types or its
// SSR helpers must not throw — so it extends a stand-in there.
const Base = (typeof HTMLElement === "undefined" ? class {} : HTMLElement) as typeof HTMLElement;

/** The element's properties a page may set before the element is defined. */
const UPGRADED = ["config", "items", "lanes", "groups", "template", "gantt", "resources", "resourceOptions", "hooks", "selectedIds", "orientation", "density", "theme", "height", "editable"] as const;

/** `itemMoved` → `item-moved`, as a type. */
type Kebab<S extends string> = S extends `${infer Head}${infer Rest}` ? `${Head extends Uppercase<Head> ? (Head extends Lowercase<Head> ? Head : `-${Lowercase<Head>}`) : Head}${Kebab<Rest>}` : S;

/** The DOM event an instance event is dispatched as (`command` is `timeline-command`). */
export type TimelineElementEventName<K extends TimelineInstanceEventName = TimelineInstanceEventName> = K extends "command" ? "timeline-command" : Kebab<K>;

/** The element's DOM events: every instance event under its kebab-case name, its payload as `detail`. */
export type TimelineElementEventMap<T = unknown> = { [K in TimelineInstanceEventName as TimelineElementEventName<K>]: CustomEvent<TimelineInstanceEventMap<T>[K]> };

/** The `<temporeum-timeline>` element. Register with {@link defineTimelineElement}. */
export class TemporeumTimelineElement<T = unknown> extends Base {
  static get observedAttributes(): readonly string[] {
    return OBSERVED_ATTRIBUTES;
  }

  #timeline: Timeline<T> | undefined;
  #props: TimelineConfig<T> = {};
  /** The fields the last `config` set, and no named property set since. */
  #fromConfig = new Set<string>();
  #unsubscribe: (() => void)[] = [];

  constructor() {
    super();
    // A property set before the element was defined (a framework that sets
    // `.items` on a tag whose module loads later) is the element's own data
    // property, which hides the accessor: taken off and set again, it goes
    // through the setter. `config` first, so the named ones win over it.
    for (const name of UPGRADED) {
      if (!Object.hasOwn(this, name)) continue;
      const value = (this as Record<string, unknown>)[name];
      delete (this as Record<string, unknown>)[name];
      (this as Record<string, unknown>)[name] = value;
    }
  }

  /** The live instance, while the element is connected. */
  get timeline(): Timeline<T> | undefined {
    return this.#timeline;
  }

  /** The items: an array, or a function that fetches the ones in a range. */
  get items(): TimelineConfig<T>["items"] {
    return this.#props.items;
  }
  set items(items: TimelineConfig<T>["items"]) {
    this.#set({ items });
  }

  /** The lanes the items are in, in order. */
  get lanes(): readonly Lane[] | undefined {
    return this.#props.lanes;
  }
  set lanes(lanes: readonly Lane[] | undefined) {
    this.#set({ lanes: lanes ?? [] });
  }

  /** Nested groups of lanes, which the reader collapses and reorders (the `/groups` plugin). */
  get groups(): TimelineConfig<T>["groups"] {
    return this.#props.groups;
  }
  set groups(groups: TimelineConfig<T>["groups"]) {
    this.#set({ groups });
  }

  /** Each item's content as HTML (the `/items` plugin). */
  get template(): TimelineConfig<T>["template"] {
    return this.#props.template;
  }
  set template(template: TimelineConfig<T>["template"]) {
    this.#set({ template });
  }

  /** Dependency arrows and the Gantt drawing; the task grid is `mountTaskGrid(box, element.timeline)`. */
  get gantt(): TimelineConfig<T>["gantt"] {
    return this.#props.gantt;
  }
  set gantt(gantt: TimelineConfig<T>["gantt"]) {
    this.#set({ gantt });
  }

  /** The resources, for a resource view; the unscheduled tasks beside it are `mountBacklog(box, element.timeline, { tasks })`. */
  get resources(): TimelineConfig<T>["resources"] {
    return this.#props.resources;
  }
  set resources(resources: TimelineConfig<T>["resources"]) {
    this.#set({ resources });
  }

  /** How the resource view counts and draws the load: the units an assignment takes, the load lane. */
  get resourceOptions(): TimelineConfig<T>["resourceOptions"] {
    return this.#props.resourceOptions;
  }
  set resourceOptions(resourceOptions: TimelineConfig<T>["resourceOptions"]) {
    this.#set({ resourceOptions });
  }

  /** The render hooks: what is drawn for an item, a cluster, a label or a detail, and how each is described to a screen reader. */
  get hooks(): RenderHooks<T> | undefined {
    return this.#props.hooks;
  }
  set hooks(hooks: RenderHooks<T> | undefined) {
    this.#set({ hooks: hooks ?? {} });
  }

  /** `"horizontal"`, `"vertical"` or `"auto"` — the `orientation` attribute as a property, which wins over it. */
  get orientation(): OrientationSetting | undefined {
    return this.#props.orientation ?? this.#config().orientation;
  }
  set orientation(orientation: OrientationSetting | undefined) {
    this.#own("orientation", orientation);
  }

  /** The `density` attribute as a property, which wins over it. */
  get density(): DensitySetting | undefined {
    return this.#props.density ?? this.#config().density;
  }
  set density(density: DensitySetting | undefined) {
    this.#own("density", density);
  }

  /** The `theme` attribute as a property, which wins over it. */
  get theme(): ThemeSetting | undefined {
    return this.#props.theme ?? this.#config().theme;
  }
  set theme(theme: ThemeSetting | undefined) {
    this.#own("theme", theme);
  }

  /** The height in pixels — the `height` attribute as a property, which wins over it. */
  get height(): number | undefined {
    return this.#props.height ?? this.#config().height;
  }
  set height(height: number | undefined) {
    this.#own("height", height);
    this.#heightStyle(this.height);
  }

  /** Whether the reader can move and resize items — the `editable` attribute as a property, which wins over it. */
  get editable(): boolean {
    return (this.#props.editing ?? this.#config().editing)?.enabled === true;
  }
  set editable(editable: boolean) {
    this.#set({ editing: { ...(this.#props.editing ?? this.#config().editing), enabled: editable } });
  }

  get selectedIds(): readonly string[] {
    return this.#timeline?.getSnapshot().selectedIds ?? this.#props.selectedIds ?? [];
  }
  /** Setting it selects those items, whatever the reader selected since — as `timeline.select` does. */
  set selectedIds(ids: readonly string[]) {
    this.#props = { ...this.#props, selectedIds: ids };
    this.#timeline?.select(ids);
  }

  /**
   * Everything a configuration can say, as one property. Setting it
   * replaces what the `config` before it said: a field it leaves out goes
   * back to what the attributes say, or to its default. A named property
   * (`items`, `theme`, …) set on its own stays.
   */
  get config(): TimelineConfig<T> {
    return { ...this.#config(), ...this.#props };
  }
  set config(config: TimelineConfig<T>) {
    const attributes = this.#config() as Record<string, unknown>;
    const props = { ...this.#props, ...config } as Record<string, unknown>;
    const next: Record<string, unknown> = { ...config };
    for (const key of this.#fromConfig) {
      if (key in config) continue;
      delete props[key];
      next[key] = attributes[key];
    }
    this.#props = props as TimelineConfig<T>;
    this.#fromConfig = new Set(Object.keys(config));
    this.#heightStyle(this.height);
    this.#timeline?.update(next as TimelineUpdate<T>);
  }

  #set(next: TimelineUpdate<T>): void {
    this.#props = { ...this.#props, ...next } as TimelineConfig<T>;
    for (const key of Object.keys(next)) this.#fromConfig.delete(key);
    this.#timeline?.update(next);
  }

  /** A property that is also an attribute: `undefined` hands it back to the attribute. */
  #own<K extends "orientation" | "density" | "theme" | "height">(key: K, value: TimelineConfig<T>[K]): void {
    if (value !== undefined) {
      this.#set({ [key]: value } as TimelineUpdate<T>);
      return;
    }
    const props = { ...this.#props } as Record<string, unknown>;
    delete props[key];
    this.#props = props as TimelineConfig<T>;
    this.#fromConfig.delete(key);
    this.#timeline?.update({ [key]: this.#config()[key] } as TimelineUpdate<T>);
  }

  /** The host's height, for the stylesheet: `--tl-height`. */
  #heightStyle(height: number | undefined): void {
    if (height === undefined || !(height > 0)) this.style.removeProperty("--tl-height");
    else this.style.setProperty("--tl-height", `${String(height)}px`);
  }

  #config(): TimelineConfig<T> {
    return this.#fromAttributes((name) => this.getAttribute(name));
  }

  /**
   * What the attributes say. The accessible name is `aria-label`, or the
   * text of the elements `aria-labelledby` names: those are in the page, and
   * the timeline inside the shadow root cannot point at them by id.
   */
  #fromAttributes(read: (name: Attribute) => string | null): TimelineConfig<T> {
    const config = configFromAttributes(read) as Record<string, unknown>;
    const ids = read("aria-labelledby");
    if (config.ariaLabel === undefined && ids !== null) {
      const root = this.getRootNode() as Document | ShadowRoot;
      const text = ids
        .split(/\s+/)
        .map((id) => (id === "" ? undefined : root.getElementById?.(id)?.textContent?.trim()))
        .filter((each) => each !== undefined && each !== "")
        .join(" ");
      if (text !== "") config.ariaLabel = text;
    }
    return config as TimelineConfig<T>;
  }

  connectedCallback(): void {
    if (this.#timeline !== undefined) return;
    // A declarative shadow root (server-rendered) is already attached, and
    // open: attaching a second would throw.
    const existing = this.shadowRoot;
    // Delegated: `element.focus()`, a label's click and the tab order reach
    // the timeline inside.
    const root = existing ?? this.attachShadow({ mode: "open", delegatesFocus: true });
    this.#heightStyle(this.height);
    let config = { ...scriptConfig(this), ...this.#config(), ...this.#props } as TimelineConfig<T>;
    // The `nonce` attribute: the browser hides its value from the attribute
    // once the element is in the document, and keeps it in the property.
    if (config.nonce === undefined && this.nonce) config = { ...config, nonce: this.nonce };
    // Adopted, or — where it cannot be — a `<style>` with the nonce, unless
    // the server's is there.
    const unstyle = adoptCss(root, HOST_CSS, config.nonce);
    const timeline = createTimeline<T>(this, config, { root, hydrate: existing !== null });
    this.#timeline = timeline;
    this.#unsubscribe = EVENTS.map((type) =>
      timeline.on(type, (detail: TimelineInstanceEventMap<T>[typeof type]) => {
        this.dispatchEvent(new CustomEvent(eventNameOf(type), { detail, bubbles: true, composed: true }));
      }),
    );
    this.#unsubscribe.push(unstyle);
  }

  disconnectedCallback(): void {
    // A move is a disconnect and a connect in one task (`append` into
    // another parent, a framework reordering a list): the instance — its
    // view, selection, collapsed groups, edits and listeners — stays. Only an
    // element still out of the document after the task's microtasks lets go.
    queueMicrotask(() => {
      if (this.isConnected) return;
      for (const stop of this.#unsubscribe) stop();
      this.#unsubscribe = [];
      this.#timeline?.destroy();
      this.#timeline = undefined;
    });
  }

  /** `moveBefore` keeps the element's state, and so does the element: nothing to do. */
  connectedMoveCallback(): void {}

  attributeChangedCallback(name: string, previous: string | null, value: string | null): void {
    if (previous === value || this.#timeline === undefined) return;
    if (name === "height") this.#heightStyle(this.height);
    const config = this.#config() as Record<string, unknown>;
    if ((name === "start" || name === "end") && config.domain !== undefined) {
      this.#timeline.zoomTo(config.domain as readonly [TimeInput, TimeInput]);
      return;
    }
    // Only what this attribute changed: the configuration the attributes
    // said before, against what they say now. A removed attribute goes back
    // to the default, which `update` spells as the key with no value. A
    // property set on the element wins over an attribute, as at connect.
    const was = this.#fromAttributes((each) => (each === name ? previous : this.getAttribute(each))) as Record<string, unknown>;
    const changed: Record<string, unknown> = {};
    let any = false;
    for (const key of new Set([...Object.keys(was), ...Object.keys(config)])) {
      if (key in this.#props || key === "domain" || sameValue(was[key], config[key])) continue;
      changed[key] = config[key];
      any = true;
    }
    if (any) this.#timeline.update(changed as TimelineUpdate<T>);
  }

  /** Listen to one of the timeline's events, typed: `item-moved` hands a `CustomEvent` whose `detail` is the move. */
  override addEventListener<K extends keyof TimelineElementEventMap<T>>(type: K, listener: (this: this, event: TimelineElementEventMap<T>[K]) => void, options?: boolean | AddEventListenerOptions): void;
  override addEventListener<K extends keyof HTMLElementEventMap>(type: K, listener: (this: this, event: HTMLElementEventMap[K]) => void, options?: boolean | AddEventListenerOptions): void;
  override addEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions): void;
  override addEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions): void {
    super.addEventListener(type, listener, options);
  }

  /** Stop listening — the counterpart of the typed {@link addEventListener}. */
  override removeEventListener<K extends keyof TimelineElementEventMap<T>>(type: K, listener: (this: this, event: TimelineElementEventMap<T>[K]) => void, options?: boolean | EventListenerOptions): void;
  override removeEventListener<K extends keyof HTMLElementEventMap>(type: K, listener: (this: this, event: HTMLElementEventMap[K]) => void, options?: boolean | EventListenerOptions): void;
  override removeEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions): void;
  override removeEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions): void {
    super.removeEventListener(type, listener, options);
  }

  /** Zoom to a domain — the instance's `zoomTo`, with the same argument. */
  zoomTo(domain: readonly [TimeInput, TimeInput]): void {
    this.#timeline?.zoomTo(domain);
  }
}

/**
 * Register the element. Idempotent, and a no-op where there are no custom
 * elements (a server), so a shared module can call it unconditionally.
 */
export function defineTimelineElement(name: string = TAG_NAME, registry?: CustomElementRegistry): void {
  const target = registry ?? (typeof customElements === "undefined" ? undefined : customElements);
  if (target === undefined || target.get(name) !== undefined) return;
  // A registry accepts one constructor per name: a second tag needs its own.
  // `getName` answers null for a constructor not yet registered.
  const constructor = (target.getName?.(TemporeumTimelineElement) ?? null) === null ? TemporeumTimelineElement : class extends TemporeumTimelineElement {};
  target.define(name, constructor);
}

declare global {
  interface HTMLElementTagNameMap {
    "temporeum-timeline": TemporeumTimelineElement;
  }
}
