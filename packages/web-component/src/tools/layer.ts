/**
 * The `/tools` plugin's inside — not on any entry point.
 *
 * The time tools on screen: time bars, the overview strip's window, range
 * selection, zoom preset buttons and the item tooltip — one HTML layer over
 * the drawing, as the group tree is.
 *
 * HTML, not SVG, because each of them is a control a keyboard and a screen
 * reader have to reach on its own: a time bar and the strip's window are
 * sliders, a preset is a button, the tooltip is a tooltip — and none of that
 * may sit inside the drawing's listbox, which holds options only. What the
 * strip and the lane headers *show* is drawn in the frame (`frameScene`), so
 * the server draws it too; this layer is the client's and comes with it.
 *
 * Every gesture here has its key, and both end in one of the host's
 * functions: `moveBar` for a bar (a drag, `dragTimeBarTime`; a key,
 * `timeBarKeyTime`), `setDomain` for the strip (`minimapDragDomain`,
 * `minimapKeyDomain`), `selectRange` for a range (`rangeFromDrag`,
 * `rangeKeyStep`) — the routes G-NO-GESTURE-ONLY reads.
 */

import type { RenderResult, SceneElement } from "@temporeum/timeline-core";
import {
  createHiddenDates,
  DEFAULT_MINIMAP_SIZE,
  DEFAULT_ZOOM_PRESETS,
  defaultTimeBarStep,
  dragTimeBarTime,
  laneHeaderCss,
  laneHeaderNodes,
  minimapCss,
  minimapExtent,
  minimapGeometry,
  minimapNodes,
  moveTimeBar,
  presetDomain,
  rollingDomain,
  withLaneHeaderLayer,
  minimapDragDomain,
  minimapJumpDomain,
  minimapKeyDomain,
  rangeFromDrag,
  rangeKeyStep,
  resolveAxisKey,
  resolveRangeKey,
  selectRange,
  timeBarKeyTime,
  timeBarPlacements,
} from "@temporeum/timeline-core/tools";
import type { HiddenDateRange, MinimapGeometry, RangeDraft, RangeSelectOptions, TimeBar, TimeRange, ZoomPreset } from "@temporeum/timeline-core/tools";
import type { Domain, Item, KeySample, MainCrossRect, Orientation, TimeMs, TimeScale } from "@temporeum/timeline-core";
import { MIRRORED_KEYS, partNames } from "@temporeum/timeline-core/dom";
import { DEFAULT_STRINGS, fill } from "@temporeum/timeline-core/words";

import { hiddenDatesOf, sizesOf } from "../config.js";
import type { FrameState, TimelineConfig } from "../config.js";
import type { TimelinePlugin } from "../plugins.js";

/** What the layer asks of the timeline it is on. */
export interface ToolsHost<T> {
  /** The element pointer and key events reach. */
  readonly element: HTMLElement;
  orientation(): Orientation;
  /** The frame: its main and cross extents, and the axis band's. */
  frame(): { readonly mainSize: number; readonly crossSize: number; readonly axisSize: number; readonly band: number } | undefined;
  domain(): Domain;
  /** The view's scale, in shown time with hidden dates. */
  scale(): TimeScale | undefined;
  locale(): string;
  timeZone(): string;
  bars(): readonly TimeBar[];
  barStep(): number;
  /** The one place a bar moves. */
  moveBar(id: string, time: TimeMs): void;
  geometry(): MinimapGeometry | undefined;
  /** The one place the strip moves the view. */
  setDomain(domain: Domain): void;
  range(): (RangeSelectOptions & { readonly stepMs?: number }) | undefined;
  /** The one place a range is selected. */
  selectRange(range: TimeRange): void;
  presets(): readonly ZoomPreset[] | undefined;
  zoomToPreset(id: string): void;
  /** Whether tooltips are on. */
  tooltips(): boolean;
  /** The tooltip's text for an item, or `null` for none. */
  tooltip(item: Item<T>): string | null;
  /** The item under a point of the element, and its box in it. */
  hitAt(point: { readonly main: number; readonly cross: number }, pointerType: "mouse" | "pen" | "touch"): { readonly item: Item<T>; readonly box: MainCrossRect } | undefined;
  /** The keyboard's item and its box, while the drawing has the focus. */
  focused(): { readonly item: Item<T>; readonly box: MainCrossRect } | undefined;
  /** An edit is under way: no tooltip over it. */
  editing(): boolean;
  /** Which way the inline axis runs: in `"rtl"` the frame is mirrored, and so is the layer. `"ltr"` without it. */
  direction?(): "ltr" | "rtl";
  /** The layer's words: the dictionary's phrase for a key, filled in. The English defaults without it. */
  say?(key: ToolsWord, values?: Readonly<Record<string, string | number>>): string;
}

