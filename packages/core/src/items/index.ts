/**
 * `@temporeum/timeline-core/items` — item kinds, adding and removing items,
 * and HTML templates.
 *
 * A separate entry point because the base one is full: its budget is
 * spent on the engine every timeline needs. What is here is what some
 * timelines need, and it works through the engine's own seams — the render
 * hooks draw the kinds, decorations draw the backgrounds, and an add or a
 * remove is a patch like any move — so nothing in the base entry point
 * changes, and nobody who does not import this pays for it.
 *
 * The library never saves. An add or a remove leaves as a {@link Command}
 * whose inverse puts the list back exactly as it was — the removed item in
 * the very place it had — and the host decides what happens to it.
 */

import { applyPatches, createCommand, snapTime } from "../editing.js";
import type { EraDecoration } from "../decorations.js";
import { lineAttrs, rectAttrs, withClass } from "../draw.js";
import type { KeySample } from "../keyboard.js";
import { MAX_SUBLANE_SPAN, resolveSpan } from "../layout.js";
import { defaultItemNode, FOCUS_RING_GAP } from "../render.js";
import type { ItemRenderContext, RenderHooks } from "../render.js";
import type { TimeScale } from "../scale.js";
import type { SceneElement } from "../scene.js";
import type { Command, Item, ItemPatch, MainCross, MainCrossRect, TimeMs } from "../types.js";

import { withoutId } from "./nodes.js";

export { withoutId } from "./nodes.js";
export { parseTemplate, slotHooks, templateHooks, TEMPLATE_ATTRIBUTES, TEMPLATE_TAGS } from "./template.js";
export type { TemplateContext, TemplateHookOptions, TemplateOptions } from "./template.js";

// --- kinds -------------------------------------------------------------------

/** How {@link itemKindHooks} draws. */
export interface ItemKindOptions {
  /**
   * Draw a remove handle on each selected item — the gesture twin of the
   * `Delete` key. Its box is {@link removeHandleBox}.
   */
  readonly removable?: boolean;
}

/** Largest radius of a point's dot, in CSS pixels. */
const POINT_RADIUS = 5;
/** Largest side of a remove handle, in CSS pixels. */
const REMOVE_HANDLE_SIZE = 16;

/**
 * The remove handle of a drawn item: a square at its end, on its first row —
 * inside the item when it has room for three, just past its end otherwise.
 * Inside, because a drawn box is clipped at the edge of the view, and a
 * handle past a clipped end would be off-screen.
 */
export function removeHandleBox(box: MainCrossRect): MainCrossRect {
  const size = Math.min(box.crossSize, REMOVE_HANDLE_SIZE);
  const main = box.mainSize >= 3 * size ? box.main + box.mainSize - size - 2 : box.main + box.mainSize + 2;
  return { main, mainSize: size, cross: box.cross, crossSize: size };
}

/** Whether a point is on a remove handle. */
export function onRemoveHandle(box: MainCrossRect, point: MainCross, slop = 0): boolean {
  const handle = removeHandleBox(box);
  return (
    point.main >= handle.main - slop &&
    point.main <= handle.main + handle.mainSize + slop &&
    point.cross >= handle.cross - slop &&
    point.cross <= handle.cross + handle.crossSize + slop
  );
}

function classesOf<T>(context: ItemRenderContext<T>, kind: string): string {
  const item = context.placed.item;
  return withClass(`tl-item tl-item--${kind}${context.selected ? " tl-item--selected" : ""}`, item.className);
}

/**
 * A box or a point: the shape at its time, and a line from it to the axis.
 *
 * A box is the item's own bar with the line from its middle; a point is a
 * dot at its start. Either way it is packed in time like any instant — the
 * layout never decides by pixels — and the label is placed by the label
 * placer as for any other item.
 */
