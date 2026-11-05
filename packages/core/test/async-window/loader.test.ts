import { describe, expect, it } from "vitest";

import { createItemLoader, DEFAULT_LOAD_OVERSCAN, DEFAULT_MAX_WINDOWS } from "../../src/data.js";
import type { ItemLoaderChange } from "../../src/data.js";
import type { Item } from "../../src/types.js";
import { makeRandom } from "../property/harness.js";
import { controlledSource, DAY, flush, ORIGIN } from "./fixture.js";

/**
 * The loader's contract, claim by claim. Every title carries a `[claim:…]`
 * tag; `sdk_check_async.mjs` requires each one green.
 */

const item = (id: string, start: number, end?: number): Item<{ fetch: number }> => ({
  id,
  start,
  ...(end === undefined ? {} : { end }),
  data: { fetch: -1 },
});

const SPAN = 30 * DAY;
const view = (offset = 0, span = SPAN): readonly [number, number] => [ORIGIN + offset, ORIGIN + offset + span];

describe("windows", () => {
  it("[claim:windows-nest] asks for whole power-of-two windows covering the view and its overscan", () => {
    const { calls, source } = controlledSource();
    const loader = createItemLoader({ source });
    loader.request(view());
    expect(calls.length).toBeGreaterThan(0);
    const size = calls[0]!.domain[1] - calls[0]!.domain[0];
    // A power of two between half a view and a whole one.
    expect(Math.log2(size) % 1).toBe(0);
    expect(size).toBeGreaterThanOrEqual(SPAN / 2);
    expect(size).toBeLessThan(SPAN);
    for (const call of calls) {
      expect(call.domain[1] - call.domain[0]).toBe(size);
      expect(call.domain[0] % size).toBe(0);
    }
    const covered = [Math.min(...calls.map((call) => call.domain[0])), Math.max(...calls.map((call) => call.domain[1]))];
    expect(covered[0]).toBeLessThanOrEqual(ORIGIN - DEFAULT_LOAD_OVERSCAN * SPAN);
    expect(covered[1]).toBeGreaterThanOrEqual(ORIGIN + SPAN + DEFAULT_LOAD_OVERSCAN * SPAN);
    // The middle of the view is asked for first, then outwards.
    const centre = ORIGIN + SPAN / 2;
    const distances = calls.map((call) => Math.abs((call.domain[0] + call.domain[1]) / 2 - centre));
    expect(distances).toEqual([...distances].sort((a, b) => a - b));
    expect(distances[0]).toBeLessThanOrEqual(size / 2);
  });

  it("[claim:windows-nest] the same request twice asks for nothing new, and is cheap", () => {
    const { calls, source } = controlledSource();
    const loader = createItemLoader({ source });
    loader.request(view());
    const asked = calls.length;
    loader.request(view());
    loader.request(view(1000));
    expect(calls.length).toBe(asked);
    expect(loader.stats.aborted).toBe(0);
  });

  it("[claim:windows-nest] fetches as far past each edge as the overscan asks", () => {
    const { calls, source } = controlledSource();
    const loader = createItemLoader({ source, overscan: 2 });
    loader.request(view());
    expect(Math.min(...calls.map((call) => call.domain[0]))).toBeLessThanOrEqual(ORIGIN - 2 * SPAN);
    expect(Math.max(...calls.map((call) => call.domain[1]))).toBeGreaterThanOrEqual(ORIGIN + 3 * SPAN);
  });

  it("[claim:windows-nest] honours the overscan option, including none", () => {
    const { calls, source } = controlledSource();
    const loader = createItemLoader({ source, overscan: 0 });
    loader.request(view());
    const lo = Math.min(...calls.map((call) => call.domain[0]));
    const hi = Math.max(...calls.map((call) => call.domain[1]));
    expect(lo).toBeLessThanOrEqual(ORIGIN);
    expect(hi).toBeGreaterThanOrEqual(ORIGIN + SPAN);
    expect(hi - lo).toBeLessThan(3 * SPAN);
  });

  it("[claim:zoom-in-reuse] a zoom in is served from the coarser window already held", async () => {
    const { calls, source } = controlledSource();
    const loader = createItemLoader({ source });
    loader.request(view());
    for (const call of calls) {
      call.resolve([item(`w${String(call.n)}`, call.domain[0] + 1, call.domain[0] + 2)]);
    }
    await flush();
    const asked = calls.length;
    loader.request(view(SPAN / 4, SPAN / 2));
    loader.request(view(SPAN / 3, SPAN / 16));
    expect(calls.length).toBe(asked);
    expect(loader.loading).toEqual([]);
    expect(loader.busy).toBe(false);
  });

  it("[claim:zoom-in-reuse] a zoom out is served by children that cover it, and asks only for the rest", async () => {
    const { calls, source } = controlledSource();
    const loader = createItemLoader({ source, overscan: 0 });
    loader.request(view(0, SPAN));
    for (const call of calls) {
      call.resolve([]);
    }
    await flush();
    const before = calls.length;
    loader.request(view(0, 2 * SPAN));
    const fresh = calls.slice(before);
    // Every new window lies at least partly outside what the children held.
    for (const call of fresh) {
      const children = calls.slice(0, before).filter((old) => old.domain[0] >= call.domain[0] && old.domain[1] <= call.domain[1]);
      expect(children.length).toBeLessThan(2);
    }
  });

  it("[claim:windows-nest] a pan reuses every window the view still overlaps", async () => {
    const { calls, source } = controlledSource();
    const loader = createItemLoader({ source });
    loader.request(view());
    for (const call of calls) {
      call.resolve([]);
    }
    await flush();
    const before = calls.length;
    loader.request(view(SPAN / 2));
    const fresh = calls.slice(before);
    expect(fresh.length).toBeGreaterThan(0);
    expect(fresh.length).toBeLessThan(before);
    for (const call of fresh) {
      expect(calls.slice(0, before).some((old) => old.domain[0] === call.domain[0])).toBe(false);
    }
  });
});

