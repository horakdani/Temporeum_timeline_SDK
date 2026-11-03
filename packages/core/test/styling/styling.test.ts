import { describe, expect, it } from "vitest";

import { DENSITIES, densityMetrics } from "../../src/density.js";
import type { DensityMetrics, MetricsProvider } from "../../src/density.js";
import { slotHooks } from "../../src/items/template.js";
import { mountScene } from "../../src/dom/mount.js";
import { partNames, withParts } from "../../src/parts.js";
import { renderTimeline } from "../../src/render.js";
import type { RenderOptions } from "../../src/render.js";
import { fitDensity } from "../../src/responsive.js";
import { renderToSvgString } from "../../src/scene.js";
import type { SceneElement } from "../../src/scene.js";
import { printPages } from "../../src/export/pages.js";
import { laneHeaderNodes } from "../../src/tools/lanes.js";
import type { Item } from "../../src/types.js";
import { FakeElement, fakeContainer, resetLedger } from "../dom/fake-dom.js";
import type { FakeDocument } from "../dom/fake-dom.js";

/**
 * P35 in the engine: the sizes a frame draws with, the drawing's classes as
 * `part`s, and the boxes a framework renders into.
 */

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 1);

const items: Item[] = [
  { id: "a", start: T0, end: T0 + 4 * DAY, label: "Design", laneId: "l1", className: "urgent" },
  { id: "b", start: T0 + 3 * DAY, end: T0 + 9 * DAY, label: "Build", laneId: "l1" },
  { id: "c", start: T0 + 10 * DAY, end: T0 + 12 * DAY, label: "Ship", laneId: "l2" },
];
const frame = (overrides: Partial<RenderOptions> = {}): RenderOptions => ({
  items,
  lanes: [
    { id: "l1", label: "Work" },
    { id: "l2", label: "Delivery" },
  ],
  domain: [T0, T0 + 20 * DAY],
  width: 800,
  height: 240,
  timeZone: "UTC",
  ...overrides,
});

function find(node: SceneElement, test: (node: SceneElement) => boolean, into: SceneElement[] = []): SceneElement[] {
  if (test(node)) into.push(node);
  for (const child of node.children ?? []) find(child, test, into);
  return into;
}
const styleOf = (scene: SceneElement): string => find(scene, (node) => node.tag === "style")[0]?.text ?? "";
const itemRect = (scene: SceneElement, id: string): SceneElement =>
  find(scene, (node) => node.tag === "rect" && node.attrs?.["data-tl-id"] === id)[0] as SceneElement;

describe("metrics: the sizes a frame draws with", () => {
  const sized = (overrides: Partial<DensityMetrics>): MetricsProvider => {
    const made = new Map<string, DensityMetrics>();
    return (density, orientation) => {
      const key = `${density}|${orientation}`;
      let metrics = made.get(key);
      if (metrics === undefined) {
        metrics = { ...densityMetrics(density, orientation), ...overrides };
        made.set(key, metrics);
      }
      return metrics;
    };
  };

  it("is what the frame draws, measures and packs with", () => {
    const plain = renderTimeline(frame());
    const asked: string[] = [];
    const provider = sized({ rowSize: 44, cornerRadius: 9, fontSize: 15, tickFontSize: 13, fontFamily: '"Iowan Old Style", serif', axisSize: 40 });
    const result = renderTimeline(frame({ metrics: (density, orientation) => (asked.push(`${density}|${orientation}`), provider(density, orientation)) }));
    expect(asked[0]).toBe("comfortable|horizontal");
    expect(itemRect(result.scene, "a").attrs?.rx).toBe(9);
    expect(Number(itemRect(result.scene, "a").attrs?.height)).toBe(44);
    expect(result.contentCrossSize).toBeGreaterThan(plain.contentCrossSize);
    const css = styleOf(result.scene);
    expect(css).toContain('.tl{font-family:"Iowan Old Style", serif;');
    expect(css).toContain(".tl-label{fill:var(--tl-item-text);color:var(--tl-item-text);font-size:15px");
    expect(css).toContain(".tl-tick-label{fill:var(--tl-text-muted);font-size:13px}");
  });

  it("is the empty frame's too", () => {
    const empty = renderTimeline(frame({ width: 0, metrics: sized({ fontSize: 19 }) }));
    expect(styleOf(empty.scene)).toContain("font-size:19px");
  });

  it("decides density: auto with the sizes the levels would draw at", () => {
    const input = { items, domain: [T0, T0 + 20 * DAY] as const, width: 800, height: 140, orientation: "horizontal" as const };
    const plain = fitDensity(input);
    const tall = fitDensity({ ...input, metrics: (density, orientation) => ({ ...densityMetrics(density, orientation), rowSize: densityMetrics(density, orientation).rowSize * 3 }) });
    for (const density of DENSITIES) expect(tall.contentCrossSize[density]).toBeGreaterThan(plain.contentCrossSize[density]);
  });

  it("places the lane headers with them", () => {
    const layout = renderTimeline(frame()).layout;
    const plain = laneHeaderNodes(layout, { orientation: "horizontal", density: "comfortable", crossOffset: 0, crossSize: 240 });
    const moved = laneHeaderNodes(layout, { orientation: "horizontal", density: "comfortable", metrics: sized({ axisSize: 60 }), crossOffset: 0, crossSize: 240 });
    expect(JSON.stringify(moved)).not.toBe(JSON.stringify(plain));
  });

  it("prints with them", () => {
    const pages = printPages(frame({ metrics: sized({ rowSize: 50 }) }));
    expect(pages.length).toBeGreaterThan(0);
    expect(Number(itemRect(pages[0]?.frame.scene as SceneElement, "a").attrs?.height)).toBe(50);
  });
});