function kindNode<T>(context: ItemRenderContext<T>, kind: "box" | "point"): SceneElement {
  const { box, projector, metrics } = context;
  const at = kind === "point" ? box.main : box.main + box.mainSize / 2;
  const shape: SceneElement =
    kind === "box"
      ? { tag: "rect", attrs: { class: "tl-item-box", ...rectAttrs(box, projector), rx: metrics.cornerRadius } }
      : dotNode(context, "tl-item-dot", 0);
  return {
    tag: "g",
    attrs: { class: classesOf(context, kind), "data-tl-id": context.placed.item.id },
    children: [
      {
        tag: "line",
        attrs: {
          class: "tl-item-line",
          ...lineAttrs({ main: at, cross: metrics.axisSize }, { main: at, cross: box.cross }, projector),
          // A guide across the lanes above, not the item: a pointer on it is
          // over whatever it crosses, as the hit test has it.
          "pointer-events": "none",
        },
      },
      shape,
      { tag: "title", text: context.name },
    ],
  };
}

/** A point's dot at its start, in the middle of its row — or, `grow` wider, its focus ring. */
function dotNode<T>(context: ItemRenderContext<T>, className: string, grow: number): SceneElement {
  const box = context.box;
  const centre = context.projector.projectPoint({ main: box.main, cross: box.cross + box.crossSize / 2 });
  return { tag: "circle", attrs: { class: className, cx: centre.x, cy: centre.y, r: Math.min(box.crossSize / 2, POINT_RADIUS) + grow } };
}

/** A remove handle: a square with a cross in it. Hidden from assistive technology — its twin is the `Delete` key. */
function removeHandleNode<T>(context: ItemRenderContext<T>): SceneElement {
  const handle = removeHandleBox(context.box);
  const inset = handle.crossSize / 4;
  const a = { main: handle.main + inset, cross: handle.cross + inset };
  const b = { main: handle.main + handle.mainSize - inset, cross: handle.cross + handle.crossSize - inset };
  const style = "stroke:var(--tl-focus);stroke-width:1.5";
  return {
    tag: "g",
    attrs: { class: "tl-remove", "aria-hidden": "true", "data-tl-remove": context.placed.item.id },
    children: [
      {
        tag: "rect",
        attrs: { ...rectAttrs(handle, context.projector), rx: 3, style: "fill:var(--tl-surface);stroke:var(--tl-focus)" },
      },
      { tag: "line", attrs: { ...lineAttrs(a, b, context.projector), style } },
      {
        tag: "line",
        attrs: { ...lineAttrs({ main: a.main, cross: b.cross }, { main: b.main, cross: a.cross }, context.projector), style },
      },
    ],
  };
}

/**
 * Render hooks that draw `box` and `point` items, and a remove handle on the
 * selected ones when asked. Every other item goes to `hooks.renderItem`, or
 * to the default. The render step adds the option semantics to whatever a
 * hook draws, so a box is a `role="option"` with its accessible name like
 * any range.
 *
 * `background` items are not drawn by a hook: they are not items to the
 * layout at all — see {@link splitBackgrounds}.
 */
export function itemKindHooks<T>(hooks: RenderHooks<T> = {}, options: ItemKindOptions = {}): RenderHooks<T> {
  const base = hooks.renderItem ?? defaultItemNode;
  return {
    ...hooks,
    renderItem(context) {
      const kind = context.placed.item.kind;
      const node = kind === "box" || kind === "point" ? kindNode(context, kind) : base(context);
      if (node === null || options.removable !== true || !context.selected || context.placed.item.removable === false) {
        return node;
      }
      return { tag: "g", attrs: { "data-tl-id": context.placed.item.id }, children: [withoutId(node), removeHandleNode(context)] };
    },
    renderFocus(context) {
      // A dot's ring is a circle round the dot, not a pill round its row.
      return context.placed.item.kind === "point" ? dotNode(context, "tl-focus-ring", FOCUS_RING_GAP) : hooks.renderFocus?.(context);
    },
  };
}

