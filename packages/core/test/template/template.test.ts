/**
 * The template check: HTML templates for items.
 *
 *  - The same template gives the same tree on the client and on the server:
 *    the frame mounted into a DOM shows exactly the server's markup.
 *  - The item keeps its accessible name: the template is its picture.
 *  - A template with a script, a handler or a `javascript:` URL does not run
 *    by default — and the negative control: with `sanitize: false` the very
 *    same template does reach the DOM as a script and a handler, so the
 *    check can see one when there is one.
 */

import { describe, expect, it } from "vitest";

import { mountScene } from "../../src/dom/mount.js";
import { parseTemplate, templateHooks } from "../../src/items/index.js";
import { renderTimeline } from "../../src/render.js";
import { storyPlainText } from "../../src/story/index.js";
import { renderToSvgString } from "../../src/scene.js";
import type { SceneElement } from "../../src/scene.js";
import type { Item } from "../../src/types.js";
import { differs, fakeContainer } from "../dom/fake-dom.js";
import type { FakeElement } from "../dom/fake-dom.js";

const DAY = 86_400_000;
const ORIGIN = Date.UTC(2024, 0, 1);
const EVIL =
  '<b>Ann</b> <img src=x onerror="globalThis.__ran = 1"><script>globalThis.__ran = 2</script>' +
  '<span onclick="globalThis.__ran = 3" class="tag">ok</span><a href="javascript:alert(1)">x</a><style>*{}</style>';

const items: Item[] = [
  { id: "a", start: ORIGIN, end: ORIGIN + 5 * DAY, label: "Ann's task" },
  { id: "b", start: ORIGIN + 8 * DAY, end: ORIGIN + 12 * DAY, label: "Bob's task" },
];

function frame(template: string, sanitize?: boolean) {
  return renderTimeline({
    items,
    domain: [ORIGIN - DAY, ORIGIN + 14 * DAY],
    width: 900,
    height: 200,
    hooks: templateHooks<unknown>(() => template, sanitize === undefined ? {} : { sanitize }),
  });
}

function all(node: SceneElement, into: SceneElement[] = []): SceneElement[] {
  into.push(node);
  for (const child of node.children ?? []) all(child, into);
  return into;
}

function liveAll(node: FakeElement, into: FakeElement[] = []): FakeElement[] {
  into.push(node);
  for (const child of node.childNodes) if (child.nodeType === 1) liveAll(child as FakeElement, into);
  return into;
}

