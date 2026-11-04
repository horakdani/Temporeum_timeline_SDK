/**
 * HTML templates for items, sanitised by default.
 *
 * A host that wants an item to show more than one line of text — a name in
 * bold and a status after it, an icon class, a small badge — writes it as
 * HTML, because that is what it already knows. The template's string never
 * reaches `innerHTML`. It is tokenised here, by a small parser of our own
 * that needs no DOM, into the scene's own elements: an allow-list decides
 * which tags and attributes survive, and text is always text. Two things
 * follow:
 *
 * 1. **The server and the browser draw the same thing.** The same function
 *    turns the same string into the same tree in Node and in a page, and the
 *    tree is printed or mounted like every other node of the frame — so a
 *    server-rendered template hydrates instead of being drawn twice.
 * 2. **A template cannot run code by default.** `<script>`, `<style>`,
 *    `<iframe>` and their content are dropped, every `on…` attribute is
 *    dropped, and so is any attribute outside the allow-list. A URL is not
 *    on the default list at all; one the host allows keeps only an http,
 *    https, mailto, tel or relative address, a `style` it allows loads
 *    nothing, and `<base>`, `<meta>`, `<link>` and `<form>` never survive.
 *    Nor do the timeline's own markers — a `data-tl-*` attribute or a `tl-*`
 *    class —, so one item's template cannot act as another item's control.
 *    `sanitize: false` keeps everything, and is only for a template the host
 *    wrote itself from data it trusts.
 *
 * The item keeps its accessible name: the render step sets `aria-label` on
 * the item's node, and the template is its picture, not its name.
 */

import { defaultItemNode, defaultLabelNode } from "../render.js";
import type { ItemRenderContext, RenderHooks } from "../render.js";
import type { SceneElement } from "../scene.js";
import type { Item } from "../types.js";
import { withoutId } from "./nodes.js";

/** The namespace of what a `foreignObject` holds. */
const XHTML_NS = "http://www.w3.org/1999/xhtml";

/** Tags a sanitised template keeps. Anything else is unwrapped: its text stays, the tag goes. */
export const TEMPLATE_TAGS: readonly string[] = [
  "abbr",
  "b",
  "bdi",
  "br",
  "code",
  "del",
  "div",
  "em",
  "i",
  "ins",
  "kbd",
  "li",
  "mark",
  "ol",
  "p",
  "q",
  "s",
  "small",
  "span",
  "strong",
  "sub",
  "sup",
  "time",
  "u",
  "ul",
];

/** Attributes a sanitised template keeps, besides `data-*` and `aria-*`. */
export const TEMPLATE_ATTRIBUTES: readonly string[] = ["class", "title", "lang", "dir", "datetime"];

/** Tags whose content goes with them: what is inside is code or chrome, not text. */
const DROPPED = new Set([
  "script",
  "style",
  "iframe",
  "frame",
  "frameset",
  "object",
  "embed",
  "template",
  "noscript",
  "textarea",
  "title",
  "svg",
  "math",
  "select",
  "option",
  "head",
]);

/** Tags that act on the page, not the item: never kept, even when allowed. Their content stays, as text. */
const NEVER = new Set(["base", "meta", "link", "form"]);

/** Attributes holding one address: kept only when it is relative or its scheme is in {@link SAFE_SCHEME}. */
const URL_ATTRIBUTES = new Set(["href", "src", "action", "formaction", "xlink:href", "poster", "cite", "background", "data", "codebase", "longdesc", "manifest"]);

/** Attributes holding a list of addresses: never kept by a sanitised template. */
const URL_LISTS = new Set(["srcset", "imagesrcset", "ping"]);

const SAFE_SCHEME = /^(?:https?|mailto|tel):/i;

/** An attribute name `setAttribute` accepts. */
const ATTRIBUTE_NAME = /^[a-z][a-z0-9._:-]*$/;

/**
 * An address when it is relative or names a safe scheme, read as a browser
 * reads it — leading controls and spaces gone, tabs and line breaks gone
 * throughout; otherwise `undefined`.
 */
function safeUrl(value: string): string | undefined {
  // eslint-disable-next-line no-control-regex
  const read = value.replace(/[\t\n\r]/g, "").replace(/^[\u0000-\u0020]+/, "");
  return /^[a-z][a-z0-9+.-]*:/i.test(read) && !SAFE_SCHEME.test(read) ? undefined : value;
}

/** A style that loads something — `url(`, `image-set(`, `expression(`, `@import` — or hides it behind an escape. */
const LOADING_STYLE = /\\|@import|(?:url|image|image-set|cross-fade|element|expression|src)\s*\(/i;

/** Tags with no closing tag. */
const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);

/** How a template is sanitised. */
export interface TemplateOptions {
  /**
   * `false` keeps every tag and attribute, scripts and handlers included.
   * Only for a template the host wrote from data it trusts.
   */
  readonly sanitize?: boolean;
  /** Tags kept, replacing {@link TEMPLATE_TAGS}. A dropped tag cannot be allowed. */
  readonly allowTags?: readonly string[];
  /** Attributes kept, replacing {@link TEMPLATE_ATTRIBUTES}. An `on…` attribute cannot be allowed. */
  readonly allowAttributes?: readonly string[];
}

