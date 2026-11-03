/**
 * vis-timeline's items, groups and options as a Temporeum configuration.
 *
 * The rules are vis-timeline 8's own, so that an item lands where it landed
 * there: its kind is its `type`, else the `type` option, else a range when
 * it has an end and a box when it does not; with groups, it is in its
 * group's row, a background without a group spans every row, and an item
 * whose group is missing or hidden is not drawn; groups come in
 * `groupOrder`, nested ones under their parent. What has no equivalent is
 * not dropped silently: it is a warning, with the option's name.
 */

import type { Group } from "../groups/index.js";
import type { DomainLimits, EditingOptions, InteractionOptions, Item, ItemKind, Lane, PackMode, TimeMs } from "../types.js";
import { parseVisTime, runtimeTimeZone } from "./time.js";
import type { VisTime } from "./time.js";

/** An item as vis-timeline takes it. */
export interface VisItem {
  readonly id?: string | number;
  readonly start: VisTime;
  readonly end?: VisTime;
  readonly content?: string | { readonly textContent?: string | null; readonly outerHTML?: string } | null;
  readonly group?: string | number | null;
  readonly type?: string;
  readonly className?: string;
  readonly title?: string;
  readonly editable?: boolean | { readonly updateTime?: boolean; readonly updateGroup?: boolean; readonly remove?: boolean };
  readonly selectable?: boolean;
  readonly [key: string]: unknown;
}

/** A group as vis-timeline takes it. */
export interface VisGroup {
  readonly id: string | number;
  readonly content?: string | { readonly textContent?: string | null } | null;
  readonly className?: string;
  readonly title?: string;
  readonly visible?: boolean;
  readonly nestedGroups?: readonly (string | number)[];
  readonly showNested?: boolean;
  readonly [key: string]: unknown;
}

/** vis-timeline's options. Every key is read; the ones without an equivalent are warned about. */
export type VisOptions = Readonly<Record<string, unknown>>;

/** A `DataSet`, a `DataView`, or a plain array. */
export type VisData<T> = readonly T[] | { get(): T[] };

/** Something vis-timeline does that this configuration does not. */
export interface VisWarning {
  /** The option, or `items[3].subgroup`, `groups[1].visible`. */
  readonly option: string;
  readonly message: string;
}

/** The part of a Temporeum configuration a vis-timeline setup becomes. */
export interface VisCompatConfig<T = VisItem> {
  readonly items: readonly Item<T>[];
  readonly lanes?: readonly Lane[];
  readonly groups?: readonly Group[];
  readonly domain?: readonly [TimeMs, TimeMs];
  readonly limits?: DomainLimits;
  readonly height?: number;
  readonly packMode?: PackMode;
  readonly interactions?: InteractionOptions;
  readonly editing?: EditingOptions<T> & { readonly crossLane?: boolean; readonly add?: boolean; readonly remove?: boolean };
  readonly selectedIds?: readonly string[];
  readonly direction?: "ltr" | "rtl";
  readonly locale?: string;
  readonly timeZone?: string;
  readonly hiddenDates?: readonly { readonly start: TimeMs; readonly end: TimeMs; readonly repeat?: "daily" | "weekly" | "monthly" | "yearly" }[];
  readonly rolling?: boolean | { readonly offset?: number };
  readonly cluster?: boolean;
  readonly tooltip?: (item: Item<T>) => string | null;
  readonly template?: (item: Item<T>) => string | null;
}

/** What {@link fromVis} gives. */
export interface VisConversion<T = VisItem> {
  readonly config: VisCompatConfig<T>;
  readonly warnings: readonly VisWarning[];
}

/** Options of the conversion. */
export interface FromVisOptions {
  /** The zone times without an offset are read in. The runtime's own, as in vis-timeline. */
  readonly timeZone?: string;
}

const KINDS: Readonly<Record<string, ItemKind>> = { range: "range", box: "box", point: "point", background: "background" };
const MARKUP = /<[a-z!/]/i;

const rows = <T>(data: VisData<T> | null | undefined): readonly T[] => {
  if (data === null || data === undefined) return [];
  if (Array.isArray(data)) return data as readonly T[];
  return (data as { get(): T[] }).get();
};

/**
 * The text without its `<script>` or `<style>` blocks, read forward once:
 * past the first one with no end tag, none has one.
 */
