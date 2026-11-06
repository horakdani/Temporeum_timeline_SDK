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
export const OBSERVED_ATTRIBUTES = Object.freeze([
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
] as const);

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
    // Every time the configuration holds, wherever it is: what is not read stays as it was, and is left out with `inputSkipped`.
    const time = (value: unknown): unknown => (typeof value === "string" ? (timeAttr(value) ?? value) : value);
    const times = (value: unknown, fields: readonly string[]): unknown => {
      if (typeof value !== "object" || value === null || Array.isArray(value)) return value;
      const copy: Record<string, unknown> = { ...value };
      for (const field of fields) if (field in copy) copy[field] = time(copy[field]);
      if ("baseline" in copy) copy.baseline = times(copy.baseline, ["start", "end"]);
      return copy;
    };
    const each = (key: string, fields: readonly string[]): void => {
      const list = config[key];
      if (Array.isArray(list)) config[key] = list.map((entry) => times(entry, fields));
    };
    each("items", ["start", "end"]);
    each("decorations", ["time", "start", "end"]);
    each("timeBars", ["time"]);
    each("hiddenDates", ["start", "end"]);
    // `domain` only: the wrappers' `defaultDomain` is not a key of the
    // element's configuration, and converting it read as if it were (Y17).
    if (Array.isArray(config.domain)) config.domain = config.domain.map(time);
    if ("limits" in config) config.limits = times(config.limits, ["min", "max"]);
    if ("editing" in config) config.editing = times(config.editing, ["snapOrigin"]);
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
const UPGRADED = ["config", "items", "lanes", "groups", "template", "gantt", "resources", "resourceOptions", "hooks", "selectedIds", "orientation", "density", "theme", "height", "editable", "multiSelect", "snapMs", "locale", "timeZone", "breakpoint", "packMode", "cluster", "direction", "calendar", "touchAction", "domain"] as const;

