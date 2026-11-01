import { describe, expect, it, vi } from "vitest";

import { observeSize, openDetail } from "../../src/dom/responsive.js";

/**
 * The responsive bindings, tested without a browser.
 *
 * Both functions find the window through the element they are handed, so a
 * plain object with the handful of members they touch is a complete stand-in.
 * What is checked here is the wiring — which observer is used, what is
 * reported, where the surface goes and how it lets go. That the browser
 * agrees (the popover really stays on screen, the sheet really is at the
 * bottom) is the docs package's Playwright suite.
 */

type Handler = (event: unknown) => void;

interface FakeNode {
  className: string;
  textContent: string;
  type: string;
  readonly attrs: Map<string, string>;
  readonly children: unknown[];
  readonly style: Record<string, string>;
  readonly listeners: Map<string, Handler>;
  offsetWidth: number;
  offsetHeight: number;
  removed: boolean;
  setAttribute(name: string, value: string): void;
  append(child: unknown): void;
  remove(): void;
  addEventListener(type: string, handler: Handler): void;
}

function fakeNode(): FakeNode {
  const node: FakeNode = {
    className: "",
    textContent: "",
    type: "",
    attrs: new Map(),
    children: [],
    style: { cssText: "" },
    listeners: new Map(),
    offsetWidth: 240,
    offsetHeight: 80,
    removed: false,
    setAttribute(name, value) {
      node.attrs.set(name, value);
    },
    append(child) {
      node.children.push(child);
    },
    remove() {
      node.removed = true;
    },
    addEventListener(type, handler) {
      node.listeners.set(type, handler);
    },
  };
  return node;
}

interface FakeWorld {
  readonly container: Element;
  readonly body: FakeNode;
  readonly created: FakeNode[];
  readonly docListeners: Map<string, Handler>;
}

function fakeWorld(clientWidth = 375, innerHeight = 667): FakeWorld {
  const body = fakeNode();
  const created: FakeNode[] = [];
  const docListeners = new Map<string, Handler>();
  const doc = {
    body,
    documentElement: { clientWidth },
    defaultView: { innerHeight },
    createElement() {
      const node = fakeNode();
      created.push(node);
      return node;
    },
    addEventListener(type: string, handler: Handler) {
      docListeners.set(type, handler);
    },
    removeEventListener(type: string, handler: Handler) {
      if (docListeners.get(type) === handler) {
        docListeners.delete(type);
      }
    },
  };
  return { container: { ownerDocument: doc } as unknown as Element, body, created, docListeners };
}

describe("observeSize", () => {
  function observed(withObserver: boolean | "no-view") {
    const callbacks: ((entries: unknown[]) => void)[] = [];
    const observedTargets: unknown[] = [];
    const disconnect = vi.fn();
    class FakeObserver {
      constructor(callback: (entries: unknown[]) => void) {
        callbacks.push(callback);
      }
      observe(target: unknown) {
        observedTargets.push(target);
      }
      disconnect() {
        disconnect();
      }
    }
    const view = withObserver === true ? { ResizeObserver: FakeObserver } : {};
    const target = {
      ownerDocument: { defaultView: withObserver === "no-view" ? null : view },
      getBoundingClientRect: () => ({ width: 412, height: 300 }),
    } as unknown as Element;
    const sizes: { width: number; height: number }[] = [];
    const observation = observeSize(target, (size) => sizes.push(size));
    const fire = (width: number, height: number) => {
      for (const callback of callbacks) {
        callback([{ contentRect: { width: 1, height: 1 } }, { contentRect: { width, height } }]);
      }
    };
    return { observation, sizes, fire, callbacks, observedTargets, target, disconnect };
  }

  it("watches the element through its own window's ResizeObserver", () => {
    const run = observed(true);
    expect(run.observedTargets).toEqual([run.target]);
    run.fire(1440, 300);
    run.fire(375, 667);
    expect(run.sizes).toEqual([
      { width: 1440, height: 300 },
      { width: 375, height: 667 },
    ]);
  });

  it("reports a size once, not once per callback", () => {
    const run = observed(true);
    run.fire(768, 300);
    run.fire(768, 300);
    run.fire(768, 301);
    expect(run.sizes).toHaveLength(2);
    // An empty batch is not a size.
    for (const callback of run.callbacks) {
      callback([]);
    }
    expect(run.sizes).toHaveLength(2);
  });

  it("lets go on destroy", () => {
    const run = observed(true);
    run.observation.destroy();
    expect(run.disconnect).toHaveBeenCalledTimes(1);
  });

  it("without an observer, reports the size once and stays static", () => {
    for (const mode of [false, "no-view"] as const) {
      const run = observed(mode);
      expect(run.sizes).toEqual([{ width: 412, height: 300 }]);
      expect(() => run.observation.destroy()).not.toThrow();
    }
  });
});