const NAMED: Readonly<Record<string, string>> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decode(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    const name = body.toLowerCase();
    return Object.hasOwn(NAMED, name) ? (NAMED[name] as string) : whole;
  });
}

interface Draft {
  readonly tag: string;
  readonly attrs: Record<string, string>;
  /** Text runs and children, in document order. */
  readonly content: (string | Draft)[];
  readonly dropped: boolean;
  readonly kept: boolean;
}

const ATTRIBUTE = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

function attributesOf(source: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const match of source.matchAll(ATTRIBUTE)) {
    const name = (match[1] as string).toLowerCase();
    // A name the DOM would throw on is not an attribute.
    if (!ATTRIBUTE_NAME.test(name) || Object.hasOwn(attrs, name)) continue;
    attrs[name] = decode(match[2] ?? match[3] ?? match[4] ?? "");
  }
  return attrs;
}

/** A draft into scene elements: text first, later text runs as `<span>`s. */
function toScene(draft: Draft): SceneElement[] {
  const children: SceneElement[] = [];
  let text: string | undefined;
  for (const part of draft.content) {
    if (typeof part === "string") {
      if (part === "") continue;
      if (children.length === 0 && text === undefined) text = part;
      else children.push({ tag: "span", text: part });
      continue;
    }
    if (part.dropped) continue;
    const inner = toScene(part);
    if (!part.kept) {
      // Unwrapped: its content takes its place.
      for (const node of inner) children.push(node);
      continue;
    }
    children.push(...inner);
  }
  if (!draft.kept) {
    return text === undefined ? children : [{ tag: "span", text }, ...children];
  }
  const node: { tag: string; attrs?: Record<string, string>; text?: string; children?: SceneElement[] } = { tag: draft.tag };
  if (Object.keys(draft.attrs).length > 0) node.attrs = draft.attrs;
  if (text !== undefined) node.text = text;
  if (children.length > 0) node.children = children;
  return [node];
}

/** How deep a template's elements nest; a tag past it is unwrapped, its text kept. */
const MAX_DEPTH = 64;

/**
 * A template string as scene elements, sanitised unless told otherwise.
 * Deterministic and DOM-free: the server and the browser get the same tree.
 * Elements nest at most 64 deep.
 */
export function parseTemplate(html: string, options: TemplateOptions = {}): SceneElement[] {
  const sanitize = options.sanitize !== false;
  const tags = new Set((options.allowTags ?? TEMPLATE_TAGS).map((tag) => tag.toLowerCase()));
  const attributes = new Set((options.allowAttributes ?? TEMPLATE_ATTRIBUTES).map((name) => name.toLowerCase()));
  /** An attribute's value as the template keeps it, or `undefined`. */
  const kept = (name: string, value: string): string | undefined => {
    if (!sanitize) return value;
    if (name.startsWith("on") || name.startsWith("data-tl-") || URL_LISTS.has(name)) return undefined;
    if (!attributes.has(name) && !name.startsWith("data-") && !name.startsWith("aria-")) return undefined;
    if (URL_ATTRIBUTES.has(name)) return safeUrl(value);
    if (name === "style") return LOADING_STYLE.test(value) ? undefined : value;
    if (name === "class") {
      // The timeline's own classes are its, not the template's.
      const classes = value.split(/\s+/).filter((token) => token !== "" && !/^tl-/i.test(token));
      return classes.length === 0 ? undefined : classes.join(" ");
    }
    return value;
  };

  const root: Draft = { tag: "#root", attrs: {}, content: [], dropped: false, kept: false };
  const stack: Draft[] = [root];
  const top = (): Draft => stack[stack.length - 1] as Draft;
  let at = 0;
  while (at < html.length) {
    const open = html.indexOf("<", at);
    if (open < 0) {
      top().content.push(decode(html.slice(at)));
      break;
    }
    if (open > at) top().content.push(decode(html.slice(at, open)));
    if (html.startsWith("<!--", open)) {
      const close = html.indexOf("-->", open + 4);
      at = close < 0 ? html.length : close + 3;
      continue;
    }
    const close = html.indexOf(">", open);
    if (close < 0) {
      // A lone `<` is text.
      top().content.push(decode(html.slice(open)));
      break;
    }
    const body = html.slice(open + 1, close);
    at = close + 1;
    if (body.startsWith("!") || body.startsWith("?")) continue;
    if (body.startsWith("/")) {
      const name = body.slice(1).trim().toLowerCase();
      const index = stack.map((draft) => draft.tag).lastIndexOf(name);
      if (index > 0) stack.length = index;
      continue;
    }
    const nameMatch = /^([a-zA-Z][a-zA-Z0-9-]*)/.exec(body);
    if (nameMatch === null) {
      top().content.push(decode(`<${body}>`));
      continue;
    }
    const tag = (nameMatch[1] as string).toLowerCase();
    const raw = attributesOf(body.slice(tag.length).replace(/\/\s*$/, ""));
    const attrs: Record<string, string> = {};
    for (const [name, value] of Object.entries(raw)) {
      const keep = kept(name, value);
      if (keep !== undefined) attrs[name] = keep;
    }
    const dropped = sanitize && DROPPED.has(tag);
    if (dropped) {
      // Its content is code, not markup: skip to its own end tag.
      const end = new RegExp(`</${tag}`, "gi");
      end.lastIndex = at;
      const found = end.exec(html);
      at = found === null ? html.length : html.indexOf(">", found.index) + 1 || html.length;
      continue;
    }
    // Past the depth, a tag is unwrapped: its content goes on in the deepest element.
    if (stack.length > MAX_DEPTH) continue;
    const draft: Draft = { tag, attrs, content: [], dropped, kept: !sanitize || (tags.has(tag) && !NEVER.has(tag)) };
    top().content.push(draft);
    if (!VOID.has(tag) && !body.trimEnd().endsWith("/")) stack.push(draft);
  }
  return toScene(root);
}

