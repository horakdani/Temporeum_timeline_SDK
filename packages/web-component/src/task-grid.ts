/**
 * The task grid: the table of a Gantt chart, beside the timeline.
 *
 * One row per lane, on the lane's line — the rows are placed from the
 * timeline's own layout and its scroll across (`taskGridRows` of
 * `@temporeum/timeline-core/gantt`), so a row and its lane stay together
 * through every scroll, collapse and reorder. Only the rows in view, and a
 * few beyond, are in the document: a grid of 10 000 rows holds about as many
 * nodes as the view has rows.
 *
 * It is an element of its own, which the host puts next to the timeline (a
 * CSS grid or flex row of two), and not a layer drawn over the timeline: a
 * table laid over the lanes would cover their items. Nothing here decides
 * what a key means — that is the core's `resolveGridKey` and `gridKeyStep` —
 * and nothing is saved: the grid reads the timeline and asks it to scroll
 * and to focus.
 *
 * `role="grid"` with `aria-rowcount` for all the rows and `aria-rowindex` on
 * each, so a reader hears "row 4 812 of 10 001" for a row the document only
 * holds while it is in view. The arrows walk the rows (along the cross axis,
 * like every key of the timeline), `Home`, `End` and the page keys jump,
 * `Enter` puts the timeline's focus on the row's first item. A click on a
 * row is the same as `Enter`; the wheel over the grid scrolls the lanes, the
 * same as the arrows do a row at a time.
 */

import { DARK_THEME, densityMetrics, LIGHT_THEME, resolveTheme, toTimeMs } from "@temporeum/timeline-core";
import { fill, formatAmount, resolveStrings } from "@temporeum/timeline-core/words";
import type { Strings } from "@temporeum/timeline-core/words";
import type { Item, KeySample, Lane, LayoutItem, Orientation, Theme, ThemeSetting } from "@temporeum/timeline-core";
import { gridKeyStep, resolveGridKey, taskGridRows } from "@temporeum/timeline-core/gantt";
import type { TaskGridRow } from "@temporeum/timeline-core/gantt";

import type { Timeline } from "./timeline.js";

/** What a column is handed for one row. */
export interface TaskGridRowContext<T = unknown> {
  readonly lane: Lane;
  /** The lane's items, in layout order. */
  readonly items: readonly Item<T>[];
}

/** One column of the grid. */
export interface TaskGridColumn<T = unknown> {
  readonly id: string;
  readonly header: string;
  /** Width in CSS pixels. The name column takes what is left by default. */
  readonly width?: number;
  /** The cell's text. */
  readonly value: (row: TaskGridRowContext<T>) => string;
}

/** How a grid is set up. */
export interface TaskGridOptions<T = unknown> {
  /** Name, start, end and progress by default. */
  readonly columns?: readonly TaskGridColumn<T>[];
  /** The grid's accessible name. */
  readonly label?: string;
  /** Rows kept beyond each edge of the view. 4 by default. */
  readonly overscan?: number;
  readonly theme?: ThemeSetting;
  /** Where `Enter` and a click move the keyboard: the timeline's element. */
  readonly focusTarget?: HTMLElement;
  /**
   * The grid's words in the host's language: `tasks` and the `*Column`
   * phrases of `DEFAULT_STRINGS` (`/intl`). `label` and `columns` still win.
   */
  readonly strings?: Partial<Strings>;
  /**
   * The default columns' dates and percentages in a locale (`Intl`, a short
   * date in `timeZone`). Without it, ISO dates in UTC, as before.
   */
  readonly locale?: string;
  readonly timeZone?: string;
}

/** A mounted grid. */
export interface TaskGrid {
  /** Draw again — after the host changed something the timeline did not announce. */
  update(): void;
  /** The focused row's position among all rows, from 0. */
  readonly focusedIndex: number;
  destroy(): void;
}

const iso = (time: number): string => new Date(time).toISOString().slice(0, 10);

/** How the default columns speak: a dictionary, and a locale for their dates and numbers. */
export interface TaskColumnWords {
  readonly strings?: Partial<Strings>;
  readonly locale?: string;
  readonly timeZone?: string;
}