/** The items the layout packs, and the backgrounds as decorations. */
export interface SplitItems<T = unknown> {
  readonly items: readonly Item<T>[];
  readonly backgrounds: readonly EraDecoration[];
}

/**
 * Take the `background` items out of a list, as era decorations.
 *
 * A background is drawn in the background layer, under every item and every
 * lane's content: it cannot cover an item, it is not an option, and no
 * pointer can hit it — the hit tester only knows the layout, and a
 * background is not in it. Its label is drawn like an era's. It spans every
 * lane: the base entry point's eras are not lane-bound.
 */
export function splitBackgrounds<T>(items: readonly Item<T>[], timeZone?: string): SplitItems<T> {
  if (!items.some((item) => item.kind === "background")) return { items, backgrounds: [] };
  const kept: Item<T>[] = [];
  const backgrounds: EraDecoration[] = [];
  for (const item of items) {
    if (item.kind !== "background") {
      kept.push(item);
      continue;
    }
    const span = resolveSpan(item, timeZone);
    backgrounds.push({
      kind: "era",
      id: `bg:${item.id}`,
      start: span.start,
      end: span.open ? Number.MAX_SAFE_INTEGER : span.end,
      ...(item.label === undefined ? {} : { label: item.label }),
      className: item.className === undefined ? "tl-background" : `tl-background ${item.className}`,
    });
  }
  return { items: kept, backgrounds };
}

// --- add and remove ----------------------------------------------------------

/** Vetoes, read from the editing options. */
export interface ItemVetoes<T = unknown> {
  readonly canAdd?: (item: Item<T>) => boolean;
  readonly canRemove?: (item: Item<T>) => boolean;
}

/**
 * Apply patches, adds and removes included: a patch with `item` puts that
 * item in the list (at `index`, or in place of the one with its id, or at the
 * end), a patch with `item: null` takes it out, and the rest is
 * `applyPatches`. Untouched items come back by reference.
 */
export function applyItemPatches<T>(items: readonly Item<T>[], patches: readonly ItemPatch[]): Item<T>[] {
  if (!patches.some((patch) => "item" in patch)) return applyPatches(items, patches);
  let next = [...items];
  let plain: ItemPatch[] = [];
  const flush = (): void => {
    if (plain.length > 0) next = applyPatches(next, plain);
    plain = [];
  };
  for (const patch of patches) {
    if (!("item" in patch)) {
      plain.push(patch);
      continue;
    }
    flush();
    const at = next.findIndex((item) => item.id === patch.id);
    if (patch.item === null || patch.item === undefined) {
      if (at >= 0) next.splice(at, 1);
      continue;
    }
    const item = patch.item as Item<T>;
    if (at >= 0) next.splice(at, 1);
    const index = patch.index ?? (at >= 0 ? at : next.length);
    next.splice(Math.max(0, Math.min(index, next.length)), 0, item);
  }
  flush();
  return next;
}

/**
 * The command that adds `item`, or `undefined` when the host vetoed it or an
 * item with its id is already there. The item goes to the end of the list
 * unless `index` says otherwise.
 */
export function addCommand<T>(
  items: readonly Item<T>[],
  item: Item<T>,
  options: ItemVetoes<T> & { readonly index?: number; readonly label?: string } = {},
): Command<T> | undefined {
  if (items.some((each) => each.id === item.id)) return undefined;
  if (options.canAdd !== undefined && !options.canAdd(item)) return undefined;
  const index = options.index ?? items.length;
  return createCommand<T>(
    "add",
    [{ id: item.id, item: null, index }],
    [{ id: item.id, item, index }],
    options.label,
  );
}

/**
 * The command that removes the items with `ids`, or `undefined` when none of
 * them is there or the host vetoed any one of them: a removal is atomic.
 *
 * The inverse puts each item back at the index it had. Its patches run in
 * ascending index order, so the earlier ones are back before the later ones
 * are counted from them — which is what makes the restored list identical,
 * not merely equal as a set.
 */