describe("abort", () => {
  it("[claim:abort-on-leave] aborts a window's request the moment the window is no longer needed", () => {
    const { calls, source } = controlledSource();
    const loader = createItemLoader({ source });
    loader.request(view());
    const first = [...calls];
    loader.request(view(400 * DAY));
    for (const call of first) {
      expect(call.signal.aborted).toBe(true);
    }
    expect(loader.stats.aborted).toBe(first.length);
    expect(loader.stats.inFlight).toBe(calls.length - first.length);
  });

  it("[claim:discard-late] a result that arrives after its abort is dropped, also when the source ignored the signal", async () => {
    const { calls, source } = controlledSource();
    const loader = createItemLoader({ source });
    loader.request(view());
    const stale = [...calls];
    loader.request(view(400 * DAY));
    // The server could not cancel: it answers every aborted request anyway.
    for (const call of stale) {
      call.resolve([item(`stale${String(call.n)}`, ORIGIN + 400 * DAY + DAY)]);
    }
    await flush();
    expect(loader.items).toEqual([]);
    expect(loader.stats.discarded).toBe(stale.length);
    expect(loader.stats.loaded).toBe(0);
    // And it stays dropped: coming back asks again instead of using it.
    loader.request(view());
    expect(calls.length).toBeGreaterThan(stale.length + 1);
  });

  it("[claim:discard-late] an answer for a window that was aborted and asked again belongs to the new request only", async () => {
    const { calls, source } = controlledSource();
    const loader = createItemLoader({ source, overscan: 0 });
    loader.request(view());
    const old = [...calls];
    loader.request(view(400 * DAY));
    loader.request(view());
    const again = calls.slice(old.length).filter((call) => !call.signal.aborted);
    expect(again.map((call) => call.domain)).toEqual(old.map((call) => call.domain));
    for (const call of old) {
      call.resolve([item("old", call.domain[0] + 1)]);
    }
    await flush();
    expect(loader.items.map((each) => each.id)).toEqual([]);
    for (const call of again) {
      call.resolve([item("new", call.domain[0] + 1)]);
    }
    await flush();
    expect(new Set(loader.items.map((each) => each.id))).toEqual(new Set(["new"]));
  });

  it("[claim:discard-late] a rejection after an abort is silent: no failure, no event", async () => {
    const { calls, source } = controlledSource();
    const loader = createItemLoader({ source });
    const changes: ItemLoaderChange[] = [];
    loader.subscribe((change) => changes.push(change));
    loader.request(view());
    const stale = [...calls];
    loader.request(view(400 * DAY));
    for (const call of stale) {
      call.reject(new DOMException("aborted", "AbortError"));
    }
    await flush();
    expect(loader.stats.failed).toBe(0);
    expect(changes).toEqual([]);
    expect(loader.loading.some((range) => range.failed === true)).toBe(false);
  });

  it("[claim:discard-late] a window made redundant by a coarser arrival is aborted", async () => {
    const { calls, source } = controlledSource();
    const loader = createItemLoader({ source, overscan: 0 });
    loader.request(view(0, 2 * SPAN));
    const coarse = [...calls];
    loader.request(view(0, SPAN / 2));
    const fine = calls.slice(coarse.length);
    expect(fine.length).toBeGreaterThan(0);
    // Back out before anything arrives: the coarse windows are asked again.
    loader.request(view(0, 2 * SPAN));
    const coarseAgain = calls.filter((call) => !call.signal.aborted);
    for (const call of coarseAgain) {
      call.resolve([]);
    }
    await flush();
    expect(loader.stats.inFlight).toBe(0);
    expect(loader.loading).toEqual([]);
  });
});