function withoutBlocks(text: string, tag: string): string {
  const open = new RegExp(`<${tag}`, "gi");
  const close = new RegExp(`</${tag}>`, "gi");
  let out = "";
  let at = 0;
  for (;;) {
    open.lastIndex = at;
    const start = open.exec(text);
    if (start === null) break;
    close.lastIndex = start.index;
    const end = close.exec(text);
    if (end === null) break;
    out += text.slice(at, start.index);
    at = close.lastIndex;
  }
  return out + text.slice(at);
}

/** Text without its markup, the way a browser would read it, for the label and the accessible name. */
export function visText(content: VisItem["content"] | VisGroup["content"]): string {
  if (content === null || content === undefined) return "";
  if (typeof content !== "string") return String(content.textContent ?? "").trim();
  if (!MARKUP.test(content)) return content;
  return withoutBlocks(withoutBlocks(content, "script"), "style")
    .replace(/<br\s*\/?>/gi, " ")
    // A tag does not hold a `<`: an unclosed one is text, read once.
    .replace(/<[^<>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/** The HTML of an item's content, when it has markup. */
function htmlOf(content: VisItem["content"]): string | undefined {
  if (typeof content === "string") return MARKUP.test(content) ? content : undefined;
  if (content !== null && content !== undefined && typeof content.outerHTML === "string") return content.outerHTML;
  return undefined;
}

/** vis-data's sort by a field: `>` and `<`, ties in insertion order. */
function sortBy<T extends object>(list: readonly T[], order: unknown): T[] {
  const copy = [...list];
  if (typeof order === "function") return copy.sort(order as (a: T, b: T) => number);
  if (typeof order !== "string") return copy;
  return copy.sort((a, b) => {
    const av = (a as Record<string, unknown>)[order] as number | string;
    const bv = (b as Record<string, unknown>)[order] as number | string;
    return av > bv ? 1 : av < bv ? -1 : 0;
  });
}

/**
 * The groups vis-timeline shows, in its order: `groupOrder`, then each
 * nested group after its parent. A hidden group (`visible: false`) is left
 * out, and so is everything nested in it: vis-timeline lays out the tree
 * from its visible roots.
 */
function orderGroups(groups: readonly VisGroup[], groupOrder: unknown): { order: VisGroup[]; parentOf: Map<string, string> } {
  const parentOf = new Map<string, string>();
  for (const group of groups) {
    if (group.nestedInGroup !== undefined && group.nestedInGroup !== null) parentOf.set(String(group.id), String(group.nestedInGroup as string | number));
  }
  for (const group of groups) for (const child of group.nestedGroups ?? []) parentOf.set(String(child), String(group.id));
  const sorted = sortBy(
    groups.filter((group) => group.visible !== false),
    groupOrder,
  );
  const order: VisGroup[] = [];
  const seen = new Set<string>();
  const visit = (group: VisGroup): void => {
    const id = String(group.id);
    if (seen.has(id)) return;
    seen.add(id);
    order.push(group);
    if (group.nestedGroups === undefined) return;
    for (const child of sorted) if (parentOf.get(String(child.id)) === id) visit(child);
  };
  for (const group of sorted) if (!parentOf.has(String(group.id))) visit(group);
  return { order, parentOf };
}

/** Options with an equivalent, read below; every other key is a warning. */
const MAPPED = new Set([
  "start",
  "end",
  "min",
  "max",
  "zoomMin",
  "zoomMax",
  "height",
  "stack",
  "moveable",
  "zoomable",
  "editable",
  "selectable",
  "multiselect",
  "rtl",
  "locale",
  "hiddenDates",
  "rollingMode",
  "cluster",
  "type",
  "groupOrder",
  "template",
  "showTooltips",
  "tooltip",
]);
/** Options that change nothing a Temporeum timeline would show differently. */
const HARMLESS = new Set(["autoResize", "clickToUse", "onInitialDrawComplete", "xss", "throttleRedraw", "width", "showCurrentTime", "maxHeight", "minHeight"]);
const HARMLESS_NOTES: Readonly<Record<string, string>> = {
  showCurrentTime: "Temporeum draws no now line by default: `decorations: [{ kind: \"now\", time: Date.now() }]` draws one (the library never reads the clock itself).",
  maxHeight: "The timeline is as tall as `height`, or its container.",
  minHeight: "The timeline is as tall as `height`, or its container.",
  width: "The timeline is as wide as its container.",
};

/**
 * A vis-timeline setup — `new vis.Timeline(container, items, groups,
 * options)` — as a Temporeum configuration, and what did not carry over:
 *
 * ```ts
 * const { config, warnings } = fromVis(items, groups, options);
 * const timeline = createTimeline(container, config);
 * ```
 *
 * Items keep their vis-timeline object as `data`; ids become strings.
 */
export function fromVis<T extends VisItem = VisItem>(
  items: VisData<T>,
  groups?: VisData<VisGroup> | null,
  options: VisOptions = {},
  conversion: FromVisOptions = {},
): VisConversion<T> {
  const warnings: VisWarning[] = [];
  const warn = (option: string, message: string): void => {
    warnings.push({ option, message });
  };
  const timeZone = conversion.timeZone ?? runtimeTimeZone();
  const absent = (value: unknown): value is null | undefined => value === undefined || value === null;
  // A time vis-timeline cannot read either is `null`, warned about with
  // what happens instead: never a NaN that would stop the whole timeline.
  const time = (value: unknown, where: string, instead: string): TimeMs | null | undefined => {
    const t = parseVisTime(value as VisTime, { timeZone });
    if (t === null || t === undefined) return undefined;
    if (!Number.isNaN(t)) return t;
    warn(where, `${JSON.stringify(value)} is not a time vis-timeline reads either; ${instead}.`);
    return null;
  };

  // --- groups ---------------------------------------------------------------
  const groupRows = groups === null || groups === undefined ? null : rows(groups);
  const { order, parentOf } = orderGroups(groupRows ?? [], options.groupOrder ?? "order");
  const hidden = new Set<string>();
  for (const [index, group] of (groupRows ?? []).entries()) {
    if (group.visible === false) {
      hidden.add(String(group.id));
      warn(`groups[${String(index)}].visible`, "A hidden group is left out, with its items: Temporeum has no hidden groups.");
    }
    for (const key of ["subgroupOrder", "subgroupStack", "subgroupVisibility", "style"]) {
      if (group[key] !== undefined) warn(`groups[${String(index)}].${key}`, key === "style" ? "Use `className` and a stylesheet." : "Rows inside a group's rows are not supported.");
    }
  }
  const shown = order;
  for (const group of groupRows ?? []) if (!order.includes(group)) hidden.add(String(group.id));
  const nested = shown.some((group) => parentOf.has(String(group.id)));
  const known = new Set(shown.map((group) => String(group.id)));

  // --- items ----------------------------------------------------------------
  const defaultType = typeof options.type === "string" ? options.type : undefined;
  const titles = new Map<string, string>();
  const html = new Map<string, string>();
  const converted: Item<T>[] = [];
  const selectable = options.selectable !== false;
  const editable = options.editable;
  const editDefaults = typeof editable === "object" && editable !== null ? (editable as Record<string, unknown>) : { add: editable === true, updateTime: editable === true, updateGroup: editable === true, remove: editable === true };
  for (const [index, raw] of rows(items).entries()) {
    const where = `items[${String(index)}]`;
    const end = raw.end === undefined || raw.end === null ? undefined : raw.end;
    const type = raw.type ?? defaultType ?? (end !== undefined ? "range" : "box");
    const kind = KINDS[type];
    if (kind === undefined) {
      warn(`${where}.type`, `vis-timeline has no item type ${JSON.stringify(type)}; the item is left out.`);
      continue;
    }
    let laneId: string | undefined;
    if (groupRows !== null) {
      const group = raw.group === undefined || raw.group === null ? undefined : String(raw.group);
      if (group === undefined) {
        if (kind !== "background") {
          warn(`${where}.group`, "With groups, vis-timeline draws no item without one; it is left out.");
          continue;
        }
      } else if (!known.has(group)) {
        warn(`${where}.group`, hidden.has(group) ? "Its group is hidden; the item is left out." : `No group ${JSON.stringify(group)}; vis-timeline does not draw the item, so it is left out.`);
        continue;
      } else {
        laneId = group;
        if (kind === "background") warn(`${where}.group`, "A background bound to one group is drawn behind every lane.");
      }
    }
    const start = time(raw.start, `${where}.start`, "the item is left out");
    if (start === null) continue;
    if (start === undefined) {
      warn(`${where}.start`, "An item needs a start; it is left out.");
      continue;
    }
    const id = raw.id === undefined ? `vis-${String(index + 1)}` : String(raw.id);
    if (raw.id === undefined) warn(`${where}.id`, `No id; it is ${JSON.stringify(id)}.`);
    const stop = kind === "box" || kind === "point" ? undefined : time(end, `${where}.end`, "the item is left out");
    if (stop === null) continue;
    if (kind === "range" && stop === undefined) warn(`${where}.end`, "vis-timeline needs an end for a range; it is drawn as an instant.");
    const label = visText(raw.content);
    const markup = htmlOf(raw.content);
    if (markup !== undefined) html.set(id, markup);
    if (typeof raw.title === "string" && raw.title !== "") titles.set(id, raw.title);
    const rights = typeof raw.editable === "object" ? { ...editDefaults, ...raw.editable } : raw.editable === undefined ? editDefaults : { updateTime: raw.editable, updateGroup: raw.editable, remove: raw.editable };
    const item: Record<string, unknown> = { id, start, data: raw };
    if (stop !== undefined) item.end = stop;
    if (laneId !== undefined) item.laneId = laneId;
    if (label !== "") item.label = label;
    if (kind !== "range") item.kind = kind;
    if (typeof raw.className === "string" && raw.className !== "") item.className = raw.className;
    if (raw.selectable === false || !selectable) item.selectable = false;
    if (raw.editable !== undefined || editable !== undefined) {
      if (rights.updateTime !== true) {
        item.movable = false;
        item.resizable = false;
      }
      if (rights.remove !== true) item.removable = false;
    }
    for (const key of ["subgroup", "style", "align", "limitSize"]) {
      if (raw[key] !== undefined) warn(`${where}.${key}`, key === "subgroup" ? "Rows inside a group's rows are not supported; nest a group instead." : key === "style" ? "Use `className` and a stylesheet." : "Not supported.");
    }
    converted.push(item as unknown as Item<T>);
  }

  // --- options --------------------------------------------------------------
  const config: Record<string, unknown> = { items: converted };
  if (groupRows !== null) {
    if (nested) {
      config.groups = shown.map((group) => {
        const out: Record<string, unknown> = { id: String(group.id) };
        const label = visText(group.content);
        if (label !== "") out.label = label;
        const parent = parentOf.get(String(group.id));
        if (parent !== undefined && known.has(parent)) out.parentId = parent;
        if (group.showNested === false) out.collapsed = true;
        if (typeof group.className === "string" && group.className !== "") out.className = group.className;
        return out;
      });
    } else {
      config.lanes = shown.map((group) => {
        const label = visText(group.content);
        return label === "" ? { id: String(group.id) } : { id: String(group.id), label };
      });
    }
  }
  const start = time(options.start, "start", "the view fits the items") ?? undefined;
  const end = time(options.end, "end", "the view fits the items") ?? undefined;
  if (start !== undefined && end !== undefined) config.domain = [start, end];
  // One given and the other not at all; a time given wrong has had its warning.
  else if ((start !== undefined && absent(options.end)) || (end !== undefined && absent(options.start))) warn(start === undefined ? "end" : "start", "Without both `start` and `end`, the view fits the items.");
  const limits: Record<string, number> = {};
  const min = time(options.min, "min", "there is no limit") ?? undefined;
  const max = time(options.max, "max", "there is no limit") ?? undefined;
  if (min !== undefined) limits.min = min;
  if (max !== undefined) limits.max = max;
  if (typeof options.zoomMin === "number") limits.minSpanMs = options.zoomMin;
  if (typeof options.zoomMax === "number") limits.maxSpanMs = options.zoomMax;
  if (Object.keys(limits).length > 0) config.limits = limits;
  if (typeof options.height === "number") config.height = options.height;
  else if (typeof options.height === "string") {
    const px = /^\s*(\d+(?:\.\d+)?)\s*(px)?\s*$/.exec(options.height);
    if (px !== null) config.height = Number(px[1]);
    else warn("height", `Only a height in pixels carries over, not ${JSON.stringify(options.height)}; the container's height is used.`);
  }
  if (options.stack === false) config.packMode = "overlap";
  const interactions: Record<string, boolean> = {};
  if (options.moveable === false) interactions.pan = false;
  if (options.zoomable === false) interactions.zoom = false;
  if (Object.keys(interactions).length > 0) config.interactions = interactions;
  if (editable !== undefined && editable !== false) {
    const rights = editDefaults;
    const editing: Record<string, unknown> = { enabled: rights.updateTime === true || rights.updateGroup === true || rights.add === true || rights.remove === true };
    if (rights.updateGroup === true) editing.crossLane = true;
    if (rights.add === true) editing.add = true;
    if (rights.remove === true) editing.remove = true;
    if (options.multiselect === true) editing.multiSelect = true;
    config.editing = editing;
    if (typeof editable === "object" && editable !== null && (editable as Record<string, unknown>).overrideItems !== undefined) warn("editable.overrideItems", "Item rights always narrow the timeline's.");
  } else if (options.multiselect === true) config.editing = { multiSelect: true };
  if (options.rtl === true) config.direction = "rtl";
  if (typeof options.locale === "string") config.locale = options.locale;
  if (conversion.timeZone !== undefined) config.timeZone = conversion.timeZone;
  if (Array.isArray(options.hiddenDates) || (typeof options.hiddenDates === "object" && options.hiddenDates !== null)) {
    const list = (Array.isArray(options.hiddenDates) ? options.hiddenDates : [options.hiddenDates]) as readonly Record<string, unknown>[];
    const hiddenDates: Record<string, unknown>[] = [];
    for (const [index, range] of list.entries()) {
      const from = time(range.start, `hiddenDates[${String(index)}].start`, "the range is not hidden");
      const to = time(range.end, `hiddenDates[${String(index)}].end`, "the range is not hidden");
      if (absent(from) || absent(to)) continue;
      const out: Record<string, unknown> = { start: from, end: to };
      if (range.repeat === "daily" || range.repeat === "weekly" || range.repeat === "monthly" || range.repeat === "yearly") out.repeat = range.repeat;
      else if (range.repeat !== undefined) warn(`hiddenDates[${String(index)}].repeat`, `No repeat ${JSON.stringify(range.repeat)}.`);
      hiddenDates.push(out);
    }
    config.hiddenDates = hiddenDates;
  }
  if (typeof options.rollingMode === "object" && options.rollingMode !== null) {
    const rolling = options.rollingMode as Record<string, unknown>;
    if (rolling.follow === true) config.rolling = typeof rolling.offset === "number" ? { offset: rolling.offset } : true;
  }
  if (options.cluster !== undefined && options.cluster !== false) {
    config.cluster = true;
    if (typeof options.cluster === "object") warn("cluster", "Clusters are tuned with Temporeum's own `cluster` options (gap, itemSize, minCount).");
  }
  if (titles.size > 0 && options.showTooltips !== false) config.tooltip = (item: Item<T>) => titles.get(item.id) ?? null;
  if (typeof options.tooltip === "object" && options.tooltip !== null && typeof (options.tooltip as Record<string, unknown>).template === "function") {
    const template = (options.tooltip as { template: (data: unknown) => unknown }).template;
    config.tooltip = (item: Item<T>) => {
      const out = template(item.data);
      return typeof out === "string" ? out : null;
    };
  }
  if (typeof options.template === "function") {
    const template = options.template as (data: unknown) => unknown;
    config.template = (item: Item<T>) => {
      const out = template(item.data);
      if (typeof out === "string") return out;
      if (out !== null && typeof out === "object" && typeof (out as { outerHTML?: unknown }).outerHTML === "string") return (out as { outerHTML: string }).outerHTML;
      return null;
    };
  } else if (html.size > 0) config.template = (item: Item<T>) => html.get(item.id) ?? null;
  for (const key of Object.keys(options)) {
    if (MAPPED.has(key)) continue;
    if (HARMLESS.has(key)) {
      const note = HARMLESS_NOTES[key];
      if (note !== undefined && options[key] !== false) warn(key, note);
      continue;
    }
    warn(key, "No equivalent in Temporeum yet; see the migration guide.");
  }
  return { config: config as unknown as VisCompatConfig<T>, warnings };
}

/** Only the items: {@link fromVis} without groups or options. */
export function fromVisItems<T extends VisItem = VisItem>(items: VisData<T>, conversion: FromVisOptions = {}): VisConversion<T> {
  return fromVis(items, null, {}, conversion);
}
