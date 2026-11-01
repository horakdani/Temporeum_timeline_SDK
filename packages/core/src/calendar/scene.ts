/**
 * The week and the day, drawn: a scene tree the core's renderers already
 * take — `mountScene` in the browser, `renderToSvgString` on a server, the
 * `/export` writers for a file.
 *
 * Accessible the way the timeline is: the root is a `listbox` and the one
 * focus stop, every event an `option` with a name that says what and when,
 * and `aria-activedescendant` points at the event the keyboard is on. The
 * grid, the hours, the day names and the events' titles and times are
 * drawing (`aria-hidden`); the days, titles and times are in the events'
 * names, so nothing is lost to a reader.
 *
 * Right to left, the geometry mirrors the days and the hours, and each text
 * is anchored at its box's right edge. The root takes no `direction`: under
 * it `text-anchor: end` would mean the left edge, and a Latin title would
 * run out of its box. The bidirectional algorithm still orders each title.
 *
 * The stylesheet is part of the scene (a `<style>` in the root): a scene
 * written to a file or sent from a server looks the same as the one in the
 * page. Colours are the theme's tokens, as CSS variables under `.tl-cal`.
 */

import { formatterFor } from "../a11y.js";
import { densityMetrics } from "../density.js";
import { estimateTextWidth, shortenLabel } from "../labels.js";
import type { MeasureText } from "../labels.js";
import type { SceneElement } from "../scene.js";
import { CALENDAR_STRINGS } from "../strings.js";
import type { CalendarStrings } from "../strings.js";
import { fill } from "../text.js";
import { DARK_THEME, LIGHT_THEME, resolveTheme } from "../theme.js";
import type { Theme, ThemeSetting } from "../theme.js";
import { toTimeMs } from "../time.js";
import type { Density, TimeInput, TimeMs } from "../types.js";
import { wallMs, wallOf } from "./rrule.js";
import { calendarGeometry } from "./view.js";
import type { AllDaySegment, CalendarDay, CalendarGeometry, CalendarMetrics, DaySegment, DaysLayout } from "./view.js";

/** How the view is drawn. */
export interface CalendarSceneOptions extends CalendarMetrics {
  /** Dates and names in this locale. `"en"` by default. */
  readonly locale?: string;
  readonly theme?: ThemeSetting;
  /** Type sizes. `"comfortable"` by default. */
  readonly density?: Density;
  /** Item ids drawn selected. */
  readonly selectedIds?: readonly string[];
  /** The key (`DaySegment.key`) the keyboard is on. */
  readonly focusedKey?: string;
  /** Prefix of the events' document ids. `"tlc"` by default. */
  readonly idPrefix?: string;
  /** The view's accessible name. "Week of …" or the day by default. */
  readonly ariaLabel?: string;
  /** Where to draw the current time, if it is in the view. */
  readonly now?: TimeInput;
  /** The day marked as today. */
  readonly today?: TimeInput;
  /** The view's words: the `CALENDAR_STRINGS` keys of `DEFAULT_STRINGS` (`/intl`). */
  readonly strings?: Partial<CalendarStrings>;
  /** A day's header. The weekday and day of the month in `locale` by default. */
  readonly formatDay?: (day: CalendarDay, locale: string) => string;
  /** An hour's label in the gutter. `"09:00"` by default. */
  readonly formatHour?: (hour: number) => string;
  /** An event's accessible name, instead of the default "title, time". */
  readonly describe?: (item: DaySegment | AllDaySegment, context: { readonly locale: string; readonly timeZone: string }) => string;
  readonly measureText?: MeasureText;
}

const pad = (n: number): string => String(n).padStart(2, "0");

/** A document id for an event's node. */
export function calendarDomId(prefix: string, key: string): string {
  return `${prefix}-e-${key.replace(/[^A-Za-z0-9_-]/g, (char) => `.${char.charCodeAt(0).toString(16)}.`)}`;
}

