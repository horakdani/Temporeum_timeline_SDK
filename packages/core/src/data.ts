/**
 * Items fetched per window: the data half of a timeline that does not fit in
 * memory.
 *
 * {@link ItemsSource} may be a function — `(domain, signal) =>
 * Promise<Item[]>` — and this file is what makes that form real. A loader
 * sits between the host's function and the renderer: the host tells it what
 * domain it is about to draw, the loader asks the source for the windows that
 * domain needs, and the renderer gets back one plain array of items plus the
 * ranges still missing. The library still never touches the network; the
 * source is the host's.
 *
 * Three decisions carry the file:
 *
 * 1. **Windows are aligned in time, in powers of two.** A view of span `s`
 *    asks for windows of `2^ceil(log2(s / 2))` milliseconds, each starting at
 *    a whole multiple of its size. So windows nest exactly — one window holds
 *    precisely two of the level below — and a zoom in is served from the
 *    window already loaded, without a request. A pan reuses every window the
 *    view still overlaps.
 * 2. **An aborted request never shows.** A window's request is aborted the
 *    moment the window stops being needed, and a result that arrives after
 *    that is dropped — also when the source ignored the signal and answered
 *    anyway, which a server that cannot cancel will do. Nothing of it is
 *    cached, so nothing of it can be drawn. That is the promise the async
 *    tests check, against a deliberately naive loader as its negative control.
 * 3. **Nothing here draws or waits.** The loader holds no timer and reads no
 *    clock: a request is cheap enough to make on every frame, and what is
 *    loading comes back as data for the renderer to show on the axis.
 */

import { applyPatches } from "./editing.js";
import { Emitter } from "./emitter.js";
import type { Unsubscribe } from "./emitter.js";
import { MAX_TIME_MS } from "./scale.js";
import { toTimeMs } from "./time.js";
import type { Domain, Item, ItemPatch, ItemsSource, TimeInput, TimeMs } from "./types.js";

/** A range of time the view needs and does not have yet. */
export interface LoadingRange {
  readonly start: TimeMs;
  readonly end: TimeMs;
  /** The request for it failed; it is not being retried until asked. */
  readonly failed?: boolean;
}

/** Why the loader's items or loading ranges changed. */
export type ItemLoaderChangeReason = "loaded" | "failed" | "applied" | "invalidated" | "retried";

/** What a loader tells its subscribers. */
export interface ItemLoaderChange {
  readonly reason: ItemLoaderChangeReason;
  /** The window that arrived or failed. */
  readonly window?: Domain;
  /** What the source rejected with, for `failed`. */
  readonly error?: unknown;
}

/** What the loader did, cumulatively. */
export interface ItemLoaderStats {
  /** Requests handed to the source. */
  readonly started: number;
  /** Windows that arrived and were kept. */
  readonly loaded: number;
  /** Requests aborted: the window was no longer needed, invalidated, or the loader destroyed. */
  readonly aborted: number;
  /** Results that arrived after their request was aborted, and were dropped. */
  readonly discarded: number;
  /** Requests the source rejected. */
  readonly failed: number;
  /** Windows dropped to stay within {@link ItemLoaderOptions.maxWindows}. */
  readonly evicted: number;
  /** Windows held now. */
  readonly windows: number;
  /** Requests running now. */
  readonly inFlight: number;
}

/** How a loader is set up. */
export interface ItemLoaderOptions<T = unknown> {
  /** The items, or the host's function that fetches one window of them. */
  readonly source: ItemsSource<T>;
  /** Most windows held. {@link DEFAULT_MAX_WINDOWS} by default. */
  readonly maxWindows?: number;
  /**
   * How far past each edge of the view to fetch, as a fraction of its span.
   * {@link DEFAULT_LOAD_OVERSCAN} by default, so a pan finds its data waiting.
   */
  readonly overscan?: number;
}

/** A source of items for the renderer, loaded per window. */
export interface ItemLoader<T = unknown> {
  /**
   * The view is about to show this domain: fetch what it needs, abort what
   * it no longer does. Cheap when nothing changed, so it can run every frame.
   * Never notifies — the caller is already drawing.
   */
  request(domain: readonly [TimeInput, TimeInput]): void;
  /**
   * Every item held, once each. The same array until something arrives, is
   * dropped or is edited, so the renderer's caches survive a pan.
   */
  readonly items: readonly Item<T>[];
  /** What the last requested domain still lacks, merged into ranges. */
  readonly loading: readonly LoadingRange[];
  /** Whether any request is running. */
  readonly busy: boolean;
  readonly stats: ItemLoaderStats;
  /** Called when items or loading ranges changed without a `request`. */
  subscribe(listener: (change: ItemLoaderChange) => void): Unsubscribe;
  /**
   * Apply an edit to the items held — a command's `after`, or its inverse
   * for an undo. Also replayed on every request already running, so a late
   * answer from before the edit cannot undo it.
   */
  apply(patches: readonly ItemPatch[]): void;
  /** Forget what is held (in this range, or everywhere) and fetch it again. */
  invalidate(range?: readonly [TimeInput, TimeInput]): void;
  /** Fetch the failed windows again. */
  retry(): void;
  /** Abort everything and stop. */
  destroy(): void;
}

