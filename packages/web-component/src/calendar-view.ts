/**
 * The week and the day views, mounted.
 *
 * Everything that decides is the core's `/calendar`: `layoutDays` places the
 * events, `calendarScene` draws them, `resolveCalendarKey` and
 * `calendarKeyStep` say what a key does, `calendarHit` what a click is on.
 * This file holds the DOM: a toolbar (previous, today, next, and the range
 * it shows), the drawing, and the keyboard and pointer that drive them.
 *
 * One way to choose an event, two inputs: a click (a mouse, a pen or a
 * finger — one pointer path) and `Enter` or `Space` on the event the
 * keyboard is on both call `choose`, which selects it, moves the focus to
 * it and says `select`. The arrows walk the events — down and up in reading
 * order, across to the nearest event of the next or previous day — and
 * `PageDown`, `PageUp` and `t` change the period, the same as the buttons.
 *
 * Recurring events are expanded for the period shown (`expandEvents`), so a
 * rule that repeats forever costs one week's occurrences. Nothing is saved.
 */

import type { Density, Item, ThemeSetting, TimeInput, TimeMs } from "@temporeum/timeline-core";
import { toTimeMs } from "@temporeum/timeline-core";
import {
  calendarDomId,
  calendarGeometry,
  calendarHit,
  calendarKeyStep,
  calendarScene,
  dayStartOf,
  expandEvents,
  layoutDays,
  resolveCalendarKey,
  weekStartOf,
} from "@temporeum/timeline-core/calendar";
import type { CalendarEvent, CalendarKeyAction, DaysLayout } from "@temporeum/timeline-core/calendar";
import { mountScene } from "@temporeum/timeline-core/dom";

import { adoptCss } from "./css.js";
import { resolveStrings, sayIn } from "@temporeum/timeline-core/words";
import type { Strings } from "@temporeum/timeline-core/words";

/** How a calendar view is set up. */
export interface CalendarViewOptions<T = unknown> {
  /** Calendar events, recurring or not; expanded for the period shown. */
  readonly events?: readonly CalendarEvent<T>[] | undefined;
  /** Items to show as they are, beside the events. */
  readonly items?: readonly Item<T>[] | undefined;
  /** A week (the default) or a day. */
  readonly view?: "week" | "day" | undefined;
  /** Any moment of the period to show. Now by default. */
  readonly date?: TimeInput | undefined;
  readonly timeZone?: string | undefined;
  /**
   * The nonce of the view's `<style>`s, for a Content-Security-Policy without
   * `'unsafe-inline'` in a browser that cannot adopt a constructed sheet.
   * Where it can, no `<style>` is written. Read once, when the view mounts.
   */
  readonly nonce?: string | undefined;
  /** Dates and names in this locale. `"en"` by default. */
  readonly locale?: string | undefined;
  /** 1 = Monday (the default) to 7 = Sunday. */
  readonly weekStartsOn?: number | undefined;
  readonly dayStartHour?: number | undefined;
  readonly dayEndHour?: number | undefined;
  readonly minDurationMs?: number | undefined;
  /** The drawing's height in CSS pixels. 720 by default. */
  readonly height?: number | undefined;
  readonly theme?: ThemeSetting | undefined;
  readonly density?: Density | undefined;
  /** Right to left: the first day on the right. `"auto"` reads the container's `direction`. */
  readonly direction?: "ltr" | "rtl" | "auto" | undefined;
  /** The view's words: `DEFAULT_STRINGS` keys of `/intl`. */
  readonly strings?: Partial<Strings> | undefined;
  /** The drawing's accessible name. "Week of …" by default. */
  readonly ariaLabel?: string | undefined;
  /** The current-time line: on (now), off, or at a given moment. On by default. */
  readonly now?: boolean | TimeInput | undefined;
  /** The previous / today / next buttons. On by default. */
  readonly toolbar?: boolean | undefined;
}

