/*
 * Shared tools for the performance measurements: the data, the gestures, the
 * frame counting and the scenarios.
 *
 * Two pages use it: bench.html measures the core's own path (the perf check), and
 * bench-public.html the public path, `createTimeline` from the shipped
 * element bundle (the perf-public check). This code used to live in bench.html; it
 * sits in one place now so the two measurements cannot drift apart — the
 * same data, the same finger, the same counting, only the measured path differs.
 */

// --- the data: 10,000 items, deterministic ----------------------------
// 60 interleaved streams, 8-day items every 10 days: packing gives ~48 rows,
// which fills the 900 px at dense density. The view is a fifth of the whole
// range, so ~2000 of the 10,000 items are visible.
const DAY = 86_400_000;
export const START = Date.UTC(2026, 0, 1);
const STREAMS = 60;
const PERIOD = 10 * DAY;
const LENGTH = 8 * DAY;

export function benchItems() {
  const items = [];
  for (let index = 0; items.length < 10_000; index += 1) {
    const stream = index % STREAMS;
    const round = Math.floor(index / STREAMS);
    const start = START + round * PERIOD + (stream * PERIOD) / STREAMS;
    items.push({ id: `e${index}`, start, end: start + LENGTH, label: `Item ${index}` });
  }
  return items;
}

/** The starting view: the second fifth of the whole range. */
export function benchDomain(items) {
  const total = items[items.length - 1].end - START;
  return [START + total * 0.2, START + total * 0.4];
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));

/**
 * The measuring tools for one frame element.
 *
 * `counters()` gives the loop's two numbers: how many draws were requested
 * (`requests`) and how many it drew (`frames`) — this shows that input is
 * coalesced per frame. `settleAt(domain)` sets the view through the page's
 * own path and waits for it to be drawn.
 */
