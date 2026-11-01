/**
 * The backlog: the tasks not on the timeline yet, beside it.
 *
 * A list the host puts next to the timeline, of the tasks it hands over that
 * no item has the id of (`unscheduledTasks` of
 * `@temporeum/timeline-core/resources`). A task leaves the list by being
 * placed, and comes back when the place is undone — the list follows the
 * timeline's items (`itemsChanged`), so there is nothing to keep in step.
 *
 * Two ways to place a task, one command. Dragging a row onto the timeline —
 * with a mouse, a pen or a finger, one pointer path for all three — asks the
 * timeline to add it where it was let go (`dropItemAt`): the time under the
 * pointer, the lane under it. `Enter` or `Space` on a row asks it to add it
 * where the keyboard is (`dropItem`): the middle of the view, in the
 * focused item's lane. Either way the timeline makes the same `add` command,
 * selects the new item and puts its focus on it, so the keys that move an
 * item in time and between lanes take over from there.
 *
 * `role="listbox"` with `aria-activedescendant`: the list takes the focus,
 * the arrows walk its rows, `Home` and `End` jump. Nothing is saved: the
 * host keeps the command, as for every other edit.
 */

import { DARK_THEME, LIGHT_THEME, resolveTheme } from "@temporeum/timeline-core";
import type { Item, Theme, ThemeSetting } from "@temporeum/timeline-core";
import { unscheduledTasks } from "@temporeum/timeline-core/resources";
import type { BacklogTask } from "@temporeum/timeline-core/resources";
import { resolveStrings, sayIn } from "@temporeum/timeline-core/words";
import type { Strings } from "@temporeum/timeline-core/words";

import type { Timeline } from "./timeline.js";

/** How a backlog is set up. */
export interface BacklogOptions<T = unknown> {
  /** Every task that could be on the timeline; those that are not yet are listed. */
  readonly tasks: readonly BacklogTask<T>[];
  /** The list's accessible name. */
  readonly label?: string;
  /** A row's text. The task's label and its length by default. */
  readonly describe?: (task: BacklogTask<T>) => string;
  /** What the list says when every task is placed. */
  readonly empty?: string;
  /** Movement in pixels before a press on a row becomes a drag. 6 by default. */
  readonly dragThreshold?: number;
  readonly theme?: ThemeSetting;
  /** Where the keyboard goes after `Enter` placed a task: the timeline's element. */
  readonly focusTarget?: HTMLElement;
  /**
   * The list's words in the host's language: `backlog`, `backlogEmpty`,
   * `backlogTask` and the `duration*` phrases of `DEFAULT_STRINGS` (`/intl`),
   * with numbers in `locale`. `label`, `empty` and `describe` still win.
   */
  readonly strings?: Partial<Strings>;
  readonly locale?: string;
}

/** A mounted backlog. */
export interface Backlog<T = unknown> {
  /** Hand over another list of tasks. */
  update(tasks: readonly BacklogTask<T>[]): void;
  /** The tasks listed now: those not on the timeline. */
  readonly tasks: readonly BacklogTask<T>[];
  destroy(): void;
}

const HOUR = 3_600_000;

/** A length as people say it: "3 d", "4 h", "30 min". */
function lengthOf(ms: number): string {
  if (ms >= 24 * HOUR && ms % (24 * HOUR) === 0) return `${String(ms / (24 * HOUR))} d`;
  if (ms >= HOUR) return `${String(Math.round((ms / HOUR) * 10) / 10)} h`;
  return `${String(Math.round(ms / 60_000))} min`;
}

/** A row's default text: the label, and the length when there is one — in a dictionary's words when given one. */
export function describeBacklogTask<T>(task: BacklogTask<T>, say?: (key: keyof Strings, values?: Readonly<Record<string, string | number>>) => string): string {
  const name = task.label ?? task.id;
  const ms = task.durationMs;
  if (ms === undefined) return name;
  if (say === undefined) return `${name}, ${lengthOf(ms)}`;
  const length =
    ms >= 24 * HOUR && ms % (24 * HOUR) === 0
      ? say("durationDays", { count: ms / (24 * HOUR) })
      : ms >= HOUR
        ? say("durationHours", { count: Math.round((ms / HOUR) * 10) / 10 })
        : say("durationMinutes", { count: Math.round(ms / 60_000) });
  return say("backlogTask", { name, length });
}

function tokens(theme: Theme): string {
  const used = ["text", "textMuted", "surface", "surfaceAlt", "line", "focus", "itemFill", "itemStroke"] as const;
  return used.map((name) => `--tl-b-${name}:${theme.tokens[name]}`).join(";");
}