export function removeCommand<T>(
  items: readonly Item<T>[],
  ids: readonly string[],
  options: ItemVetoes<T> & { readonly label?: string } = {},
): Command<T> | undefined {
  const wanted = new Set(ids);
  const found: { item: Item<T>; index: number }[] = [];
  items.forEach((item, index) => {
    if (wanted.has(item.id)) found.push({ item, index });
  });
  if (found.length === 0) return undefined;
  for (const { item } of found) {
    if (item.removable === false) return undefined;
    if (options.canRemove !== undefined && !options.canRemove(item)) return undefined;
  }
  return createCommand<T>(
    "remove",
    found.map(({ item, index }) => ({ id: item.id, item, index })),
    found.map(({ item, index }) => ({ id: item.id, item: null, index })),
    options.label,
  );
}

/** Where a new item goes: its time and its lane. */
export interface AddTarget {
  readonly start: TimeMs;
  readonly end: TimeMs;
  /** `null`: the default lane. */
  readonly laneId: string | null;
}

/** What turns an {@link AddTarget} into a host's item. */
export type CreateItem<T = unknown> = (target: AddTarget) => Item<T> | undefined;

/** How a target is found. */
export interface AddTargetOptions {
  readonly snapMs?: number;
  readonly snapOrigin?: TimeMs;
  /** The zone a grid of whole days lies in: local midnights all year. UTC by default. */
  readonly timeZone?: string;
  /** The new item's duration. A twentieth of the view by default. */
  readonly durationMs?: number;
}

const DEFAULT_SHARE = 20;

function targetAt(start: TimeMs, laneId: string | null, domain: readonly [TimeMs, TimeMs], options: AddTargetOptions): AddTarget {
  const snapped = snapTime(start, options.snapMs, options.snapOrigin, options.timeZone);
  const duration = options.durationMs ?? Math.max(1, Math.round((domain[1] - domain[0]) / DEFAULT_SHARE));
  return { start: snapped, end: snapped + duration, laneId };
}

/**
 * The gesture's target: where a double tap on empty lane space landed.
 * `laneAt` is the hit tester's.
 */
export function addTargetAt(
  point: MainCross,
  scale: TimeScale,
  laneAt: (cross: number) => string | undefined,
  options: AddTargetOptions = {},
): AddTarget {
  return targetAt(scale.toTime(point.main), laneAt(point.cross) ?? null, scale.domain, options);
}

/**
 * The keyboard's target: the middle of the view, in the focused item's lane
 * — or in `laneId` when nothing is focused. The same {@link AddTarget} a tap
 * at that time in that lane gives, so the two reach one command.
 */
export function addTargetFromFocus(
  domain: readonly [TimeMs, TimeMs],
  focusedLaneId: string | null,
  options: AddTargetOptions = {},
): AddTarget {
  return targetAt((domain[0] + domain[1]) / 2, focusedLaneId, domain, options);
}

/**
 * The item for a target. The host's `createItem` when given; otherwise a
 * plain range with the first free id of the form `item-N`, labelled `label`
 * — "New item" by default (`newItem` in `/intl`'s dictionary).
 */
export function itemForTarget<T>(items: readonly Item<T>[], target: AddTarget, createItem?: CreateItem<T>, label = "New item"): Item<T> | undefined {
  if (createItem !== undefined) return createItem(target);
  const ids = new Set(items.map((item) => item.id));
  let n = items.length + 1;
  while (ids.has(`item-${String(n)}`)) n += 1;
  return {
    id: `item-${String(n)}`,
    start: target.start,
    end: target.end,
    ...(target.laneId === null ? {} : { laneId: target.laneId }),
    label,
  };
}

/**
 * Which items a removal takes: the one asked for, and the rest of the
 * selection with it when that one is selected and several may be — the
 * rule a drag follows for what it carries.
 */