describe("failure", () => {
  it("[claim:failure-retry] a rejected window is reported, shown as failed, not asked again every frame, and retried on demand", async () => {
    const { calls, source } = controlledSource();
    const loader = createItemLoader({ source, overscan: 0 });
    const changes: ItemLoaderChange[] = [];
    loader.subscribe((change) => changes.push(change));
    loader.request(view());
    const broken = calls[0]!;
    const error = new Error("503");
    broken.reject(error);
    for (const call of calls.slice(1)) {
      call.resolve([]);
    }
    await flush();
    expect(changes.find((change) => change.reason === "failed")).toEqual({ reason: "failed", window: broken.domain, error });
    expect(loader.loading).toEqual([{ start: broken.domain[0], end: broken.domain[1], failed: true }]);
    expect(loader.stats.failed).toBe(1);
    const asked = calls.length;
    loader.request(view());
    loader.request(view(1));
    expect(calls.length).toBe(asked);
    loader.retry();
    expect(calls.length).toBe(asked + 1);
    expect(calls[asked]!.domain).toEqual(broken.domain);
    expect(changes.at(-1)?.reason).toBe("retried");
    expect(loader.loading).toEqual([{ start: broken.domain[0], end: broken.domain[1] }]);
  });

  it("[claim:failure-retry] leaving a failed window and coming back asks again", async () => {
    const { calls, source } = controlledSource();
    const loader = createItemLoader({ source, overscan: 0 });
    loader.request(view());
    for (const call of calls) {
      call.reject(new Error("down"));
    }
    await flush();
    const asked = calls.length;
    loader.request(view(400 * DAY));
    loader.request(view());
    expect(calls.slice(asked).filter((call) => !call.signal.aborted).length).toBe(asked);
  });

  it("[claim:failure-retry] a source that throws, or resolves to something that is not an array, is a failure", async () => {
    const thrower = createItemLoader<unknown>({
      source: () => {
        throw new Error("sync");
      },
      overscan: 0,
    });
    thrower.request(view());
    await flush();
    expect(thrower.stats.failed).toBeGreaterThan(0);
    expect(thrower.loading.every((range) => range.failed === true)).toBe(true);

    const liar = createItemLoader<unknown>({ source: () => Promise.resolve({} as never), overscan: 0 });
    const errors: unknown[] = [];
    liar.subscribe((change) => errors.push(change.error));
    liar.request(view());
    await flush();
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toBeInstanceOf(TypeError);
    expect(liar.items).toEqual([]);
  });

  it("[claim:failure-retry] retry with nothing failed does nothing", () => {
    const { calls, source } = controlledSource();
    const loader = createItemLoader({ source });
    const changes: ItemLoaderChange[] = [];
    loader.subscribe((change) => changes.push(change));
    loader.request(view());
    const asked = calls.length;
    loader.retry();
    expect(calls.length).toBe(asked);
    expect(changes).toEqual([]);
  });
});

