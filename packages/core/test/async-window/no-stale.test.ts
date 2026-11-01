import { writeFileSync } from "node:fs";

import { afterAll, describe, expect, it } from "vitest";

import { createItemLoader } from "../../src/data.js";
import type { LoadingRange } from "../../src/data.js";
import { renderTimeline } from "../../src/render.js";
import { clampDomain, panDomainBy, zoomDomainAt } from "../../src/scale.js";
import { planSceneSpace } from "../../src/scene-space.js";
import type { SceneSpace } from "../../src/scene-space.js";
import type { Domain, Item, Orientation } from "../../src/types.js";
import { makeRandom } from "../property/harness.js";
import { answer, controlledSource, DAY, fetchesShown, flush, ORIGIN } from "./fixture.js";
import type { SourceCall } from "./fixture.js";

/**
 * G-ASYNC: during fast zooming, what an aborted request brings back NEVER
 * reaches the canvas.
 *
 * Each schedule is a seeded walk of a user — bursts of zoom steps one frame
 * apart, pans, and now and then a pause — over a source whose answers arrive
 * late, out of order, and often after their request was aborted (a server
 * that cannot cancel). After every step the frame is rendered, exactly as a
 * host renders it, and read back: every option's accessible name ends in the
 * number of the request its item came from. A name from an aborted request
 * is a leak, and one is enough to fail.
 *
 * The check is on the drawn scene, not on the loader's internals, so it also
 * covers the renderer's caches: half the frames go through a scene space and
 * its tile cache, the path a gesture takes since P7.
 *
 * The NEGATIVE CONTROL runs the same schedules through a deliberately naive
 * loader — it aborts like the real one but keeps whatever arrives. If the
 * detector found nothing there, it would be blind, and the zero above would
 * mean nothing.
 */

const SCHEDULES = 240;
const STEPS = 48;
const WIDTH = 720;
const HEIGHT = 240;

interface LoaderLike {
  request(domain: readonly [number, number]): void;
  readonly items: readonly Item<{ fetch: number }>[];
  readonly loading: readonly LoadingRange[];
}

type Factory = (source: ReturnType<typeof controlledSource>["source"]) => LoaderLike;

/**
 * The control: aborts what leaves the view, like the real loader, and keeps
 * every answer — the bug the gate exists to catch.
 */
function naiveLoader(source: ReturnType<typeof controlledSource>["source"]): LoaderLike {
  const held = new Map<string, readonly Item<{ fetch: number }>[]>();
  const running = new Map<string, AbortController>();
  return {
    request(domain) {
      const span = domain[1] - domain[0];
      const size = 2 ** Math.ceil(Math.log2(Math.max(span / 2, 1)));
      const wanted = new Set<string>();
      for (let index = Math.floor((domain[0] - span / 2) / size); index * size < domain[1] + span / 2; index += 1) {
        wanted.add(`${String(index * size)}:${String(size)}`);
      }
      for (const [key, controller] of running) {
        if (!wanted.has(key)) {
          controller.abort();
          running.delete(key);
        }
      }
      for (const key of wanted) {
        if (held.has(key) || running.has(key)) {
          continue;
        }
        const [start, size2] = key.split(":").map(Number) as [number, number];
        const controller = new AbortController();
        running.set(key, controller);
        void source([start, start + size2], controller.signal).then(
          (items) => {
            running.delete(key);
            held.set(key, items);
          },
          () => {
            running.delete(key);
          },
        );
      }
    },
    get items() {
      const byId = new Map<string, Item<{ fetch: number }>>();
      for (const items of held.values()) {
        for (const item of items) {
          byId.set(item.id, item);
        }
      }
      return [...byId.values()];
    },
    loading: [],
  };
}

/** A fixed set of items, over two years, with spans from an instant to months. */
function universe(random: () => number): Item[] {
  const items: Item[] = [];
  const count = 120 + Math.floor(random() * 120);
  for (let index = 0; index < count; index += 1) {
    const start = ORIGIN + Math.floor(random() * 730 * DAY);
    const roll = random();
    const end = roll < 0.3 ? undefined : start + Math.floor((roll < 0.8 ? random() * 5 : random() * 90) * DAY) + 1;
    items.push({ id: `e${String(index)}`, start, ...(end === undefined ? {} : { end }), label: `E${String(index)}`, laneId: `l${String(index % 3)}` });
  }
  return items;
}

interface RunResult {
  readonly frames: number;
  readonly leaks: readonly string[];
  readonly drawn: number;
  readonly aborted: number;
  /** Aborted requests whose answer was delivered anyway. */
  readonly answeredAfterAbort: number;
  readonly zoomSteps: number;
  readonly fetches: number;
}

