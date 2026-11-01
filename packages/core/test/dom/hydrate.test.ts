import { describe, expect, it } from "vitest";

import { mountScene } from "../../src/dom/mount.js";
import { renderTimeline } from "../../src/render.js";
import type { RenderOptions } from "../../src/render.js";
import { renderToSvgString } from "../../src/scene.js";
import type { Item } from "../../src/types.js";
import { differs, FakeComment, FakeElement, FakeText, fakeContainer, resetLedger } from "./fake-dom.js";
import type { FakeDocument } from "./fake-dom.js";

/**
 * Hydration: the client takes over what the server rendered.
 *
 * The server's half is the string `renderToSvgString` prints — the same
 * function a Next or Astro page calls. A parser turns it into nodes, and the
 * claim is about those nodes: the mount keeps every one of them (none is
 * created, none is replaced), it writes nothing when the client's frame is
 * the server's frame, and it patches only the difference when it is not.
 */

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 1);

const items: Item[] = [
  { id: "a", start: T0, end: T0 + 4 * DAY, label: "Tervezés & <építés>", laneId: "l1" },
  { id: "b", start: T0 + 3 * DAY, end: T0 + 9 * DAY, label: "Építés \"élesben\"", laneId: "l1" },
  { id: "c", start: T0 + 10 * DAY, label: "Mérföldkő", laneId: "l2" },
];
const frame = (overrides: Partial<RenderOptions> = {}): RenderOptions => ({
  items,
  lanes: [
    { id: "l1", label: "Munka" },
    { id: "l2", label: "Szállítás" },
  ],
  domain: [T0, T0 + 20 * DAY],
  width: 800,
  height: 240,
  locale: "hu",
  timeZone: "UTC",
  ...overrides,
});

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const decode = (text: string): string => text.replace(/&(amp|lt|gt|quot|apos);/g, (_, name: string) => ENTITIES[name] as string);

/**
 * What a browser's parser makes of the serialiser's output, into the fake
 * document: elements, attributes, text, and — as a template engine would
 * leave them — whitespace and comments between tags.
 */
function parseInto(parent: FakeElement, markup: string, noise: boolean): void {
  const doc = parent.ownerDocument as FakeDocument;
  const stack: FakeElement[] = [parent];
  const token = /<(\/?)([a-zA-Z][\w-]*)((?:\s+[\w:-]+="[^"]*")*)\s*(\/?)>|([^<]+)/g;
  for (let match = token.exec(markup); match !== null; match = token.exec(markup)) {
    const top = stack[stack.length - 1] as FakeElement;
    const [, closing, tag, attrs, selfClosing, text] = match;
    if (text !== undefined) {
      top.appendChild(new FakeText(decode(text)));
      continue;
    }
    if (closing === "/") {
      stack.pop();
      continue;
    }
    const element = doc.createElementNS("http://www.w3.org/2000/svg", tag as string);
    for (const [, name, value] of (attrs ?? "").matchAll(/([\w:-]+)="([^"]*)"/g)) {
      element.attributes.set(name as string, decode(value as string));
    }
    if (noise && top !== parent) {
      top.appendChild(new FakeText("\n  "));
      top.appendChild(new FakeComment("template"));
    }
    top.appendChild(element);
    if (selfClosing !== "/") {
      stack.push(element);
    }
  }
}

function comments(node: FakeElement): number {
  let total = 0;
  for (const child of node.childNodes) {
    if (child instanceof FakeComment) total += 1;
    if (child instanceof FakeElement) total += comments(child);
  }
  return total;
}

function elements(node: FakeElement, into: FakeElement[] = []): FakeElement[] {
  into.push(node);
  for (const child of node.childNodes) {
    if (child instanceof FakeElement) elements(child, into);
  }
  return into;
}

function serverRendered(options: RenderOptions, noise = false) {
  const { container, ledger } = fakeContainer();
  // The host's own markup next to the timeline: the mount must not touch it.
  const caption = (container.ownerDocument as FakeDocument).createElementNS("", "p");
  container.appendChild(caption);
  parseInto(container, renderToSvgString(renderTimeline(options).scene), noise);
  resetLedger(ledger);
  const root = container.childNodes[1] as FakeElement;
  return { container, ledger, root, caption, nodes: elements(root) };
}

