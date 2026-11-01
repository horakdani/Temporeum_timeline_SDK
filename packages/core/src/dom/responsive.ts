/**
 * The browser half of the responsive phase: measuring the box, and opening
 * the surface an item's details live on.
 *
 * Like the input binding, neither function reaches for a global. The window
 * is found through the element the host hands over
 * (`ownerDocument.defaultView`), which keeps the core's DOM ban intact, keeps
 * the binding testable with a plain object, and makes an iframe's timeline
 * measure against its own window rather than the parent's.
 *
 * And like the input binding, neither function decides anything. Which
 * orientation a width means, which surface a pointer gets and where a popover
 * goes are pure functions in `responsive.ts`; this file measures, mounts and
 * lets go.
 */

import type { ScreenRect } from "../geometry.js";
import { placePopover } from "../responsive.js";
import type { DetailSurface } from "../types.js";

/** A measured container, in CSS pixels. */
export interface ObservedSize {
  readonly width: number;
  readonly height: number;
}

/** A live observation. Call {@link SizeObservation.destroy} to stop it. */
export interface SizeObservation {
  destroy(): void;
}

/**
 * Report the element's content-box size now and whenever it changes.
 *
 * The decision lives on a `ResizeObserver`, not on the size at load time
 * (`api_terv` §8.3): a phone turned sideways, a split-screen, a sidebar
 * collapsing — the timeline re-projects without the host lifting a finger.
 * The element, not the window, is what is measured, so a timeline in a
 * narrow column of a wide page is narrow.
 *
 * A change is reported once: a resize that settles on the same size as
 * before is not a new size, and a host that re-renders on every callback
 * would otherwise draw the same frame twice.
 *
 * Without a `ResizeObserver` (an old engine, a test double) the size is
 * reported once and never again — a static timeline rather than none.
 */
export function observeSize(
  target: Element,
  onSize: (size: ObservedSize) => void,
): SizeObservation {
  let last: ObservedSize | undefined;
  const report = (width: number, height: number): void => {
    if (last !== undefined && last.width === width && last.height === height) {
      return;
    }
    last = { width, height };
    onSize(last);
  };

  const Observer = target.ownerDocument.defaultView?.ResizeObserver;
  if (Observer === undefined) {
    const box = target.getBoundingClientRect();
    report(box.width, box.height);
    return { destroy() {} };
  }
  const observer = new Observer((entries) => {
    // One element is observed, so the last entry is the current size.
    const entry = entries[entries.length - 1];
    if (entry !== undefined) {
      report(entry.contentRect.width, entry.contentRect.height);
    }
  });
  observer.observe(target);
  return {
    destroy() {
      observer.disconnect();
    },
  };
}

/** What to show, and where. */
export interface DetailOptions {
  readonly surface: DetailSurface;
  /** What the details say. A string is set as text, never parsed as HTML. */
  readonly content: string | Node;
  /**
   * The item's box in viewport coordinates (`getBoundingClientRect`). The
   * popover is placed next to it; a sheet ignores it.
   */
  readonly anchor?: ScreenRect;
  /** Accessible name of the surface. */
  readonly label?: string;
  /** Text of the sheet's close button. */
  readonly closeLabel?: string;
  /** Called once when the surface closes, by any route. */
  readonly onClose?: () => void;
}

/** An open detail surface. */
export interface DetailHandle {
  readonly element: HTMLElement;
  readonly surface: DetailSurface;
  close(): void;
}

const BASE_STYLE =
  "position:fixed;z-index:1000;box-sizing:border-box;margin:0;padding:12px 14px;" +
  "background:Canvas;color:CanvasText;border:1px solid GrayText;" +
  "font:13px/1.4 system-ui,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.18)";

/**
 * Open an item's details on the surface {@link resolveDetailSurface} chose.
 *
 * A **popover** is measured first and then placed with {@link placePopover}
 * inside the viewport's *client* width — the width without the scrollbar —
 * so it can never be the thing that gives the page a horizontal scroll. A
 * **sheet** spans the bottom of the viewport, at most half its height, and
 * brings its own close button: on a phone there is no hover to leave and no
 * pointer to move away.
 *
 * Escape closes either. Content passed as a string is text, so an item label
 * from user data cannot inject markup.
 */
export function openDetail(container: Element, options: DetailOptions): DetailHandle {
  const doc = container.ownerDocument;
  const view = doc.defaultView;
  const element = doc.createElement("div");
  element.className = `tl-detail tl-detail--${options.surface}`;
  element.setAttribute("data-tl-detail", options.surface);
  element.setAttribute("role", "dialog");
  if (options.label !== undefined) {
    element.setAttribute("aria-label", options.label);
  }
  if (typeof options.content === "string") {
    element.textContent = options.content;
  } else {
    element.append(options.content);
  }

  let open = true;
  const close = (): void => {
    if (!open) {
      return;
    }
    open = false;
    doc.removeEventListener("keydown", onKey);
    element.remove();
    options.onClose?.();
  };
  const onKey = (event: KeyboardEvent): void => {
    if (event.key === "Escape") {
      close();
    }
  };

  if (options.surface === "sheet") {
    element.style.cssText =
      `${BASE_STYLE};left:0;right:0;bottom:0;max-height:50vh;overflow:auto;` +
      "border-radius:12px 12px 0 0;padding-bottom:max(12px,env(safe-area-inset-bottom))";
    const button = doc.createElement("button");
    button.type = "button";
    button.className = "tl-detail__close";
    button.textContent = options.closeLabel ?? "Close";
    button.style.cssText = "display:block;margin:10px 0 0 auto;min-height:44px;min-width:44px";
    button.addEventListener("click", close);
    element.append(button);
    doc.body.append(element);
  } else {
    // Measured before it is placed: the width the content wants, capped so a
    // long label wraps instead of pushing the popover off the screen.
    element.style.cssText =
      `${BASE_STYLE};left:0;top:0;max-width:320px;border-radius:8px;visibility:hidden`;
    doc.body.append(element);
    const anchor = options.anchor ?? { x: 0, y: 0, width: 0, height: 0 };
    const placed = placePopover(
      anchor,
      { width: element.offsetWidth, height: element.offsetHeight },
      { width: doc.documentElement.clientWidth, height: view?.innerHeight ?? 0 },
    );
    element.style.left = `${String(placed.x)}px`;
    element.style.top = `${String(placed.y)}px`;
    element.style.width = `${String(placed.width)}px`;
    element.style.visibility = "";
    element.setAttribute("data-tl-side", placed.side);
  }
  doc.addEventListener("keydown", onKey);
  return { element, surface: options.surface, close };
}
