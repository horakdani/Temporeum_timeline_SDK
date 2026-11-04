import { describe, expect, it } from "vitest";

import { DEFAULT_POOL_LIMIT, mountScene } from "../../src/dom/mount.js";
import { planSceneSpace } from "../../src/scene-space.js";
import type { SceneSpace } from "../../src/scene-space.js";
import { renderTimeline } from "../../src/render.js";
import type { SceneElement } from "../../src/scene.js";
import type { Item } from "../../src/types.js";
import { differs, FakeElement, FakeText, fakeContainer, resetLedger } from "./fake-dom.js";

/**
 * The mount's write ledger.
 *
 * The property next door proves a patched tree equals the scene. That is
 * correctness, and a mount that rebuilt everything on every frame would pass
 * it. These tests are about what the mount is FOR: that an item which stays
 * in view is not written, that a long pan stops creating nodes, and that the
 * pool is what makes the difference.
 */

const DAY = 86_400_000;
const T0 = Date.UTC(2025, 0, 1);
const WIDTH = 900;
const HEIGHT = 400;

/** Three rows of items, one every two days, for five years. */
function longTimeline(): readonly Item[] {
  const items: Item[] = [];
  for (let index = 0; index < 900; index += 1) {
    const start = T0 + index * 2 * DAY;
    items.push({ id: `e${String(index)}`, start, end: start + 5 * DAY, label: `Event ${String(index)}` });
  }
  return items;
}

function itemNodes(container: FakeElement): FakeElement[] {
  const root = container.childNodes[0] as FakeElement;
  const layer = root.childNodes.find(
    (node): node is FakeElement =>
      node instanceof FakeElement && node.attributes.get("class") === "tl-layer tl-layer--items",
  );
  // In a space the items sit in tile groups; without one, directly in the layer.
  const found: FakeElement[] = [];
  const walk = (node: FakeElement): void => {
    for (const child of node.childNodes) {
      if (!(child instanceof FakeElement)) {
        continue;
      }
      if (child.attributes.has("data-tl-id")) {
        found.push(child);
      } else if (child.attributes.has("data-tl-tile")) {
        walk(child);
      }
    }
  };
  if (layer !== undefined) {
    walk(layer);
  }
  return found;
}