describe("cache", () => {
  it("[claim:merge] merges windows into one array, once per id, the later arrival winning — and keeps the array while nothing changes", async () => {
    const { calls, source } = controlledSource();
    const loader = createItemLoader({ source, overscan: 0 });
    loader.request(view());
    expect(calls.length).toBeGreaterThan(1);
    const [a, b] = calls as [(typeof calls)[0], (typeof calls)[0]];
    const spanning = (label: string): Item<{ fetch: number }> => ({ ...item("long", a.domain[0], b.domain[1]), label });
    b.resolve([spanning("from b"), item("onlyB", b.domain[0] + 1)]);
    await flush();
    a.resolve([spanning("from a"), item("onlyA", a.domain[0] + 1)]);
    await flush();
    const items = loader.items;
    expect(items.filter((each) => each.id === "long")).toHaveLength(1);
    expect(items.find((each) => each.id === "long")?.label).toBe("from a");
    expect(new Set(items.map((each) => each.id))).toEqual(new Set(["long", "onlyA", "onlyB"]));
    loader.request(view(10));
    expect(loader.items).toBe(items);
  });

  it("[claim:evict] keeps at most maxWindows, dropping the least recently used, never one the view uses", async () => {
    const { calls, source } = controlledSource();
    const loader = createItemLoader({ source, maxWindows: 4, overscan: 0 });
    for (let step = 0; step < 6; step += 1) {
      loader.request(view(step * 100 * DAY));
      for (const call of calls) {
        if (!call.settled && !call.signal.aborted) {
          call.resolve([item(`s${String(step)}c${String(call.n)}`, call.domain[0] + 1)]);
        }
      }
      await flush();
    }
    expect(loader.stats.windows).toBeLessThanOrEqual(4);
    expect(loader.stats.evicted).toBeGreaterThan(0);
    // What the current view needs is still all there.
    loader.request(view(5 * 100 * DAY));
    expect(loader.loading).toEqual([]);
    expect(loader.items.some((each) => each.id.startsWith("s5"))).toBe(true);
    expect(loader.items.some((each) => each.id.startsWith("s0"))).toBe(false);
    expect(DEFAULT_MAX_WINDOWS).toBeGreaterThanOrEqual(16);
  });

  it("[claim:evict] a coarser arrival replaces the finer windows it contains", async () => {
    const { calls, source } = controlledSource();
    const loader = createItemLoader({ source, overscan: 0 });
    loader.request(view(0, SPAN / 4));
    for (const call of calls) {
      call.resolve([item(`fine${String(call.n)}`, call.domain[0] + 1)]);
    }
    await flush();
    const fineCount = loader.stats.windows;
    // Out by three levels: further than children can cover, so the coarse
    // windows are asked for while the fine ones are still held.
    loader.request(view(0, 8 * SPAN));
    for (const call of calls.filter((each) => !each.settled && !each.signal.aborted)) {
      call.resolve([item(`coarse${String(call.n)}`, call.domain[0] + 1)]);
    }
    await flush();
    expect(fineCount).toBeGreaterThan(0);
    expect(loader.items.length).toBeGreaterThan(0);
    expect(loader.items.every((each) => each.id.startsWith("coarse"))).toBe(true);
    expect(loader.stats.windows).toBe(calls.filter((call) => call.domain[1] - call.domain[0] > SPAN && !call.signal.aborted).length);
  });
});