describe("HTML templates", () => {
  it("[claim:same-tree] the client mounts exactly the tree the server prints", () => {
    const server = frame("<strong>{name}</strong> <em>due</em> <small>&lt;soon&gt;</small>");
    const again = frame("<strong>{name}</strong> <em>due</em> <small>&lt;soon&gt;</small>");
    expect(renderToSvgString(again.scene)).toBe(renderToSvgString(server.scene));
    const { container } = fakeContainer();
    const mount = mountScene(container as unknown as Element);
    mount.update(server.scene);
    const svg = container.childNodes[0] as FakeElement;
    expect(differs(svg, server.scene)).toBeUndefined();
    expect(renderToSvgString(server.scene)).toContain("&lt;soon&gt;");
  });

  it("[claim:accessible-name] the item keeps its accessible name, and the template replaces its label", () => {
    const result = frame("<b>Rich</b> text");
    const options = all(result.scene).filter((node) => node.attrs?.role === "option");
    expect(options.map((node) => String(node.attrs?.["aria-label"]))).toEqual([
      expect.stringContaining("Ann's task"),
      expect.stringContaining("Bob's task"),
    ]);
    expect(all(result.scene).some((node) => String(node.attrs?.class).includes("tl-template"))).toBe(true);
    expect(all(result.scene).some((node) => node.attrs?.["data-tl-label"] === "a")).toBe(false);
  });

  it("[claim:no-script] a template with a script or a handler does not run by default", () => {
    const tree = parseTemplate(EVIL);
    const nodes = tree.flatMap((node) => all(node));
    expect(nodes.some((node) => node.tag === "script" || node.tag === "style" || node.tag === "img" || node.tag === "a")).toBe(false);
    expect(nodes.some((node) => Object.keys(node.attrs ?? {}).some((name) => name.startsWith("on") || name === "href" || name === "src"))).toBe(false);
    expect(nodes.map((node) => node.text ?? "").join("")).toContain("Ann");
    const result = frame(EVIL);
    const printed = renderToSvgString(result.scene);
    expect(printed).not.toMatch(/<script|onerror|onclick|javascript:/i);
    const { container } = fakeContainer();
    mountScene(container as unknown as Element).update(result.scene);
    const live = liveAll(container);
    expect(live.some((node) => node.tagName === "script")).toBe(false);
    expect(live.some((node) => [...node.attributes.keys()].some((name) => name.startsWith("on")))).toBe(false);
  });

  it("[claim:negative-control] with sanitize: false the same template does reach the DOM as a script and handlers", () => {
    const result = frame(EVIL, false);
    const printed = renderToSvgString(result.scene);
    expect(printed).toMatch(/<script/i);
    expect(printed).toMatch(/onerror/i);
    const { container } = fakeContainer();
    mountScene(container as unknown as Element).update(result.scene);
    const live = liveAll(container);
    expect(live.some((node) => node.tagName === "script")).toBe(true);
    expect(live.some((node) => node.attributes.has("onerror"))).toBe(true);
  });
});

describe("the template parser", () => {
  it("keeps allowed tags and attributes, unwraps the rest, decodes entities", () => {
    expect(parseTemplate('<span class="a" data-x="1" aria-hidden="true" style="color:red" id="n">t</span>')).toEqual([
      { tag: "span", attrs: { class: "a", "data-x": "1", "aria-hidden": "true" }, text: "t" },
    ]);
    expect(parseTemplate("<blink>old</blink> &amp; &#65;&#x42; &nbsp;&bogus;")).toEqual([
      { tag: "span", text: "old" },
      { tag: "span", text: " & AB  &bogus;" },
    ]);
    expect(parseTemplate("a<br>b<br/>c")).toEqual([{ tag: "span", text: "a" }, { tag: "br" }, { tag: "span", text: "b" }, { tag: "br" }, { tag: "span", text: "c" }]);
    expect(parseTemplate("<p>x<!-- no --><!doctype x><?pi?></p></div>")).toEqual([{ tag: "p", text: "x" }]);
    expect(parseTemplate("<p>one <b>two</b> three</p>")).toEqual([
      { tag: "p", text: "one ", children: [{ tag: "b", text: "two" }, { tag: "span", text: " three" }] },
    ]);
    expect(parseTemplate("1 < 2")).toEqual([{ tag: "span", text: "1 " }, { tag: "span", text: "< 2" }]);
    expect(parseTemplate("<3 love>")).toEqual([{ tag: "span", text: "<3 love>" }]);
    expect(parseTemplate("<script>never")).toEqual([]);
    expect(parseTemplate("<b>x</b>", { allowTags: ["i"] })).toEqual([{ tag: "span", text: "x" }]);
    expect(parseTemplate('<i title="t" lang="hu">x</i>', { allowAttributes: ["lang", "onclick"] })).toEqual([{ tag: "i", attrs: { lang: "hu" }, text: "x" }]);
    expect(parseTemplate("<b a='1' b=2 c>x</b>", { allowAttributes: ["a", "b", "c"] })).toEqual([{ tag: "b", attrs: { a: "1", b: "2", c: "" }, text: "x" }]);
  });

  it("ends a tag at the first > outside a quoted value, and loses nothing after a void or self-closed dropped tag (V25)", () => {
    expect(parseTemplate('<b title="a > b">x</b>y')).toEqual([{ tag: "b", attrs: { title: "a > b" }, text: "x" }, { tag: "span", text: "y" }]);
    expect(parseTemplate("<i title='1>0' class=\"c\">x</i>")).toEqual([{ tag: "i", attrs: { title: "1>0", class: "c" }, text: "x" }]);
    expect(parseTemplate('a<svg/>b<math />c<embed src="x">d')).toEqual([{ tag: "span", text: "a" }, { tag: "span", text: "b" }, { tag: "span", text: "c" }, { tag: "span", text: "d" }]);
    // A <style/> opens its raw text in HTML, as in a browser: what follows is style, up to its end tag.
    expect(parseTemplate("<style/>p{}</style>after")).toEqual([{ tag: "span", text: "after" }]);
    // An unclosed quoted value is the rest of the template, as text.
    expect(parseTemplate('<b title="open>x')).toEqual([{ tag: "span", text: '<b title="open>x' }]);
    // Many quoted values and many '=' keep the parse linear.
    const began = performance.now();
    parseTemplate(`<b ${'a="x" '.repeat(50_000)}>y</b>${"= ".repeat(100_000)}`);
    expect(performance.now() - began).toBeLessThan(2000);
  });

  it("leaves an item as it was when the template is empty", () => {
    const result = renderTimeline({
      items,
      domain: [ORIGIN - DAY, ORIGIN + 14 * DAY],
      width: 900,
      height: 200,
      hooks: templateHooks<unknown>((item) => (item.id === "a" ? "" : null)),
    });
    expect(all(result.scene).some((node) => String(node.attrs?.class).includes("tl-template"))).toBe(false);
    expect(all(result.scene).some((node) => node.attrs?.["data-tl-label"] === "a")).toBe(true);
  });
});