/** Windows held by default: a few dozen views' worth. */
export const DEFAULT_MAX_WINDOWS = 64;

/** Fraction of the view span fetched past each edge by default. */
export const DEFAULT_LOAD_OVERSCAN = 0.5;

/** The coarsest level: one window spans more than the whole representable range. */
const MAX_LEVEL = 54;

/** How many levels below a window to look for children that already cover it. */
const CHILD_DEPTH = 2;

interface WindowRef {
  readonly key: string;
  readonly level: number;
  readonly index: number;
  readonly start: TimeMs;
  readonly end: TimeMs;
}

interface HeldWindow<T> extends WindowRef {
  items: readonly Item<T>[];
  /** Arrival order: a later window's copy of an item wins. */
  readonly seq: number;
  lastUsed: number;
}

interface Fetch {
  readonly window: WindowRef;
  readonly controller: AbortController;
  /** The last edit applied before it started; later ones are replayed on it. */
  readonly patchSeq: number;
}

function windowOf(level: number, index: number): WindowRef {
  const size = 2 ** level;
  return {
    key: `${String(level)}:${String(index)}`,
    level,
    index,
    start: Math.max(index * size, -MAX_TIME_MS),
    end: Math.min((index + 1) * size, MAX_TIME_MS),
  };
}

/** The level whose windows are about half a view wide. */
function levelFor(span: number): number {
  return Math.min(Math.max(Math.ceil(Math.log2(Math.max(span / 2, 1))), 0), MAX_LEVEL);
}

function overlaps(a: { start: number; end: number }, start: number, end: number): boolean {
  return a.start < end && a.end > start;
}

/**
 * A loader over a source.
 *
 * An array source is held as it is: `items` is that array, nothing is ever
 * loading, and a host can use one code path for both forms.
 */