/** The keys of the dictionary (`DEFAULT_STRINGS` in `/words`) the layer says. */
export type ToolsWord = "timeBar" | "overview" | "zoom" | "range" | "rangeHelp";

/** The layer's handle. */
export interface ToolsLayer {
  /** Put everything where the frame just drew. */
  update(): void;
  destroy(): void;
}

const LONG_PRESS_MS = 500;
const HOVER_MS = 150;
const HIDE_GRACE_MS = 300;
const PRESS_SLOP = 8;

function css(): string {
  return (
    ".tl-tools{position:absolute;inset:0;pointer-events:none;font:12px/1.3 system-ui,sans-serif}" +
    ".tl-tools>*{pointer-events:auto}" +
    // Stacked by what a press should reach first: a bar over the range band, the buttons over both.
    ".tl-range-hit{position:absolute;z-index:1;touch-action:none;cursor:crosshair}" +
    ".tl-minimap-hit{position:absolute;z-index:1;touch-action:none;cursor:pointer}" +
    ".tl-timebar{position:absolute;z-index:2;touch-action:none;cursor:ew-resize}" +
    ".tl-presets{position:absolute;z-index:3;display:flex;gap:2px;padding:2px}" +
    ".tl-tooltip{position:absolute;z-index:4;max-width:280px;padding:4px 8px;border-radius:4px;background:#1f2328;color:#fff;white-space:pre-line;box-shadow:0 2px 8px rgba(0,0,0,.25)}" +
    ".tl-timebar::before{content:'';position:absolute;background:var(--tl-marker,#7a4fd6)}" +
    ".tl-timebar[data-axis=h]::before{left:5px;top:0;bottom:0;width:2px}" +
    ".tl-timebar[data-axis=v]{cursor:ns-resize}.tl-timebar[data-axis=v]::before{top:5px;left:0;right:0;height:2px}" +
    ".tl-timebar-grip{position:absolute;min-width:12px;padding:0 4px;border-radius:3px;background:var(--tl-marker,#7a4fd6);color:#fff;white-space:nowrap;outline-offset:2px}" +
    ".tl-timebar-grip:focus-visible,.tl-minimap-handle:focus-visible{outline:2px solid var(--tl-focus,#1a73e8)}" +
    ".tl-timebar[aria-disabled=true]{cursor:default}" +
    ".tl-minimap-handle{position:absolute;cursor:grab;border-radius:2px}" +
    ".tl-range{position:absolute;pointer-events:none;background:var(--tl-accent,#1a73e8);opacity:.18}" +
    ".tl-presets button{font:inherit;min-width:24px;min-height:24px;padding:1px 6px;border:1px solid var(--tl-line,#c8ccd2);border-radius:3px;background:var(--tl-surface,#fff);color:var(--tl-text,#1f2328);cursor:pointer}" +
    ".tl-presets button:focus-visible{outline:2px solid var(--tl-focus,#1a73e8)}" +
    ".tl-tooltip[hidden]{display:none}" +
    ".tl-live{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}"
  );
}

/** A control's class, and the same as its parts, for a page styling it in a shadow root. */
function classed(element: HTMLElement, className: string): void {
  element.className = className;
  element.setAttribute("part", partNames(className));
}

function sampleOf(event: KeyboardEvent, mirrored: boolean): KeySample {
  // Mirrored, the left arrow goes where the right one would: later along a horizontal axis.
  const key = mirrored ? (MIRRORED_KEYS[event.key] ?? event.key) : event.key;
  return { key, shiftKey: event.shiftKey, altKey: event.altKey, ctrlKey: event.ctrlKey, metaKey: event.metaKey, time: event.timeStamp };
}