describe("parts", () => {
  it("are the classes without the library's prefix, the host's as they are", () => {
    expect(partNames("tl")).toBe("timeline");
    expect(partNames("tl-item tl-item--selected urgent")).toBe("item item-selected urgent");
    expect(partNames("  tl-tick   tl-tick--major ")).toBe("tick tick-major");
    expect(partNames("tl-a tl-a")).toBe("a");
    expect(partNames("")).toBe("");
  });

  it("stay bounded however many distinct classes a page draws", () => {
    for (let index = 0; index < 5000; index += 1) partNames(`tl-x${String(index)}`);
    expect(partNames("tl-x4999")).toBe("x4999");
  });

  it("are printed into a scene for a server's shadow root", () => {
    const scene = withParts(renderTimeline(frame()).scene);
    expect(scene.attrs?.part).toBe("timeline");
    expect(itemRect(scene, "a").attrs?.part).toBe("item urgent");
    const svg = renderToSvgString(scene);
    expect(svg).toContain('part="tick');
    // A node without a class has no part.
    expect(find(scene, (node) => node.tag === "title").every((node) => node.attrs?.part === undefined)).toBe(true);
  });

  it("are written by the mount, with the class, and only where asked", () => {
    const plain = fakeContainer();
    mountScene(plain.container as unknown as Element).update(renderTimeline(frame()).scene);
    const all = (node: FakeElement, into: FakeElement[] = []): FakeElement[] => {
      into.push(node);
      for (const child of node.childNodes) if (child instanceof FakeElement) all(child, into);
      return into;
    };
    expect(all(plain.container).some((node) => node.attributes.has("part"))).toBe(false);

    const { container, ledger } = fakeContainer();
    const mount = mountScene(container as unknown as Element, { parts: true });
    mount.update(renderTimeline(frame()).scene);
    const rect = all(container).find((node) => node.attributes.get("data-tl-id") === "a" && node.tagName === "rect") as FakeElement;
    expect(rect.attributes.get("part")).toBe("item urgent");
    expect((container.childNodes[0] as FakeElement).attributes.get("part")).toBe("timeline");

    // A redraw that changes no class writes no part.
    resetLedger(ledger);
    const write = FakeElement.prototype.setAttribute;
    let partWrites = 0;
    FakeElement.prototype.setAttribute = function (this: FakeElement, name: string, value: string) {
      if (name === "part") partWrites += 1;
      write.call(this, name, value);
    };
    try {
      mount.update(renderTimeline(frame({ domain: [T0 + DAY, T0 + 21 * DAY] })).scene);
    } finally {
      FakeElement.prototype.setAttribute = write;
    }
    expect(partWrites).toBe(0);
    expect(ledger.attrWrites).toBeGreaterThan(0);

    // The selection is a class, so it is a part.
    mount.update(renderTimeline(frame({ selectedIds: ["a"] })).scene);
    expect(rect.attributes.get("part")).toBe("item item-selected urgent");
    mount.update(renderTimeline(frame()).scene);
    expect(rect.attributes.get("part")).toBe("item urgent");
  });

  it("drop with the class", () => {
    const { container } = fakeContainer();
    const mount = mountScene(container as unknown as Element, { parts: true });
    mount.update({ tag: "svg", attrs: { class: "tl" }, children: [{ tag: "g", attrs: { class: "tl-x" } }] });
    const g = (container.childNodes[0] as FakeElement).childNodes[0] as FakeElement;
    expect(g.attributes.get("part")).toBe("x");
    mount.update({ tag: "svg", attrs: { class: "tl" }, children: [{ tag: "g", attrs: { id: "y" } }] });
    expect(g.attributes.has("part")).toBe(false);
    mount.update({ tag: "svg", attrs: { class: "tl" }, children: [{ tag: "g", attrs: { class: "" } }] });
    expect(g.attributes.has("part")).toBe(false);
  });

  it("are given to a server's nodes the mount takes over, and the server's own are not the scene's", () => {
    const serve = (withPartsPrinted: boolean) => {
      const { container, ledger } = fakeContainer();
      const doc = container.ownerDocument as FakeDocument;
      const scene = renderTimeline(frame()).scene;
      // A minimal parse: the root and one item rect.
      const root = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
      for (const [name, value] of Object.entries(scene.attrs ?? {})) if (value !== undefined) root.attributes.set(name, String(value));
      if (withPartsPrinted) root.attributes.set("part", "timeline");
      container.appendChild(root);
      resetLedger(ledger);
      const mount = mountScene(container as unknown as Element, { hydrate: true, parts: true });
      mount.update({ ...scene, children: [] });
      return { root, ledger };
    };
    for (const printed of [false, true]) {
      const { root } = serve(printed);
      expect(root.attributes.get("part")).toBe("timeline");
    }
  });
});