export function createItemLoader<T = unknown>(options: ItemLoaderOptions<T>): ItemLoader<T> {
  const source = options.source;
  const maxWindows = options.maxWindows ?? DEFAULT_MAX_WINDOWS;
  const overscan = options.overscan ?? DEFAULT_LOAD_OVERSCAN;
  if (!(Number.isInteger(maxWindows) && maxWindows >= 1)) {
    throw new RangeError(`maxWindows must be a positive integer, got ${String(maxWindows)}`);
  }
  if (!(Number.isFinite(overscan) && overscan >= 0)) {
    throw new RangeError(`overscan must be a finite number of at least 0, got ${String(overscan)}`);
  }

  const emitter = new Emitter<{ change: ItemLoaderChange }>();
  const held = new Map<string, HeldWindow<T>>();
  const inFlight = new Map<string, Fetch>();
  const failed = new Map<string, unknown>();
  const patchLog: { readonly seq: number; readonly patches: readonly ItemPatch[] }[] = [];
  const counts = { started: 0, loaded: 0, aborted: 0, discarded: 0, failed: 0, evicted: 0 };
  let arrayItems: readonly Item<T>[] | undefined = typeof source === "function" ? undefined : source;
  let destroyed = false;
  let tick = 0;
  let loadSeq = 0;
  let patchSeq = 0;
  let version = 0;
  let merged: { version: number; items: readonly Item<T>[] } | undefined;
  let loading: readonly LoadingRange[] = [];
  /** The last request: the level, the index range, and the time range it covers. */
  let last: { level: number; first: number; last: number; from: number; to: number } | undefined;

  const emit = (change: ItemLoaderChange): void => {
    emitter.emit("change", change);
  };

  function coveredAbove(level: number, index: number): boolean {
    let at = index;
    for (let up = level + 1; up <= MAX_LEVEL; up += 1) {
      at = Math.floor(at / 2);
      if (held.has(`${String(up)}:${String(at)}`)) {
        return true;
      }
    }
    return false;
  }

  function coveredBelow(level: number, index: number, depth: number): boolean {
    if (held.has(`${String(level)}:${String(index)}`)) {
      return true;
    }
    return (
      depth > 0 &&
      level > 0 &&
      coveredBelow(level - 1, 2 * index, depth - 1) &&
      coveredBelow(level - 1, 2 * index + 1, depth - 1)
    );
  }

  function abort(fetch: Fetch): void {
    inFlight.delete(fetch.window.key);
    counts.aborted += 1;
    fetch.controller.abort();
  }

  function start(window: WindowRef): void {
    const controller = new AbortController();
    const fetch: Fetch = { window, controller, patchSeq };
    inFlight.set(window.key, fetch);
    counts.started += 1;
    let result: Promise<readonly Item<T>[]>;
    try {
      result = Promise.resolve((source as Exclude<ItemsSource<T>, readonly Item<T>[]>)([window.start, window.end], controller.signal));
    } catch (error: unknown) {
      result = Promise.reject(error);
    }
    result.then(
      (items) => {
        arrive(fetch, items);
      },
      (error: unknown) => {
        fail(fetch, error);
      },
    );
  }

  /** Whether a settling request is still the one the loader is waiting for. */
  function current(fetch: Fetch): boolean {
    return !destroyed && !fetch.controller.signal.aborted && inFlight.get(fetch.window.key) === fetch;
  }

  function arrive(fetch: Fetch, items: readonly Item<T>[]): void {
    if (!current(fetch)) {
      // The one rule the loader exists to keep: whatever an aborted request
      // brings back is dropped here, before it can reach the cache.
      counts.discarded += 1;
      return;
    }
    if (!Array.isArray(items)) {
      fail(fetch, new TypeError("an items source must resolve to an array of items"));
      return;
    }
    inFlight.delete(fetch.window.key);
    let list: readonly Item<T>[] = items;
    for (const entry of patchLog) {
      if (entry.seq > fetch.patchSeq) {
        list = applyPatches(list, entry.patches);
      }
    }
    const window = fetch.window;
    // A coarser window holds everything its descendants do, and is newer.
    for (const [key, other] of held) {
      if (other.level < window.level && other.start >= window.start && other.end <= window.end) {
        held.delete(key);
      }
    }
    loadSeq += 1;
    held.set(window.key, { ...window, items: list, seq: loadSeq, lastUsed: tick });
    counts.loaded += 1;
    changed();
    reconcile();
    prunePatchLog();
    emit({ reason: "loaded", window: [window.start, window.end] });
  }

  function fail(fetch: Fetch, error: unknown): void {
    if (!current(fetch)) {
      // An aborted request usually rejects with an AbortError: expected.
      return;
    }
    inFlight.delete(fetch.window.key);
    failed.set(fetch.window.key, error);
    counts.failed += 1;
    reconcile();
    prunePatchLog();
    emit({ reason: "failed", window: [fetch.window.start, fetch.window.end], error });
  }

  function changed(): void {
    version += 1;
  }

  function prunePatchLog(): void {
    let oldest = Infinity;
    for (const fetch of inFlight.values()) {
      oldest = Math.min(oldest, fetch.patchSeq);
    }
    while (patchLog.length > 0 && (patchLog[0] as { seq: number }).seq <= oldest) {
      patchLog.shift();
    }
  }

  /** Bring requests, failures and the cache in line with the last request. */
  function reconcile(): void {
    if (last === undefined || destroyed) {
      return;
    }
    tick += 1;
    const center = (last.from + last.to) / 2;
    const missing: WindowRef[] = [];
    for (let index = last.first; index <= last.last; index += 1) {
      if (!coveredAbove(last.level, index) && !coveredBelow(last.level, index, CHILD_DEPTH)) {
        missing.push(windowOf(last.level, index));
      }
    }
    const needed = new Set(missing.map((window) => window.key));
    for (const fetch of [...inFlight.values()]) {
      if (!needed.has(fetch.window.key)) {
        abort(fetch);
      }
    }
    // A failure is remembered while its window stays needed, so a broken
    // server is not hammered every frame; once the view leaves, coming back
    // asks again.
    for (const key of [...failed.keys()]) {
      if (!needed.has(key)) {
        failed.delete(key);
      }
    }
    // The middle of the view first: it is what the reader is looking at.
    const order = [...missing].sort(
      (a, b) => Math.abs((a.start + a.end) / 2 - center) - Math.abs((b.start + b.end) / 2 - center) || a.index - b.index,
    );
    for (const window of order) {
      if (!inFlight.has(window.key) && !failed.has(window.key)) {
        start(window);
      }
    }
    // Everything the request overlaps is in use; the rest ages.
    for (const window of held.values()) {
      if (overlaps(window, last.from, last.to)) {
        window.lastUsed = tick;
      }
    }
    if (held.size > maxWindows) {
      const byAge = [...held.values()].filter((window) => window.lastUsed !== tick).sort((a, b) => a.lastUsed - b.lastUsed || a.seq - b.seq);
      for (const window of byAge) {
        if (held.size <= maxWindows) {
          break;
        }
        held.delete(window.key);
        counts.evicted += 1;
        version += 1;
      }
    }
    const ranges: { start: number; end: number; failed?: boolean }[] = [];
    for (const window of missing) {
      const isFailed = failed.has(window.key);
      const previous = ranges[ranges.length - 1];
      if (previous !== undefined && previous.end === window.start && (previous.failed === true) === isFailed) {
        previous.end = window.end;
      } else {
        ranges.push(isFailed ? { start: window.start, end: window.end, failed: true } : { start: window.start, end: window.end });
      }
    }
    loading = ranges;
  }

  function mergedItems(): readonly Item<T>[] {
    if (arrayItems !== undefined) {
      return arrayItems;
    }
    if (merged !== undefined && merged.version === version) {
      return merged.items;
    }
    const byId = new Map<string, Item<T>>();
    for (const window of [...held.values()].sort((a, b) => a.seq - b.seq)) {
      for (const item of window.items) {
        byId.set(item.id, item);
      }
    }
    merged = { version, items: [...byId.values()] };
    return merged.items;
  }

  return {
    request(domain) {
      if (arrayItems !== undefined || destroyed) {
        return;
      }
      const from = toTimeMs(domain[0]);
      const to = toTimeMs(domain[1]);
      if (!(Number.isFinite(from) && Number.isFinite(to) && to > from)) {
        throw new RangeError("request needs two finite instants, the second after the first");
      }
      const span = to - from;
      const level = levelFor(span);
      const size = 2 ** level;
      const lo = Math.max(from - overscan * span, -MAX_TIME_MS);
      const hi = Math.min(to + overscan * span, MAX_TIME_MS);
      const first = Math.floor(lo / size);
      const lastIndex = Math.max(Math.ceil(hi / size) - 1, first);
      // Every change to what is held reconciles on the spot, so the same
      // windows as last time need nothing more than the new extent.
      if (last !== undefined && last.level === level && last.first === first && last.last === lastIndex) {
        last = { level, first, last: lastIndex, from: lo, to: hi };
        return;
      }
      last = { level, first, last: lastIndex, from: lo, to: hi };
      reconcile();
    },
    get items() {
      return mergedItems();
    },
    get loading() {
      return loading;
    },
    get busy() {
      return inFlight.size > 0;
    },
    get stats() {
      return { ...counts, windows: held.size, inFlight: inFlight.size };
    },
    subscribe(listener) {
      return emitter.on("change", listener);
    },
    apply(patches) {
      if (destroyed || patches.length === 0) {
        return;
      }
      if (arrayItems !== undefined) {
        arrayItems = applyPatches(arrayItems, patches);
      } else {
        for (const window of held.values()) {
          window.items = applyPatches(window.items, patches);
        }
        if (inFlight.size > 0) {
          patchSeq += 1;
          patchLog.push({ seq: patchSeq, patches });
        }
        version += 1;
      }
      emit({ reason: "applied" });
    },
    invalidate(range) {
      if (destroyed) {
        return;
      }
      if (arrayItems !== undefined) {
        emit({ reason: "invalidated" });
        return;
      }
      const from = range === undefined ? -Infinity : toTimeMs(range[0]);
      const to = range === undefined ? Infinity : toTimeMs(range[1]);
      for (const [key, window] of held) {
        if (overlaps(window, from, to)) {
          held.delete(key);
        }
      }
      for (const fetch of [...inFlight.values()]) {
        if (overlaps(fetch.window, from, to)) {
          abort(fetch);
        }
      }
      for (const key of [...failed.keys()]) {
        const [level, index] = key.split(":").map(Number) as [number, number];
        if (overlaps(windowOf(level, index), from, to)) {
          failed.delete(key);
        }
      }
      changed();
      reconcile();
      prunePatchLog();
      emit({ reason: "invalidated" });
    },
    retry() {
      if (destroyed || failed.size === 0) {
        return;
      }
      failed.clear();
      reconcile();
      emit({ reason: "retried" });
    },
    destroy() {
      if (destroyed) {
        return;
      }
      for (const fetch of [...inFlight.values()]) {
        abort(fetch);
      }
      destroyed = true;
      held.clear();
      failed.clear();
      patchLog.length = 0;
      loading = [];
      emitter.clear();
      version += 1;
    },
  };
}