/** Mount the layer in `root`, after the drawing. */
export function mountToolsLayer<T>(root: Element | DocumentFragment, doc: Document, host: ToolsHost<T>): ToolsLayer {
  let layer = (Array.from(root.children).find((child) => child.classList.contains("tl-tools")) as HTMLDivElement | undefined) ?? null;
  if (layer === null) {
    layer = doc.createElement("div");
    classed(layer, "tl-tools");
    const style = doc.createElement("style");
    style.textContent = css();
    layer.append(style);
    root.append(layer);
  }
  const element = layer;
  const bars = new Map<string, { readonly line: HTMLDivElement; readonly grip: HTMLDivElement }>();
  let minimapHit: HTMLDivElement | undefined;
  let minimapHandle: HTMLDivElement | undefined;
  let rangeHit: HTMLDivElement | undefined;
  const rangeBand = doc.createElement("div");
  classed(rangeBand, "tl-range");
  rangeBand.hidden = true;
  let presets: HTMLDivElement | undefined;
  let presetKey = "";
  const tooltip = doc.createElement("div");
  classed(tooltip, "tl-tooltip");
  tooltip.setAttribute("role", "tooltip");
  tooltip.id = `tl-tooltip-${Math.random().toString(36).slice(2, 10)}`;
  tooltip.hidden = true;
  const live = doc.createElement("div");
  classed(live, "tl-live");
  live.setAttribute("aria-live", "polite");
  element.append(rangeBand, tooltip, live);

  /** A bar being dragged: shown where the pointer has it, committed on release. */
  let barDrag: { readonly id: string; readonly pointerId: number; readonly grab: { readonly time: TimeMs; readonly main: number }; time: TimeMs } | undefined;
  let stripDrag: { readonly pointerId: number; readonly grab: number; readonly domain: Domain; readonly geometry: MinimapGeometry } | undefined;
  let rangeDrag: { readonly pointerId: number; readonly from: number; to: number } | undefined;
  let draft: RangeDraft | undefined;
  /** What the tooltip shows, and why. */
  let tip: { readonly id: string; readonly why: "hover" | "focus" | "press" } | undefined;
  let dismissedFor: string | undefined;
  let hoverTimer: ReturnType<typeof setTimeout> | undefined;
  let hideTimer: ReturnType<typeof setTimeout> | undefined;
  let pressTimer: ReturnType<typeof setTimeout> | undefined;
  let press: { readonly pointerId: number; readonly x: number; readonly y: number } | undefined;

  const mirrored = (): boolean => host.direction?.() === "rtl";
  const words = (key: ToolsWord, values?: Readonly<Record<string, string | number>>): string =>
    host.say?.(key, values) ?? fill(DEFAULT_STRINGS[key], values, host.locale());
  const along = (event: PointerEvent): { main: number; cross: number } => {
    const box = host.element.getBoundingClientRect();
    // In a mirrored frame `x` runs from the right edge, as the drawing's does.
    const x = mirrored() ? box.right - event.clientX : event.clientX - box.left;
    const y = event.clientY - box.top;
    return host.orientation() === "vertical" ? { main: y, cross: x } : { main: x, cross: y };
  };
  /**
   * A node's `x` from the layer's start edge: the left, or the right in a
   * mirrored frame — the mirror of `left: x` is `right: x`. From the end
   * edge with `fromEnd`.
   */
  function setX(node: HTMLElement, x: string, fromEnd = false): void {
    const right = mirrored() !== fromEnd;
    node.style.left = right ? "" : x;
    node.style.right = right ? x : "";
  }
  /** A `(main, cross)` rect as CSS on an absolutely placed node. */
  function place(node: HTMLElement, rect: MainCrossRect): void {
    const vertical = host.orientation() === "vertical";
    setX(node, `${String(vertical ? rect.cross : rect.main)}px`);
    node.style.top = `${String(vertical ? rect.main : rect.cross)}px`;
    node.style.width = `${String(vertical ? rect.crossSize : rect.mainSize)}px`;
    node.style.height = `${String(vertical ? rect.mainSize : rect.crossSize)}px`;
  }
  const formatter = (): Intl.DateTimeFormat =>
    new Intl.DateTimeFormat(host.locale(), { dateStyle: "medium", timeStyle: "short", timeZone: host.timeZone() });
  const say = (text: string): void => {
    live.textContent = text;
  };

  // --- time bars --------------------------------------------------------------

  function updateBars(scale: TimeScale, frame: NonNullable<ReturnType<ToolsHost<T>["frame"]>>): void {
    const shown = host.bars();
    const keep = new Set<string>();
    const format = formatter();
    const vertical = host.orientation() === "vertical";
    for (const placement of timeBarPlacements(shown, scale)) {
      const { bar } = placement;
      keep.add(bar.id);
      let nodes = bars.get(bar.id);
      if (nodes === undefined) {
        const line = doc.createElement("div");
        classed(line, "tl-timebar");
        line.dataset.tlTimebar = bar.id;
        const grip = doc.createElement("div");
        classed(grip, "tl-timebar-grip");
        grip.setAttribute("role", "slider");
        grip.tabIndex = 0;
        line.append(grip);
        element.insertBefore(line, rangeBand);
        nodes = { line, grip };
        bars.set(bar.id, nodes);
      }
      const time = barDrag?.id === bar.id ? barDrag.time : placement.time;
      const main = barDrag?.id === bar.id ? scale.toMain(time) : placement.main;
      const { line, grip } = nodes;
      line.dataset.axis = vertical ? "v" : "h";
      classed(line, bar.className === undefined ? "tl-timebar" : `tl-timebar ${bar.className}`);
      line.hidden = !(main >= -6 && main <= frame.mainSize + 6);
      place(line, { main: main - 6, mainSize: 12, cross: 0, crossSize: frame.crossSize });
      grip.textContent = bar.label ?? "";
      setX(grip, vertical ? "0" : "12px");
      grip.style.top = vertical ? "12px" : "0";
      grip.setAttribute("aria-label", bar.label ?? words("timeBar"));
      grip.setAttribute("aria-orientation", vertical ? "vertical" : "horizontal");
      grip.setAttribute("aria-valuemin", String(host.domain()[0]));
      grip.setAttribute("aria-valuemax", String(host.domain()[1]));
      grip.setAttribute("aria-valuenow", String(time));
      grip.setAttribute("aria-valuetext", format.format(time));
      if (bar.movable === false) {
        grip.setAttribute("aria-disabled", "true");
        line.setAttribute("aria-disabled", "true");
      } else {
        grip.removeAttribute("aria-disabled");
        line.removeAttribute("aria-disabled");
      }
    }
    for (const [id, nodes] of bars) {
      if (keep.has(id)) continue;
      nodes.line.remove();
      bars.delete(id);
    }
  }

  function barOf(target: EventTarget | null): string | undefined {
    const node = target instanceof Element ? target.closest<HTMLElement>("[data-tl-timebar]") : null;
    return node?.dataset.tlTimebar ?? undefined;
  }

  // --- the overview strip -------------------------------------------------------

  function updateStrip(frame: NonNullable<ReturnType<ToolsHost<T>["frame"]>>): void {
    const geometry = host.geometry();
    if (geometry === undefined) {
      minimapHit?.remove();
      minimapHit = undefined;
      minimapHandle = undefined;
      return;
    }
    if (minimapHit === undefined) {
      minimapHit = doc.createElement("div");
      classed(minimapHit, "tl-minimap-hit");
      minimapHit.dataset.tlMinimap = "";
      minimapHandle = doc.createElement("div");
      classed(minimapHandle, "tl-minimap-handle");
      minimapHandle.setAttribute("role", "slider");
      minimapHandle.setAttribute("aria-label", words("overview"));
      minimapHandle.tabIndex = 0;
      minimapHit.append(minimapHandle);
      element.insertBefore(minimapHit, rangeBand);
    }
    place(minimapHit, { main: 0, mainSize: frame.mainSize, cross: frame.crossSize, crossSize: frame.band });
    const handle = minimapHandle as HTMLDivElement;
    const vertical = host.orientation() === "vertical";
    setX(handle, vertical ? "0" : `${String(geometry.window.main)}px`);
    handle.style.top = vertical ? `${String(geometry.window.main)}px` : "0";
    handle.style.width = vertical ? "100%" : `${String(geometry.window.mainSize)}px`;
    handle.style.height = vertical ? `${String(geometry.window.mainSize)}px` : "100%";
    const domain = host.domain();
    const format = formatter();
    handle.setAttribute("aria-orientation", vertical ? "vertical" : "horizontal");
    handle.setAttribute("aria-valuemin", String(geometry.extent[0]));
    handle.setAttribute("aria-valuemax", String(geometry.extent[1]));
    handle.setAttribute("aria-valuenow", String(domain[0]));
    handle.setAttribute("aria-valuetext", words("range", { start: format.format(domain[0]), end: format.format(domain[1]) }));
  }

  // --- range selection ----------------------------------------------------------

  function updateRange(scale: TimeScale, frame: NonNullable<ReturnType<ToolsHost<T>["frame"]>>): void {
    if (host.range() === undefined) {
      rangeHit?.remove();
      rangeHit = undefined;
      rangeBand.hidden = true;
      draft = undefined;
      return;
    }
    if (rangeHit === undefined) {
      rangeHit = doc.createElement("div");
      classed(rangeHit, "tl-range-hit");
      rangeHit.dataset.tlRange = "";
      element.insertBefore(rangeHit, rangeBand);
    }
    place(rangeHit, { main: 0, mainSize: frame.mainSize, cross: 0, crossSize: frame.axisSize });
    const span = rangeDrag !== undefined ? [scale.toTime(rangeDrag.from), scale.toTime(rangeDrag.to)] : draft !== undefined ? [draft.anchor, draft.head] : undefined;
    if (span === undefined) {
      rangeBand.hidden = true;
      return;
    }
    const from = scale.toMain(Math.min(span[0] as number, span[1] as number));
    const to = scale.toMain(Math.max(span[0] as number, span[1] as number));
    rangeBand.hidden = false;
    place(rangeBand, { main: from, mainSize: Math.max(to - from, 2), cross: 0, crossSize: frame.crossSize });
  }

  function commitRange(range: TimeRange | undefined): void {
    if (range === undefined) return;
    host.selectRange(range);
    const format = formatter();
    say(words("range", { start: format.format(range.start), end: format.format(range.end) }));
  }

  // --- zoom presets -----------------------------------------------------------

  function updatePresets(frame: NonNullable<ReturnType<ToolsHost<T>["frame"]>>): void {
    const list = host.presets();
    if (list === undefined || list.length === 0) {
      presets?.remove();
      presets = undefined;
      presetKey = "";
      return;
    }
    const key = list.map((preset) => `${preset.id}\u0000${preset.label}`).join("\u0001");
    if (presets === undefined) {
      presets = doc.createElement("div");
      classed(presets, "tl-presets");
      presets.setAttribute("role", "toolbar");
      presets.setAttribute("aria-label", words("zoom"));
      element.insertBefore(presets, tooltip);
    }
    if (key !== presetKey) {
      presetKey = key;
      presets.replaceChildren(
        ...list.map((preset) => {
          const button = doc.createElement("button");
          button.type = "button";
          button.textContent = preset.label;
          button.dataset.tlPreset = preset.id;
          return button;
        }),
      );
    }
    // The frame's top right corner: over the axis band of a horizontal one.
    presets.style.top = "0";
    setX(presets, host.orientation() === "vertical" ? `${String(frame.band)}px` : "0", true);
  }

  // --- the tooltip --------------------------------------------------------------

  function clearTimers(): void {
    if (hoverTimer !== undefined) clearTimeout(hoverTimer);
    if (hideTimer !== undefined) clearTimeout(hideTimer);
    hoverTimer = undefined;
    hideTimer = undefined;
  }

  function showTip(target: { readonly item: Item<T>; readonly box: MainCrossRect }, why: "hover" | "focus" | "press"): void {
    const text = host.tooltip(target.item);
    if (text === null || text === "" || host.editing()) {
      hideTip();
      return;
    }
    if (dismissedFor === target.item.id && tip === undefined) return;
    dismissedFor = undefined;
    tip = { id: target.item.id, why };
    tooltip.textContent = text;
    tooltip.hidden = false;
    // Beside the item: above it when there is room, below it otherwise.
    const vertical = host.orientation() === "vertical";
    const box = target.box;
    const x = vertical ? box.cross + box.crossSize + 6 : box.main;
    const y = vertical ? box.main : box.cross;
    setX(tooltip, `${String(Math.max(0, x))}px`);
    const height = tooltip.offsetHeight || 24;
    tooltip.style.top = vertical ? `${String(Math.max(0, y))}px` : `${String(y - height - 6 >= 0 ? y - height - 6 : y + box.crossSize + 6)}px`;
  }

  function hideTip(): void {
    clearTimers();
    tip = undefined;
    tooltip.hidden = true;
  }

  /** Esc: the tooltip goes, and nothing else happens — the pointer and the focus stay. */
  function dismissTip(): boolean {
    if (tip === undefined) return false;
    dismissedFor = tip.id;
    hideTip();
    return true;
  }

  function onHover(event: PointerEvent): void {
    if (event.pointerType === "touch" || event.buttons !== 0) return;
    if (!host.tooltips()) return;
    const origin = event.composedPath()[0];
    // On the tooltip itself: it stays (WCAG 1.4.13, hoverable).
    if (origin === tooltip || (origin instanceof Node && tooltip.contains(origin))) {
      if (hideTimer !== undefined) clearTimeout(hideTimer);
      hideTimer = undefined;
      return;
    }
    if (origin instanceof Element && origin.closest(".tl-tools") !== null && origin !== element) return;
    const pointerType = event.pointerType === "pen" ? "pen" : "mouse";
    const hit = host.hitAt(along(event), pointerType);
    if (hit === undefined) {
      if (hoverTimer !== undefined) clearTimeout(hoverTimer);
      hoverTimer = undefined;
      if (dismissedFor !== undefined) dismissedFor = undefined;
      if (tip?.why === "hover" && hideTimer === undefined) {
        hideTimer = setTimeout(() => {
          hideTimer = undefined;
          if (tip?.why === "hover") hideTip();
        }, HIDE_GRACE_MS);
      }
      return;
    }
    if (hideTimer !== undefined) clearTimeout(hideTimer);
    hideTimer = undefined;
    if (tip?.id === hit.item.id) return;
    if (hoverTimer !== undefined) clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => {
      hoverTimer = undefined;
      showTip(hit, "hover");
    }, HOVER_MS);
  }

  function onLeave(): void {
    if (hoverTimer !== undefined) clearTimeout(hoverTimer);
    hoverTimer = undefined;
    // Away and back is a new hover: a dismissal was for the one it ended.
    dismissedFor = undefined;
    if (tip?.why === "hover") hideTip();
  }

  function onAnyDown(event: PointerEvent): void {
    // A press anywhere else lets a pressed tooltip go.
    const origin = event.composedPath()[0];
    if (!(origin instanceof Node && tooltip.contains(origin)) && tip?.why === "press") hideTip();
    if (pressTimer !== undefined) clearTimeout(pressTimer);
    pressTimer = undefined;
    press = undefined;
    if (event.pointerType !== "touch" || !host.tooltips()) return;
    const point = along(event);
    press = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    pressTimer = setTimeout(() => {
      pressTimer = undefined;
      if (press === undefined) return;
      press = undefined;
      const hit = host.hitAt(point, "touch");
      if (hit !== undefined) showTip(hit, "press");
    }, LONG_PRESS_MS);
  }

  function onAnyMove(event: PointerEvent): void {
    if (press !== undefined && event.pointerId === press.pointerId && Math.hypot(event.clientX - press.x, event.clientY - press.y) > PRESS_SLOP) {
      if (pressTimer !== undefined) clearTimeout(pressTimer);
      pressTimer = undefined;
      press = undefined;
    }
    onHover(event);
  }

  function onAnyUp(event: PointerEvent): void {
    if (press !== undefined && event.pointerId === press.pointerId) {
      if (pressTimer !== undefined) clearTimeout(pressTimer);
      pressTimer = undefined;
      press = undefined;
    }
  }

  function updateFocusTip(): void {
    if (!host.tooltips()) {
      if (tip !== undefined) hideTip();
      return;
    }
    const focused = host.focused();
    if (focused === undefined) {
      if (tip?.why === "focus") hideTip();
      return;
    }
    if (tip?.id === focused.item.id) {
      showTip(focused, tip.why);
      return;
    }
    if (tip === undefined || tip.why === "focus") showTip(focused, "focus");
  }

  // --- events -----------------------------------------------------------------

  function onPointerDown(event: PointerEvent): void {
    const origin = event.composedPath()[0];
    if (!(origin instanceof Element)) return;
    const scale = host.scale();
    if (scale === undefined) return;
    const point = along(event);
    const barId = barOf(origin);
    if (barId !== undefined) {
      event.stopPropagation();
      const bar = host.bars().find((each) => each.id === barId);
      if (bar === undefined || bar.movable === false) return;
      const placement = timeBarPlacements([bar], scale)[0];
      if (placement === undefined) return;
      barDrag = { id: barId, pointerId: event.pointerId, grab: { time: placement.time, main: point.main }, time: placement.time };
      capture(origin, event.pointerId);
      return;
    }
    if (origin.closest("[data-tl-minimap]") !== null) {
      event.stopPropagation();
      const geometry = host.geometry();
      if (geometry === undefined) return;
      let domain = host.domain();
      if (origin.closest(".tl-minimap-handle") === null) {
        // Beside the window: the view goes there, and the press drags on from it.
        domain = minimapJumpDomain(domain, point.main, geometry);
        host.setDomain(domain);
      }
      const now = host.geometry() ?? geometry;
      stripDrag = { pointerId: event.pointerId, grab: point.main, domain, geometry: now };
      capture(origin, event.pointerId);
      return;
    }
    if (origin.closest("[data-tl-range]") !== null) {
      event.stopPropagation();
      draft = undefined;
      rangeDrag = { pointerId: event.pointerId, from: point.main, to: point.main };
      capture(origin, event.pointerId);
      host.element.focus({ preventScroll: true });
      return;
    }
    if (origin === tooltip || tooltip.contains(origin) || origin.closest(".tl-presets") !== null) event.stopPropagation();
  }

  function capture(node: Element, pointerId: number): void {
    try {
      node.setPointerCapture(pointerId);
    } catch {
      /* the pointer ended before we could capture it */
    }
  }

  function onPointerMove(event: PointerEvent): void {
    const scale = host.scale();
    if (scale === undefined) return;
    const point = along(event);
    if (barDrag !== undefined && event.pointerId === barDrag.pointerId) {
      event.stopPropagation();
      barDrag.time = dragTimeBarTime(barDrag.grab, point.main, scale);
      layerUpdate();
      return;
    }
    if (stripDrag !== undefined && event.pointerId === stripDrag.pointerId) {
      event.stopPropagation();
      host.setDomain(minimapDragDomain(stripDrag.domain, stripDrag.grab, point.main, stripDrag.geometry));
      return;
    }
    if (rangeDrag !== undefined && event.pointerId === rangeDrag.pointerId) {
      event.stopPropagation();
      rangeDrag.to = point.main;
      layerUpdate();
    }
  }

  function onPointerUp(event: PointerEvent): void {
    const scale = host.scale();
    if (barDrag !== undefined && event.pointerId === barDrag.pointerId) {
      event.stopPropagation();
      const { id, time, grab } = barDrag;
      barDrag = undefined;
      if (event.type !== "pointercancel" && time !== grab.time) host.moveBar(id, time);
      layerUpdate();
      return;
    }
    if (stripDrag !== undefined && event.pointerId === stripDrag.pointerId) {
      event.stopPropagation();
      stripDrag = undefined;
      return;
    }
    if (rangeDrag !== undefined && event.pointerId === rangeDrag.pointerId) {
      event.stopPropagation();
      const { from, to } = rangeDrag;
      rangeDrag = undefined;
      if (event.type !== "pointercancel" && scale !== undefined) commitRange(rangeFromDrag(scale, from, to, host.range() ?? {}));
      layerUpdate();
    }
  }

  function onLayerKey(event: KeyboardEvent): void {
    const origin = event.composedPath()[0];
    if (!(origin instanceof Element) || event.defaultPrevented) return;
    const action = resolveAxisKey(sampleOf(event, mirrored()), host.orientation());
    const barId = barOf(origin);
    if (barId !== undefined && origin.classList.contains("tl-timebar-grip")) {
      event.stopPropagation();
      if (action === undefined) return;
      event.preventDefault();
      const bar = host.bars().find((each) => each.id === barId);
      if (bar === undefined || bar.movable === false) return;
      const placement = host.scale() === undefined ? undefined : timeBarPlacements([bar], host.scale() as TimeScale)[0];
      if (placement === undefined) return;
      host.moveBar(barId, timeBarKeyTime(placement.time, action, { stepMs: host.barStep(), domain: host.domain() }));
      return;
    }
    if (origin.classList.contains("tl-minimap-handle")) {
      event.stopPropagation();
      const geometry = host.geometry();
      if (action === undefined || geometry === undefined) return;
      event.preventDefault();
      host.setDomain(minimapKeyDomain(host.domain(), action, geometry));
      return;
    }
    if (origin.closest(".tl-presets") !== null || origin === tooltip) event.stopPropagation();
  }

  function onPresetClick(event: MouseEvent): void {
    const origin = event.composedPath()[0];
    const button = origin instanceof Element ? origin.closest<HTMLElement>("[data-tl-preset]") : null;
    const id = button?.dataset.tlPreset;
    event.stopPropagation();
    if (id !== undefined) host.zoomToPreset(id);
  }

  /**
   * Esc takes the tooltip away wherever the focus is — a mouse's tooltip
   * shows while the focus is anywhere on the page — and does nothing else:
   * the first Esc is the tooltip's, before anyone else hears it.
   */
  function onDocumentKey(event: KeyboardEvent): void {
    if (event.key !== "Escape" || event.isComposing || draft !== undefined) return;
    if (dismissTip()) {
      event.preventDefault();
      event.stopPropagation();
    }
  }

  /** Keys on the timeline itself: a range picked from the keyboard. Before the machine's. */
  function onHostKey(event: KeyboardEvent): void {
    if (event.defaultPrevented || event.isComposing) return;
    const origin = event.composedPath()[0];
    if (origin instanceof Element && origin.closest(".tl-tools, .tl-groups") !== null) return;
    const options = host.range();
    if (options === undefined) return;
    const action = resolveRangeKey(sampleOf(event, mirrored()), host.orientation(), { picking: draft !== undefined });
    if (action === undefined) {
      // While a range is being picked, nothing else hears the keys.
      if (draft !== undefined) event.stopPropagation();
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (action === "cancel") {
      draft = undefined;
      say("");
    } else if (action === "commit") {
      const picked = draft;
      draft = undefined;
      if (picked !== undefined) commitRange(selectRange(picked.anchor, picked.head, options));
    } else {
      const domain = host.domain();
      draft = rangeKeyStep(draft, action, { ...options, domain, stepMs: options.stepMs ?? (domain[1] - domain[0]) / 100 });
      if (action === "start") say(words("rangeHelp"));
    }
    layerUpdate();
  }

  const listeners: readonly (readonly [EventTarget, string, (event: never) => void, boolean])[] = [
    [element, "pointerdown", onPointerDown, false],
    [element, "pointermove", onPointerMove, false],
    [element, "pointerup", onPointerUp, false],
    [element, "pointercancel", onPointerUp, false],
    [element, "keydown", onLayerKey, false],
    [element, "click", onPresetClick, false],
    [element, "dblclick", (event: MouseEvent) => event.stopPropagation(), false],
    [doc, "keydown", onDocumentKey, true],
    [host.element, "keydown", onHostKey, true],
    [host.element, "pointerdown", onAnyDown, true],
    [host.element, "pointermove", onAnyMove, true],
    [host.element, "pointerup", onAnyUp, true],
    [host.element, "pointercancel", onAnyUp, true],
    [host.element, "pointerleave", onLeave, false],
  ];
  for (const [target, name, handler, captureIt] of listeners) target.addEventListener(name, handler as EventListener, captureIt);

  function layerUpdate(): void {
    const frame = host.frame();
    const scale = host.scale();
    if (frame === undefined || scale === undefined) return;
    // The layer's own text and order, the buttons' included, run the frame's way.
    element.dir = mirrored() ? "rtl" : "ltr";
    updateBars(scale, frame);
    updateStrip(frame);
    updateRange(scale, frame);
    updatePresets(frame);
    updateFocusTip();
  }

  return {
    update: layerUpdate,
    destroy(): void {
      clearTimers();
      if (pressTimer !== undefined) clearTimeout(pressTimer);
      for (const [target, name, handler, captureIt] of listeners) target.removeEventListener(name, handler as EventListener, captureIt);
      element.remove();
    },
  };
}