/** The backlog's stylesheet, with the theme's colours: the list is outside the drawing that holds them. */
export function backlogCss(): string {
  return (
    `.tl-backlog{box-sizing:border-box;height:100%;overflow:auto;font:12px/1.3 system-ui,sans-serif;color:var(--tl-b-text);` +
    `background:var(--tl-b-surface);box-shadow:inset 0 0 0 1px var(--tl-b-line);${tokens(LIGHT_THEME)}}` +
    `@media (prefers-color-scheme:dark){.tl-backlog:not([data-tl-theme="light"]){${tokens(DARK_THEME)}}}` +
    `.tl-backlog[data-tl-theme="dark"]{${tokens(DARK_THEME)}}` +
    ".tl-backlog-list{list-style:none;margin:0;padding:4px;outline:none}" +
    ".tl-backlog-list:focus-visible{box-shadow:inset 0 0 0 2px var(--tl-b-focus)}" +
    // pan-y: a finger moving down the list scrolls it; one moving across drags the row out.
    ".tl-backlog-item{box-sizing:border-box;min-height:32px;margin:0 0 4px;padding:6px 8px;border:1px solid var(--tl-b-itemStroke);" +
    "border-radius:4px;background:var(--tl-b-itemFill);cursor:grab;touch-action:pan-y;user-select:none;-webkit-user-select:none}" +
    ".tl-backlog-item[aria-selected=true]{outline:2px solid var(--tl-b-focus);outline-offset:1px}" +
    ".tl-backlog-empty{padding:8px;color:var(--tl-b-textMuted)}" +
    ".tl-backlog-ghost{position:fixed;z-index:2147483647;pointer-events:none;opacity:.85;cursor:grabbing;box-shadow:0 2px 8px rgba(0,0,0,.25)}"
  );
}

/**
 * Put the keyboard in the timeline: the target, when it takes the focus,
 * else the first thing in it — or in its shadow root — that does. A
 * `createTimeline` container is a plain element; its drawing is what is
 * focusable.
 */
function focusInto(target: HTMLElement | undefined): void {
  if (target === undefined) return;
  const inner = target.hasAttribute("tabindex") ? target : (target.querySelector<HTMLElement | SVGElement>("[tabindex]") ?? target.shadowRoot?.querySelector<HTMLElement | SVGElement>("[tabindex]"));
  (inner ?? target).focus({ preventScroll: true });
}

let backlogCount = 0;

/**
 * Mount a backlog in `container`, placing its tasks on `timeline`. The
 * timeline needs `editing: { enabled: true, drop: true }`: a timeline that
 * does not take drops takes no task.
 */
