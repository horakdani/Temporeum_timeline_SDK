/**
 * The group headers: a tree of headers laid over the header rows. The
 * `/groups` plugin's inside — not on any entry point.
 *
 * The core renderer draws lanes as bands, with no label: its base entry
 * point is full, and a tree is not something an SVG `listbox` may hold —
 * an option list with tree items in it is invalid ARIA. So the headers are
 * HTML, beside the drawing and on top of it: one `role="tree"` with a
 * `role="treeitem"` per shown group, each laid over its group's header row
 * (`@temporeum/timeline-core/groups`), so it covers no item.
 *
 * One function places the headers ({@link headerPlacements}); the server
 * prints what it returns and the browser writes it into live nodes, so a
 * server-rendered tree is taken over, not drawn twice. Nothing here decides
 * what a key or a drag means — that is the core's `groupKeyStep`,
 * `dropPosition` and `moveGroupCommand` — it only feeds them.
 */

import { DARK_THEME, densityMetrics, LIGHT_THEME, resolveTheme } from "@temporeum/timeline-core";
import { partNames } from "@temporeum/timeline-core/dom";
import type { Density, KeySample, Layout, MetricsProvider, Orientation, Theme, ThemeSetting } from "@temporeum/timeline-core";
import { MIRRORED_KEYS } from "@temporeum/timeline-core/dom";
import {
  applyGroupPatches,
  dropPosition,
  groupHeaderBoxes,
  groupKeyStep,
  groupView,
  headerGroupId,
  moveGroupCommand,
  resolveGroupKey,
} from "@temporeum/timeline-core/groups";
import type { Group, GroupCommand, GroupRow } from "@temporeum/timeline-core/groups";

import type { TimelinePlugin } from "../plugins.js";

/** Indent per level of nesting, in CSS pixels. */
const INDENT = 14;
/** Travel before a press on a header becomes a drag. */
const DRAG_THRESHOLD = 4;

function tokens(theme: Theme): string {
  const used = ["text", "textMuted", "surface", "surfaceAlt", "line", "focus"] as const;
  return used.map((name) => `--tl-g-${name}:${theme.tokens[name]}`).join(";");
}

/** The headers' stylesheet: the theme's colours, since the tree is outside the drawing that holds them. */
export function groupHeaderCss(): string {
  return (
    `.tl-groups{position:absolute;overflow:hidden;pointer-events:none;${tokens(LIGHT_THEME)}}` +
    `@media (prefers-color-scheme:dark){.tl-groups:not([data-tl-theme="light"]){${tokens(DARK_THEME)}}}` +
    `.tl-groups[data-tl-theme="dark"]{${tokens(DARK_THEME)}}` +
    ".tl-group{position:absolute;box-sizing:border-box;display:flex;align-items:center;gap:4px;pointer-events:auto;" +
    "cursor:grab;color:var(--tl-g-text);background:var(--tl-g-surfaceAlt);border:1px solid var(--tl-g-line);" +
    "font:12px/1.2 system-ui,sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;user-select:none;touch-action:none}" +
    ".tl-group:focus-visible{outline:2px solid var(--tl-g-focus);outline-offset:-2px}" +
    ".tl-group--dragging{cursor:grabbing;opacity:.85;z-index:1}" +
    '.tl-group-toggle{display:inline-block;width:1em;text-align:center;color:var(--tl-g-textMuted)}' +
    '.tl-groups--vertical .tl-group{writing-mode:vertical-rl}'
  );
}

/** One header as drawn. */
export interface HeaderPlacement {
  readonly row: GroupRow;
  readonly attrs: Readonly<Record<string, string>>;
  readonly toggle: string;
  readonly label: string;
}

/**
 * An inline style mirrored: `left` and `right` trade places, and so do a
 * four-value padding's left and right — the group tree of a right-to-left
 * frame, which is HTML over the drawing and not inside its mirror.
 */
export function mirrorStyle(style: string): string {
  return style
    .replace(/(^|;)(left|right):/g, (_, start: string, side: string) => `${start}${side === "left" ? "right" : "left"}:`)
    .replace(/padding:(\S+) (\S+) (\S+) ([^;]+)/g, "padding:$1 $4 $3 $2");
}

