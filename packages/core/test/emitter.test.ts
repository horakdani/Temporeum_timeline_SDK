import { describe, expect, it, vi } from "vitest";
import { Emitter } from "../src/emitter.js";

interface TestEvents {
  readonly ping: { readonly n: number };
  readonly pong: string;
}

describe("Emitter", () => {
  it("delivers the payload to every subscriber", () => {
    const emitter = new Emitter<TestEvents>();
    const a = vi.fn();
    const b = vi.fn();
    emitter.on("ping", a);
    emitter.on("ping", b);

    emitter.emit("ping", { n: 1 });

    expect(a).toHaveBeenCalledExactlyOnceWith({ n: 1 });
    expect(b).toHaveBeenCalledExactlyOnceWith({ n: 1 });
  });

  it("does not deliver to other event names", () => {
    const emitter = new Emitter<TestEvents>();
    const listener = vi.fn();
    emitter.on("pong", listener);

    emitter.emit("ping", { n: 1 });

    expect(listener).not.toHaveBeenCalled();
  });

  it("emitting with no subscribers is a no-op", () => {
    const emitter = new Emitter<TestEvents>();
    expect(() => emitter.emit("ping", { n: 1 })).not.toThrow();
  });

  it("the returned unsubscribe stops delivery and is idempotent", () => {
    const emitter = new Emitter<TestEvents>();
    const listener = vi.fn();
    const dispose = emitter.on("ping", listener);

    dispose();
    dispose();
    emitter.emit("ping", { n: 1 });

    expect(listener).not.toHaveBeenCalled();
    expect(emitter.listenerCount("ping")).toBe(0);
  });

  it("off removes a listener, and removing an unknown one is harmless", () => {
    const emitter = new Emitter<TestEvents>();
    const listener = vi.fn();
    emitter.on("ping", listener);

    emitter.off("ping", listener);
    emitter.off("ping", vi.fn());
    emitter.off("pong", vi.fn());
    emitter.emit("ping", { n: 1 });

    expect(listener).not.toHaveBeenCalled();
  });

  it("once delivers exactly one event", () => {
    const emitter = new Emitter<TestEvents>();
    const listener = vi.fn();
    emitter.once("ping", listener);

    emitter.emit("ping", { n: 1 });
    emitter.emit("ping", { n: 2 });

    expect(listener).toHaveBeenCalledExactlyOnceWith({ n: 1 });
    expect(emitter.listenerCount("ping")).toBe(0);
  });

  it("once can be disposed before it ever fires", () => {
    const emitter = new Emitter<TestEvents>();
    const listener = vi.fn();
    const dispose = emitter.once("ping", listener);

    dispose();
    emitter.emit("ping", { n: 1 });

    expect(listener).not.toHaveBeenCalled();
  });

  it("a listener subscribed during dispatch does not see the event in flight", () => {
    const emitter = new Emitter<TestEvents>();
    const late = vi.fn();
    emitter.on("ping", () => {
      emitter.on("ping", late);
    });

    emitter.emit("ping", { n: 1 });
    expect(late).not.toHaveBeenCalled();

    emitter.emit("ping", { n: 2 });
    expect(late).toHaveBeenCalledExactlyOnceWith({ n: 2 });
  });

  it("a listener removed during dispatch is not called at all", () => {
    const emitter = new Emitter<TestEvents>();
    const second = vi.fn();
    emitter.on("ping", () => {
      emitter.off("ping", second);
    });
    emitter.on("ping", second);

    emitter.emit("ping", { n: 1 });

    expect(second).not.toHaveBeenCalled();
  });

  it("one throwing listener does not silence the others", () => {
    const onError = vi.fn();
    const emitter = new Emitter<TestEvents>(onError);
    const boom = new Error("boom");
    const after = vi.fn();

    emitter.on("ping", () => {
      throw boom;
    });
    emitter.on("ping", after);

    emitter.emit("ping", { n: 1 });

    expect(after).toHaveBeenCalledExactlyOnceWith({ n: 1 });
    expect(onError).toHaveBeenCalledExactlyOnceWith(boom, "ping");
  });

  it("without an error handler the error goes to the platform's reportError", () => {
    const reportError = vi.fn();
    vi.stubGlobal("reportError", reportError);
    try {
      const emitter = new Emitter<TestEvents>();
      const boom = new Error("unhandled");
      const after = vi.fn();
      emitter.on("ping", () => {
        throw boom;
      });
      emitter.on("ping", after);

      expect(() => emitter.emit("ping", { n: 1 })).not.toThrow();

      expect(after).toHaveBeenCalledExactlyOnceWith({ n: 1 });
      expect(reportError).toHaveBeenCalledExactlyOnceWith(boom);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("where reportError does not exist the error is thrown from a microtask", () => {
    vi.stubGlobal("reportError", undefined);
    const scheduled: (() => void)[] = [];
    const queue = vi
      .spyOn(globalThis, "queueMicrotask")
      .mockImplementation((callback: () => void) => {
        scheduled.push(callback);
      });
    try {
      const emitter = new Emitter<TestEvents>();
      const boom = new Error("unhandled");
      emitter.on("ping", () => {
        throw boom;
      });

      expect(() => emitter.emit("ping", { n: 1 })).not.toThrow();

      // The error is not swallowed: it is queued, and it throws when it runs.
      expect(scheduled).toHaveLength(1);
      expect(() => scheduled[0]?.()).toThrow(boom);
    } finally {
      queue.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it("only the first error of a dispatch is reported globally", () => {
    const reportError = vi.fn();
    vi.stubGlobal("reportError", reportError);
    try {
      const emitter = new Emitter<TestEvents>();
      const first = new Error("first");
      emitter.on("ping", () => {
        throw first;
      });
      emitter.on("ping", () => {
        throw new Error("second");
      });

      emitter.emit("ping", { n: 1 });

      expect(reportError).toHaveBeenCalledExactlyOnceWith(first);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("counts listeners per event and in total", () => {
    const emitter = new Emitter<TestEvents>();
    emitter.on("ping", vi.fn());
    emitter.on("ping", vi.fn());
    emitter.on("pong", vi.fn());

    expect(emitter.listenerCount("ping")).toBe(2);
    expect(emitter.listenerCount("pong")).toBe(1);
    expect(emitter.listenerCount()).toBe(3);
  });

  it("clear drops one event or all of them", () => {
    const emitter = new Emitter<TestEvents>();
    emitter.on("ping", vi.fn());
    emitter.on("pong", vi.fn());

    emitter.clear("ping");
    expect(emitter.listenerCount("ping")).toBe(0);
    expect(emitter.listenerCount("pong")).toBe(1);

    emitter.clear();
    expect(emitter.listenerCount()).toBe(0);
  });

  it("the same listener registered twice is held once", () => {
    const emitter = new Emitter<TestEvents>();
    const listener = vi.fn();
    emitter.on("ping", listener);
    emitter.on("ping", listener);

    emitter.emit("ping", { n: 1 });

    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe("Emitter edge cases (E6, E7)", () => {
  it("clear() during dispatch stops the listeners the event has not reached yet", () => {
    for (const scope of ["all", "type"] as const) {
      const emitter = new Emitter<{ ping: { n: number } }>();
      const later = vi.fn();
      emitter.on("ping", () => (scope === "all" ? emitter.clear() : emitter.clear("ping")));
      emitter.on("ping", later);
      emitter.emit("ping", { n: 1 });
      expect(later).not.toHaveBeenCalled();
      expect(emitter.listenerCount()).toBe(0);
    }
  });

  it("each handle of a twice-subscribed function removes its own subscription", () => {
    const emitter = new Emitter<{ ping: { n: number } }>();
    const listener = vi.fn();
    const first = emitter.on("ping", listener);
    const second = emitter.on("ping", listener);
    // Delivered once per event, as with addEventListener.
    emitter.emit("ping", { n: 1 });
    expect(listener).toHaveBeenCalledTimes(1);
    first();
    first();
    emitter.emit("ping", { n: 2 });
    expect(listener).toHaveBeenCalledTimes(2);
    second();
    emitter.emit("ping", { n: 3 });
    expect(listener).toHaveBeenCalledTimes(2);
    expect(emitter.listenerCount("ping")).toBe(0);
  });

  it("a handle left over from before off() does not remove a later subscription", () => {
    const emitter = new Emitter<{ ping: { n: number } }>();
    const listener = vi.fn();
    const stale = emitter.on("ping", listener);
    emitter.off("ping", listener);
    emitter.on("ping", listener);
    stale();
    emitter.emit("ping", { n: 1 });
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