/** The configuration fields a property owns on its own: `undefined` hands one back to its attribute. */
type Owned = "orientation" | "density" | "theme" | "height" | "locale" | "timeZone" | "breakpoint" | "packMode" | "cluster" | "direction" | "calendar" | "touchAction";

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
    // Asked for from a script after the element, while the document still
    // loads: its children are parsed, so it sets up now (Y5).
    if (this.#timeline === undefined && this.isConnected && !this.#parsing()) this.connectedCallback();
    return this.#timeline;
  }

  /**
   * Whether the parser may still add the element's children: the document
   * is loading, and nothing follows the element or any of its ancestors yet,
   * so the parser has not passed its end tag (X15, Y5).
   */
  #parsing(): boolean {
    const doc = this.ownerDocument;
    if (doc.readyState !== "loading" || this.getRootNode() !== doc) return false;
    let next = this.nextSibling;
    for (let node = this.parentNode; next === null && node !== null; node = node.parentNode) next = node.nextSibling;
    return next === null;
  }

  /**
   * The items: an array, or a function that fetches the ones in a range.
   * Reading it gives the items as they are drawn — a drag or `updateItems`
   * included — as `domain` and `selectedIds` give the view and the selection.
   */
  get items(): TimelineConfig<T>["items"] {
    const given = this.#effective().items;
    return typeof given === "function" || this.#timeline === undefined ? given : this.#timeline.items;
  }
  set items(items: TimelineConfig<T>["items"]) {
    this.#set({ items });
  }

  /** The lanes the items are in, in order. */
  get lanes(): readonly Lane[] | undefined {
    return this.#effective().lanes;
  }
  set lanes(lanes: readonly Lane[] | undefined) {
    this.#set({ lanes: lanes ?? [] });
  }

  /** Nested groups of lanes, which the reader collapses and reorders (the `/groups` plugin). */
  get groups(): TimelineConfig<T>["groups"] {
    return this.#effective().groups;
  }
  set groups(groups: TimelineConfig<T>["groups"]) {
    this.#set({ groups });
  }

  /** Each item's content as HTML (the `/items` plugin). */
  get template(): TimelineConfig<T>["template"] {
    return this.#effective().template;
  }
  set template(template: TimelineConfig<T>["template"]) {
    this.#set({ template });
  }

  /** Dependency arrows and the Gantt drawing; the task grid is `mountTaskGrid(box, element.timeline)`. */
  get gantt(): TimelineConfig<T>["gantt"] {
    return this.#effective().gantt;
  }
  set gantt(gantt: TimelineConfig<T>["gantt"]) {
    this.#set({ gantt });
  }

  /** The resources, for a resource view; the unscheduled tasks beside it are `mountBacklog(box, element.timeline, { tasks })`. */
  get resources(): TimelineConfig<T>["resources"] {
    return this.#effective().resources;
  }
  set resources(resources: TimelineConfig<T>["resources"]) {
    this.#set({ resources });
  }

  /** How the resource view counts and draws the load: the units an assignment takes, the load lane. */
  get resourceOptions(): TimelineConfig<T>["resourceOptions"] {
    return this.#effective().resourceOptions;
  }
  set resourceOptions(resourceOptions: TimelineConfig<T>["resourceOptions"]) {
    this.#set({ resourceOptions });
  }

  /** The render hooks: what is drawn for an item, a cluster, a label or a detail, and how each is described to a screen reader. */
  get hooks(): RenderHooks<T> | undefined {
    return this.#effective().hooks;
  }
  set hooks(hooks: RenderHooks<T> | undefined) {
    this.#set({ hooks: hooks ?? {} });
  }

  /** `"horizontal"`, `"vertical"` or `"auto"` — the `orientation` attribute as a property, which wins over it. */
  get orientation(): OrientationSetting | undefined {
    return this.#effective().orientation;
  }
  set orientation(orientation: OrientationSetting | undefined) {
    this.#own("orientation", orientation);
  }

  /** The `density` attribute as a property, which wins over it. */
  get density(): DensitySetting | undefined {
    return this.#effective().density;
  }
  set density(density: DensitySetting | undefined) {
    this.#own("density", density);
  }

  /** The `theme` attribute as a property, which wins over it. */
  get theme(): ThemeSetting | undefined {
    return this.#effective().theme;
  }
  set theme(theme: ThemeSetting | undefined) {
    this.#own("theme", theme);
  }

  /** The height in pixels — the `height` attribute as a property, which wins over it. */
  get height(): number | undefined {
    return this.#effective().height;
  }
  set height(height: number | undefined) {
    this.#own("height", height);
    this.#heightStyle(this.height);
  }

  /** The `locale` attribute as a property, which wins over it. */
  get locale(): string | undefined {
    return this.#effective().locale;
  }
  set locale(locale: string | undefined) {
    this.#own("locale", locale);
  }

  /** The `time-zone` attribute as a property, which wins over it. */
  get timeZone(): string | undefined {
    return this.#effective().timeZone;
  }
  set timeZone(timeZone: string | undefined) {
    this.#own("timeZone", timeZone);
  }

  /** The `breakpoint` attribute as a property, which wins over it. */
  get breakpoint(): number | undefined {
    return this.#effective().breakpoint;
  }
  set breakpoint(breakpoint: number | undefined) {
    this.#own("breakpoint", breakpoint);
  }

  /** The `pack-mode` attribute as a property, which wins over it. */
  get packMode(): TimelineConfig<T>["packMode"] {
    return this.#effective().packMode;
  }
  set packMode(packMode: TimelineConfig<T>["packMode"]) {
    this.#own("packMode", packMode);
  }

  /** The `cluster` attribute as a property, which wins over it — and takes the clustering's options too. */
  get cluster(): TimelineConfig<T>["cluster"] {
    return this.#effective().cluster;
  }
  set cluster(cluster: TimelineConfig<T>["cluster"]) {
    this.#own("cluster", cluster);
  }

  /** The `direction` attribute as a property, which wins over it. */
  get direction(): TimelineConfig<T>["direction"] {
    return this.#effective().direction;
  }
  set direction(direction: TimelineConfig<T>["direction"]) {
    this.#own("direction", direction);
  }

  /** The `calendar` attribute as a property, which wins over it. */
  get calendar(): string | undefined {
    return this.#effective().calendar;
  }
  set calendar(calendar: string | undefined) {
    this.#own("calendar", calendar);
  }

  /** The `touch-action` attribute as a property, which wins over it. */
  get touchAction(): TimelineConfig<T>["touchAction"] {
    return this.#effective().touchAction;
  }
  set touchAction(touchAction: TimelineConfig<T>["touchAction"]) {
    this.#own("touchAction", touchAction);
  }

  /**
   * The visible range — the `start` and `end` attributes as one property.
   * Reading it gives the range the reader is looking at now; setting it
   * moves the view there, as `timeline.zoomTo` does.
   */
  get domain(): readonly [TimeInput, TimeInput] | undefined {
    return this.#timeline?.getSnapshot().domain ?? this.#effective().domain;
  }
  /** Setting it zooms there; `undefined` hands the range back to the `start` and `end` attributes (X24). */
  set domain(domain: readonly [TimeInput, TimeInput] | undefined) {
    this.#props = { ...this.#props, domain };
    if (domain === undefined) delete (this.#props as { domain?: unknown }).domain;
    const next = this.#effective().domain;
    if (next !== undefined) this.#timeline?.zoomTo(next);
  }

  /** Whether the reader can move and resize items — the `editable` attribute as a property, which wins over it. */
  get editable(): boolean {
    return this.#effective().editing?.enabled === true;
  }
  set editable(editable: boolean | undefined) {
    this.#editing({ enabled: editable });
  }

  /** Whether Shift and Ctrl/Cmd add to the selection — the `multi-select` attribute as a property, which wins over it. */
  get multiSelect(): boolean | undefined {
    return this.#effective().editing?.multiSelect;
  }
  set multiSelect(multiSelect: boolean | undefined) {
    this.#editing({ multiSelect });
  }

  /** The grid moves and resizes snap to, in milliseconds — the `snap-ms` attribute as a property, which wins over it. */
  get snapMs(): number | undefined {
    return this.#effective().editing?.snapMs;
  }
  set snapMs(snapMs: number | undefined) {
    this.#editing({ snapMs });
  }

  get selectedIds(): readonly string[] {
    return this.#timeline?.getSnapshot().selectedIds ?? this.#effective().selectedIds ?? [];
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
    // The items and the selection as they are, as the `items` and
    // `selectedIds` properties give them: `el.config = { ...el.config, theme }`
    // after a drag handed back the configured array, and undid the drag (Y29).
    const config = this.#effective();
    const timeline = this.#timeline;
    return timeline === undefined ? config : { ...config, items: this.items, selectedIds: timeline.getSnapshot().selectedIds };
  }
  set config(config: TimelineConfig<T>) {
    const attributes = { ...this.#fromScript(), ...this.#config() } as Record<string, unknown>;
    const props = { ...this.#props, ...config } as Record<string, unknown>;
    const next: Record<string, unknown> = { ...config };
    for (const key of this.#fromConfig) {
      if (key in config) continue;
      delete props[key];
      next[key] = attributes[key];
    }
    this.#props = props as TimelineConfig<T>;
    this.#fromConfig = new Set(Object.keys(config));
    if ("editing" in next) next.editing = this.#effective().editing;
    this.#heightStyle(this.height);
    this.#timeline?.update(next as TimelineUpdate<T>);
  }

  #set(next: TimelineUpdate<T>): void {
    this.#props = { ...this.#props, ...next } as TimelineConfig<T>;
    for (const key of Object.keys(next)) this.#fromConfig.delete(key);
    this.#timeline?.update(next);
  }

  /**
   * The attributes, and the properties over them. `editing` field by field:
   * three attributes and three properties each say a part of it, and setting
   * `editable` must not silence `multi-select` or `snap-ms`.
   */
  #effective(): TimelineConfig<T> {
    // The JSON child first, the attributes over it, the properties over both — as the instance is made (V17).
    const attributes = { ...this.#fromScript(), ...this.#config() } as TimelineConfig<T>;
    const editing = this.#props.editing;
    return { ...attributes, ...this.#props, ...(editing === undefined || attributes.editing === undefined ? {} : { editing: { ...attributes.editing, ...editing } }) };
  }

  /** Some editing fields as properties: an `undefined` one goes back to its attribute. */
  #editing(fields: Record<string, unknown>): void {
    const editing = { ...this.#props.editing, ...fields } as Record<string, unknown>;
    for (const key of Object.keys(fields)) if (fields[key] === undefined) delete editing[key];
    this.#props = { ...this.#props, editing } as TimelineConfig<T>;
    this.#fromConfig.delete("editing");
    this.#timeline?.update({ editing: this.#effective().editing } as TimelineUpdate<T>);
  }

  /** A property that is also an attribute: `undefined` hands it back to the attribute. */
  #own<K extends Owned>(key: K, value: TimelineConfig<T>[K]): void {
    if (value !== undefined) {
      this.#set({ [key]: value } as TimelineUpdate<T>);
      return;
    }
    const props = { ...this.#props } as Record<string, unknown>;
    delete props[key];
    this.#props = props as TimelineConfig<T>;
    this.#fromConfig.delete(key);
    this.#timeline?.update({ [key]: this.#effective()[key] } as TimelineUpdate<T>);
  }

  /** The host's height, for the stylesheet: `--tl-height`. */
  #heightStyle(height: number | undefined): void {
    if (height === undefined || !(height > 0)) this.style.removeProperty("--tl-height");
    else this.style.setProperty("--tl-height", `${String(height)}px`);
  }

  #config(): TimelineConfig<T> {
    return this.#fromAttributes((name) => this.getAttribute(name));
  }

  #scriptText: string | null | undefined;
  #scriptValue: TimelineConfig = {};

  #labelWatch: MutationObserver | undefined;

  /**
   * `aria-labelledby` is live, as the platform's is (V18): while it names the
   * timeline, a change to the text it points at — or a label put in later —
   * names it anew. The page's light DOM is watched, not the drawing.
   */
  #watchLabel(): void {
    this.#labelWatch?.disconnect();
    this.#labelWatch = undefined;
    if (this.#timeline === undefined || this.getAttribute("aria-labelledby") === null || typeof MutationObserver === "undefined") return;
    let named = this.#config().ariaLabel;
    this.#labelWatch = new MutationObserver(() => {
      const name = this.#config().ariaLabel;
      if (name === named) return;
      named = name;
      if (!("ariaLabel" in this.#props)) this.#timeline?.update({ ariaLabel: this.#effective().ariaLabel } as TimelineUpdate<T>);
    });
    this.#labelWatch.observe(this.getRootNode(), { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["id"] });
  }

  /** What the JSON child says, read again only when its text changed. */
  #fromScript(): TimelineConfig {
    const text = this.querySelector(":scope > script[type='application/json']")?.textContent ?? null;
    if (text !== this.#scriptText) {
      this.#scriptText = text;
      this.#scriptValue = scriptConfig(this);
    }
    return this.#scriptValue;
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
    if (this.#timeline !== undefined) {
      // Moved, perhaps into another root: the labels are looked up there now.
      this.#watchLabel();
      return;
    }
    // Defined before the parser reached its children (a `<script>` in the
    // head): its JSON child and its declarative shadow root are not there
    // yet. It sets up once they are (X15) — at `DOMContentLoaded`, or when a
    // script after it asks for `timeline` (Y5). A `<script>` after the
    // element finds it parsed, and set up at once.
    if (this.#parsing()) {
      this.ownerDocument.addEventListener("DOMContentLoaded", () => this.#timeline === undefined && this.isConnected && this.connectedCallback(), { once: true });
      return;
    }
    // A declarative shadow root (server-rendered) is already attached, and
    // open: attaching a second would throw.
    const existing = this.shadowRoot;
    // Delegated: `element.focus()`, a label's click and the tab order reach
    // the timeline inside.
    const root = existing ?? this.attachShadow({ mode: "open", delegatesFocus: true });
    this.#heightStyle(this.height);
    let config = this.#effective();
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
    this.#watchLabel();
  }

  disconnectedCallback(): void {
    // A move is a disconnect and a connect in one task (`append` into
    // another parent, a framework reordering a list): the instance — its
    // view, selection, collapsed groups, edits and listeners — stays. Only an
    // element still out of the document after the task's microtasks lets go.
    queueMicrotask(() => {
      const timeline = this.#timeline;
      if (this.isConnected || timeline === undefined) return;
      for (const stop of this.#unsubscribe) stop();
      this.#unsubscribe = [];
      this.#labelWatch?.disconnect();
      this.#labelWatch = undefined;
      // What the reader did stays the element's: put back in, it draws the
      // items and the selection it was let go with (the view is the one it is configured with).
      const { selectedIds } = timeline.getSnapshot();
      this.#props = { ...this.#props, ...(typeof this.#props.items === "function" ? {} : { items: timeline.items }), selectedIds };
      timeline.destroy();
      this.#timeline = undefined;
    });
  }

  /** `moveBefore` keeps the element's state, and so does the element: nothing to do. */
  connectedMoveCallback(): void {}

  attributeChangedCallback(name: string, previous: string | null, value: string | null): void {
    if (previous === value || this.#timeline === undefined) return;
    if (name === "aria-labelledby") this.#watchLabel();
    if (name === "height") this.#heightStyle(this.height);
    // A removed attribute goes back to what the JSON child says, else to the default.
    const config = { ...this.#fromScript(), ...this.#config() } as Record<string, unknown>;
    if ((name === "start" || name === "end") && config.domain !== undefined) {
      this.#timeline.zoomTo(config.domain as readonly [TimeInput, TimeInput]);
      return;
    }
    // Only what this attribute changed: the configuration the attributes
    // said before, against what they say now. A removed attribute goes back
    // to the default, which `update` spells as the key with no value. A
    // property set on the element wins over an attribute, as at connect.
    const was = { ...this.#fromScript(), ...this.#fromAttributes((each) => (each === name ? previous : this.getAttribute(each))) } as Record<string, unknown>;
    const changed: Record<string, unknown> = {};
    let any = false;
    for (const key of new Set([...Object.keys(was), ...Object.keys(config)])) {
      // `editing` is said field by field, so an attribute's field still counts beside a property's.
      if ((key in this.#props && key !== "editing") || key === "domain" || sameValue(was[key], config[key])) continue;
      changed[key] = key === "editing" ? this.#effective().editing : config[key];
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
    // Before there is an instance, as the `domain` property: kept, not lost (Y5).
    const timeline = this.timeline;
    if (timeline === undefined) this.domain = domain;
    else timeline.zoomTo(domain);
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