/** What `itemSelect` says. */
export interface CalendarSelectPayload<T = unknown> {
  readonly item: Item<T>;
  /** The piece of the item chosen: its key in the layout. */
  readonly key: string;
  readonly via: "pointer" | "keyboard";
}

/** What `rangeChanged` says: the period now shown. */
export interface CalendarRangePayload {
  readonly start: TimeMs;
  readonly end: TimeMs;
}

/** The events of a calendar view. */
export interface CalendarViewEventMap<T = unknown> {
  /** An event was chosen — a click, `Enter`, or `choose` — whether or not it was selected before. */
  readonly itemSelect: CalendarSelectPayload<T>;
  /** The period shown changed. */
  readonly rangeChanged: CalendarRangePayload;
}

/** A mounted calendar view. */
export interface CalendarView<T = unknown> {
  /** Change any option; the rest stay. */
  update(options?: Partial<CalendarViewOptions<T>>): void;
  /** The period shown, `[start, end)`. */
  readonly range: readonly [TimeMs, TimeMs];
  readonly layout: DaysLayout<T>;
  /** The selected item's id. */
  readonly selectedId: string | undefined;
  /** The key the keyboard is on. */
  readonly focusedKey: string | undefined;
  /** Show the next period. `true`: a calendar always has one — the same signature as the story's. */
  next(): boolean;
  /** Show the period before. `true`, as `next`. */
  previous(): boolean;
  today(): void;
  /** Choose an event by its layout key, as a click or `Enter` would. */
  choose(key: string, via?: "pointer" | "keyboard"): void;
  on<K extends keyof CalendarViewEventMap<T>>(event: K, handler: (payload: CalendarViewEventMap<T>[K]) => void): () => void;
  destroy(): void;
}

/** The toolbar's stylesheet. The drawing carries its own. */
export function calendarViewCss(): string {
  return (
    ".tl-cal-view{font:13px/1.3 system-ui,sans-serif}" +
    ".tl-cal-bar{display:flex;align-items:center;gap:6px;margin:0 0 6px}" +
    ".tl-cal-bar button{min-width:44px;min-height:32px;padding:4px 10px;border:1px solid #737b87;border-radius:4px;background:transparent;color:inherit;font:inherit;cursor:pointer}" +
    ".tl-cal-bar button:focus-visible{outline:2px solid #1d4ed8;outline-offset:1px}" +
    ".tl-cal-range{margin-inline-start:8px;font-weight:600}" +
    ".tl-cal-view svg{display:block;touch-action:pan-y;user-select:none;-webkit-user-select:none}"
  );
}

const DAY = 86_400_000;
let viewCount = 0;