const varName = (token: string): string => `--tl-${token.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
const tokens = (theme: Theme): string =>
  Object.entries(theme.tokens)
    .map(([token, value]) => `${varName(token)}:${value}`)
    .join(";");

/** The view's stylesheet, scoped to `.tl-cal`. */
export function calendarCss(setting: ThemeSetting = "auto", density: Density = "comfortable"): string {
  const m = densityMetrics(density, "vertical");
  const resolved = resolveTheme(setting);
  const root = ".tl-cal";
  const colours =
    resolved === undefined
      ? `${root}{${tokens(LIGHT_THEME)}}@media (prefers-color-scheme:dark){${root}:not([data-tl-theme="light"]){${tokens(DARK_THEME)}}}${root}[data-tl-theme="dark"]{${tokens(DARK_THEME)}}`
      : `${root}{${tokens(resolved)}}`;
  return [
    colours,
    `${root}{font-family:${m.fontFamily}}`,
    `${root} .tl-cal-surface{fill:var(--tl-surface)}`,
    `${root} .tl-cal-band{fill:var(--tl-surface-alt)}`,
    `${root} .tl-cal-today{fill:var(--tl-era)}`,
    `${root} .tl-cal-line{stroke:var(--tl-line);stroke-width:1}`,
    `${root} .tl-cal-line--day{stroke:var(--tl-line-strong)}`,
    `${root} .tl-cal-head{fill:var(--tl-text);font-size:${String(m.fontSize)}px}`,
    `${root} .tl-cal-hour{fill:var(--tl-text-muted);font-size:${String(m.tickFontSize)}px}`,
    `${root} .tl-cal-event{fill:var(--tl-item-fill);stroke:var(--tl-item-stroke);stroke-width:1}`,
    `${root} .tl-cal-event--selected{stroke:var(--tl-focus);stroke-width:2}`,
    `${root} .tl-cal-label{fill:var(--tl-item-text);font-size:${String(m.fontSize)}px;pointer-events:none}`,
    `${root} .tl-cal-time{fill:var(--tl-item-text);font-size:${String(m.tickFontSize)}px;pointer-events:none}`,
    `${root} .tl-cal-now{stroke:var(--tl-now);stroke-width:2}`,
    `${root} .tl-cal-focus{fill:none;stroke:var(--tl-focus);stroke-width:2;pointer-events:none}`,
    `${root}:focus-visible{outline:2px solid var(--tl-focus);outline-offset:1px}`,
  ].join("");
}

/** A rectangle node. */
const rect = (cls: string, r: { readonly x: number; readonly y: number; readonly width: number; readonly height: number }, extra: Record<string, string | number> = {}): SceneElement => ({
  tag: "rect",
  attrs: { class: cls, x: r.x, y: r.y, width: Math.max(0, r.width), height: Math.max(0, r.height), ...extra },
});
const line = (cls: string, x1: number, y1: number, x2: number, y2: number): SceneElement => ({ tag: "line", attrs: { class: cls, x1, y1, x2, y2 } });

/** The time of an instant as the gutter writes it. */
function timeText(t: TimeMs, zone: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit", timeZone: zone }).format(t);
}

/** The view as a scene tree: one `<svg>`. */
export function calendarScene(layout: DaysLayout<unknown>, options: CalendarSceneOptions): SceneElement {
  const locale = options.locale ?? "en";
  const zone = layout.timeZone;
  const density = options.density ?? "comfortable";
  const m = densityMetrics(density, "vertical");
  const words: CalendarStrings = { ...CALENDAR_STRINGS, ...options.strings };
  const say = (key: keyof CalendarStrings, values?: Readonly<Record<string, string | number>>): string => fill(words[key], values, locale);
  const geometry: CalendarGeometry = calendarGeometry(layout, options);
  const rtl = options.rtl === true;
  const prefix = options.idPrefix ?? "tlc";
  const selected = new Set(options.selectedIds ?? []);
  const measure = options.measureText ?? estimateTextWidth;
  const formatDay =
    options.formatDay ??
    ((day: CalendarDay, at: string): string => new Intl.DateTimeFormat(at, { weekday: "short", day: "numeric", timeZone: zone }).format(day.start + 12 * 3_600_000));
  const formatHour = options.formatHour ?? ((hour: number): string => `${pad(hour)}:00`);
  const dateFormat = formatterFor(locale, zone, false);
  const firstDay = layout.days[0];
  const label =
    options.ariaLabel ??
    (firstDay === undefined
      ? say("weekView", { date: "" })
      : layout.days.length === 1
        ? say("dayView", { date: dateFormat.format(firstDay.start) })
        : say("weekView", { date: dateFormat.format(firstDay.start) }));

  // --- chrome: surface, today, all-day band, hour lines, day lines, headers
  const chrome: SceneElement[] = [rect("tl-cal-surface", { x: 0, y: 0, width: geometry.width, height: geometry.height })];
  const today = options.today === undefined ? undefined : toTimeMs(options.today);
  layout.days.forEach((day, i) => {
    const column = geometry.columns[i];
    if (today !== undefined && today >= day.start && today < day.end && column !== undefined) chrome.push(rect("tl-cal-today", { x: column.x, y: 0, width: column.width, height: geometry.height }));
  });
  if (geometry.allDayBand.height > 0) {
    chrome.push(rect("tl-cal-band", geometry.allDayBand));
    chrome.push({
      tag: "text",
      attrs: { class: "tl-cal-hour", x: rtl ? geometry.gutter.x + geometry.gutter.width - 4 : 4, y: geometry.allDayBand.y + geometry.allDayBand.height / 2, "dominant-baseline": "central", "text-anchor": rtl ? "end" : "start" },
      text: say("allDay"),
    });
  }
  const hours = layout.dayEndHour - layout.dayStartHour;
  const body = geometry.body;
  for (let h = 0; h <= hours; h += 1) {
    const y = body.y + (h / hours) * body.height;
    chrome.push(line("tl-cal-line", body.x, y, body.x + body.width, y));
    if (h < hours && body.height / hours >= m.tickFontSize) {
      chrome.push({
        tag: "text",
        attrs: { class: "tl-cal-hour", x: rtl ? geometry.gutter.x + 4 : geometry.gutter.x + geometry.gutter.width - 4, y: y + 2, "dominant-baseline": "hanging", "text-anchor": rtl ? "start" : "end" },
        text: formatHour(layout.dayStartHour + h),
      });
    }
  }
  geometry.columns.forEach((column, i) => {
    const edge = rtl ? column.x + column.width : column.x;
    chrome.push(line(i === 0 ? "tl-cal-line tl-cal-line--day" : "tl-cal-line", edge, 0, edge, geometry.height));
    const head = geometry.headers[i];
    const day = layout.days[i];
    if (head !== undefined && day !== undefined) {
      chrome.push({ tag: "text", attrs: { class: "tl-cal-head", x: head.x + head.width / 2, y: head.height / 2, "dominant-baseline": "central", "text-anchor": "middle" }, text: formatDay(day, locale) });
    }
  });
  chrome.push(line("tl-cal-line", 0, geometry.allDayBand.y, geometry.width, geometry.allDayBand.y));
  if (options.now !== undefined) {
    const now = toTimeMs(options.now);
    const i = layout.days.findIndex((day) => now >= day.start && now < day.end);
    const column = geometry.columns[i];
    const day = layout.days[i];
    if (column !== undefined && day !== undefined) {
      const minutes = (wallOf(now, zone) - wallMs(day.year, day.month, day.day)) / 60_000 - layout.dayStartHour * 60;
      const at = minutes / (hours * 60);
      if (at >= 0 && at <= 1) chrome.push(line("tl-cal-now", column.x, column.y + at * column.height, column.x + column.width, column.y + at * column.height));
    }
  }

  // --- events
  const describe = (segment: DaySegment | AllDaySegment, allDay: boolean): string => {
    if (options.describe !== undefined) return options.describe(segment, { locale, timeZone: zone });
    const item = segment.item;
    const name = item.label ?? say("untitled");
    const s = toTimeMs(item.start);
    const e = item.end === undefined ? s : toTimeMs(item.end);
    if (allDay) {
      const last = e > s ? e - 1 : s;
      return say("allDayEvent", { name, range: last - s < 86_400_000 ? dateFormat.format(s) : dateFormat.formatRange(s, last) });
    }
    const withTime = formatterFor(locale, zone, true);
    return say("event", { name, range: e > s ? withTime.formatRange(s, e) : withTime.format(s) });
  };
  const events: SceneElement[] = [];
  // The titles and times, over the events: drawing, as the timeline's labels
  // are. A title shortened to its box is not a name, and the event's own
  // name says it whole.
  const labels: SceneElement[] = [];
  let focusRing: SceneElement | undefined;
  const textOf = (text: string, width: number, size: number): string | undefined => {
    if (measure(text, size) <= width) return text;
    return shortenLabel(text, (candidate) => ({ main: measure(candidate, size), cross: size }), (need) => need.main <= width)?.text;
  };
  const draw = (segment: DaySegment | AllDaySegment, allDay: boolean): void => {
    const r = geometry.rects.get(segment.key);
    if (r === undefined) return;
    const item = segment.item;
    const isSelected = selected.has(item.id);
    const children: SceneElement[] = [
      rect(`tl-cal-event${isSelected ? " tl-cal-event--selected" : ""}${item.className === undefined ? "" : ` ${item.className}`}`, r, { rx: Math.min(m.cornerRadius, r.height / 2) }),
    ];
    const padX = 4;
    const room = r.width - 2 * padX;
    const title = item.label ?? say("untitled");
    const x = rtl ? r.x + r.width - padX : r.x + padX;
    const anchor = rtl ? "end" : "start";
    if (room > 0 && r.height >= m.tickFontSize) {
      // A short event gets its title in the small type, on its middle line.
      const small = r.height < m.fontSize + 4;
      const shown = textOf(title, room, small ? m.tickFontSize : m.fontSize);
      if (shown !== undefined) {
        const middle = allDay || small;
        labels.push({ tag: "text", attrs: { class: small ? "tl-cal-time" : "tl-cal-label", x, y: r.y + (middle ? r.height / 2 : 2), "dominant-baseline": middle ? "central" : "hanging", "text-anchor": anchor }, text: shown });
      }
      if (!allDay && "start" in segment && r.height >= m.fontSize + m.tickFontSize + 6) {
        const time = textOf(timeText(segment.start, zone, locale), room, m.tickFontSize);
        if (time !== undefined) labels.push({ tag: "text", attrs: { class: "tl-cal-time", x, y: r.y + m.fontSize + 4, "dominant-baseline": "hanging", "text-anchor": anchor }, text: time });
      }
    }
    events.push({
      tag: "g",
      attrs: {
        id: calendarDomId(prefix, segment.key),
        role: "option",
        "aria-label": describe(segment, allDay),
        "aria-selected": isSelected ? "true" : "false",
        "data-tl-id": segment.key,
        "data-item-id": item.id,
      },
      children,
    });
    if (options.focusedKey === segment.key) focusRing = rect("tl-cal-focus", { x: r.x - 2, y: r.y - 2, width: r.width + 4, height: r.height + 4 });
  };
  // Reading order, so a reader's list is the keyboard's.
  const byKey = new Map<string, readonly [DaySegment | AllDaySegment, boolean]>();
  for (const segment of layout.allDay) byKey.set(segment.key, [segment, true]);
  for (const segment of layout.segments) byKey.set(segment.key, [segment, false]);
  for (const key of layout.order) {
    const found = byKey.get(key);
    if (found !== undefined) draw(found[0], found[1]);
  }
  const active = options.focusedKey !== undefined && byKey.has(options.focusedKey) ? calendarDomId(prefix, options.focusedKey) : undefined;
  return {
    tag: "svg",
    attrs: {
      xmlns: "http://www.w3.org/2000/svg",
      class: "tl-cal",
      width: geometry.width,
      height: geometry.height,
      viewBox: `0 0 ${String(geometry.width)} ${String(geometry.height)}`,
      role: "listbox",
      tabindex: 0,
      "aria-label": label,
      "aria-activedescendant": active,
      "aria-multiselectable": "false",
      "data-tl-theme": typeof options.theme === "string" ? options.theme : undefined,
    },
    children: [
      { tag: "style", text: calendarCss(options.theme, density) },
      { tag: "g", attrs: { "aria-hidden": "true" }, children: chrome },
      { tag: "g", attrs: { role: "none" }, children: events },
      { tag: "g", attrs: { "aria-hidden": "true" }, children: labels },
      ...(focusRing === undefined ? [] : [{ tag: "g", attrs: { "aria-hidden": "true" }, children: [focusRing] }]),
    ],
  };
}
