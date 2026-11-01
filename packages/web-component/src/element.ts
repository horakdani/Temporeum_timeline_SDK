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

import { toTimeMs } from "@temporeum/timeline-core";
import type { DensitySetting, Lane, OrientationSetting, PackMode, RenderHooks, ThemeSetting } from "@temporeum/timeline-core";

import type { TimelineConfig, TimelineUpdate } from "./config.js";
import { HOST_CSS, TAG_NAME } from "./ssr.js";
import { createTimeline, TIMELINE_EVENTS } from "./timeline.js";
import type { Timeline, TimelineInstanceEventMap, TimelineInstanceEventName } from "./timeline.js";

const EVENTS = TIMELINE_EVENTS;

/** `itemMoved` → `item-moved`: the event name the element dispatches. */
export function eventNameOf(type: TimelineInstanceEventName): string {
  return type.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

/** The attributes the element reads. Everything else is a property. */
export const OBSERVED_ATTRIBUTES = [
  "orientation",
  "density",
  "theme",
  "locale",
  "time-zone",
  "label",
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
  set("ariaLabel", read("label"));
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

/** The `<temporeum-timeline>` element. Register with {@link defineTimelineElement}. */
export class TemporeumTimelineElement<T = unknown> extends Base {
  static get observedAttributes(): readonly string[] {
    return OBSERVED_ATTRIBUTES;
  }

  #timeline: Timeline<T> | undefined;
  #props: TimelineConfig<T> = {};
  #unsubscribe: (() => void)[] = [];

  /** The live instance, while the element is connected. */
  get timeline(): Timeline<T> | undefined {
    return this.#timeline;
  }

  get items(): TimelineConfig<T>["items"] {
    return this.#props.items;
  }
  set items(items: TimelineConfig<T>["items"]) {
    this.#set({ items });
  }

  get lanes(): readonly Lane[] | undefined {
    return this.#props.lanes;
  }
  set lanes(lanes: readonly Lane[] | undefined) {
    this.#set({ lanes: lanes ?? [] });
  }

  get groups(): TimelineConfig<T>["groups"] {
    return this.#props.groups;
  }
  set groups(groups: TimelineConfig<T>["groups"]) {
    this.#set({ groups });
  }

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

  get resourceOptions(): TimelineConfig<T>["resourceOptions"] {
    return this.#props.resourceOptions;
  }
  set resourceOptions(resourceOptions: TimelineConfig<T>["resourceOptions"]) {
    this.#set({ resourceOptions });
  }

  get hooks(): RenderHooks<T> | undefined {
    return this.#props.hooks;
  }
  set hooks(hooks: RenderHooks<T> | undefined) {
    this.#set({ hooks: hooks ?? {} });
  }

  get selectedIds(): readonly string[] {
    return this.#timeline?.getSnapshot().selectedIds ?? this.#props.selectedIds ?? [];
  }
  set selectedIds(ids: readonly string[]) {
    this.#set({ selectedIds: ids });
  }

  /** Everything else a configuration can say, as one property. */
  get config(): TimelineConfig<T> {
    return { ...this.#config(), ...this.#props };
  }
  set config(config: TimelineConfig<T>) {
    this.#set(config);
  }

  #set(next: TimelineUpdate<T>): void {
    this.#props = { ...this.#props, ...next } as TimelineConfig<T>;
    this.#timeline?.update(next);
  }

  #config(): TimelineConfig<T> {
    return configFromAttributes((name) => this.getAttribute(name)) as TimelineConfig<T>;
  }

  connectedCallback(): void {
    if (this.#timeline !== undefined) return;
    // A declarative shadow root (server-rendered) is already attached, and
    // open: attaching a second would throw.
    const existing = this.shadowRoot;
    const root = existing ?? this.attachShadow({ mode: "open" });
    if (existing === null || existing.querySelector("style") === null) {
      const style = this.ownerDocument.createElement("style");
      style.textContent = HOST_CSS;
      root.prepend(style);
    }
    const height = this.getAttribute("height");
    if (height !== null && numberAttr(height) !== undefined) this.style.setProperty("--tl-height", `${height}px`);
    const config = { ...scriptConfig(this), ...this.#config(), ...this.#props } as TimelineConfig<T>;
    const timeline = createTimeline<T>(this, config, { root, hydrate: existing !== null });
    this.#timeline = timeline;
    this.#unsubscribe = EVENTS.map((type) =>
      timeline.on(type, (detail: TimelineInstanceEventMap<T>[typeof type]) => {
        this.dispatchEvent(new CustomEvent(eventNameOf(type), { detail, bubbles: true, composed: true }));
      }),
    );
  }

  disconnectedCallback(): void {
    for (const stop of this.#unsubscribe) stop();
    this.#unsubscribe = [];
    this.#timeline?.destroy();
    this.#timeline = undefined;
  }

  attributeChangedCallback(name: string, previous: string | null, value: string | null): void {
    if (previous === value || this.#timeline === undefined) return;
    if (name === "height") {
      if (value === null || numberAttr(value) === undefined) this.style.removeProperty("--tl-height");
      else this.style.setProperty("--tl-height", `${value}px`);
    }
    const config = this.#config();
    if ((name === "start" || name === "end") && config.domain !== undefined) {
      this.#timeline.zoomTo(config.domain);
      return;
    }
    // A removed attribute goes back to the default, which `update` spells
    // as the key with no value — merging would otherwise keep the old one.
    const cleared: Record<string, undefined> = {};
    if (value === null) {
      const key = ({ "time-zone": "timeZone", label: "ariaLabel", "pack-mode": "packMode", "touch-action": "touchAction", "multi-select": "editing", "snap-ms": "editing", editable: "editing" } as Record<string, string>)[name] ?? name;
      cleared[key] = undefined;
    }
    this.#timeline.update({ ...cleared, ...config, ...this.#props } as TimelineUpdate<T>);
  }

  /** Zoom to a domain. */
  zoomTo(start: Date | number, end: Date | number): void {
    this.#timeline?.zoomTo([toTimeMs(start), toTimeMs(end)]);
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