/** Mount a week or day view in `container`. */
export function mountCalendarView<T = unknown>(container: HTMLElement, initial: CalendarViewOptions<T> = {}): CalendarView<T> {
  const doc = container.ownerDocument;
  const prefix = `tl-cal-${String((viewCount += 1))}`;
  let options: CalendarViewOptions<T> = initial;
  let anchor = toTimeMs(options.date ?? Date.now());
  let selectedId: string | undefined;
  let focusedKey: string | undefined;
  let layout: DaysLayout<T>;
  let range: [TimeMs, TimeMs] = [0, 0];
  let destroyed = false;
  const listeners = new Map<string, Set<(payload: never) => void>>();

  const box = doc.createElement("div");
  box.className = "tl-cal-view";
  const bar = doc.createElement("div");
  bar.className = "tl-cal-bar";
  const previousButton = doc.createElement("button");
  const todayButton = doc.createElement("button");
  const nextButton = doc.createElement("button");
  for (const button of [previousButton, todayButton, nextButton]) button.type = "button";
  const rangeText = doc.createElement("span");
  rangeText.className = "tl-cal-range";
  rangeText.setAttribute("aria-live", "polite");
  bar.append(previousButton, todayButton, nextButton, rangeText);
  const host = doc.createElement("div");
  box.append(bar, host);
  container.append(box);
  const unstyle = adoptCss(box, calendarViewCss(), initial.nonce);
  const mount = mountScene(host, initial.nonce === undefined ? {} : { nonce: initial.nonce });

  function emit<K extends keyof CalendarViewEventMap<T>>(event: K, payload: CalendarViewEventMap<T>[K]): void {
    for (const handler of listeners.get(event) ?? []) (handler as (value: CalendarViewEventMap<T>[K]) => void)(payload);
  }

  const zone = (): string => options.timeZone ?? "UTC";
  const locale = (): string => options.locale ?? "en";
  const rtl = (): boolean => (options.direction === "auto" ? doc.defaultView?.getComputedStyle(container).direction === "rtl" : options.direction === "rtl");
  const dayCount = (): number => (options.view === "day" ? 1 : 7);
  const width = (): number => Math.max(320, host.clientWidth || container.clientWidth || 800);
  const height = (): number => options.height ?? 720;
  const words = (): Strings => resolveStrings(options.strings);

  function periodStart(): TimeMs {
    return options.view === "day" ? dayStartOf(anchor, zone()) : weekStartOf(anchor, zone(), options.weekStartsOn ?? 1);
  }

  function geometryOptions(): { width: number; height: number; rtl: boolean } {
    return { width: width(), height: height(), rtl: rtl() };
  }

  function draw(): void {
    if (destroyed) return;
    const start = periodStart();
    const days = dayCount();
    const items = [...expandEvents(options.events ?? [], start - DAY, start + (days + 1) * DAY, { timeZone: zone() }), ...(options.items ?? [])] as Item<T>[];
    layout = layoutDays(items, {
      start,
      days,
      timeZone: zone(),
      ...(options.dayStartHour === undefined ? {} : { dayStartHour: options.dayStartHour }),
      ...(options.dayEndHour === undefined ? {} : { dayEndHour: options.dayEndHour }),
      ...(options.minDurationMs === undefined ? {} : { minDurationMs: options.minDurationMs }),
    });
    const last = layout.days[layout.days.length - 1];
    const changed = range[0] !== start;
    range = [start, last?.end ?? start];
    if (focusedKey !== undefined && !layout.order.includes(focusedKey)) focusedKey = undefined;
    const say = sayIn(words(), locale());
    const now = options.now === false ? undefined : options.now === true || options.now === undefined ? Date.now() : options.now;
    const scene = calendarScene(layout, {
      ...geometryOptions(),
      locale: locale(),
      strings: words(),
      idPrefix: prefix,
      today: Date.now(),
      ...(now === undefined ? {} : { now }),
      ...(options.theme === undefined ? {} : { theme: options.theme }),
      ...(options.density === undefined ? {} : { density: options.density }),
      ...(options.ariaLabel === undefined ? {} : { ariaLabel: options.ariaLabel }),
      ...(selectedId === undefined ? {} : { selectedIds: [selectedId] }),
      ...(focusedKey === undefined ? {} : { focusedKey }),
    });
    mount.update(scene);
    box.dir = rtl() ? "rtl" : "ltr";
    bar.hidden = options.toolbar === false;
    previousButton.textContent = say("previousPeriod");
    todayButton.textContent = say("today");
    nextButton.textContent = say("nextPeriod");
    const format = new Intl.DateTimeFormat(locale(), { dateStyle: "medium", timeZone: zone() });
    rangeText.textContent = days === 1 || last === undefined ? format.format(start) : format.formatRange(start, last.start);
    if (changed) emit("rangeChanged", { start: range[0], end: range[1] });
  }

  function svg(): SVGSVGElement | undefined {
    const root = mount.root;
    return root instanceof SVGSVGElement ? root : undefined;
  }

  function shift(periods: number): void {
    // Mid-day of the first day of the new period: a day across a clock
    // change is 23 or 25 hours, and the middle of it is still in it.
    anchor = periodStart() + periods * dayCount() * DAY + DAY / 2;
    focusedKey = undefined;
    draw();
  }

  function choose(key: string, via: "pointer" | "keyboard" = "keyboard"): void {
    const piece = layout.segments.find((segment) => segment.key === key) ?? layout.allDay.find((segment) => segment.key === key);
    if (piece === undefined) return;
    focusedKey = key;
    selectedId = piece.item.id;
    draw();
    emit("itemSelect", { item: piece.item, key, via });
  }

  function run(action: CalendarKeyAction): void {
    switch (action) {
      case "nextPeriod":
        shift(1);
        return;
      case "previousPeriod":
        shift(-1);
        return;
      case "today":
        anchor = Date.now();
        focusedKey = undefined;
        draw();
        return;
      case "activate":
        if (focusedKey !== undefined) choose(focusedKey, "keyboard");
        return;
      default: {
        const next = calendarKeyStep(layout, focusedKey, action);
        if (next === focusedKey) return;
        focusedKey = next;
        draw();
        if (next !== undefined) doc.getElementById(calendarDomId(prefix, next))?.scrollIntoView?.({ block: "nearest" });
      }
    }
  }

  function onKey(event: KeyboardEvent): void {
    const action = resolveCalendarKey(event, { direction: rtl() ? "rtl" : "ltr" });
    if (action === undefined) return;
    event.preventDefault();
    run(action);
  }

  // --- the pointer: a press that does not travel is a click, for every pointer type
  let press: { readonly id: number; readonly x: number; readonly y: number } | undefined;
  function onPointerDown(event: PointerEvent): void {
    if (event.button !== 0) return;
    press = { id: event.pointerId, x: event.clientX, y: event.clientY };
  }
  function onPointerUp(event: PointerEvent): void {
    const started = press;
    press = undefined;
    const root = svg();
    if (started === undefined || started.id !== event.pointerId || root === undefined) return;
    if (Math.hypot(event.clientX - started.x, event.clientY - started.y) > 6) return;
    const rect = root.getBoundingClientRect();
    const geometry = calendarGeometry(layout, geometryOptions());
    const x = ((event.clientX - rect.left) / (rect.width || 1)) * geometry.width;
    const y = ((event.clientY - rect.top) / (rect.height || 1)) * geometry.height;
    const key = calendarHit(geometry, x, y);
    root.focus({ preventScroll: true });
    if (key !== undefined) choose(key, "pointer");
  }
  function onPointerCancel(): void {
    press = undefined;
  }

  host.addEventListener("keydown", onKey);
  host.addEventListener("pointerdown", onPointerDown);
  host.addEventListener("pointerup", onPointerUp);
  host.addEventListener("pointercancel", onPointerCancel);
  previousButton.addEventListener("click", () => run("previousPeriod"));
  nextButton.addEventListener("click", () => run("nextPeriod"));
  todayButton.addEventListener("click", () => run("today"));
  const resize = typeof ResizeObserver === "function" ? new ResizeObserver(() => draw()) : undefined;
  resize?.observe(host);
  draw();

  return {
    update(next) {
      options = { ...options, ...next };
      if (next?.date !== undefined) anchor = toTimeMs(next.date);
      draw();
    },
    get range() {
      return range;
    },
    get layout() {
      return layout;
    },
    get selectedId() {
      return selectedId;
    },
    get focusedKey() {
      return focusedKey;
    },
    next() {
      run("nextPeriod");
      return true;
    },
    previous() {
      run("previousPeriod");
      return true;
    },
    today: () => run("today"),
    choose,
    on(event, handler) {
      const set = listeners.get(event) ?? new Set();
      set.add(handler as (payload: never) => void);
      listeners.set(event, set);
      return () => set.delete(handler as (payload: never) => void);
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      resize?.disconnect();
      mount.destroy();
      unstyle();
      box.remove();
    },
  };
}
