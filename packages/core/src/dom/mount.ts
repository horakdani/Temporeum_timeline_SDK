/**
 * The DOM half of the renderer: a scene into live nodes, patched in place.
 *
 * A host once turned a frame into a string and assigned it to
 * `innerHTML`. That is correct and it is what the server does, but in a
 * browser it throws away every node on every frame and has the parser build
 * them again — at 2000 visible items, a pan frame created and discarded about
 * 4000 elements. This file keeps the nodes and changes only what changed.
 *
 * **Keyed where identity exists.** An item node is matched by its
 * `data-tl-id`, a lane by its `data-tl-lane`. When a pan moves an item, its
 * rect is the same element with a new `x`; its `<title>` is not touched at
 * all. Everything without an identity — ticks, labels, decorations — is
 * matched by position among siblings of the same tag, which is exactly how
 * the scene emits them.
 *
 * **Rehomed across a released parent.** An item's node is found by its
 * `data-tl-id` beyond its own parent too, but only inside a parent this
 * mount has let go of: when a tile of one scale gives way to tiles of
 * another (a stepped re-anchor), every item it held moves to its new
 * tile as the same element, with a new `x` and width — not a new element
 * with all of its attributes written. A parent still in the scene is never
 * robbed, so a hook's node that repeats an item's id cannot take it.
 *
 * **Pooled where identity ends.** An item that scrolls out releases its node
 * into a pool, with its children still attached, and the next item that
 * scrolls in takes it from there. A long pan therefore stops creating nodes
 * once the pool holds one screen's worth: that is what the memory check
 * measures, from the counters below and from the browser's own node count.
 *
 * **No reads.** What a node currently shows is remembered on the side, so a
 * patch never asks the DOM for an attribute — a read in the middle of writes
 * is what turns a patch into a forced layout per element.
 *
 * Like the other bindings it reaches no global: the document comes from the
 * container the host hands over.
 */

import { partNames } from "../parts.js";
import { formatNumber } from "../scene.js";
import type { SceneElement } from "../scene.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const NO_ATTRS: Readonly<Record<string, string | number | undefined>> = Object.freeze({});
/** Children of a node that has none: shared, since a patch replaces the array rather than changing it. */
const NO_CHILDREN: Element[] = [];
const XHTML_NS = "http://www.w3.org/1999/xhtml";

/**
 * Most nodes of one tag the pool keeps.
 *
 * The pool exists so that a pan reuses nodes; it does not exist to remember
 * the largest frame ever drawn. Past this, a released node is let go for the
 * collector. Twice the stated budget of visible items, so a zoom out and back
 * in at the budget still finds every node it needs.
 */
export const DEFAULT_POOL_LIMIT = 4096;

/** How a mount is set up. */
export interface MountOptions {
  /**
   * Give every node its classes as `part`s (`partNames`), so a page styles
   * a drawing in a shadow root with `::part()`. Written when a node's class
   * changes, never read; off by default, where a page's stylesheet reaches
   * the classes themselves.
   */
  readonly parts?: boolean;
  /**
   * Most released nodes of one tag kept for reuse. {@link DEFAULT_POOL_LIMIT}
   * by default; 0 turns pooling off, which is what the memory benchmark's
   * negative control does to prove it can tell the difference.
   */
  readonly poolLimit?: number;
  /**
   * Take over the scene root a server already rendered into the container,
   * instead of appending a new one beside it.
   *
   * The first update looks for a child element of the scene's tag, reads
   * what it shows once — the only read this file ever does — and patches
   * it from there. The nodes stay the same nodes: a focus the user put on
   * the server's timeline before the script arrived survives, and nothing
   * flashes. Whatever the server drew differently (another width, another
   * locale's labels) is patched like any other change.
   *
   * Off by default: a container that holds the host's own `<svg>` must not
   * have it claimed.
   */
  readonly hydrate?: boolean;
  /**
   * The nonce a scene's `<style>` carries where it has to be an element.
   *
   * A scene's stylesheet goes into `adoptedStyleSheets` of the container's
   * document or shadow root, which a `style-src` without `'unsafe-inline'`
   * allows. Only where that is not possible — a container not yet in a
   * document, a browser without constructable stylesheets — is it written
   * as a `<style>`, and under such a policy that one needs this nonce.
   */
  readonly nonce?: string;
}