/** What a template function is handed. */
export type TemplateContext<T = unknown> = ItemRenderContext<T>;

/** How {@link templateHooks} draws. */
export interface TemplateHookOptions<T = unknown> extends TemplateOptions {
  /** Hooks to build on: their item node is drawn under the template. */
  readonly hooks?: RenderHooks<T>;
}

/**
 * Render hooks that draw each item's template inside its box, over the item's
 * own node (`hooks.renderItem`, or the default bar). The template replaces
 * the item's label, so `renderLabel` draws nothing; the full text stays the
 * accessible name. A template that returns `""` or `null` leaves the item as
 * it was, label and all.
 */
export function templateHooks<T>(
  template: (item: Item<T>, context: TemplateContext<T>) => string | null,
  options: TemplateHookOptions<T> = {},
): RenderHooks<T> {
  const hooks = options.hooks ?? {};
  const base = hooks.renderItem ?? defaultItemNode;
  const templated = new Set<string>();
  // Each string is parsed once: a frame draws every visible item, and a pan draws many frames.
  const parsed = new Map<string, SceneElement[]>();
  const nodesOf = (html: string): SceneElement[] => {
    let nodes = parsed.get(html);
    if (nodes === undefined) {
      if (parsed.size >= 1000) parsed.clear();
      nodes = parseTemplate(html, options);
      parsed.set(html, nodes);
    }
    return nodes;
  };
  return {
    ...hooks,
    renderItem(context) {
      const node = base(context);
      const html = template(context.placed.item, context);
      const id = context.placed.item.id;
      if (html === null || html === "" || node === null) {
        templated.delete(id);
        return node;
      }
      templated.add(id);
      const screen = context.projector.projectRect(context.box);
      return {
        tag: "g",
        attrs: { "data-tl-id": id },
        children: [
          withoutId(node),
          {
            tag: "foreignObject",
            attrs: { class: "tl-label tl-template", x: screen.x, y: screen.y, width: screen.width, height: screen.height },
            children: [{ tag: "div", attrs: { xmlns: XHTML_NS }, children: nodesOf(html) }],
          },
        ],
      };
    },
    renderLabel(context) {
      if (context.cluster === undefined && templated.has(context.placed.item.id)) return null;
      return hooks.renderLabel === undefined ? defaultLabelNode(context) : hooks.renderLabel(context);
    },
  };
}

/**
 * Render hooks that leave each item an empty box for a framework to fill.
 *
 * The box is a `foreignObject` over the item's own node, holding one empty
 * `<div data-tl-slot="<id>">`. The scene never puts anything in it, so what
 * a host renders there — a React portal, a Vue teleport — is not the
 * mount's to patch. As with a template the box replaces the label, and the
 * label stays the item's accessible name; `slotted` returning `false` draws
 * the item as it was.
 */
export function slotHooks<T>(slotted: (item: Item<T>) => boolean, hooks: RenderHooks<T> = {}): RenderHooks<T> {
  const base = hooks.renderItem ?? defaultItemNode;
  const kept = new Set<string>();
  return {
    ...hooks,
    renderItem(context) {
      const node = base(context);
      const item = context.placed.item;
      if (node === null || !slotted(item)) {
        kept.delete(item.id);
        return node;
      }
      kept.add(item.id);
      const screen = context.projector.projectRect(context.box);
      return {
        tag: "g",
        attrs: { "data-tl-id": item.id },
        children: [
          withoutId(node),
          {
            tag: "foreignObject",
            attrs: { class: "tl-label tl-slot", x: screen.x, y: screen.y, width: screen.width, height: screen.height },
            children: [{ tag: "div", attrs: { xmlns: XHTML_NS, "data-tl-slot": item.id } }],
          },
        ],
      };
    },
    renderLabel(context) {
      if (context.cluster === undefined && kept.has(context.placed.item.id)) return null;
      return hooks.renderLabel === undefined ? defaultLabelNode(context) : hooks.renderLabel(context);
    },
  };
}