export function removeTargets(id: string, selectedIds: readonly string[], options: { readonly multiSelect?: boolean | undefined } = {}): readonly string[] {
  return options.multiSelect === true && selectedIds.includes(id) ? [id, ...selectedIds.filter((each) => each !== id)] : [id];
}

/** What a key asks for, in the item layer. */
export type ItemKeyAction = "add" | "remove";

/**
 * `n` or `Insert` adds an item, `Delete` or `Backspace` removes the focused
 * one. No modifiers: `Ctrl+N` is the browser's, and a key with `Alt` is the
 * timeline's lane move.
 */
export function resolveItemKey(sample: KeySample): ItemKeyAction | undefined {
  if (sample.ctrlKey || sample.metaKey || sample.altKey) return undefined;
  switch (sample.key) {
    case "n":
    case "N":
    case "Insert":
      return "add";
    case "Delete":
    case "Backspace":
      return "remove";
    default:
      return undefined;
  }
}

/** The MIME type an external element carries a dropped item in. */
export const DROP_MIME = "application/x-temporeum-item";

const isBoolean = (value: unknown): boolean => typeof value === "boolean";
const isString = (value: unknown): boolean => typeof value === "string";
const oneOf =
  (...names: string[]) =>
  (value: unknown): boolean =>
    names.includes(value as string);

/**
 * The item fields a drop may carry, each with what makes it valid. The
 * payload comes from another page or app; a field that would fail the
 * layout later (`sublaneSpan: 0`, a `progress` of "half") is left out here.
 */
const DROP_FIELDS: Readonly<Record<string, (value: unknown) => boolean>> = {
  id: (value) => isString(value) && value !== "",
  label: isString,
  className: isString,
  open: isBoolean,
  selectable: isBoolean,
  movable: isBoolean,
  resizable: isBoolean,
  removable: isBoolean,
  sublaneSpan: (value) => Number.isInteger(value) && (value as number) >= 1 && (value as number) <= MAX_SUBLANE_SPAN,
  progress: (value) => typeof value === "number" && value >= 0 && value <= 1,
  granularity: oneOf("millisecond", "second", "minute", "hour", "day", "month", "year", "decade", "century", "millennium"),
  kind: oneOf("range", "box", "point", "background", "milestone"),
  data: () => true,
};

/** A JSON time — epoch milliseconds or a date string — or `undefined`. */
function dropTime(value: unknown): TimeMs | undefined {
  const ms = typeof value === "string" ? Date.parse(value) : value;
  return typeof ms === "number" && Math.abs(ms) <= 8.64e15 ? ms : undefined;
}

/**
 * A dropped payload as an item at a target: the payload's own fields win,
 * except time and lane, which are where it was dropped. A payload without an
 * id gets one from {@link itemForTarget}, and one without a label `label`.
 * `undefined` for a payload that is not a JSON object.
 *
 * The payload's `start` and `end` (epoch milliseconds or date strings) or
 * its `durationMs` give the length only. Fields the item does not have, or
 * that are not valid for it, are dropped rather than passed on.
 */
export function itemFromDrop<T>(items: readonly Item<T>[], payload: string, target: AddTarget, label?: string): Item<T> | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return undefined;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
  const fields = parsed as Record<string, unknown>;
  const base = itemForTarget(items, target, undefined, label) as Item<T>;
  const start = target.start;
  const from = dropTime(fields.start);
  const to = dropTime(fields.end);
  const given = fields.durationMs;
  const duration =
    typeof given === "number" && given >= 0 && given <= 8.64e15 ? given : from !== undefined && to !== undefined && to >= from ? to - from : undefined;
  const end = duration === undefined ? target.end : start + duration;
  const rest: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (Object.hasOwn(DROP_FIELDS, key) && DROP_FIELDS[key]?.(value) === true) rest[key] = value;
  }
  return {
    ...base,
    ...rest,
    id: rest.id ?? base.id,
    start,
    end,
    ...(target.laneId === null ? {} : { laneId: target.laneId }),
  } as Item<T>;
}