describe("slotHooks", () => {
  const slotsOf = (scene: SceneElement): string[] =>
    find(scene, (node) => node.attrs?.["data-tl-slot"] !== undefined).map((node) => String(node.attrs?.["data-tl-slot"]));

  it("leaves each item an empty box named by it, over its own node, instead of its label", () => {
    const scene = renderTimeline(frame({ hooks: slotHooks(() => true) })).scene;
    expect(slotsOf(scene).sort()).toEqual(["a", "b", "c"]);
    const box = find(scene, (node) => node.attrs?.["data-tl-slot"] === "a")[0] as SceneElement;
    expect(box.children).toBeUndefined();
    expect(box.text).toBeUndefined();
    const group = find(scene, (node) => node.tag === "g" && node.attrs?.["data-tl-id"] === "a")[0] as SceneElement;
    expect(group.children?.[1]?.attrs?.class).toBe("tl-label tl-slot");
    // The item's own node keeps its name; the label is the box.
    expect(group.attrs?.["aria-label"]).toContain("Design");
    expect(find(scene, (node) => node.tag === "foreignObject" && node.attrs?.class === "tl-label")).toHaveLength(0);
  });

  it("draws the items it does not pick as they were, on the host's own hooks", () => {
    const scene = renderTimeline(
      frame({
        hooks: slotHooks((item) => item.laneId === "l1", {
          renderLabel: (context) => ({ tag: "text", attrs: { class: "own-label" }, text: context.placed.item.label ?? "" }),
        }),
      }),
    ).scene;
    expect(slotsOf(scene).sort()).toEqual(["a", "b"]);
    expect(find(scene, (node) => node.attrs?.class === "own-label").map((node) => node.text)).toEqual(["Ship"]);
  });

  it("forgets an item it no longer picks, and keeps a node the host drew as nothing", () => {
    let pick = true;
    const hooks = slotHooks(() => pick, { renderItem: (context) => (context.placed.item.id === "c" ? null : { tag: "rect", attrs: { class: "tl-item", "data-tl-id": context.placed.item.id } }) });
    expect(slotsOf(renderTimeline(frame({ hooks })).scene).sort()).toEqual(["a", "b"]);
    pick = false;
    const scene = renderTimeline(frame({ hooks, domain: [T0, T0 + 21 * DAY] })).scene;
    expect(slotsOf(scene)).toEqual([]);
    expect(find(scene, (node) => node.tag === "foreignObject" && node.attrs?.class === "tl-label").length).toBeGreaterThan(0);
  });

  it("leaves a cluster's count to the label", () => {
    const crowd: Item[] = Array.from({ length: 60 }, (_, index) => ({ id: `i${String(index)}`, start: T0 + index * 60_000, label: `Item ${String(index)}`, laneId: "l1" }));
    const result = renderTimeline(frame({ items: crowd, cluster: true, hooks: slotHooks(() => true) }));
    expect(result.clusters.length).toBeGreaterThan(0);
    expect(find(result.scene, (node) => String(node.attrs?.class ?? "").includes("tl-cluster-count")).length).toBeGreaterThan(0);
  });
});