/** The tree container's attributes. */
export function groupLayerAttrs(
  orientation: Orientation,
  density: Density,
  theme: ThemeSetting | undefined,
  label?: string,
  direction: "ltr" | "rtl" = "ltr",
  metrics?: MetricsProvider,
): Record<string, string> {
  const axis = (metrics ?? densityMetrics)(density, orientation).axisSize;
  const resolved = resolveTheme(theme ?? "auto");
  const custom = resolved !== undefined && resolved !== LIGHT_THEME && resolved !== DARK_THEME;
  return {
    class: `tl-groups tl-groups--${orientation}`,
    part: `groups groups-${orientation}`,
    role: "tree",
    "aria-label": label ?? "Groups",
    ...(resolved === undefined ? {} : { "data-tl-theme": custom ? "custom" : resolved.name }),
    ...(direction === "rtl" ? { dir: "rtl" } : {}),
    style:
      (direction === "rtl" ? mirrorStyle : (style: string) => style)(
        orientation === "horizontal" ? `top:${String(axis)}px;left:0;right:0;bottom:0` : `left:${String(axis)}px;top:0;right:0;bottom:0`,
      ) + (custom ? `;${tokens(resolved)}` : ""),
  };
}

/**
 * Where each shown group's header goes: over its header row, scrolled with
 * the lanes, at the start of the view, indented by its depth.
 */
export function headerPlacements(
  rows: readonly GroupRow[],
  layout: Layout,
  orientation: Orientation,
  crossOffset: number,
  focusedId: string | undefined,
  direction: "ltr" | "rtl" = "ltr",
): HeaderPlacement[] {
  const boxes = groupHeaderBoxes(rows, layout);
  const focused = rows.some((row) => row.group.id === focusedId) ? focusedId : rows[0]?.group.id;
  return boxes.map(({ row, cross, crossSize }) => {
    const at = cross - crossOffset;
    const indent = 4 + row.depth * INDENT;
    const style =
      orientation === "horizontal"
        ? `top:${String(at)}px;left:0;height:${String(crossSize)}px;max-width:40%;padding:0 6px 0 ${String(indent)}px`
        : `left:${String(at)}px;top:0;width:${String(crossSize)}px;max-height:40%;padding:${String(indent)}px 0 6px 0`;
    const className = row.group.className === undefined ? "tl-group" : `tl-group ${row.group.className}`;
    return {
      row,
      attrs: {
        class: className,
        part: partNames(className),
        role: "treeitem",
        "data-tl-group": row.group.id,
        "aria-level": String(row.depth + 1),
        "aria-setsize": String(row.siblings),
        "aria-posinset": String(row.position),
        "aria-expanded": row.expanded ? "true" : "false",
        tabindex: row.group.id === focused ? "0" : "-1",
        style: direction === "rtl" ? mirrorStyle(style) : style,
      },
      // Collapsed, it points the way the lanes' labels read.
      toggle: row.expanded ? "▾" : direction === "rtl" ? "◂" : "▸",
      label: row.group.label ?? row.group.id,
    };
  });
}

/** An overlay element's class, and the same as its parts, for a page styling it in a shadow root. */
function classed(element: HTMLElement, className: string): void {
  element.className = className;
  element.setAttribute("part", partNames(className));
}

const escape = (value: string): string =>
  value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function printAttrs(attrs: Readonly<Record<string, string>>): string {
  return Object.entries(attrs)
    .map(([name, value]) => ` ${name}="${escape(value)}"`)
    .join("");
}

/** The tree as markup, for the server. */
export function groupHeaderMarkup(container: Readonly<Record<string, string>>, placements: readonly HeaderPlacement[]): string {
  return (
    `<div${printAttrs(container)}><style>${groupHeaderCss()}</style>` +
    placements
      .map(
        (placement) =>
          `<div${printAttrs(placement.attrs)}><span class="tl-group-toggle" part="group-toggle" aria-hidden="true">${placement.toggle}</span>` +
          `<span class="tl-group-label" part="group-label">${escape(placement.label)}</span></div>`,
      )
      .join("") +
    "</div>"
  );
}

/** What the layer asks of the instance. */
export interface GroupLayerHost {
  readonly groups: () => readonly Group[];
  readonly rows: () => readonly GroupRow[];
  readonly layout: () => Layout | undefined;
  readonly orientation: () => Orientation;
  readonly crossOffset: () => number;
  /** Which way the frame runs; `"ltr"` without it. */
  readonly direction?: () => "ltr" | "rtl";
  readonly toggle: (id: string, collapsed: boolean) => void;
  readonly command: (command: GroupCommand) => void;
}