/** What the mount did, cumulatively. The numbers a node budget is checked by. */
export interface MountStats {
  /** Elements created, ever. Stops growing once the pool is warm. */
  readonly created: number;
  /**
   * Elements taken from the pool instead of created — directly, or out of
   * an element in it: an item rehomed from a released tile, with its
   * children, is the pool's too.
   */
  readonly reused: number;
  /** Elements released into the pool. */
  readonly released: number;
  /** Released elements the full pool let go of. */
  readonly discarded: number;
  /** Elements in the pool now, waiting to be reused. */
  readonly pooled: number;
  /** Patches applied. */
  readonly frames: number;
}

/** A mounted scene. */
export interface SceneMount {
  /** Patch the live nodes to show this scene. */
  update(scene: SceneElement): void;
  /** The root element, once the first scene is mounted. */
  readonly root: Element | undefined;
  readonly stats: MountStats;
  /** Remove the root from the container and drop the pool. */
  destroy(): void;
}

/** What a live element currently shows. Kept so a patch never reads the DOM. */
interface Shown {
  readonly tag: string;
  /** The pool it goes back to: its tag, and its namespace when that is HTML. */
  readonly kind: string;
  /** What the node is matched by across frames, if anything. See {@link identityOf}. */
  identity: string | undefined;
  /** The patch that last claimed it, so claiming needs no set. */
  stamp: number;
  /**
   * Identified children by identity — kept across frames, updated by the
   * change. Made when the first identified child is: a rect and its title
   * need none.
   */
  index: Map<string, Element> | undefined;
  /**
   * The scene attributes it shows: the very object last patched in, or what
   * a server wrote. A scene is not changed once handed over, so this is
   * what the element carries, and the same object again means nothing to
   * write. One reference per node: two maps of its attributes per node, as an
   * earlier version kept, were a third of the heap a long pan grows by.
   */
  attrs: Readonly<Record<string, string | number | undefined>>;
  /** How many of them are set: a scene that sets fewer may have dropped one. */
  defined: number;
  text: Text | undefined;
  children: Element[];
  /**
   * The children array last patched in. A scene is not changed once handed
   * over, so the same array again means the same children — and a renderer
   * that hands back an unchanged layer gets it skipped on one comparison
   * instead of a walk over thousands of nodes.
   */
  childrenFrom: readonly SceneElement[] | undefined;
}

/**
 * What a node is matched by across frames.
 *
 * Its key when it has one: an item by `data-tl-id`, a lane by
 * `data-tl-lane`, a cluster's marker by `data-tl-cluster`, a tile of a
 * frame drawn in a space by `data-tl-tile` — a pan that adds a tile in
 * front must not hand every tile its neighbour's items — and an item's
 * label by `data-tl-label`. Otherwise its text, when it has some: a tick
 * label that stays in view keeps its node and only moves — matching by
 * position would hand every one after a new one its neighbour's text, and
 * new text is the one change that makes the browser shape glyphs again. A
 * `<title>` is the exception: it is its item's only child, so its position
 * already finds it, and a changed name is then patched in rather than a new
 * node built for it. Nodes with neither — tick lines, decoration shapes,
 * the layers — are matched by position among siblings of the same tag,
 * which is how the scene emits them.
 *
 * An item's identity is its id itself, the very string the scene holds, so
 * a node remembers it without a copy; every other kind starts with a NUL
 * and a letter for its namespace — and so does an item id that happens to
 * start with a NUL, so no two kinds can meet.
 */
function identityOf(node: SceneElement): string | undefined {
  const attrs = node.attrs;
  if (attrs !== undefined) {
    // A lane shares the namespace: its node sits in a layer, which is never
    // let go of, so it is never rehomed, nor rehomed into.
    const id = attrs["data-tl-id"] ?? attrs["data-tl-lane"];
    if (id !== undefined) {
      const key = String(id);
      return key.charCodeAt(0) === 0 ? `\u0000#${key}` : key;
    }
    // A cluster's marker is named after its first member, so it keeps a
    // namespace of its own: when a zoom dissolves it, the member's node is
    // a different node, not the marker under a new class.
    const cluster = attrs["data-tl-cluster"];
    if (cluster !== undefined) {
      return `\u0000%${String(cluster)}`;
    }
    const tile = attrs["data-tl-tile"];
    if (tile !== undefined) {
      return `\u0000@${String(tile)}`;
    }
    const label = attrs["data-tl-label"];
    if (label !== undefined) {
      return `\u0000&${String(label)}`;
    }
  }
  const text = node.text;
  return text === undefined || text === "" || node.tag === "title" ? undefined : `\u0000~${text}`;
}