/** The default columns: the lane's name, its first start, its last end, its progress. */
export function defaultTaskColumns<T>(words: TaskColumnWords = {}): TaskGridColumn<T>[] {
  const strings = resolveStrings(words.strings);
  const header = (key: "taskColumn" | "startColumn" | "endColumn" | "progressColumn"): string => fill(strings[key], {}, words.locale);
  const locale = words.locale;
  const dates = locale === undefined ? undefined : new Intl.DateTimeFormat(locale, { dateStyle: "short", timeZone: words.timeZone ?? "UTC" });
  const day = (time: number): string => (dates === undefined ? iso(time) : dates.format(time));
  return [
    {
      id: "name",
      header: header("taskColumn"),
      value: (row) => row.lane.label ?? row.items[0]?.label ?? (row.lane.id.startsWith("\u0000") ? "" : row.lane.id),
    },
    {
      id: "start",
      header: header("startColumn"),
      width: 84,
      value: (row) => (row.items.length === 0 ? "" : day(Math.min(...row.items.map((item) => toTimeMs(item.start))))),
    },
    {
      id: "end",
      header: header("endColumn"),
      width: 84,
      value: (row) => (row.items.length === 0 ? "" : day(Math.max(...row.items.map((item) => toTimeMs(item.end ?? item.start))))),
    },
    {
      id: "progress",
      header: header("progressColumn"),
      width: 40,
      value: (row) => {
        const known = row.items.filter((item) => item.progress !== undefined && Number.isFinite(item.progress));
        if (known.length === 0) return "";
        const mean = known.reduce((sum, item) => sum + Math.min(Math.max(item.progress ?? 0, 0), 1), 0) / known.length;
        return locale === undefined ? `${String(Math.round(mean * 100))}%` : formatAmount(Math.round(mean * 100) / 100, locale, true);
      },
    },
  ];
}

function tokens(theme: Theme): string {
  const used = ["text", "textMuted", "surface", "surfaceAlt", "line", "focus"] as const;
  return used.map((name) => `--tl-t-${name}:${theme.tokens[name]}`).join(";");
}

/** The grid's stylesheet, with the theme's colours: the grid is outside the drawing that holds them. */
export function taskGridCss(): string {
  // No border on the box: its rows are placed from its padding edge, and a
  // border would shift every row off its lane by its width.
  return (
    `.tl-grid{position:relative;overflow:hidden;box-sizing:border-box;height:100%;font:12px/1.2 system-ui,sans-serif;` +
    `color:var(--tl-t-text);background:var(--tl-t-surface);box-shadow:inset 0 0 0 1px var(--tl-t-line);${tokens(LIGHT_THEME)}}` +
    `@media (prefers-color-scheme:dark){.tl-grid:not([data-tl-theme="light"]){${tokens(DARK_THEME)}}}` +
    `.tl-grid[data-tl-theme="dark"]{${tokens(DARK_THEME)}}` +
    ".tl-grid-head{position:absolute;display:flex;box-sizing:border-box;background:var(--tl-t-surfaceAlt);border-bottom:1px solid var(--tl-t-line);font-weight:600}" +
    ".tl-grid-body{position:absolute;overflow:hidden}" +
    ".tl-grid-row{position:absolute;display:flex;box-sizing:border-box;border-bottom:1px solid var(--tl-t-line);cursor:pointer}" +
    ".tl-grid-row:focus-visible{outline:2px solid var(--tl-t-focus);outline-offset:-2px}" +
    ".tl-grid-cell,.tl-grid-header{box-sizing:border-box;padding:0 6px;display:flex;align-items:center;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}" +
    ".tl-grid-cell--name,.tl-grid-header--name{flex:1 1 auto;min-width:0}" +
    ".tl-grid--vertical .tl-grid-head,.tl-grid--vertical .tl-grid-row{flex-direction:column}" +
    ".tl-grid--vertical .tl-grid-cell,.tl-grid--vertical .tl-grid-header{writing-mode:vertical-rl;padding:6px 0}"
  );
}

function sampleOf(event: KeyboardEvent): KeySample {
  return { key: event.key, shiftKey: event.shiftKey, altKey: event.altKey, ctrlKey: event.ctrlKey, metaKey: event.metaKey, time: event.timeStamp };
}

/**
 * Mount a task grid in `container`, following `timeline`. The container is
 * the grid's box: give it the timeline's height (across a horizontal
 * timeline) and the width the columns need.
 */
