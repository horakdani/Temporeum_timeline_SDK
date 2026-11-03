/**
 * The one file in the core that touches the DOM.
 *
 * Everything else in the package is a pure function over plain objects, and
 * the lint config enforces it. This module is the deliberate, visible
 * exception the plan predicted, and it is kept to the smallest thing that
 * cannot be done without a browser: turning real Pointer, wheel and key
 * events into samples, running the one timer a long press or a view
 * transition needs, telling the machine whether the user asked for reduced
 * motion, and handing the effects back.
 *
 * It ships as a separate entry point (`@temporeum/timeline-core/dom`) rather
 * than from the barrel. That is not tidiness either: it keeps the main entry
 * provably free of DOM access for server-side rendering, and it keeps the
 * size budget honest for hosts that bind their own events.
 *
 * What it does *not* do is interpret anything. No thresholds, no gesture
 * logic, and — this is the part worth being pedantic about — no idea of how
 * long a long press is. The machine *asks* to be woken at a point in time
 * ({@link ScheduleEffect}); this file owns a `setTimeout` and nothing else.
 * The delay is therefore defined in exactly one place, which is the lesson of
 * the `touchAction` setting that has to be passed to two. If a gesture
 * misbehaves, this file is not where the bug is, and that separation is the
 * point.
 */

import type { InputEffect, InputMachine, PointerKind, PointerSample } from "../input.js";

/** How the binding is set up. */
export interface AttachInputOptions<T = unknown> {
  /** The machine that interprets what the host's pointers do. */
  readonly machine: InputMachine<T>;
  /** Called once per event, with everything the machine decided. */
  readonly onEffects?: (effects: readonly InputEffect<T>[]) => void;
  /**
   * Reflect the current gesture on the element as `data-tl-gesture`.
   *
   * On by default: the default stylesheet uses it for the grab cursor, and a
   * host can hang its own rules off it. Turn it off to keep the element's
   * attributes entirely your own.
   *
   * A running edit is reflected the same way, as `data-tl-edit`: a drag that
   * does not change the cursor reads as a page that stopped responding.
   */
  readonly reflectGesture?: boolean;
  /** Forward key presses to the machine. On by default. */
  readonly keyboard?: boolean;
  /**
   * Keep the machine's `reducedMotion` in step with the user's
   * `prefers-reduced-motion`, including a change while the page is open.
   * On by default; off for a host that decides motion itself.
   */
  readonly followReducedMotion?: boolean;
  /**
   * Which way the inline axis runs, asked at every event: `"rtl"` for a
   * frame mirrored by `mirrorScene` (`/intl`). A pointer's `x` is then
   * measured from the right edge, the wheel's `deltaX` is reversed, and the
   * left and right arrows trade places — so the machine, in `(main, cross)`
   * as ever, sees the mirror image of what the user did. Left to right by
   * default.
   */
  readonly direction?: () => "ltr" | "rtl";
}

/** A live binding. Call {@link InputBinding.destroy} to let the element go. */
export interface InputBinding {
  destroy(): void;
}

const SVG_NS = "http://www.w3.org/2000/svg";

/** The keys that trade places in a mirrored frame. */
export const MIRRORED_KEYS: Readonly<Record<string, string>> = { ArrowLeft: "ArrowRight", ArrowRight: "ArrowLeft" };

function pointerKindOf(pointerType: string): PointerKind {
  return pointerType === "touch" || pointerType === "pen" ? pointerType : "mouse";
}

/**
 * Bind a machine to an element.
 *
 * Three details here are the difference between a gesture that works and one
 * that nearly works:
 *
 * - **Pointer capture.** Without it, a drag that leaves the element stops
 *   getting moves and the content freezes mid-gesture with the finger still
 *   down. With it, the element keeps receiving the pointer until it lifts,
 *   wherever it goes — and `lostpointercapture` is treated as a cancel, which
 *   is what the browser does when a system gesture takes over.
 * - **A non-passive wheel listener.** The browser assumes it may scroll while
 *   the handler runs unless told otherwise, and then zooming jitters against
 *   the page scroll.
 * - **`preventDefault` only when the gesture was used.** A wheel the timeline
 *   ignored — at a domain limit, or with zoom turned off — is left to the
 *   page, so a timeline in an article never traps the scroll.
 */