/**
 * Whether an identity is followed into a released parent: an item's, and
 * an item's label — a zoom's refill moves both into the new scale's
 * tiles, and a label built anew there is three nodes and its text shaped.
 */
function isItem(identity: string): boolean {
  return identity.charCodeAt(0) !== 0 || identity.charCodeAt(1) === 35 || identity.charCodeAt(1) === 38;
}

/**
 * Mount scenes into a container, patching instead of rebuilding.
 *
 * The mount owns one element in the container — the scene's root — and
 * leaves anything else the host put there alone.
 */
export function mountScene(container: Element | DocumentFragment, options: MountOptions = {}): SceneMount {
  const doc = container.ownerDocument;
  const poolLimit = options.poolLimit ?? DEFAULT_POOL_LIMIT;
  const parts = options.parts === true;
  const shown = new WeakMap<Element, Shown>();
  // Oldest first: a node let go of a moment ago may still hold items the
  // next tile is about to rehome, so it is the last one handed out again.
  const pool = new Map<string, (Element | undefined)[] & { head: number }>();
  /** The element last known by each item identity, wherever it is. */
  const homes = new Map<string, Element>();
  let root: Element | undefined;
  /** Each `<style>`'s constructed sheet, with the text it holds, and where they are adopted. */
  const sheets = new Map<Element, [CSSStyleSheet, string]>();
  let sheetHost: DocumentOrShadowRoot | undefined;
  let created = 0;
  let reused = 0;
  let released = 0;
  let discarded = 0;
  let pooled = 0;
  let frames = 0;

  function make(tag: string, html = false): Element {
    const kind = html ? `html:${tag}` : tag;
    const queue = pool.get(kind);
    const spare = queue?.[queue.head];
    if (queue !== undefined && spare !== undefined) {
      queue[queue.head++] = undefined;
      // What was handed out is cut off once it outgrows what is kept.
      if (queue.head > poolLimit) {
        queue.splice(0, queue.head);
        queue.head = 0;
      }
      pooled -= 1;
      // It comes with its children — a rect with its title, a label with its
      // line — none of which is created, as when an item is rehomed.
      reused += 1 + descendants(spare);
      return spare;
    }
    created += 1;
    // A `<style>` whose sheet is adopted is an element of no namespace: one
    // the browser does not read as a stylesheet, so a policy has nothing to
    // block — not even an empty one.
    const element = doc.createElementNS(html ? XHTML_NS : tag === "style" && sheetRoot() ? null : SVG_NS, tag);
    if (tag === "style" && options.nonce !== undefined) element.setAttribute("nonce", options.nonce);
    shown.set(element, {
      tag,
      kind,
      identity: undefined,
      stamp: 0,
      index: undefined,
      attrs: NO_ATTRS,
      defined: 0,
      text: undefined,
      children: NO_CHILDREN,
      childrenFrom: undefined,
    });
    return element;
  }

  /**
   * Remember what a server-rendered element shows, as if a patch had
   * written it. What the serialiser never puts between tags — whitespace a
   * template added, comments — is dropped, so a later patch walks only nodes
   * it knows. Whitespace has to go rather than be kept as the element's
   * text: a layer would then be known by that text, and the next patch,
   * looking for a layer known by nothing, would build it again.
   */
  function adopt(element: Element): void {
    const attrs: Record<string, string> = {};
    // A `part` is this mount's, not the scene's: it follows the class.
    const names = element.getAttributeNames().filter((name) => name !== "part");
    for (const name of names) {
      attrs[name] = element.getAttribute(name) as string;
    }
    // A policy without 'unsafe-inline' kept the server's `style` from
    // applying; written through the CSSOM, it does.
    if (attrs.style !== undefined) (element as HTMLElement).style.cssText = attrs.style;
    if (parts) writeParts(element, attrs.class);
    let text: Text | undefined;
    const children: Element[] = [];
    for (let node = element.firstChild; node !== null; ) {
      const next = node.nextSibling;
      if (node.nodeType === 1) {
        adopt(node as Element);
        children.push(node as Element);
      } else if (node.nodeType === 3 && text === undefined && children.length === 0 && /\S/.test((node as Text).data)) {
        text = node as Text;
      } else {
        element.removeChild(node);
      }
      node = next;
    }
    const tag = element.localName;
    shown.set(element, {
      tag,
      kind: element.namespaceURI === XHTML_NS ? `html:${tag}` : tag,
      identity: identityOf({ tag, attrs, ...(text === undefined ? {} : { text: text.data }) }),
      stamp: 0,
      index: undefined,
      attrs,
      defined: names.length,
      text,
      children,
      childrenFrom: undefined,
    });
  }

  /** Elements below one, as this mount knows them. */
  function descendants(element: Element): number {
    let count = 0;
    for (const child of (shown.get(element) as Shown).children) {
      if (child.parentNode === element) {
        count += 1 + descendants(child);
      }
    }
    return count;
  }

  /** Drop every item identity that points into a subtree let go of for good. */
  function forget(element: Element): void {
    const state = shown.get(element) as Shown;
    if (state.identity !== undefined && homes.get(state.identity) === element) {
      homes.delete(state.identity);
    }
    for (const child of state.children) {
      if (child.parentNode === element) {
        forget(child);
      }
    }
  }

  function release(element: Element): void {
    released += 1;
    const state = shown.get(element) as Shown;
    // A `<style>` let go of stops applying, though its sheet stays adopted.
    const held = sheets.get(element);
    if (held !== undefined) held[0].replaceSync((held[1] = ""));
    // Whoever takes it next patches its children fully: what it showed is
    // still remembered, but not as anything a scene could hand back.
    state.childrenFrom = undefined;
    let queue = pool.get(state.kind);
    if (queue === undefined) {
      queue = Object.assign([], { head: 0 });
      pool.set(state.kind, queue);
    }
    if (queue.length - queue.head >= poolLimit) {
      discarded += 1;
      // Let go of for good: nothing may be rehomed from it, nor keep it alive.
      forget(element);
      return;
    }
    queue.push(element);
    pooled += 1;
  }

  function writeParts(element: Element, className: string | number | undefined): void {
    const names = className === undefined ? "" : partNames(String(className));
    if (names === "") element.removeAttribute("part");
    else element.setAttribute("part", names);
  }

  /** An attribute value as written: numbers through the scene's own formatting. */
  const written = (value: string | number): string => (typeof value === "number" ? formatNumber(value) : value);

  function patchAttrs(element: Element, state: Shown, next: SceneElement): void {
    const attrs = next.attrs ?? NO_ATTRS;
    const last = state.attrs;
    if (attrs === last) {
      return;
    }
    let defined = 0;
    let kept = 0;
    for (const name in attrs) {
      const value = attrs[name];
      if (value === undefined) {
        continue;
      }
      defined += 1;
      const before = last[name];
      if (before !== undefined) {
        kept += 1;
      }
      // The raw value first: in an item space a kept item's numbers are the
      // same to the bit, and formatting 14 000 of them per frame only to find
      // the strings equal was most of a pan frame's script time.
      if (before === value) {
        continue;
      }
      const text = written(value);
      if (before === undefined || written(before) !== text) {
        // Through the CSSOM, which a `style-src` without 'unsafe-inline' allows.
        if (name === "style") (element as HTMLElement).style.cssText = text;
        else element.setAttribute(name, text);
      }
    }
    if (kept < state.defined) {
      for (const name in last) {
        if (last[name] !== undefined && attrs[name] === undefined) {
          element.removeAttribute(name);
        }
      }
    }
    if (parts && attrs.class !== last.class) writeParts(element, attrs.class);
    state.attrs = attrs;
    state.defined = defined;
  }

  /** The container's document or shadow root, where it takes constructed sheets. */
  function sheetRoot(): (Node & DocumentOrShadowRoot) | undefined {
    const host = container.getRootNode?.() as (Node & DocumentOrShadowRoot) | undefined;
    return host?.adoptedStyleSheets && doc.defaultView?.CSSStyleSheet ? host : undefined;
  }

  /**
   * A stylesheet into the container's document or shadow root, where it
   * applies exactly as the `<style>` would, CSP or not. False where there is
   * no such root — the `<style>` keeps its text.
   */
  function adoptSheet(element: Element, text: string): boolean {
    const host = sheetRoot();
    if (!host) return false;
    let held = sheets.get(element);
    if (!held) {
      sheets.set(element, (held = [new (doc.defaultView as typeof globalThis).CSSStyleSheet(), ""]));
      (sheetHost = host).adoptedStyleSheets = [...host.adoptedStyleSheets, held[0]];
    }
    if (held[1] !== text) held[0].replaceSync((held[1] = text));
    return true;
  }

  /** Every sheet this mount adopted, out of its root. */
  function dropSheets(): void {
    const mine = [...sheets.values()].map((held) => held[0]);
    if (sheetHost) sheetHost.adoptedStyleSheets = sheetHost.adoptedStyleSheets.filter((sheet) => !mine.includes(sheet));
    sheets.clear();
  }

  function patchText(element: Element, state: Shown, next: SceneElement): void {
    let text = next.text ?? "";
    // A server's `<style>` stays while it says the same — taking it over
    // writes nothing — and goes once it would say something stale.
    if (state.tag === "style" && adoptSheet(element, text) && state.text?.data !== text) text = "";
    if (text === "") {
      if (state.text !== undefined) {
        element.removeChild(state.text);
        state.text = undefined;
      }
      return;
    }
    if (state.text === undefined) {
      state.text = doc.createTextNode(text);
      element.insertBefore(state.text, element.firstChild);
    } else if (state.text.data !== text) {
      state.text.data = text;
    }
  }

  let stampCounter = 0;

  function patchChildren(element: Element, state: Shown, next: readonly SceneElement[]): void {
    if (state.childrenFrom === next) {
      return;
    }
    state.childrenFrom = next;
    const old = state.children;
    if (old.length === 0 && next.length === 0) {
      return;
    }
    // The common case first: the same children, in the same order — a rect
    // and its title, a layer whose membership did not change. No index, no
    // allocation, just the patch.
    if (old.length === next.length) {
      let same = true;
      for (let index = 0; index < old.length; index += 1) {
        const child = old[index] as Element;
        const childState = shown.get(child) as Shown;
        const node = next[index] as SceneElement;
        // A child rehomed since is no longer here to patch.
        if (childState.tag !== node.tag || childState.identity !== identityOf(node) || child.parentNode !== element) {
          same = false;
          break;
        }
      }
      if (same) {
        for (let index = 0; index < old.length; index += 1) {
          patch(old[index] as Element, next[index] as SceneElement);
        }
        return;
      }
    }

    stampCounter += 1;
    const stamp = stampCounter;
    const index = state.index;
    // Claim the identified nodes through the kept index.
    const claimed: (Element | undefined)[] = new Array<Element | undefined>(next.length);
    let anonymous = false;
    for (let at = 0; at < next.length; at += 1) {
      const node = next[at] as SceneElement;
      const identity = identityOf(node);
      if (identity === undefined) {
        anonymous = true;
        continue;
      }
      const match = index?.get(identity);
      if (match !== undefined) {
        const matchState = shown.get(match) as Shown;
        if (matchState.tag === node.tag && matchState.stamp !== stamp) {
          matchState.stamp = stamp;
          claimed[at] = match;
          continue;
        }
      }
      // An item whose node sits in a parent this mount let go of — one taken
      // out of the scene, with no parent of its own — is taken from there.
      const home = homes.get(identity);
      const parent = home?.parentNode;
      const parentState = parent?.parentNode === null ? shown.get(parent as Element) : undefined;
      if (home !== undefined && parentState !== undefined) {
        const homeState = shown.get(home) as Shown;
        if (homeState.tag === node.tag && homeState.stamp !== stamp) {
          homeState.stamp = stamp;
          claimed[at] = home;
          // It comes with its children — a rect with its title — none of
          // which is created.
          reused += 1 + homeState.children.length;
          // Its old parent must not claim it back from where it is now.
          parentState.index?.delete(identity);
        }
      }
    }
    // The rest by position among unidentified siblings of the same tag.
    if (anonymous) {
      const byTag = new Map<string, Element[]>();
      for (const child of old) {
        const childState = shown.get(child) as Shown;
        if (childState.identity === undefined) {
          const list = byTag.get(childState.tag);
          if (list === undefined) {
            byTag.set(childState.tag, [child]);
          } else {
            list.push(child);
          }
        }
      }
      const cursor = new Map<string, number>();
      for (let at = 0; at < next.length; at += 1) {
        const node = next[at] as SceneElement;
        if (identityOf(node) !== undefined) {
          continue;
        }
        const position = cursor.get(node.tag) ?? 0;
        cursor.set(node.tag, position + 1);
        const match = byTag.get(node.tag)?.[position];
        if (match !== undefined) {
          (shown.get(match) as Shown).stamp = stamp;
          claimed[at] = match;
        }
      }
    }
    // Release before inserting: what stays then keeps its relative order, and
    // the walk below only inserts — it never has to move a kept node.
    for (const child of old) {
      const childState = shown.get(child) as Shown;
      if (childState.stamp !== stamp) {
        if (childState.identity !== undefined && index?.get(childState.identity) === child) {
          index.delete(childState.identity);
        }
        // Rehomed elsewhere: it lives on there, it is not this one's to let go.
        if (child.parentNode === element) {
          element.removeChild(child);
          release(child);
        }
      }
    }
    // What a `foreignObject` holds is HTML, and so is everything below it.
    const html = state.tag === "foreignObject" || element.namespaceURI === XHTML_NS;
    const children: Element[] = new Array<Element>(next.length);
    let ref: Node | null = state.text === undefined ? element.firstChild : state.text.nextSibling;
    for (let at = 0; at < next.length; at += 1) {
      const node = next[at] as SceneElement;
      const child = claimed[at] ?? make(node.tag, html);
      if (child === ref) {
        ref = ref.nextSibling;
      } else {
        element.insertBefore(child, ref);
      }
      const before = (shown.get(child) as Shown).identity;
      patch(child, node);
      const after = (shown.get(child) as Shown).identity;
      if (after !== before && before !== undefined) {
        if (state.index?.get(before) === child) {
          state.index.delete(before);
        }
        if (homes.get(before) === child) {
          homes.delete(before);
        }
      }
      if (after !== undefined) {
        // An only child — a rect's title — is matched by its position as
        // well as by any index: it needs none.
        if (next.length > 1) {
          (state.index ??= new Map()).set(after, child);
        }
        // Where an item's node is, whatever its parent. One its parent only
        // ever patched in place (a hydrated tile the client drew the same)
        // is not known here, and is built anew if it has to move.
        if (isItem(after)) {
          homes.set(after, child);
        }
      }
      children[at] = child;
    }
    state.children = children;
  }

  function patch(element: Element, next: SceneElement): void {
    const state = shown.get(element) as Shown;
    state.identity = identityOf(next);
    patchAttrs(element, state, next);
    patchText(element, state, next);
    patchChildren(element, state, next.children ?? []);
  }

  return {
    update(scene: SceneElement): void {
      frames += 1;
      if (root !== undefined && (shown.get(root) as Shown).tag !== scene.tag) {
        container.removeChild(root);
        dropSheets();
        root = undefined;
      }
      if (root === undefined && options.hydrate === true) {
        for (let node = container.firstChild; node !== null; node = node.nextSibling) {
          if (node.nodeType === 1 && (node as Element).localName === scene.tag) {
            root = node as Element;
            adopt(root);
            break;
          }
        }
      }
      if (root === undefined) {
        root = make(scene.tag);
        container.appendChild(root);
      }
      patch(root, scene);
    },
    get root() {
      return root;
    },
    get stats(): MountStats {
      return { created, reused, released, discarded, pooled, frames };
    },
    destroy(): void {
      if (root !== undefined && root.parentNode === container) {
        container.removeChild(root);
      }
      root = undefined;
      dropSheets();
      pool.clear();
      homes.clear();
      pooled = 0;
    },
  };
}