export function mountTaskGrid<T>(container: HTMLElement, timeline: Timeline<T>, options: TaskGridOptions<T> = {}): TaskGrid {
  const doc = container.ownerDocument;
  const columns =
    options.columns ??
    defaultTaskColumns<T>({
      ...(options.strings === undefined ? {} : { strings: options.strings }),
      ...(options.locale === undefined ? {} : { locale: options.locale }),
      ...(options.timeZone === undefined ? {} : { timeZone: options.timeZone }),
    });
  const grid = doc.createElement("div");
  grid.setAttribute("role", "grid");
  grid.setAttribute("aria-label", options.label ?? fill(resolveStrings(options.strings).tasks, {}, options.locale));
  grid.setAttribute("aria-colcount", String(columns.length));
  const style = doc.createElement("style");
  style.textContent = taskGridCss();
  const head = doc.createElement("div");
  head.className = "tl-grid-head";
  head.setAttribute("role", "row");
  head.setAttribute("aria-rowindex", "1");
  for (const column of columns) {
    const cell = doc.createElement("div");
    cell.className = `tl-grid-header tl-grid-header--${column.id}`;
    cell.setAttribute("role", "columnheader");
    cell.textContent = column.header;
    if (column.width !== undefined) cell.style.flex = `0 0 ${String(column.width)}px`;
    head.append(cell);
  }
  const body = doc.createElement("div");
  body.className = "tl-grid-body";
  body.setAttribute("role", "rowgroup");
  grid.append(style, head, body);
  container.append(grid);

  /** Rows in the document, by position among all rows. */
  const shown = new Map<number, HTMLElement>();
  let focusedIndex = 0;
  let pendingFocus = false;
  let lastKey = "";
  let orientation: Orientation = "horizontal";
  let total = 0;
  let pageRows = 10;
  let lastLayout = timeline.getLayout();

  function laneAt(index: number): { readonly lane: Lane; readonly first: LayoutItem<T> | undefined } | undefined {
    const layout = timeline.getLayout();
    const laid = layout?.lanes[index];
    if (layout === undefined || laid === undefined) return undefined;
    return { lane: laid.lane, first: layout.items.find((placed) => placed.laneId === laid.lane.id) };
  }

  function makeRow(): HTMLElement {
    const row = doc.createElement("div");
    row.className = "tl-grid-row";
    row.setAttribute("role", "row");
    for (const column of columns) {
      const cell = doc.createElement("div");
      cell.className = `tl-grid-cell tl-grid-cell--${column.id}`;
      cell.setAttribute("role", "gridcell");
      if (column.width !== undefined) cell.style.flex = `0 0 ${String(column.width)}px`;
      row.append(cell);
    }
    return row;
  }

  function place(element: HTMLElement, row: TaskGridRow<T>, inset: number): void {
    const at = row.cross - inset;
    element.style.cssText =
      orientation === "horizontal"
        ? `top:${String(at)}px;left:0;right:0;height:${String(row.crossSize)}px`
        : `left:${String(at)}px;top:0;bottom:0;width:${String(row.crossSize)}px`;
    element.setAttribute("aria-rowindex", String(row.index));
    element.dataset.tlLane = row.lane.lane.id;
    element.tabIndex = row.index - 2 === focusedIndex ? 0 : -1;
    const context: TaskGridRowContext<T> = { lane: row.lane.lane, items: row.items.map((placed) => placed.item) };
    columns.forEach((column, at) => {
      const cell = element.children[at] as HTMLElement;
      const text = column.value(context);
      if (cell.textContent !== text) cell.textContent = text;
    });
  }

  function render(force = false): void {
    const layout = timeline.getLayout();
    const snapshot = timeline.getSnapshot();
    const viewport = snapshot.viewport;
    if (layout === undefined || viewport === undefined) return;
    orientation = snapshot.orientation;
    const inset = (timeline.metrics ?? densityMetrics(snapshot.density, orientation)).axisSize;
    const key = `${String(snapshot.crossOffset)}|${orientation}|${snapshot.density}|${String(viewport.crossSize)}|${String(focusedIndex)}`;
    if (!force && !pendingFocus && key === lastKey && layout === lastLayout) return;
    lastKey = key;
    lastLayout = layout;
    const resolved = resolveTheme(options.theme ?? "auto");
    const custom = resolved !== undefined && resolved !== LIGHT_THEME && resolved !== DARK_THEME;
    grid.className = `tl-grid tl-grid--${orientation}`;
    if (resolved === undefined) grid.removeAttribute("data-tl-theme");
    else grid.dataset.tlTheme = custom ? "custom" : resolved.name;
    if (custom) grid.style.cssText = tokens(resolved);
    head.style.cssText =
      orientation === "horizontal" ? `top:0;left:0;right:0;height:${String(inset)}px` : `left:0;top:0;bottom:0;width:${String(inset)}px`;
    body.style.cssText =
      orientation === "horizontal" ? `top:${String(inset)}px;left:0;right:0;bottom:0` : `left:${String(inset)}px;top:0;right:0;bottom:0`;
    const window = taskGridRows(layout, {
      crossInset: inset,
      crossOffset: snapshot.crossOffset,
      crossSize: viewport.crossSize,
      ...(options.overscan === undefined ? {} : { overscan: options.overscan }),
    });
    total = window.total;
    grid.setAttribute("aria-rowcount", String(total + 1));
    focusedIndex = Math.min(focusedIndex, Math.max(total - 1, 0));
    const rowSize = layout.lanes[0]?.crossSize ?? 1;
    pageRows = Math.max(1, Math.floor((viewport.crossSize - inset) / Math.max(rowSize, 1)) - 1);
    const keep = new Set<number>();
    for (const row of window.rows) {
      const index = row.index - 2;
      keep.add(index);
      let element = shown.get(index);
      if (element === undefined) {
        element = makeRow();
        shown.set(index, element);
        body.append(element);
      }
      place(element, row, inset);
    }
    for (const [index, element] of shown) {
      // The focused row stays while it has the focus, so the keyboard is not dropped.
      if (!keep.has(index) && !(index === focusedIndex && element.contains(doc.activeElement))) {
        element.remove();
        shown.delete(index);
      }
    }
    if (pendingFocus) {
      const target = shown.get(focusedIndex);
      if (target !== undefined && keep.has(focusedIndex)) {
        target.focus({ preventScroll: true });
        pendingFocus = false;
      }
    }
  }

  function focusRow(index: number): void {
    focusedIndex = index;
    const at = laneAt(index);
    if (at !== undefined) timeline.revealLane(at.lane.id);
    pendingFocus = true;
    render(true);
  }

  /** The one place a row is opened — for `Enter` and a click alike. */
  function open(index: number): void {
    const at = laneAt(index);
    if (at?.first === undefined) return;
    if (timeline.focusItem(at.first.item.id)) options.focusTarget?.focus({ preventScroll: true });
  }

  function rowIndexOf(target: EventTarget | null): number | undefined {
    const row = target instanceof Element ? target.closest<HTMLElement>(".tl-grid-row") : null;
    const index = row?.getAttribute("aria-rowindex");
    return index === null || index === undefined ? undefined : Number(index) - 2;
  }

  function onKey(event: KeyboardEvent): void {
    if (event.defaultPrevented) return;
    const action = resolveGridKey(sampleOf(event), orientation);
    if (action === undefined) return;
    event.preventDefault();
    if (action === "open") {
      open(focusedIndex);
      return;
    }
    const next = gridKeyStep(total, focusedIndex, action, pageRows);
    if (next !== undefined) focusRow(next);
  }

  function onClick(event: MouseEvent): void {
    const index = rowIndexOf(event.target);
    if (index === undefined) return;
    focusedIndex = index;
    render(true);
    open(index);
  }

  function onWheel(event: WheelEvent): void {
    if (event.ctrlKey || event.metaKey) return;
    const delta = orientation === "horizontal" ? event.deltaY : event.deltaX || event.deltaY;
    if (delta === 0) return;
    event.preventDefault();
    timeline.scrollLanes(event.deltaMode === 1 ? delta * 16 : delta);
  }

  function afterFrame(): void {
    const view = doc.defaultView;
    if (view === null) render(true);
    else view.requestAnimationFrame(() => {
      render(true);
    });
  }

  grid.addEventListener("keydown", onKey);
  grid.addEventListener("click", onClick);
  grid.addEventListener("wheel", onWheel, { passive: false });
  const stops = [
    timeline.subscribe(() => {
      render();
    }),
    timeline.on("layoutChanged", () => {
      render(true);
    }),
    // A toggle, a reorder or an edit is announced before the frame that shows
    // it: draw after that frame, whose callback was asked for first.
    timeline.on("groupToggle", afterFrame),
    timeline.on("groupCommand", afterFrame),
    timeline.on("command", afterFrame),
  ];
  render(true);

  return {
    update() {
      render(true);
    },
    get focusedIndex() {
      return focusedIndex;
    },
    destroy() {
      for (const stop of stops) stop();
      grid.removeEventListener("keydown", onKey);
      grid.removeEventListener("click", onClick);
      grid.removeEventListener("wheel", onWheel);
      grid.remove();
      shown.clear();
    },
  };
}