describe("mountScene({ hydrate: true })", () => {
  it("adopts the server's root and writes nothing when the client draws the same frame", () => {
    const server = serverRendered(frame());
    const mount = mountScene(server.container as unknown as Element, { hydrate: true });
    const scene = renderTimeline(frame()).scene;
    mount.update(scene);

    expect(mount.root).toBe(server.root);
    expect(server.container.childNodes).toHaveLength(2);
    expect(server.container.childNodes[0]).toBe(server.caption);
    expect(differs(server.root, scene)).toBeUndefined();
    // Not one node created, written, inserted or removed.
    expect(server.ledger).toMatchObject({ created: 0, texts: 0, attrWrites: 0, attrRemovals: 0, inserts: 0, removals: 0 });
    expect(mount.stats.created).toBe(0);
    // Every server node is still in the tree, in the same place.
    expect(elements(server.root)).toEqual(server.nodes);
  });

  it("patches only the difference when the client's frame is not the server's", () => {
    // The server could not know the container's width; it drew 800 px.
    const server = serverRendered(frame());
    const mount = mountScene(server.container as unknown as Element, { hydrate: true });
    const scene = renderTimeline(frame({ width: 1000 })).scene;
    mount.update(scene);

    expect(mount.root).toBe(server.root);
    expect(differs(server.root, scene)).toBeUndefined();
    // The item nodes were kept, keyed by their id, and only moved.
    const kept = server.nodes.filter((node) => node.attributes.has("data-tl-id"));
    expect(kept.length).toBeGreaterThan(0);
    for (const node of kept) {
      expect(elements(server.root)).toContain(node);
    }
    expect(server.ledger.attrWrites).toBeGreaterThan(0);
  });

  it("drops whitespace and comments a template put between tags, and keeps patching", () => {
    const server = serverRendered(frame(), true);
    const mount = mountScene(server.container as unknown as Element, { hydrate: true });
    const scene = renderTimeline(frame()).scene;
    mount.update(scene);

    expect(mount.root).toBe(server.root);
    expect(comments(server.root)).toBe(0);
    expect(differs(server.root, scene)).toBeUndefined();
    expect(server.ledger.created).toBe(0);

    // From here on it is an ordinary mount: a pan patches the adopted nodes.
    const panned = renderTimeline(frame({ domain: [T0 + 2 * DAY, T0 + 22 * DAY] })).scene;
    mount.update(panned);
    expect(differs(server.root, panned)).toBeUndefined();
  });

  it("matches adopted nodes by identity, so a reordered frame keeps them", () => {
    const server = serverRendered(frame());
    const mount = mountScene(server.container as unknown as Element, { hydrate: true });
    const byId = new Map(server.nodes.filter((node) => node.attributes.has("data-tl-id")).map((node) => [node.attributes.get("data-tl-id"), node]));
    // Selecting "a" changes its class and the listbox order nowhere else.
    const scene = renderTimeline(frame({ selectedIds: ["a"], focusedId: "c" })).scene;
    mount.update(scene);
    expect(differs(server.root, scene)).toBeUndefined();
    for (const node of elements(server.root).filter((each) => each.attributes.has("data-tl-id"))) {
      expect(byId.get(node.attributes.get("data-tl-id"))).toBe(node);
    }
  });

  it("without the option, appends a root of its own beside the server's", () => {
    const server = serverRendered(frame());
    const mount = mountScene(server.container as unknown as Element);
    mount.update(renderTimeline(frame()).scene);
    expect(mount.root).not.toBe(server.root);
    expect(server.container.childNodes).toHaveLength(3);
  });

  it("with the option and nothing to adopt, mounts as usual", () => {
    const { container } = fakeContainer();
    const caption = (container.ownerDocument as FakeDocument).createElementNS("", "p");
    container.appendChild(caption);
    const mount = mountScene(container as unknown as Element, { hydrate: true });
    const scene = renderTimeline(frame()).scene;
    mount.update(scene);
    expect(container.childNodes).toHaveLength(2);
    expect(differs(mount.root as unknown as FakeElement, scene)).toBeUndefined();
  });
});