describe("eviction, as a property (R70)", () => {
  it("[claim:evict] holds no window inside a coarser one it holds, wherever the view was", async () => {
    // A finer window that ends exactly where the coarser one does — the
    // right child — must go too; a fixed view never put one there.
    const random = makeRandom(0x70_e1c7);
    for (let round = 0; round < 40; round += 1) {
      const { calls, source } = controlledSource();
      const loader = createItemLoader({ source, overscan: random() * 0.5 });
      const offset = Math.floor(random() * 64) * (SPAN / 16);
      loader.request(view(offset, SPAN / (2 + Math.floor(random() * 6))));
      for (const call of calls) call.resolve([item(`fine${String(call.n)}`, call.domain[0] + 1)]);
      await flush();
      loader.request(view(offset - 2 * SPAN, 8 * SPAN));
      const coarse = calls.filter((call) => !call.settled && !call.signal.aborted);
      for (const call of coarse) call.resolve([item(`coarse${String(call.n)}`, call.domain[0] + 1)]);
      await flush();
      const fine = calls.filter((call) => !coarse.includes(call));
      const kept = fine.filter((call) => !coarse.some((each) => each.domain[0] <= call.domain[0] && call.domain[1] <= each.domain[1]));
      expect(loader.stats.windows, `round ${String(round)}`).toBe(coarse.length + kept.length);
    }
  });
});

describe("editing", () => {
  it("[claim:apply-replay] apply edits the items held, as a new array, and notifies", async () => {
    const { calls, source } = controlledSource();
    const loader = createItemLoader({ source, overscan: 0 });
    const changes: ItemLoaderChange[] = [];
    loader.subscribe((change) => changes.push(change));
    loader.request(view());
    for (const call of calls) {
      call.resolve(call.n === 0 ? [item("x", call.domain[0] + DAY, call.domain[0] + 2 * DAY)] : []);
    }
    await flush();
    const before = loader.items;
    loader.apply([{ id: "x", start: ORIGIN + 3 * DAY }]);
    expect(loader.items).not.toBe(before);
    expect(loader.items.find((each) => each.id === "x")?.start).toBe(ORIGIN + 3 * DAY);
    expect(changes.at(-1)).toEqual({ reason: "applied" });
    loader.apply([]);
    expect(changes.at(-1)).toEqual({ reason: "applied" });
    expect(changes.filter((change) => change.reason === "applied")).toHaveLength(1);
  });

  it("[claim:apply-replay] an edit is replayed on an answer that was already on its way, not on one asked after it", async () => {
    const { calls, source } = controlledSource();
    const loader = createItemLoader({ source, overscan: 0 });
    loader.request(view());
    const early = [...calls];
    // The edit lands while the requests run: the server's answers predate it.
    loader.apply([{ id: "x", start: ORIGIN + 7 * DAY }]);
    for (const call of early) {
      call.resolve(call.n === 0 ? [item("x", ORIGIN + DAY, ORIGIN + 2 * DAY)] : []);
    }
    await flush();
    expect(loader.items.find((each) => each.id === "x")?.start).toBe(ORIGIN + 7 * DAY);
    // A request started after the edit is the server's truth.
    loader.invalidate();
    const late = calls.filter((call) => !call.settled && !call.signal.aborted);
    for (const call of late) {
      call.resolve(call === late[0] ? [item("x", ORIGIN + 9 * DAY)] : []);
    }
    await flush();
    expect(loader.items.find((each) => each.id === "x")?.start).toBe(ORIGIN + 9 * DAY);
  });
});

describe("invalidate", () => {
  it("[claim:invalidate] forgets a range, aborts what runs there, and asks again", async () => {
    const { calls, source } = controlledSource();
    const loader = createItemLoader({ source, overscan: 0 });
    const changes: ItemLoaderChange[] = [];
    loader.subscribe((change) => changes.push(change));
    loader.request(view());
    const [first, ...rest] = calls as [(typeof calls)[0], ...typeof calls];
    for (const call of rest) {
      call.resolve([item(`r${String(call.n)}`, call.domain[0] + 1)]);
    }
    await flush();
    const asked = calls.length;
    loader.invalidate([first.domain[0], first.domain[0] + 1]);
    expect(first.signal.aborted).toBe(true);
    expect(calls.length).toBe(asked + 1);
    expect(calls[asked]!.domain).toEqual(first.domain);
    expect(loader.items.length).toBe(rest.length);
    expect(changes.at(-1)).toEqual({ reason: "invalidated" });
    const rerun = calls[asked]!;
    loader.invalidate();
    expect(loader.items).toEqual([]);
    // Everything is asked again, including the window that was already
    // being asked again — that request is aborted and replaced.
    expect(rerun.signal.aborted).toBe(true);
    expect(calls.length).toBe(asked + 1 + asked);
  });

  it("[claim:invalidate] clears a failure in the range, so it is asked again", async () => {
    const { calls, source } = controlledSource();
    const loader = createItemLoader({ source, overscan: 0 });
    loader.request(view());
    for (const call of calls) {
      call.reject(new Error("x"));
    }
    await flush();
    const asked = calls.length;
    loader.invalidate(view());
    expect(calls.length).toBe(2 * asked);
    expect(loader.loading.every((range) => range.failed !== true)).toBe(true);
  });
});