describe("a template from outside", () => {
  const depth = (nodes: readonly SceneElement[]): number => Math.max(0, ...nodes.map((node) => 1 + depth(node.children ?? [])));
  const text = (nodes: readonly SceneElement[]): string => nodes.map((node) => (node.text ?? "") + text(node.children ?? [])).join("");

  it("nests at most 64 deep: deeper tags give their text to the 64th, and the parse never overflows", () => {
    const nodes = parseTemplate(`${"<b>".repeat(5000)}deep${"</b>".repeat(5000)} after`);
    expect(depth(nodes)).toBe(64);
    expect(text(nodes)).toBe("deep after");
    expect(renderToSvgString({ tag: "div", children: nodes })).toContain("deep");
  });

  it("skips a dropped tag's content in time proportional to the template, and lands after its own end tag", () => {
    const began = performance.now();
    const nodes = parseTemplate(`${"<script>x</script>".repeat(80_000)}end`);
    expect(performance.now() - began).toBeLessThan(2000);
    expect(text(nodes)).toBe("end");
    // A letter whose lower case is longer than itself does not move the end tag.
    expect(text(parseTemplate(`${"İ".repeat(20)}<script>code</script>after`))).toBe(`${"İ".repeat(20)}after`);
  }, 120_000);

  it("parses a template string once, however many frames draw it", () => {
    const hooks = templateHooks<unknown>(() => "<b>Same</b>");
    const draw = () => renderTimeline({ items, domain: [ORIGIN - DAY, ORIGIN + 14 * DAY], width: 900, height: 200, hooks });
    const slotOf = (scene: SceneElement) => all(scene).find((node) => node.tag === "div" && node.attrs?.xmlns !== undefined)?.children;
    const first = slotOf(draw().scene);
    const second = slotOf(draw().scene);
    expect(first).toBeDefined();
    // The same nodes, not an equal copy: the string was not parsed again.
    expect(second).toBe(first);
  });
});