export function attachInput<T>(target: Element, options: AttachInputOptions<T>): InputBinding {
  const machine = options.machine;
  const reflect = options.reflectGesture !== false;
  const emit = options.onEffects;
  let wakeUp: ReturnType<typeof setTimeout> | undefined;
  const motion =
    options.followReducedMotion !== false && typeof matchMedia === "function"
      ? matchMedia("(prefers-reduced-motion: reduce)")
      : undefined;
  function followMotion(): void {
    machine.setKeyboard({ reducedMotion: motion?.matches === true });
  }

  const mirrored = (): boolean => options.direction?.() === "rtl";
  /** A client `x` in the frame: from the left edge, or from the right in a mirrored one. */
  function xOf(clientX: number, box: DOMRect): number {
    return mirrored() ? box.left + box.width - clientX : clientX - box.left;
  }

  function toSample(
    event: PointerEvent,
    phase: PointerSample["phase"],
  ): PointerSample {
    const box = target.getBoundingClientRect();
    return {
      pointerId: event.pointerId,
      phase,
      x: xOf(event.clientX, box),
      y: event.clientY - box.top,
      time: event.timeStamp,
      pointerType: pointerKindOf(event.pointerType),
    };
  }

  function clearWakeUp(): void {
    if (wakeUp !== undefined) {
      clearTimeout(wakeUp);
      wakeUp = undefined;
    }
  }

  /**
   * Run the machine's wake-up request.
   *
   * `event.timeStamp` and `performance.now()` share a time origin, so the
   * machine can be handed the same clock its samples came from. The delay is
   * the machine's, not ours — all this does is wait.
   */
  function schedule(at: number | null): void {
    clearWakeUp();
    if (at === null) {
      return;
    }
    wakeUp = setTimeout(
      () => {
        wakeUp = undefined;
        apply(machine.elapse(performance.now()));
      },
      Math.max(0, at - performance.now()),
    );
  }

  function apply(effects: readonly InputEffect<T>[]): void {
    for (const effect of effects) {
      if (effect.type === "schedule") {
        schedule(effect.at);
        continue;
      }
      if (!reflect) {
        continue;
      }
      if (effect.type === "gestureStart") {
        target.setAttribute("data-tl-gesture", effect.kind);
      } else if (effect.type === "gestureEnd") {
        target.removeAttribute("data-tl-gesture");
      } else if (effect.type === "editStart") {
        target.setAttribute("data-tl-edit", effect.mode);
      } else if (effect.type === "editEnd") {
        target.removeAttribute("data-tl-edit");
      }
    }
    if (emit !== undefined && effects.length > 0) {
      emit(effects);
    }
  }

  function onPointerDown(event: Event): void {
    const pointerEvent = event as PointerEvent;
    // The middle and the right button are the browser's (autoscroll, the
    // context menu), and an eraser is not a pen tip: only the primary button
    // pans, picks or drags.
    if (pointerEvent.button > 0) {
      return;
    }
    // Keeps the pointer coming to this element even when it leaves it. The
    // call can throw if the pointer is already gone, which is not an error
    // worth propagating into the host's event handler.
    try {
      target.setPointerCapture(pointerEvent.pointerId);
    } catch {
      /* the pointer ended before we could capture it */
    }
    apply(machine.handle(toSample(pointerEvent, "down")));
  }

  function onPointerMove(event: Event): void {
    const pointerEvent = event as PointerEvent;
    // A mouse whose primary button is no longer down has let go — of a chord
    // whose last button is the right one, say, which sends no pointerup.
    // (An odd `buttons` has the primary bit; a missing one is NaN, not even.)
    const released = pointerEvent.pointerType === "mouse" && pointerEvent.buttons % 2 === 0;
    apply(machine.handle(toSample(pointerEvent, released ? "cancel" : "move")));
  }

  function onPointerUp(event: Event): void {
    apply(machine.handle(toSample(event as PointerEvent, "up")));
  }

  function onPointerCancel(event: Event): void {
    apply(machine.handle(toSample(event as PointerEvent, "cancel")));
  }

  function onWheel(event: Event): void {
    const wheelEvent = event as WheelEvent;
    const box = target.getBoundingClientRect();
    const effects = machine.wheel({
      x: xOf(wheelEvent.clientX, box),
      y: wheelEvent.clientY - box.top,
      deltaX: mirrored() ? -wheelEvent.deltaX : wheelEvent.deltaX,
      deltaY: wheelEvent.deltaY,
      ctrlKey: wheelEvent.ctrlKey,
      shiftKey: wheelEvent.shiftKey,
      time: wheelEvent.timeStamp,
      ...(mirrored() ? { mirrored: true } : {}),
    });
    if (effects.some((effect) => effect.type === "viewport")) {
      // The timeline used it, so the page must not also scroll.
      event.preventDefault();
    }
    apply(effects);
  }

  /**
   * A key press, if it is the timeline's.
   *
   * Only keys pressed on the timeline itself or its SVG reach the machine: a
   * host that puts its own input inside the container keeps its arrows and
   * its Enter. A key the machine took is the timeline's alone — an arrow
   * inside a listbox must not also scroll the page — and every other key is
   * left exactly as it was.
   */
  function onKeyDown(event: Event): void {
    const key = event as KeyboardEvent;
    const from = key.target as Element | null;
    if (key.isComposing || (from !== target && from?.namespaceURI !== SVG_NS)) {
      return;
    }
    const effects = machine.key({
      key: mirrored() ? (MIRRORED_KEYS[key.key] ?? key.key) : key.key,
      shiftKey: key.shiftKey,
      altKey: key.altKey,
      ctrlKey: key.ctrlKey,
      metaKey: key.metaKey,
      time: key.timeStamp,
    });
    if (effects.length > 0) {
      event.preventDefault();
    }
    apply(effects);
  }

  const bindings: readonly (readonly [string, (event: Event) => void, AddEventListenerOptions])[] =
    [
      ["pointerdown", onPointerDown, {}],
      ["pointermove", onPointerMove, {}],
      ["pointerup", onPointerUp, {}],
      ["pointercancel", onPointerCancel, {}],
      // The browser took the pointer away — a system gesture, a context menu,
      // the element being removed. Identical to a cancel from here.
      ["lostpointercapture", onPointerCancel, {}],
      ["wheel", onWheel, { passive: false }],
      ...(options.keyboard === false ? [] : [["keydown", onKeyDown, {}] as const]),
    ];

  for (const [name, handler, listenerOptions] of bindings) {
    target.addEventListener(name, handler, listenerOptions);
  }
  if (motion !== undefined) {
    followMotion();
    motion.addEventListener("change", followMotion);
  }

  return {
    destroy(): void {
      for (const [name, handler] of bindings) {
        target.removeEventListener(name, handler);
      }
      motion?.removeEventListener("change", followMotion);
      // A pending wake-up would fire into a machine nobody is listening to,
      // and on a removed element that is a leak with a timer attached.
      clearWakeUp();
      // Anything still down is now nobody's: drop it, or the next gesture
      // starts believing a finger is already on the glass.
      machine.reset();
      if (reflect) {
        target.removeAttribute("data-tl-gesture");
        target.removeAttribute("data-tl-edit");
      }
    },
  };
}