describe("array source and lifecycle", () => {
  it("[claim:array-source] an array source is the array: nothing loads, nothing is asked, apply returns a patched copy", () => {
    const items = [item("a", ORIGIN), item("b", ORIGIN + DAY)];
    const loader = createItemLoader({ source: items });
    loader.request(view());
    expect(loader.items).toBe(items);
    expect(loader.loading).toEqual([]);
    expect(loader.busy).toBe(false);
    expect(loader.stats).toEqual({ started: 0, loaded: 0, aborted: 0, discarded: 0, failed: 0, evicted: 0, windows: 0, inFlight: 0 });
    const changes: ItemLoaderChange[] = [];
    loader.subscribe((change) => changes.push(change));
    loader.apply([{ id: "a", start: ORIGIN + 5 * DAY }]);
    expect(loader.items).not.toBe(items);
    expect(loader.items[0]?.start).toBe(ORIGIN + 5 * DAY);
    expect(loader.items[1]).toBe(items[1]);
    loader.invalidate();
    loader.retry();
    expect(changes.map((change) => change.reason)).toEqual(["applied", "invalidated"]);
  });

  it("[claim:destroy] destroy aborts everything, drops what is held, ignores late answers and further calls", async () => {
    const { calls, source } = controlledSource();
    const loader = createItemLoader({ source });
    const changes: ItemLoaderChange[] = [];
    loader.subscribe((change) => changes.push(change));
    loader.request(view());
    calls[0]!.resolve([item("kept", ORIGIN)]);
    await flush();
    const running = calls.filter((call) => !call.settled);
    loader.destroy();
    loader.destroy();
    expect(running.every((call) => call.signal.aborted)).toBe(true);
    for (const call of running) {
      call.resolve([item("late", ORIGIN)]);
    }
    await flush();
    const asked = calls.length;
    loader.request(view(400 * DAY));
    loader.apply([{ id: "kept", start: 0 }]);
    loader.invalidate();
    loader.retry();
    expect(calls.length).toBe(asked);
    expect(loader.items).toEqual([]);
    expect(loader.loading).toEqual([]);
    expect(loader.busy).toBe(false);
    expect(changes.map((change) => change.reason)).toEqual(["loaded"]);
  });

  it("[claim:destroy] rejects options and domains it cannot use", () => {
    const { source } = controlledSource();
    expect(() => createItemLoader({ source, maxWindows: 0 })).toThrow(RangeError);
    expect(() => createItemLoader({ source, maxWindows: 1.5 })).toThrow(RangeError);
    expect(() => createItemLoader({ source, overscan: -1 })).toThrow(RangeError);
    expect(() => createItemLoader({ source, overscan: Number.NaN })).toThrow(RangeError);
    const loader = createItemLoader({ source });
    expect(() => loader.request([ORIGIN, ORIGIN])).toThrow(RangeError);
    expect(() => loader.request([Number.NaN, ORIGIN])).toThrow(RangeError);
  });

  it("[claim:windows-nest] works at the edges of time: tiny and enormous spans, negative instants, Date input", () => {
    const { calls, source } = controlledSource();
    const loader = createItemLoader({ source });
    loader.request([new Date(-5), new Date(-4)]);
    expect(calls.every((call) => call.domain[1] - call.domain[0] === 1)).toBe(true);
    loader.request([-8e15, 8e15]);
    for (const call of calls.filter((each) => !each.signal.aborted)) {
      expect(call.domain[0]).toBeGreaterThanOrEqual(-8.64e15);
      expect(call.domain[1]).toBeLessThanOrEqual(8.64e15);
      expect(call.domain[1]).toBeGreaterThan(call.domain[0]);
    }
  });
});