describe("openDetail", () => {
  it("places a popover inside the viewport's client width", () => {
    const world = fakeWorld(375);
    const handle = openDetail(world.container, {
      surface: "popover",
      content: "Építés",
      label: "Részletek",
      // Hard against the right edge: centring would push it off screen.
      anchor: { x: 360, y: 100, width: 10, height: 20 },
    });
    const element = world.created[0];
    expect(element).toBeDefined();
    expect(world.body.children).toContain(element);
    expect(handle.surface).toBe("popover");
    expect(element?.attrs.get("data-tl-detail")).toBe("popover");
    expect(element?.attrs.get("role")).toBe("dialog");
    expect(element?.attrs.get("aria-label")).toBe("Részletek");
    expect(element?.attrs.get("data-tl-side")).toBe("below");
    const left = Number.parseFloat(element?.style.left ?? "NaN");
    const width = Number.parseFloat(element?.style.width ?? "NaN");
    expect(left + width).toBeLessThanOrEqual(375 - 8);
    expect(element?.style.top).toBe("128px");
    expect(element?.style.visibility).toBe("");
  });

  it("a popover without an anchor still lands on screen", () => {
    const world = fakeWorld(1440, 900);
    openDetail(world.container, { surface: "popover", content: "x" });
    expect(world.created[0]?.style.left).toBe("8px");
  });

  it("a popover in a window-less document measures against zero height", () => {
    const world = fakeWorld(375);
    const doc = (world.container as unknown as { ownerDocument: { defaultView: unknown } })
      .ownerDocument;
    doc.defaultView = null;
    openDetail(world.container, { surface: "popover", content: "x" });
    expect(world.created[0]?.attrs.get("data-tl-side")).toBe("below");
  });

  it("sets string content as text, never as markup", () => {
    const world = fakeWorld();
    openDetail(world.container, { surface: "popover", content: "<img src=x onerror=alert(1)>" });
    expect(world.created[0]?.textContent).toBe("<img src=x onerror=alert(1)>");
    expect(world.created[0]?.children).toEqual([]);
  });

  it("appends a node the host built", () => {
    const world = fakeWorld();
    const node = { host: "built" } as unknown as Node;
    openDetail(world.container, { surface: "popover", content: node });
    expect(world.created[0]?.children).toEqual([node]);
  });

  it("a sheet spans the bottom and closes from its own button, once", () => {
    const world = fakeWorld();
    const onClose = vi.fn();
    const handle = openDetail(world.container, {
      surface: "sheet",
      content: "Mérföldkő",
      closeLabel: "Bezárás",
      onClose,
    });
    const [sheet, button] = world.created;
    expect(sheet?.style.cssText).toContain("bottom:0");
    expect(sheet?.style.cssText).toContain("left:0;right:0");
    expect(sheet?.attrs.get("data-tl-detail")).toBe("sheet");
    expect(button?.textContent).toBe("Bezárás");
    expect(button?.type).toBe("button");
    expect(sheet?.children).toContain(button);
    button?.listeners.get("click")?.({});
    expect(sheet?.removed).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
    handle.close();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(world.docListeners.has("keydown")).toBe(false);
  });

  it("a sheet's button says Close unless told otherwise", () => {
    const world = fakeWorld();
    openDetail(world.container, { surface: "sheet", content: "x" });
    expect(world.created[1]?.textContent).toBe("Close");
  });

  it("Escape closes either surface; another key does not", () => {
    for (const surface of ["popover", "sheet"] as const) {
      const world = fakeWorld();
      const onClose = vi.fn();
      openDetail(world.container, { surface, content: "x", onClose });
      const key = world.docListeners.get("keydown");
      key?.({ key: "Enter" });
      expect(onClose).not.toHaveBeenCalled();
      key?.({ key: "Escape" });
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(world.created[0]?.removed).toBe(true);
      expect(world.docListeners.has("keydown")).toBe(false);
    }
  });
});