describe("a sanitised template cannot reach the timeline's own markers", () => {
  it("drops data-tl-* attributes and tl-* class names, and keeps the rest", () => {
    const nodes = parseTemplate(
      '<span data-tl-remove="b" data-tl-slot="b" data-tl-id="b" data-tag="x" class="tl-item tl-template badge TL-label">t</span>',
    );
    expect(nodes).toEqual([{ tag: "span", attrs: { "data-tag": "x", class: "badge" }, text: "t" }]);
    // An attribute the host asked for by name is still not the timeline's.
    expect(parseTemplate('<i data-tl-remove="b">t</i>', { allowAttributes: ["data-tl-remove"] })).toEqual([{ tag: "i", text: "t" }]);
    // Without sanitising, the host's own template keeps everything.
    expect(parseTemplate('<i data-tl-remove="b" class="tl-x">t</i>', { sanitize: false })).toEqual([
      { tag: "i", attrs: { "data-tl-remove": "b", class: "tl-x" }, text: "t" },
    ]);
  });

  it("an item's template cannot carry another item's remove button into the frame", () => {
    const result = frame('<span data-tl-remove="b" class="tl-remove">x</span>');
    const printed = renderToSvgString(result.scene);
    expect(printed).not.toContain('data-tl-remove="b"');
  });
});

describe("a template's attribute names are names the DOM accepts", () => {
  it("drops a name setAttribute would throw on, sanitised or not", () => {
    for (const sanitize of [true, false]) {
      const nodes = parseTemplate('<b data-x\u0000y="1" data-ok="2" 1bad="3" __proto__="4" data-aé="5">t</b>', { sanitize });
      expect(nodes).toEqual([{ tag: "b", attrs: { "data-ok": "2" }, text: "t" }]);
    }
    const { container } = fakeContainer();
    expect(() => mountScene(container as unknown as Element).update(frame('<b data-x\u0000y="1">t</b>').scene)).not.toThrow();
  });
});

describe("an extended allow-list does not open URLs or the page's head", () => {
  const links = { allowTags: [...["a", "img", "form", "base", "meta", "link", "b"]], allowAttributes: ["href", "src", "action", "formaction", "style", "xlink:href", "srcset", "content", "http-equiv"] };

  it("keeps http, https, mailto, tel and relative URLs, and drops any other scheme", () => {
    const hrefOf = (href: string) => parseTemplate(`<a href="${href}">x</a>`, links)[0]?.attrs?.href;
    expect(hrefOf("https://example.com/a?b=1")).toBe("https://example.com/a?b=1");
    expect(hrefOf("http://example.com")).toBe("http://example.com");
    expect(hrefOf("mailto:a@example.com")).toBe("mailto:a@example.com");
    expect(hrefOf("tel:+3612345")).toBe("tel:+3612345");
    expect(hrefOf("/relative/path#x")).toBe("/relative/path#x");
    expect(hrefOf("page.html")).toBe("page.html");
    for (const evil of ["javascript:alert(1)", "JaVaScRiPt:alert(1)", " \u0001javascript:alert(1)", "java\tscript:alert(1)", "java&#10;script:alert(1)", "data:text/html,&lt;script&gt;alert(1)", "vbscript:x"]) {
      expect(hrefOf(evil), evil).toBeUndefined();
    }
    expect(parseTemplate('<img src="javascript:x">', links)[0]?.attrs?.src).toBeUndefined();
    expect(parseTemplate('<b formaction="javascript:x" xlink:href="javascript:x" srcset="x.png 1x">t</b>', links)).toEqual([{ tag: "b", text: "t" }]);
  });

  it("drops a style that loads a URL or hides it behind an escape", () => {
    const styleOf = (style: string) => parseTemplate(`<b style="${style}">t</b>`, links)[0]?.attrs?.style;
    expect(styleOf("color: red")).toBe("color: red");
    expect(styleOf("background: url(https://evil.example/x)")).toBeUndefined();
    expect(styleOf("background: URL ( x )")).toBeUndefined();
    expect(styleOf("background: \\75 rl(x)")).toBeUndefined();
    expect(styleOf("background-image: image-set('x.png' 1x)")).toBeUndefined();
    expect(styleOf("width: expression(alert(1))")).toBeUndefined();
  });

  it("never keeps base, meta, link or form, even when allowed", () => {
    const nodes = parseTemplate('<base href="https://evil.example/"><meta http-equiv="refresh" content="0;url=https://evil.example"><link rel="stylesheet" href="https://evil.example/x.css"><form action="https://evil.example"><b>in</b></form>after', links);
    expect(nodes).toEqual([{ tag: "b", text: "in" }, { tag: "span", text: "after" }]);
  });
});

