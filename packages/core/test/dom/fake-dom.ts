/**
 * The smallest DOM the mount needs, with a ledger of every write.
 *
 * The mount reaches the document through the container it is handed, so a
 * plain object tree is a complete stand-in. What a real DOM cannot give, and
 * this one does, is the ledger: how many elements were created, how many
 * attributes were written and to which node. That is the claim the mount
 * exists to make — that a pan writes only what changed — and it is a claim
 * about writes, not about the final picture.
 */

import type { SceneElement } from "../../src/scene.js";
import { formatNumber } from "../../src/scene.js";

export interface Ledger {
  created: number;
  texts: number;
  attrWrites: number;
  attrRemovals: number;
  inserts: number;
  removals: number;
  /** Attribute writes per element, by its `data-tl-id` when it has one. */
  readonly writesById: Map<string, number>;
}

export class FakeText {
  parentNode: FakeElement | null = null;
  readonly nodeType = 3;
  constructor(public data: string) {}
  get nextSibling(): FakeNode | null {
    return this.parentNode?.siblingAfter(this) ?? null;
  }
}

/** What a parser leaves between tags that no scene ever describes. */
export class FakeComment {
  parentNode: FakeElement | null = null;
  readonly nodeType = 8;
  constructor(public data: string) {}
  get nextSibling(): FakeNode | null {
    return this.parentNode?.siblingAfter(this) ?? null;
  }
}

export type FakeNode = FakeElement | FakeText | FakeComment;

export class FakeElement {
  parentNode: FakeElement | null = null;
  readonly nodeType = 1;
  readonly childNodes: FakeNode[] = [];
  readonly attributes = new Map<string, string>();
  constructor(
    readonly ledger: Ledger,
    readonly ownerDocument: FakeDocument,
    readonly tagName: string,
  ) {}

  get firstChild(): FakeNode | null {
    return this.childNodes[0] ?? null;
  }

  get nextSibling(): FakeNode | null {
    return this.parentNode?.siblingAfter(this) ?? null;
  }

  get localName(): string {
    return this.tagName;
  }

  getAttributeNames(): string[] {
    return [...this.attributes.keys()];
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  siblingAfter(node: FakeNode): FakeNode | null {
    const index = this.childNodes.indexOf(node);
    return index < 0 ? null : (this.childNodes[index + 1] ?? null);
  }

  setAttribute(name: string, value: string): void {
    this.ledger.attrWrites += 1;
    const id = this.attributes.get("data-tl-id") ?? (name === "data-tl-id" ? value : undefined);
    if (id !== undefined) {
      this.ledger.writesById.set(id, (this.ledger.writesById.get(id) ?? 0) + 1);
    }
    this.attributes.set(name, value);
  }

  removeAttribute(name: string): void {
    this.ledger.attrRemovals += 1;
    this.attributes.delete(name);
  }

  private detach(node: FakeNode): void {
    if (node.parentNode !== null) {
      const siblings = node.parentNode.childNodes;
      siblings.splice(siblings.indexOf(node), 1);
      node.parentNode = null;
    }
  }

  insertBefore<N extends FakeNode>(node: N, ref: FakeNode | null): N {
    this.ledger.inserts += 1;
    this.detach(node);
    const index = ref === null ? this.childNodes.length : this.childNodes.indexOf(ref);
    if (index < 0) {
      throw new Error("insertBefore: the reference node is not a child");
    }
    this.childNodes.splice(index, 0, node);
    node.parentNode = this;
    return node;
  }

  appendChild<N extends FakeNode>(node: N): N {
    return this.insertBefore(node, null);
  }

  removeChild<N extends FakeNode>(node: N): N {
    if (node.parentNode !== this) {
      throw new Error("removeChild: not a child");
    }
    this.ledger.removals += 1;
    this.detach(node);
    return node;
  }

  /** Every element below, itself included. */
  count(): number {
    let total = 1;
    for (const child of this.childNodes) {
      if (child instanceof FakeElement) {
        total += child.count();
      }
    }
    return total;
  }
}

export class FakeDocument {
  readonly defaultView: null = null;
  constructor(readonly ledger: Ledger) {}
  createElementNS(_namespace: string, tag: string): FakeElement {
    this.ledger.created += 1;
    return new FakeElement(this.ledger, this, tag);
  }
  createTextNode(data: string): FakeText {
    this.ledger.texts += 1;
    return new FakeText(data);
  }
}

export function freshLedger(): Ledger {
  return {
    created: 0,
    texts: 0,
    attrWrites: 0,
    attrRemovals: 0,
    inserts: 0,
    removals: 0,
    writesById: new Map(),
  };
}

export function resetLedger(ledger: Ledger): void {
  ledger.created = 0;
  ledger.texts = 0;
  ledger.attrWrites = 0;
  ledger.attrRemovals = 0;
  ledger.inserts = 0;
  ledger.removals = 0;
  ledger.writesById.clear();
}

/** A container element in a fresh document. */
export function fakeContainer(): { container: FakeElement; ledger: Ledger } {
  const ledger = freshLedger();
  const doc = new FakeDocument(ledger);
  const container = new FakeElement(ledger, doc, "div");
  return { container, ledger };
}

/**
 * Whether a live element shows exactly this scene element.
 *
 * Attributes are compared as a set (a patched node may have had them written
 * in another order than the serialiser emits them, and attribute order means
 * nothing to a browser), values exactly as the serialiser would print them.
 * Returns the first difference, or undefined.
 */
export function differs(live: FakeElement, scene: SceneElement, path = "root"): string | undefined {
  if (live.tagName !== scene.tag) {
    return `${path}: <${live.tagName}> where <${scene.tag}> belongs`;
  }
  const expected = new Map<string, string>();
  for (const [name, value] of Object.entries(scene.attrs ?? {})) {
    if (value !== undefined) {
      expected.set(name, typeof value === "number" ? formatNumber(value) : value);
    }
  }
  if (expected.size !== live.attributes.size) {
    return `${path}: ${String(live.attributes.size)} attributes where ${String(expected.size)} belong (${[...live.attributes.keys()].join(",")} vs ${[...expected.keys()].join(",")})`;
  }
  for (const [name, value] of expected) {
    if (live.attributes.get(name) !== value) {
      return `${path}: ${name}="${String(live.attributes.get(name))}" where "${value}" belongs`;
    }
  }
  const text = scene.text ?? "";
  const first = live.childNodes[0];
  const liveText = first instanceof FakeText ? first.data : "";
  if (liveText !== text) {
    return `${path}: text "${liveText}" where "${text}" belongs`;
  }
  const elements = live.childNodes.filter((node): node is FakeElement => node instanceof FakeElement);
  const texts = live.childNodes.filter((node) => node instanceof FakeText).length;
  if (texts > (text === "" ? 0 : 1)) {
    return `${path}: ${String(texts)} text nodes`;
  }
  const children = scene.children ?? [];
  if (elements.length !== children.length) {
    return `${path}: ${String(elements.length)} children where ${String(children.length)} belong`;
  }
  for (let index = 0; index < children.length; index += 1) {
    const reason = differs(
      elements[index] as FakeElement,
      children[index] as SceneElement,
      `${path}/${String(index)}:${children[index]?.tag ?? "?"}`,
    );
    if (reason !== undefined) {
      return reason;
    }
  }
  return undefined;
}