export function mountBacklog<T>(container: HTMLElement, timeline: Timeline<T>, options: BacklogOptions<T>): Backlog<T> {
  const doc = container.ownerDocument;
  const prefix = `tl-backlog-${String((backlogCount += 1))}`;
  const say = options.strings === undefined ? undefined : sayIn(resolveStrings(options.strings), options.locale);
  const describe = options.describe ?? ((task: BacklogTask<T>) => describeBacklogTask(task, say));
  const threshold = options.dragThreshold ?? 6;
  const box = doc.createElement("div");
  box.className = "tl-backlog";
  const resolved = options.theme === undefined ? undefined : resolveTheme(options.theme);
  if (resolved !== undefined) {
    const custom = resolved !== LIGHT_THEME && resolved !== DARK_THEME;
    box.dataset.tlTheme = custom ? "custom" : resolved.name;
    if (custom) box.style.cssText = tokens(resolved);
  }
  const style = doc.createElement("style");
  style.textContent = backlogCss();
  const list = doc.createElement("ul");
  list.className = "tl-backlog-list";
  list.setAttribute("role", "listbox");
  list.setAttribute("aria-label", options.label ?? say?.("backlog") ?? "Unscheduled tasks");
  list.tabIndex = 0;
  const empty = doc.createElement("div");
  empty.className = "tl-backlog-empty";
  empty.textContent = options.empty ?? say?.("backlogEmpty") ?? "Nothing left to schedule";
  box.append(style, list, empty);
  container.append(box);

  let all = options.tasks;
  let shown: readonly BacklogTask<T>[] = [];
  let active = 0;
  let destroyed = false;

  function rowId(index: number): string {
    return `${prefix}-${String(index)}`;
  }

  function draw(): void {
    shown = unscheduledTasks(all, timeline.items);
    active = Math.min(active, Math.max(shown.length - 1, 0));
    const rows = shown.map((task, index) => {
      const row = doc.createElement("li");
      row.className = "tl-backlog-item";
      row.id = rowId(index);
      row.setAttribute("role", "option");
      row.setAttribute("aria-selected", String(index === active));
      row.dataset.tlTask = task.id;
      row.textContent = describe(task);
      return row;
    });
    list.replaceChildren(...rows);
    if (shown.length === 0) list.removeAttribute("aria-activedescendant");
    else list.setAttribute("aria-activedescendant", rowId(active));
    empty.hidden = shown.length > 0;
  }

  function activate(index: number): void {
    if (shown.length === 0) return;
    active = Math.min(Math.max(index, 0), shown.length - 1);
    for (const [at, row] of [...list.children].entries()) row.setAttribute("aria-selected", String(at === active));
    list.setAttribute("aria-activedescendant", rowId(active));
    list.children[active]?.scrollIntoView({ block: "nearest" });
  }

  /** What the timeline adds: the task, without the list's own fields. */
  function payloadOf(task: BacklogTask<T>): Partial<Item<T>> & { readonly durationMs?: number } {
    return task as Partial<Item<T>> & { readonly durationMs?: number };
  }

  function onKey(event: KeyboardEvent): void {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    let handled = true;
    switch (event.key) {
      case "ArrowDown":
      case "ArrowRight":
        activate(active + 1);
        break;
      case "ArrowUp":
      case "ArrowLeft":
        activate(active - 1);
        break;
      case "Home":
        activate(0);
        break;
      case "End":
        activate(shown.length - 1);
        break;
      case "Enter":
      case " ": {
        const task = shown[active];
        if (task !== undefined && timeline.dropItem(payloadOf(task))) focusInto(options.focusTarget);
        break;
      }
      default:
        handled = false;
    }
    if (handled) event.preventDefault();
  }

  // --- the drag: one pointer path for a mouse, a pen and a finger ------------

  let press: { readonly pointerId: number; readonly x: number; readonly y: number; readonly task: BacklogTask<T>; readonly row: HTMLElement } | undefined;
  let ghost: HTMLElement | undefined;

  function rowOf(target: EventTarget | null): HTMLElement | undefined {
    const row = target instanceof Element ? target.closest(".tl-backlog-item") : null;
    return row instanceof HTMLElement && list.contains(row) ? row : undefined;
  }

  function onPointerDown(event: PointerEvent): void {
    if (event.button !== 0 || press !== undefined) return;
    const row = rowOf(event.target);
    const index = row === undefined ? -1 : [...list.children].indexOf(row);
    const task = shown[index];
    if (row === undefined || task === undefined) return;
    activate(index);
    list.focus({ preventScroll: true });
    press = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, task, row };
  }

  function onPointerMove(event: PointerEvent): void {
    if (press === undefined || event.pointerId !== press.pointerId) return;
    if (ghost === undefined) {
      if (Math.hypot(event.clientX - press.x, event.clientY - press.y) < threshold) return;
      // Past the threshold: the row is being dragged out.
      press.row.setPointerCapture(event.pointerId);
      const rect = press.row.getBoundingClientRect();
      ghost = press.row.cloneNode(true) as HTMLElement;
      ghost.removeAttribute("id");
      ghost.removeAttribute("role");
      ghost.setAttribute("aria-hidden", "true");
      ghost.classList.add("tl-backlog-ghost");
      ghost.style.width = `${String(rect.width)}px`;
      box.append(ghost);
    }
    event.preventDefault();
    ghost.style.left = `${String(event.clientX + 8)}px`;
    ghost.style.top = `${String(event.clientY + 8)}px`;
  }

  function endDrag(event: PointerEvent, drop: boolean): void {
    if (press === undefined || event.pointerId !== press.pointerId) return;
    const task = press.task;
    const dragged = ghost !== undefined;
    ghost?.remove();
    ghost = undefined;
    press = undefined;
    if (drop && dragged) timeline.dropItemAt(payloadOf(task), { clientX: event.clientX, clientY: event.clientY });
  }

  function onPointerUp(event: PointerEvent): void {
    endDrag(event, true);
  }

  function onPointerCancel(event: PointerEvent): void {
    endDrag(event, false);
  }

  list.addEventListener("keydown", onKey);
  list.addEventListener("pointerdown", onPointerDown);
  list.addEventListener("pointermove", onPointerMove);
  list.addEventListener("pointerup", onPointerUp);
  list.addEventListener("pointercancel", onPointerCancel);
  const stop = timeline.on("itemsChanged", draw);
  draw();

  return {
    update(tasks) {
      all = tasks;
      draw();
    },
    get tasks() {
      return shown;
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      stop();
      ghost?.remove();
      box.remove();
    },
  };
}