describe("an entity name is a character, not an object's property", () => {
  it("leaves &constructor; and its kin as written", () => {
    expect(parseTemplate("&constructor; &toString; &__proto__; &hasOwnProperty; &amp;")).toEqual([
      { tag: "span", text: "&constructor; &toString; &__proto__; &hasOwnProperty; &" },
    ]);
    expect(storyPlainText("&constructor; &amp;")).toBe("&constructor; &");
  });
});

describe("the end tags HTML implies (Y18)", () => {
  // The parser kept `<li>a<li>b` nested and `<p>x<div>` inside the paragraph;
  // the browser closes them, so the server's markup parsed back as another tree.
  // The tree, as HTML with every end tag written: what the browser's parse of the server markup must equal.
  const tree = (nodes: readonly SceneElement[]): string =>
    nodes.map((node) => `<${node.tag}>${node.text ?? ""}${tree(node.children ?? [])}</${node.tag}>`).join("");
  const printed = (html: string): string => tree(parseTemplate(html));

  it("closes a list item at the next, and a paragraph at a block", () => {
    expect(printed("<ul><li>a<li>b</ul>")).toBe("<ul><li>a</li><li>b</li></ul>");
    expect(printed("<p>x<div>y</div>")).toBe("<p>x</p><div>y</div>");
    expect(printed("<p>one<p>two")).toBe("<p>one</p><p>two</p>");
    // A `</p>` with no paragraph open is an empty one, as the browser reads it.
    expect(printed("<p><div>x</div></p>")).toBe("<p></p><div>x</div><p></p>");
  });

  it("leaves what the parser does not close as it is", () => {
    // An inline element does not close a paragraph; a nested list keeps its outer item open.
    expect(printed("<p>a<b>b</b><span>c</span></p>")).toBe("<p>a<b>b</b><span>c</span></p>");
    expect(printed("<ul><li>a<ul><li>b</li></ul></li><li>c</li></ul>")).toBe("<ul><li>a<ul><li>b</li></ul></li><li>c</li></ul>");
    expect(printed("<ul><li>a<ul><li>b<li>c</ul></ul>")).toBe("<ul><li>a<ul><li>b</li><li>c</li></ul></li></ul>");
  });

  it("does not close a list item across a block the parser stops at (Z5)", () => {
    // HTML's list-item walk stops at a special element other than div and p:
    // Y18 walked past a section or a heading and closed the outer item.
    const unsafe = (html: string): string => tree(parseTemplate(html, { sanitize: false }));
    expect(unsafe("<ul><li>a<section>x<li>b</section></ul>")).toBe("<ul><li>a<section>x<li>b</li></section></li></ul>");
    expect(unsafe("<ul><li>a<h1>x<li>b</h1></ul>")).toBe("<ul><li>a<h1>x<li>b</li></h1></li></ul>");
    expect(unsafe("<ul><li>a<blockquote>x<li>b</blockquote></ul>")).toBe("<ul><li>a<blockquote>x<li>b</li></blockquote></li></ul>");
    // Through a div or a p it still closes.
    expect(unsafe("<ul><li>a<div>x<li>b</div></ul>")).toBe("<ul><li>a<div>x</div></li><li>b</li></ul>");
  });
});