/** The live tree. */
export interface GroupLayer {
  update(container: Readonly<Record<string, string>>, placements: readonly HeaderPlacement[]): void;
  /** The group the tree's focus is on. */
  readonly focusedId: string | undefined;
  destroy(): void;
}

function sampleOf(event: KeyboardEvent): KeySample {
  return {
    key: event.key,
    shiftKey: event.shiftKey,
    altKey: event.altKey,
    ctrlKey: event.ctrlKey,
    metaKey: event.metaKey,
    time: event.timeStamp,
  };
}

/**
 * Mount the tree in `root`, after the drawing, taking over a server-rendered
 * one when there is one.
 */
export function mountGroupLayer(root: Element | DocumentFragment, doc: Document, host: GroupLayerHost): GroupLayer {
  let layer = (Array.from(root.children).find((child) => child.classList.contains("tl-groups")) as HTMLDivElement | undefined) ?? null;
  if (layer === null) {
    layer = doc.createElement("div");
    const style = doc.createElement("style");
    style.textContent = groupHeaderCss();
    layer.append(style);
    root.append(layer);
  }
  const element = layer;
  let focusedId: string | undefined;
  let drag:
    | { readonly id: string; readonly pointerId: number; readonly start: number; readonly node: HTMLElement; moved: boolean }
    | undefined;

  const crossOf = (event: PointerEvent): number => {
    const box = element.getBoundingClientRect();
    if (host.orientation() === "horizontal") return event.clientY - box.top;
    // Mirrored, the lanes run from the right edge.
    return host.direction?.() === "rtl" ? box.right - event.clientX : event.clientX - box.left;
  };
  const headerOf = (target: EventTarget | null): HTMLElement | null =>
    target instanceof Element ? (target.closest<HTMLElement>("[data-tl-group]") ?? null) : null;

  function focusGroup(id: string): void {
    focusedId = id;
    for (const node of element.querySelectorAll<HTMLElement>("[data-tl-group]")) {
      node.tabIndex = node.dataset.tlGroup === id ? 0 : -1;
    }
    element.querySelector<HTMLElement>(`[data-tl-group="${CSS.escape(id)}"]`)?.focus();
  }

  // One Pointer Events handler, for every pointer type: a press that does
  // not travel is a click (toggle), one that does is a drag (reorder).
  const onPointerDown = (event: PointerEvent): void => {
    const node = headerOf(event.target);
    if (node === null || event.button > 0) return;
    // The drawing under the tree must not start a pan for this press.
    event.stopPropagation();
    // As in the core's attach: the call throws if the pointer is already
    // gone, and that is no reason to lose the press.
    try {
      node.setPointerCapture(event.pointerId);
    } catch {
      /* the pointer ended before we could capture it */
    }
    drag = { id: node.dataset.tlGroup ?? "", pointerId: event.pointerId, start: crossOf(event), node, moved: false };
  };
  const onPointerMove = (event: PointerEvent): void => {
    if (drag === undefined || event.pointerId !== drag.pointerId) return;
    event.stopPropagation();
    const delta = crossOf(event) - drag.start;
    if (!drag.moved && Math.abs(delta) < DRAG_THRESHOLD) return;
    drag.moved = true;
    drag.node.classList.add("tl-group--dragging");
    drag.node.style.transform = host.orientation() === "horizontal" ? `translateY(${String(delta)}px)` : `translateX(${String(delta)}px)`;
  };
  const onPointerUp = (event: PointerEvent): void => {
    if (drag === undefined || event.pointerId !== drag.pointerId) return;
    event.stopPropagation();
    const { id, node, moved } = drag;
    drag = undefined;
    node.classList.remove("tl-group--dragging");
    node.style.transform = "";
    if (event.type === "pointercancel") return;
    const row = host.rows().find((each) => each.group.id === id);
    if (row === undefined) return;
    focusedId = id;
    if (!moved) {
      host.toggle(id, row.expanded);
      return;
    }
    const layout = host.layout();
    if (layout === undefined) return;
    const position = dropPosition(groupHeaderBoxes(host.rows(), layout), id, crossOf(event) + host.crossOffset());
    const command = position === undefined ? undefined : moveGroupCommand(host.groups(), id, position);
    if (command !== undefined) host.command(command);
  };
  const onKeyDown = (event: KeyboardEvent): void => {
    const node = headerOf(event.target);
    if (node === null) return;
    const sample = sampleOf(event);
    const mirrored = host.direction?.() === "rtl" ? { ...sample, key: MIRRORED_KEYS[sample.key] ?? sample.key } : sample;
    const action = resolveGroupKey(mirrored, host.orientation());
    if (action === undefined) return;
    const step = groupKeyStep(host.groups(), host.rows(), node.dataset.tlGroup, action);
    if (step === undefined) return;
    // The timeline's own keys must not also see an arrow the tree took.
    event.preventDefault();
    event.stopPropagation();
    if (step.focus !== undefined) focusGroup(step.focus);
    if (step.toggle !== undefined) {
      focusedId = step.toggle.id;
      host.toggle(step.toggle.id, step.toggle.collapsed);
    }
    if (step.command !== undefined) {
      focusedId = node.dataset.tlGroup;
      host.command(step.command);
    }
  };
  const onFocusIn = (event: FocusEvent): void => {
    const node = headerOf(event.target);
    if (node !== null) focusedId = node.dataset.tlGroup;
  };
  const stop = (event: Event): void => {
    if (headerOf(event.target) !== null) event.stopPropagation();
  };
  element.addEventListener("pointerdown", onPointerDown);
  element.addEventListener("pointermove", onPointerMove);
  element.addEventListener("pointerup", onPointerUp);
  element.addEventListener("pointercancel", onPointerUp);
  element.addEventListener("keydown", onKeyDown);
  element.addEventListener("focusin", onFocusIn);
  // A tap on a header is not a tap on the drawing under it.
  element.addEventListener("click", stop);
  element.addEventListener("dblclick", stop);

  return {
    get focusedId() {
      return focusedId;
    },
    update(container, placements) {
      for (const [name, value] of Object.entries(container)) {
        if (element.getAttribute(name) !== value) element.setAttribute(name, value);
      }
      const existing = new Map<string, HTMLElement>();
      for (const node of Array.from(element.children) as HTMLElement[]) {
        if (node.dataset.tlGroup !== undefined) existing.set(node.dataset.tlGroup, node);
      }
      const hadFocus = doc.activeElement !== null && element.contains(doc.activeElement);
      let previous: Element | null = Array.from(element.children).find((child) => child.tagName === "STYLE" || child.tagName === "style") ?? null;
      for (const placement of placements) {
        const id = placement.row.group.id;
        let node = existing.get(id);
        existing.delete(id);
        if (node === undefined) {
          node = doc.createElement("div");
          const toggle = doc.createElement("span");
          classed(toggle, "tl-group-toggle");
          toggle.setAttribute("aria-hidden", "true");
          const label = doc.createElement("span");
          classed(label, "tl-group-label");
          node.append(toggle, label);
        }
        for (const [name, value] of Object.entries(placement.attrs)) {
          // The dragged header keeps the transform it is being dragged by.
          if (name === "style" && drag?.node === node) continue;
          if (node.getAttribute(name) !== value) node.setAttribute(name, value);
        }
        const [toggle, label] = node.children as unknown as [HTMLElement, HTMLElement];
        if (toggle.textContent !== placement.toggle) toggle.textContent = placement.toggle;
        if (label.textContent !== placement.label) label.textContent = placement.label;
        if (previous === null ? element.firstChild !== node : previous.nextSibling !== node) {
          element.insertBefore(node, previous === null ? element.firstChild : previous.nextSibling);
        }
        previous = node;
      }
      for (const node of existing.values()) node.remove();
      // A reorder or a toggle redraws the tree: the focus stays on its group.
      if (hadFocus && focusedId !== undefined) {
        const node = element.querySelector<HTMLElement>(`[data-tl-group="${CSS.escape(focusedId)}"]`);
        if (node !== null && doc.activeElement !== node) node.focus();
      }
    },
    destroy() {
      element.removeEventListener("pointerdown", onPointerDown);
      element.removeEventListener("pointermove", onPointerMove);
      element.removeEventListener("pointerup", onPointerUp);
      element.removeEventListener("pointercancel", onPointerUp);
      element.removeEventListener("keydown", onKeyDown);
      element.removeEventListener("focusin", onFocusIn);
      element.removeEventListener("click", stop);
      element.removeEventListener("dblclick", stop);
      element.remove();
    },
  };
}

/** Nested groups. Register them with `registerPlugin(groupsPlugin)`. */
export const groupsPlugin: TimelinePlugin = Object.freeze({
  name: "groups",
  feature: Object.freeze({ groupView, headerGroupId, applyGroupPatches, mount: mountGroupLayer, groupLayerAttrs, headerPlacements, groupHeaderMarkup }),
});
