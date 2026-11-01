import { describe, expect, it } from "vitest";

import { createFrameLoop } from "../../src/dom/frame.js";

/**
 * The frame loop, against a window whose frames the test hands out by hand.
 *
 * The claim is "at most one draw per animation frame, with nothing lost" —
 * and both halves need a clock the test controls: a real one could make the
 * coalescing look perfect simply because the requests happened to land in
 * different frames.
 */

interface FakeWindow {
  readonly requestAnimationFrame: (callback: (time: number) => void) => number;
  readonly cancelAnimationFrame: (handle: number) => void;
  readonly performance: { now(): number };
  /** Run every callback queued so far, as the browser does at a frame. */
  tick(time: number): void;
  readonly queued: number;
}

function fakeWindow(): FakeWindow {
  let next = 1;
  const callbacks = new Map<number, (time: number) => void>();
  return {
    requestAnimationFrame(callback) {
      const handle = next;
      next += 1;
      callbacks.set(handle, callback);
      return handle;
    },
    cancelAnimationFrame(handle) {
      callbacks.delete(handle);
    },
    performance: { now: () => 1234 },
    tick(time) {
      const due = [...callbacks.entries()];
      callbacks.clear();
      for (const [, callback] of due) {
        callback(time);
      }
    },
    get queued() {
      return callbacks.size;
    },
  };
}

function element(view: FakeWindow | null): Element {
  return { ownerDocument: { defaultView: view } } as unknown as Element;
}

describe("createFrameLoop", () => {
  it("draws once per frame, however many requests came in", () => {
    const view = fakeWindow();
    const times: number[] = [];
    const loop = createFrameLoop(element(view), (time) => times.push(time));
    for (let index = 0; index < 7; index += 1) {
      loop.request();
    }
    expect(loop.pending).toBe(true);
    expect(view.queued).toBe(1);
    view.tick(16);
    expect(times).toEqual([16]);
    expect(loop.pending).toBe(false);
    expect(loop.stats).toEqual({ requests: 7, frames: 1 });
  });

  it("does not draw when nothing was requested", () => {
    const view = fakeWindow();
    let draws = 0;
    createFrameLoop(element(view), () => {
      draws += 1;
    });
    view.tick(16);
    expect(draws).toBe(0);
  });

  it("keeps a request made during a draw for the next frame", () => {
    const view = fakeWindow();
    const times: number[] = [];
    const loop = createFrameLoop(element(view), (time) => {
      times.push(time);
      if (times.length === 1) {
        loop.request();
      }
    });
    loop.request();
    view.tick(16);
    expect(loop.pending).toBe(true);
    view.tick(32);
    expect(times).toEqual([16, 32]);
  });

  it("recovers from a draw that throws", () => {
    const view = fakeWindow();
    let calls = 0;
    const loop = createFrameLoop(element(view), () => {
      calls += 1;
      if (calls === 1) {
        throw new Error("host bug");
      }
    });
    loop.request();
    expect(() => {
      view.tick(16);
    }).toThrow("host bug");
    loop.request();
    view.tick(32);
    expect(calls).toBe(2);
  });

  it("flushes a pending draw at once, and only a pending one", () => {
    const view = fakeWindow();
    const times: number[] = [];
    const loop = createFrameLoop(element(view), (time) => times.push(time));
    loop.flush();
    expect(times).toEqual([]);
    loop.request();
    loop.flush();
    expect(times).toEqual([1234]);
    expect(view.queued).toBe(0);
  });

  it("cancels a pending draw on destroy and ignores later requests", () => {
    const view = fakeWindow();
    let draws = 0;
    const loop = createFrameLoop(element(view), () => {
      draws += 1;
    });
    loop.request();
    loop.destroy();
    view.tick(16);
    loop.request();
    view.tick(32);
    expect(draws).toBe(0);
    expect(loop.pending).toBe(false);
    loop.destroy();
  });

  it("draws at once in a document without a window", () => {
    let draws = 0;
    const loop = createFrameLoop(element(null), () => {
      draws += 1;
    });
    loop.request();
    loop.request();
    expect(draws).toBe(2);
    loop.flush();
    loop.destroy();
  });
});