/** The overview strip's geometry for a frame that has one. */
function geometry<T>(config: TimelineConfig<T>, state: FrameState<T>, result: RenderResult<T>): MinimapGeometry {
  return minimapGeometry(minimapExtent(result.layout, state.domain), state.domain, state.view.mainSize, hiddenDatesOf(config));
}

/**
 * The P24 layers: the sticky lane headers over the labels, and the overview
 * strip across the frame's far edge — the root grown to the container to
 * hold it. Both are drawn in the frame (`frameScene`), so the server draws
 * them too.
 */
function layer<T>(config: TimelineConfig<T>, state: FrameState<T>, result: RenderResult<T>, scene: SceneElement): SceneElement {
  const view = state.view;
  const headers = config.laneHeaders === true;
  const strip = view.band > 0 && view.mainSize > 0 ? geometry(config, state, result) : undefined;
  if (!headers && strip === undefined) return scene;
  const scope = config.instanceId === undefined ? ".tl" : `.tl[data-tl-instance="${config.instanceId}"]`;
  let next = scene;
  let css = "";
  if (headers) {
    const measure = state.measureText;
    const metrics = sizesOf(view);
    next = withLaneHeaderLayer(
      next,
      laneHeaderNodes(result.layout, {
        orientation: view.orientation,
        density: view.density,
        metrics: view.metrics,
        crossOffset: state.crossOffset,
        crossSize: view.crossSize,
        ...(measure === undefined ? {} : { measure: (text: string) => measure(text, metrics.fontSize) }),
      }),
    );
    css += laneHeaderCss(scope);
  }
  if (strip !== undefined) {
    const band: SceneElement = {
      tag: "g",
      attrs: { class: "tl-layer tl-layer--minimap", "aria-hidden": "true", "data-tl-minimap": "" },
      children: minimapNodes(result.layout, strip, { orientation: view.orientation, cross: view.crossSize, size: view.band }),
    };
    next = {
      ...next,
      attrs: { ...next.attrs, width: view.width, height: view.height, viewBox: `0 0 ${String(view.width)} ${String(view.height)}` },
      children: [...(next.children ?? []), band],
    };
    css += minimapCss(scope);
  }
  return { ...next, children: [...(next.children ?? []), { tag: "style", text: css }] };
}

/** The time tools. Register them with `registerPlugin(toolsPlugin)`. */
export const toolsPlugin: TimelinePlugin = Object.freeze({
  name: "tools",
  feature: Object.freeze({
    hidden: (ranges: readonly HiddenDateRange[], timeZone: string) => createHiddenDates(ranges, { timeZone }),
    minimapSize: DEFAULT_MINIMAP_SIZE,
    geometry,
    layer,
    mount: mountToolsLayer,
    moveTimeBar,
    defaultTimeBarStep,
    DEFAULT_ZOOM_PRESETS,
    presetDomain,
    rollingDomain,
  }),
});