describe("mountScene", () => {
  const items = longTimeline();

  function frame(start: number, space?: SceneSpace) {
    return renderTimeline({
      items,
      domain: [start, start + 60 * DAY],
      width: WIDTH,
      height: HEIGHT,
      ...(space === undefined ? {} : { space }),
    });
  }

  it("builds the scene into the container, next to what the host put there", () => {
    const { container } = fakeContainer();
    const own = container.ownerDocument.createElementNS("", "p");
    container.appendChild(own);
    const mount = mountScene(container as unknown as Element);
    const result = frame(T0);
    mount.update(result.scene);
    expect(container.childNodes[0]).toBe(own);
    expect(mount.root).toBe(container.childNodes[1]);
    expect(differs(container.childNodes[1] as FakeElement, result.scene)).toBeUndefined();
  });

  it("keeps an item's node across a pan, and does not touch its title", () => {
    const { container, ledger } = fakeContainer();
    const mount = mountScene(container as unknown as Element);
    mount.update(frame(T0).scene);
    const before = new Map(itemNodes(container).map((node) => [node.attributes.get("data-tl-id"), node]));
    resetLedger(ledger);
    mount.update(frame(T0 + 3 * DAY).scene);
    let kept = 0;
    for (const node of itemNodes(container)) {
      const id = node.attributes.get("data-tl-id");
      if (before.has(id)) {
        expect(node).toBe(before.get(id));
        kept += 1;
      }
    }
    expect(kept).toBeGreaterThan(10);
    // Titles are text nodes; a pan that rewrote them would show up here.
    expect(ledger.texts).toBeLessThan(10);
  });

  it("writes nothing to an item that stays in view, when the frame is in a space", () => {
    const { container, ledger } = fakeContainer();
    const mount = mountScene(container as unknown as Element);
    let space = planSceneSpace(undefined, { domain: [T0, T0 + 60 * DAY], mainSize: WIDTH });
    mount.update(frame(T0, space).scene);
    const before = new Set(itemNodes(container).map((node) => node.attributes.get("data-tl-id")));
    resetLedger(ledger);
    const next = T0 + 3 * DAY;
    space = planSceneSpace(space, { domain: [next, next + 60 * DAY], mainSize: WIDTH });
    mount.update(frame(next, space).scene);
    let kept = 0;
    let entered = 0;
    for (const node of itemNodes(container)) {
      const id = node.attributes.get("data-tl-id") as string;
      if (before.has(id)) {
        expect(ledger.writesById.get(id) ?? 0).toBe(0);
        kept += 1;
      } else {
        expect(ledger.writesById.get(id) ?? 0).toBeGreaterThan(0);
        entered += 1;
      }
    }
    expect(kept).toBeGreaterThan(10);
    expect(entered).toBeGreaterThan(0);
    // Every attribute written in the item layer went to an entering item: a
    // new node takes its seven attributes, and nothing else was touched.
    const itemWrites = [...ledger.writesById.values()].reduce((sum, count) => sum + count, 0);
    expect(itemWrites).toBeLessThanOrEqual(entered * 7);
  });

  it("writes the transforms and nothing else while a frame stays inside what is drawn", () => {
    const { container, ledger } = fakeContainer();
    const mount = mountScene(container as unknown as Element);
    const view = { domain: [T0, T0 + 60 * DAY] as const, mainSize: WIDTH };
    let space = planSceneSpace(undefined, view, { settle: true });
    for (let step = 0; step < 8; step += 1) {
      space = planSceneSpace(space, view, { settle: true });
    }
    const moving = { ...space, atRest: false };
    mount.update(frame(T0, moving).scene);
    resetLedger(ledger);
    // A pan of a few days and back: inside the overscan, so the same layer
    // children come back, and the mount compares one reference per layer.
    for (const start of [T0 + 2 * DAY, T0 + 5 * DAY, T0 - 4 * DAY]) {
      const result = frame(start, moving);
      mount.update(result.scene);
      expect(differs(mount.root as unknown as FakeElement, result.scene)).toBeUndefined();
    }
    expect(ledger.created).toBe(0);
    // The axis's context label, once, when the pan back crosses from
    // January 2025 into December 2024: a text node is known by its text, as
    // a tick label is, so a new month is the old node let go and a pooled one
    // put in its place — nothing created. It is in the viewport's pixels;
    // nothing else of it moves.
    expect(ledger.inserts).toBe(1);
    expect(ledger.removals).toBe(1);
    expect(ledger.texts).toBe(0);
    // Seven layers with a transform, three of them moving per frame along
    // with the items and four with the frame: one transform each, three
    // frames. The context layer has none; its background is written twice,
    // wider over the tick label that slides under it two days on, and back.
    expect(ledger.attrWrites).toBe(7 * 3 + 2);
  });

  it("does not even look at children handed back as the same array", () => {
    const { container } = fakeContainer();
    const mount = mountScene(container as unknown as Element);
    const children: SceneElement[] = Array.from({ length: 50 }, (_, index) => ({
      tag: "rect",
      attrs: { "data-tl-id": `r${String(index)}`, x: index },
    }));
    let reads = 0;
    const watched = new Proxy(children, {
      get(target, key, receiver) {
        if (typeof key === "string" && /^\d+$/.test(key)) {
          reads += 1;
        }
        return Reflect.get(target, key, receiver) as unknown;
      },
    });
    mount.update({ tag: "svg", children: [{ tag: "g", attrs: { transform: "a" }, children: watched }] });
    expect(reads).toBeGreaterThan(0);
    reads = 0;
    // A new layer node with a new transform, the same children array: the
    // layer is patched, its children are not walked at all.
    mount.update({ tag: "svg", children: [{ tag: "g", attrs: { transform: "b" }, children: watched }] });
    expect(reads).toBe(0);
    expect((mount.root as unknown as FakeElement).childNodes[0]).toBeInstanceOf(FakeElement);
  });

  it("keeps every tile's nodes when a pan adds a tile in front", () => {
    const { container, ledger } = fakeContainer();
    const mount = mountScene(container as unknown as Element);
    let space = planSceneSpace(undefined, { domain: [T0 + 100 * DAY, T0 + 160 * DAY], mainSize: WIDTH });
    mount.update(frame(T0 + 100 * DAY, space).scene);
    const tileOf = (node: FakeElement): string | undefined =>
      (node.parentNode as FakeElement | null)?.attributes.get("data-tl-tile");
    const before = new Map(itemNodes(container).map((node) => [node.attributes.get("data-tl-id"), tileOf(node)]));
    resetLedger(ledger);
    // Backwards, during a gesture: the range grows at its start, so new tiles
    // go in front of the kept ones. Matched by position, every kept tile
    // would be handed its neighbour's items.
    const back = T0 + 70 * DAY;
    space = planSceneSpace(space, { domain: [back, back + 60 * DAY], mainSize: WIDTH });
    const result = frame(back, space);
    mount.update(result.scene);
    expect(differs(mount.root as unknown as FakeElement, result.scene)).toBeUndefined();
    let kept = 0;
    let moved = 0;
    for (const node of itemNodes(container)) {
      const id = node.attributes.get("data-tl-id") as string;
      if (!before.has(id)) {
        continue;
      }
      // An item that started before the old range sat in its first tile, and
      // now goes home to its own: a new node there. One per row at most.
      if (before.get(id) !== tileOf(node)) {
        moved += 1;
        continue;
      }
      expect(ledger.writesById.get(id) ?? 0).toBe(0);
      kept += 1;
    }
    expect(kept).toBeGreaterThan(10);
    expect(moved).toBeLessThanOrEqual(3);
  });

  it("rehomes the items of a tile let go of as the same elements, writing only their geometry", () => {
    // A stepped re-anchor in miniature: one tile gives way to two of another
    // scale, which hold its items. Matched within a parent only, every item
    // would be a new element with every attribute written.
    const { container, ledger } = fakeContainer();
    const mount = mountScene(container as unknown as Element);
    const item = (id: string, x: number): SceneElement => ({
      tag: "rect",
      attrs: { "data-tl-id": id, role: "option", "aria-label": `Item ${id}`, x, width: 10 },
      children: [{ tag: "title", text: `Item ${id}` }],
    });
    const tile = (key: string, children: SceneElement[]): SceneElement => ({
      tag: "g",
      attrs: { class: "tl-tile", "data-tl-tile": key },
      children,
    });
    const scene = (tiles: SceneElement[]): SceneElement => ({
      tag: "svg",
      attrs: {},
      children: [{ tag: "g", attrs: { class: "tl-layer tl-layer--items" }, children: tiles }],
    });
    mount.update(
      scene([tile("0:0", [item("a", 0), item("b", 20)]), tile("0:1", [item("c", 40), item("d", 60)]), tile("0:9", [item("z", 900)])]),
    );
    // An older tile let go of first: the pool hands that one out first, so
    // the items of "0:1" have to be found where they are.
    mount.update(scene([tile("0:0", [item("a", 0), item("b", 20)]), tile("0:1", [item("c", 40), item("d", 60)])]));
    const element = (id: string): FakeElement | undefined => itemNodes(container).find((node) => node.attributes.get("data-tl-id") === id);
    const before = { c: element("c"), d: element("d") };
    const { created, reused } = mount.stats;
    resetLedger(ledger);
    const next = scene([tile("0:0", [item("a", 0), item("b", 20)]), tile("-1:2", [item("c", 80)]), tile("-1:3", [item("d", 120)])]);
    mount.update(next);
    expect(differs(mount.root as unknown as FakeElement, next)).toBeUndefined();
    expect(element("c")).toBe(before.c);
    expect(element("d")).toBe(before.d);
    // Only the new x is written; the label, the role, the title stay.
    expect(ledger.writesById.get("c")).toBe(1);
    expect(ledger.writesById.get("d")).toBe(1);
    // Both new tile groups come out of the pool, and nothing is created for
    // the items either.
    expect(mount.stats.created - created).toBe(0);
    expect(mount.stats.reused - reused).toBeGreaterThanOrEqual(3);
  });

  it("never rehomes out of a parent still in the scene", () => {
    // A detail drawn by a hook that repeats an item's id must not take the
    // item's node: only a parent let go of gives its children away.
    const { container } = fakeContainer();
    const mount = mountScene(container as unknown as Element);
    const rect = (id: string): SceneElement => ({ tag: "rect", attrs: { "data-tl-id": id } });
    const scene = (overlay: SceneElement[]): SceneElement => ({
      tag: "svg",
      attrs: {},
      children: [
        { tag: "g", attrs: { class: "items" }, children: [{ tag: "g", attrs: { "data-tl-tile": "0:0" }, children: [rect("a")] }] },
        { tag: "g", attrs: { class: "overlay" }, children: overlay },
      ],
    });
    mount.update(scene([]));
    const next = scene([rect("a")]);
    mount.update(next);
    expect(differs(mount.root as unknown as FakeElement, next)).toBeUndefined();
  });

  it("stops creating nodes once a long pan has warmed the pool", () => {
    const { container } = fakeContainer();
    const mount = mountScene(container as unknown as Element);
    const created: number[] = [];
    const live: number[] = [];
    for (let step = 0; step < 300; step += 1) {
      mount.update(frame(T0 + step * 5 * DAY).scene);
      created.push(mount.stats.created);
      live.push((mount.root as unknown as FakeElement).count());
    }
    // The second half of the pan created nothing: every entering item got a
    // node somebody else let go of.
    expect(created[299]).toBe(created[150]);
    // Over the pan the pool handed out more nodes than were ever created.
    expect(mount.stats.reused).toBeGreaterThan(mount.stats.created);
    // And the live tree does not grow with the distance travelled.
    expect(Math.max(...live.slice(200))).toBeLessThanOrEqual(Math.max(...live.slice(0, 100)) + 10);
  });

  it("without a pool creates nodes for as long as the pan goes on", () => {
    // The negative control of the test above, and of the memory check's benchmark:
    // if this did not grow, the pool test would not be measuring the pool.
    const { container } = fakeContainer();
    const mount = mountScene(container as unknown as Element, { poolLimit: 0 });
    for (let step = 0; step < 300; step += 1) {
      mount.update(frame(T0 + step * 5 * DAY).scene);
    }
    const halfway = mount.stats.created;
    for (let step = 300; step < 400; step += 1) {
      mount.update(frame(T0 + step * 5 * DAY).scene);
    }
    expect(mount.stats.created).toBeGreaterThan(halfway + 100);
    expect(mount.stats.discarded).toBe(mount.stats.released);
    expect(mount.stats.pooled).toBe(0);
  });

  it("lets go of the largest frame's nodes beyond the pool limit", () => {
    expect(DEFAULT_POOL_LIMIT).toBeGreaterThanOrEqual(4000);
    const { container } = fakeContainer();
    const mount = mountScene(container as unknown as Element, { poolLimit: 3 });
    const many: SceneElement = {
      tag: "svg",
      children: Array.from({ length: 10 }, (_, index) => ({ tag: "rect", attrs: { "data-tl-id": `r${String(index)}` } })),
    };
    mount.update(many);
    mount.update({ tag: "svg" });
    expect(mount.stats.released).toBe(10);
    expect(mount.stats.pooled).toBe(3);
    expect(mount.stats.discarded).toBe(7);
  });

  it("removes attributes and text that the next scene no longer has", () => {
    const { container } = fakeContainer();
    const mount = mountScene(container as unknown as Element);
    const first: SceneElement = {
      tag: "svg",
      attrs: { class: "a", "data-x": 1 },
      children: [{ tag: "text", attrs: { x: 1 }, text: "hello" }],
    };
    const second: SceneElement = {
      tag: "svg",
      attrs: { class: "a", "data-x": undefined },
      children: [{ tag: "text", attrs: { x: 1 }, text: "" }],
    };
    mount.update(first);
    mount.update(second);
    const root = mount.root as unknown as FakeElement;
    expect(differs(root, second)).toBeUndefined();
    expect([...root.attributes.keys()]).toEqual(["class"]);
    expect((root.childNodes[0] as FakeElement).childNodes).toHaveLength(0);
  });

  it("keeps an element's own text in front of its children", () => {
    const { container } = fakeContainer();
    const mount = mountScene(container as unknown as Element);
    const scene: SceneElement = {
      tag: "svg",
      children: [{ tag: "g", text: "lead", children: [{ tag: "rect" }, { tag: "rect" }] }],
    };
    mount.update({ tag: "svg", children: [{ tag: "g", children: [{ tag: "rect" }] }] });
    mount.update(scene);
    const group = (mount.root as unknown as FakeElement).childNodes[0] as FakeElement;
    expect(group.childNodes[0]).toBeInstanceOf(FakeText);
    expect(differs(mount.root as unknown as FakeElement, scene)).toBeUndefined();
  });

  it("draws both of two siblings that share a key", () => {
    const { container } = fakeContainer();
    const mount = mountScene(container as unknown as Element);
    const twin: SceneElement = {
      tag: "svg",
      children: [
        { tag: "rect", attrs: { "data-tl-id": "same", x: 1 } },
        { tag: "rect", attrs: { "data-tl-id": "same", x: 2 } },
      ],
    };
    mount.update(twin);
    mount.update(twin);
    expect(differs(mount.root as unknown as FakeElement, twin)).toBeUndefined();
  });

  it("replaces the root when the scene's root element changes", () => {
    const { container } = fakeContainer();
    const mount = mountScene(container as unknown as Element);
    mount.update({ tag: "svg" });
    const old = mount.root;
    mount.update({ tag: "g" });
    expect(mount.root).not.toBe(old);
    expect(container.childNodes).toHaveLength(1);
    expect((container.childNodes[0] as FakeElement).tagName).toBe("g");
  });

  it("takes only its own root away on destroy", () => {
    const { container } = fakeContainer();
    const own = container.ownerDocument.createElementNS("", "p");
    container.appendChild(own);
    const mount = mountScene(container as unknown as Element);
    mount.update(frame(T0).scene);
    mount.update(frame(T0 + 40 * DAY).scene);
    mount.destroy();
    expect(container.childNodes).toEqual([own]);
    expect(mount.root).toBeUndefined();
    expect(mount.stats.pooled).toBe(0);
    // A destroyed mount that is updated again starts over cleanly.
    mount.update({ tag: "svg" });
    expect(container.childNodes).toHaveLength(2);
    mount.destroy();
    mount.destroy();
    expect(container.childNodes).toEqual([own]);
  });
});