async function runSchedule(seed: number, make: Factory, orientation: Orientation): Promise<RunResult> {
  const random = makeRandom(seed);
  const items = universe(random);
  const control = controlledSource();
  const loader = make(control.source);
  const lanes = [{ id: "l0" }, { id: "l1" }, { id: "l2" }];
  let domain: Domain = [ORIGIN + 200 * DAY, ORIGIN + 260 * DAY];
  let space: SceneSpace | undefined;
  const leaks: string[] = [];
  let frames = 0;
  let drawn = 0;
  let zoomSteps = 0;
  let answeredAfterAbort = 0;
  const mainSize = orientation === "horizontal" ? WIDTH : HEIGHT;

  const deliver = (call: SourceCall): void => {
    if (call.signal.aborted) {
      answeredAfterAbort += 1;
    }
    if (random() < 0.1 && !call.signal.aborted) {
      call.reject(new Error("flaky"));
    } else {
      // Many sources ignore the signal: the answer comes anyway.
      call.resolve(answer(items, call));
    }
  };

  const frame = async (): Promise<void> => {
    loader.request(domain);
    await flush();
    const useSpace = frames % 2 === 1;
    space = useSpace ? planSceneSpace(space, { domain, mainSize }) : undefined;
    const result = renderTimeline({
      items: loader.items,
      lanes,
      domain,
      width: WIDTH,
      height: HEIGHT,
      orientation,
      loading: loader.loading,
      ...(space === undefined ? {} : { space }),
    });
    frames += 1;
    for (const fetch of fetchesShown(result.scene)) {
      drawn += 1;
      const call = control.calls[fetch];
      if (call === undefined || call.signal.aborted) {
        leaks.push(`seed ${String(seed)} frame ${String(frames)}: an item of request f${String(fetch)} (aborted) is on the canvas`);
      }
    }
  };

  for (let step = 0; step < STEPS; step += 1) {
    const roll = random();
    if (roll < 0.55) {
      // A burst of fast zoom steps, a frame each, answers trickling in.
      const burst = 3 + Math.floor(random() * 10);
      const inward = random() < 0.5;
      const anchor = random() * mainSize;
      for (let index = 0; index < burst; index += 1) {
        // Above 1 zooms in.
        const factor = inward ? 1.25 + random() * 1.5 : 0.4 + random() * 0.4;
        domain = clampDomain(zoomDomainAt(domain, mainSize, anchor, factor), { minSpanMs: 6 * 3_600_000, maxSpanMs: 4000 * DAY });
        zoomSteps += 1;
        for (const call of control.pending()) {
          if (random() < 0.3) {
            deliver(call);
          }
        }
        await frame();
      }
    } else if (roll < 0.75) {
      domain = panDomainBy(domain, mainSize, (random() - 0.5) * 3 * mainSize);
      await frame();
    } else {
      // A pause: everything still pending answers, in a random order.
      const pending = control.pending();
      pending.sort(() => random() - 0.5);
      for (const call of pending) {
        deliver(call);
        if (random() < 0.5) {
          await frame();
        }
      }
      await frame();
    }
  }
  for (const call of control.pending()) {
    deliver(call);
  }
  await frame();
  return {
    frames,
    leaks,
    drawn,
    aborted: control.calls.filter((call) => call.signal.aborted).length,
    answeredAfterAbort,
    zoomSteps,
    fetches: control.calls.length,
  };
}

const log: Record<string, unknown> = {};

afterAll(() => {
  writeFileSync(".async-window-log.json", `${JSON.stringify(log, null, 2)}\n`);
});

describe("aborted requests never reach the canvas", () => {
  for (const orientation of ["horizontal", "vertical"] as const) {
    it(`[claim:no-stale] ${orientation}: ${String(SCHEDULES / 2)} seeded fast-zoom schedules, the frame read back after every step`, async () => {
      const totals = { schedules: 0, frames: 0, drawn: 0, aborted: 0, answeredAfterAbort: 0, zoomSteps: 0, fetches: 0, leaks: 0 };
      const leaks: string[] = [];
      const base = orientation === "horizontal" ? 1 : 100_001;
      for (let index = 0; index < SCHEDULES / 2; index += 1) {
        const result = await runSchedule(base + index, (source) => createItemLoader({ source }), orientation);
        totals.schedules += 1;
        totals.frames += result.frames;
        totals.drawn += result.drawn;
        totals.aborted += result.aborted;
        totals.answeredAfterAbort += result.answeredAfterAbort;
        totals.zoomSteps += result.zoomSteps;
        totals.fetches += result.fetches;
        totals.leaks += result.leaks.length;
        leaks.push(...result.leaks);
      }
      log[`loader:${orientation}`] = { seeds: [base, base + SCHEDULES / 2 - 1], ...totals, firstLeaks: leaks.slice(0, 5) };
      expect(leaks.slice(0, 5)).toEqual([]);
      // Not vacuous: requests were aborted and answered anyway, and items were drawn.
      expect(totals.answeredAfterAbort).toBeGreaterThan(totals.schedules);
      expect(totals.drawn).toBeGreaterThan(totals.frames);
    }, 120_000);
  }

  it("[claim:negative-control] the same detector finds the leaks of a loader that keeps late answers", async () => {
    const totals = { schedules: 0, frames: 0, leaks: 0, schedulesWithLeaks: 0 };
    for (let index = 0; index < 40; index += 1) {
      const result = await runSchedule(1 + index, naiveLoader, "horizontal");
      totals.schedules += 1;
      totals.frames += result.frames;
      totals.leaks += result.leaks.length;
      totals.schedulesWithLeaks += result.leaks.length > 0 ? 1 : 0;
    }
    log.control = totals;
    expect(totals.schedulesWithLeaks).toBeGreaterThan(totals.schedules / 2);
  }, 120_000);
});