export function createBenchKit({ frame, counters, settleAt, origin }) {
  const H = () => frame.clientHeight;
  const W = () => frame.clientWidth;
  let dispatched = 0;

  /** The items and labels ACTUALLY visible according to the browser — not according to the renderer. */
  function visibility() {
    const box = frame.getBoundingClientRect();
    const inside = (rect) =>
      rect.right > box.left && rect.left < box.right && rect.bottom > box.top && rect.top < box.bottom;
    let visibleItems = 0;
    for (const node of frame.querySelectorAll("rect.tl-item")) {
      if (inside(node.getBoundingClientRect())) visibleItems += 1;
    }
    let visibleLabels = 0;
    for (const node of frame.querySelectorAll(".tl-label")) {
      if (inside(node.getBoundingClientRect())) visibleLabels += 1;
    }
    return {
      visibleItems,
      visibleLabels,
      domNodes: frame.getElementsByTagName("*").length,
    };
  }

  function dispatch(type, pointerId, x, y) {
    const box = frame.getBoundingClientRect();
    dispatched += 1;
    frame.dispatchEvent(
      new PointerEvent(type, {
        pointerId,
        pointerType: "touch",
        isPrimary: pointerId === 1,
        clientX: box.left + x,
        clientY: box.top + y,
        bubbles: true,
        cancelable: true,
      }),
    );
  }

  /**
   * One gesture with a 120 Hz digitizer. The position is computed from the
   * elapsed TIME, not from frames — the way a real finger keeps moving even
   * when the page falls behind. `path(u)` gives the fingers for u ∈ [0, 1].
   */
  async function performGesture(durationMs, path) {
    const frames = [];
    let recording = true;
    const record = (time) => {
      frames.push(time);
      if (recording) requestAnimationFrame(record);
    };
    const loopBefore = counters();
    const startPointers = path(0);
    startPointers.forEach((p, index) => dispatch("pointerdown", index + 1, p.x, p.y));
    requestAnimationFrame(record);
    const began = performance.now();
    await new Promise((resolve) => {
      const tick = () => {
        const u = Math.min((performance.now() - began) / durationMs, 1);
        path(u).forEach((p, index) => dispatch("pointermove", index + 1, p.x, p.y));
        if (u < 1) setTimeout(tick, 8);
        else resolve();
      };
      setTimeout(tick, 8);
    });
    // The last gesture frame is still drawn before the finger lifts.
    await nextFrame();
    recording = false;
    const end = path(1);
    const upAt = performance.now();
    end.forEach((p, index) => dispatch("pointerup", index + 1, p.x, p.y));
    // The settle frame: after the lift the loop draws (re-anchoring in item
    // space if there was a zoom), and the start of the NEXT frame is when that
    // is on screen.
    await nextFrame();
    await nextFrame();
    const settleMs = performance.now() - upAt;
    const loopAfter = counters();
    return {
      frames,
      settleMs,
      requests: loopAfter.requests - loopBefore.requests,
      draws: loopAfter.frames - loopBefore.frames,
    };
  }

  function summarize(run) {
    const times = run.frames;
    const intervals = times.slice(1).map((time, index) => time - times[index]);
    const duration = times[times.length - 1] - times[0];
    const expected = duration / (1000 / 60);
    const missed = expected <= 0 ? 1 : Math.max(0, 1 - intervals.length / expected);
    return {
      frames: intervals.length,
      durationMs: duration,
      missedVsyncShare: missed,
      effectiveFps: intervals.length / (duration / 1000),
      longestFrameMs: Math.max(...intervals),
      p95FrameMs: [...intervals].sort((a, b) => a - b)[Math.floor(intervals.length * 0.95)],
      settleMs: run.settleMs,
      inputEvents: run.requests,
      draws: run.draws,
    };
  }

  /** A one-finger drag from right to left and back: 960 px/s, two seconds. */
  const panPath = (u) => {
    const x = u < 0.5 ? 1200 - 1920 * u : 240 + 1920 * (u - 0.5);
    return [{ x, y: H() / 2 }];
  };

  /** A pinch around the centre: from 200 px to 400 px (2x) and back. */
  const pinchPath = (u) => {
    const spread = u < 0.5 ? 200 + 400 * u : 400 - 400 * (u - 0.5);
    const cx = W() / 2;
    return [
      { x: cx - spread / 2, y: H() / 2 },
      { x: cx + spread / 2, y: H() / 2 },
    ];
  };

  /**
   * A deep pinch: from 100 px to 400 px (4x) and back — the perf-deep check
   * scenario (a gated check). Even the 2x zoom does not fit into item space's
   * 1.5x stretch (two or three re-anchors along the way; an earlier comment
   * here claimed the opposite), and the 4x one needs six: this scenario
   * measures what re-anchoring costs.
   */
  const deepPinchPath = (u) => {
    const spread = u < 0.5 ? 100 + 600 * u : 400 - 600 * (u - 0.5);
    const cx = W() / 2;
    return [
      { x: cx - spread / 2, y: H() / 2 },
      { x: cx + spread / 2, y: H() / 2 },
    ];
  };

  /**
   * A long pan, for information only: four drags in a row, each 1200 px to
   * the left at 960 px/s — 4800 px, far beyond the overscan, so incoming
   * tiles have to be drawn during the gesture. There is no pause between the
   * drags: the idle fill only gets the frames that fall between two drags.
   */
  async function longPan() {
    const runs = [];
    for (let index = 0; index < 4; index += 1) {
      runs.push(await performGesture(1250, (u) => [{ x: 1300 - 1200 * u, y: H() / 2 }]));
    }
    const parts = runs.map(summarize);
    const frames = parts.reduce((sum, part) => sum + part.frames, 0);
    const duration = parts.reduce((sum, part) => sum + part.durationMs, 0);
    const expected = duration / (1000 / 60);
    return {
      frames,
      durationMs: duration,
      missedVsyncShare: Math.max(0, 1 - frames / expected),
      effectiveFps: frames / (duration / 1000),
      longestFrameMs: Math.max(...parts.map((part) => part.longestFrameMs)),
      p95FrameMs: Math.max(...parts.map((part) => part.p95FrameMs)),
      settleMs: Math.max(...parts.map((part) => part.settleMs)),
      inputEvents: parts.reduce((sum, part) => sum + part.inputEvents, 0),
      draws: parts.reduce((sum, part) => sum + part.draws, 0),
    };
  }

  /**
   * Recording for input that comes from outside (the perf-wheel check): the real
   * wheel is sent by the measuring script from Node (`page.mouse.wheel`), as
   * in the throttled benchmark, so the browser's own input path is part of the
   * measurement. The recording collects rAF times, the wheel events reaching
   * the page and the loop's draws. `stop()` summarises the same way as for
   * gestures; the settle frame here is the longest frame after the last wheel
   * step (in it the page redraws at rest, after waiting for the wheel burst
   * to end).
   */
  let recordingNow;

  async function startRecording(extras = {}) {
    await settleAt(origin);
    // It starts from a quiet page, as the throttled benchmark does: there the
    // measurement begins after `ready` (two consecutive frames without a
    // draw), and here too it waits until the loop has not drawn for two frames.
    for (let quiet = 0, waited = 0; quiet < 2 && waited < 300; waited += 1) {
      const drawn = counters().frames;
      await nextFrame();
      quiet = counters().frames === drawn ? quiet + 1 : 0;
    }
    const before = visibility();
    const token = extras.start?.();
    const frames = [];
    let recording = true;
    let wheels = 0;
    let lastWheelAt = -Infinity;
    const onWheel = () => {
      wheels += 1;
      lastWheelAt = performance.now();
    };
    frame.addEventListener("wheel", onWheel, { capture: true, passive: true });
    const record = (time) => {
      frames.push(time);
      if (recording) requestAnimationFrame(record);
    };
    const loopBefore = counters();
    requestAnimationFrame(record);
    recordingNow = {
      stop() {
        recording = false;
        frame.removeEventListener("wheel", onWheel, { capture: true });
        const after = frames.filter((time) => time > lastWheelAt);
        const tail = after.slice(1).map((time, index) => time - after[index]);
        const measured = summarize({
          frames,
          settleMs: tail.length === 0 ? 0 : Math.max(...tail),
          requests: wheels,
          draws: counters().frames - loopBefore.frames,
        });
        return {
          name: "zoom-wheel",
          before,
          after: visibility(),
          ...(extras.end?.(token) ?? {}),
          ...measured,
          frameTimes: frames.map((time) => Math.round(time)),
          lastWheelAt: Math.round(lastWheelAt),
        };
      },
    };
    return before;
  }

  /**
   * One scenario. `extras.start()` runs at the start of the measurement,
   * `extras.end(token)` at the end, and what it returns is the page's own
   * diagnostics (re-anchoring, slowest draws) — the check does not measure it.
   */
  async function scenario(name, extras = {}) {
    await settleAt(origin);
    if (name === "pan-labelled") {
      // The 2x view, where the labels fit.
      const middle = (origin[0] + origin[1]) / 2;
      const half = (origin[1] - origin[0]) / 4;
      await settleAt([middle - half, middle + half]);
    }
    await sleep(100);
    const before = visibility();
    const token = extras.start?.();
    let measured;
    if (name === "pan-long") {
      measured = await longPan();
    } else {
      const path = name === "zoom" ? pinchPath : name === "zoom-deep" ? deepPinchPath : panPath;
      measured = summarize(await performGesture(2000, path));
    }
    const after = visibility();
    return { name, before, after, ...(extras.end?.(token) ?? {}), ...measured };
  }

  return {
    visibility,
    performGesture,
    scenario,
    startRecording,
    stopRecording: () => recordingNow.stop(),
    get dispatched() {
      return dispatched;
    },
  };
}
