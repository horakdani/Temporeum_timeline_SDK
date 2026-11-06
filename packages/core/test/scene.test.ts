import { describe, expect, it } from "vitest";

import { countSceneNodes, renderToSvgString } from "../src/scene.js";
import type { SceneElement } from "../src/scene.js";

describe("renderToSvgString", () => {
  it("self-closes an element with no text and no children", () => {
    expect(renderToSvgString({ tag: "rect", attrs: { x: 1, y: 2 } })).toBe('<rect x="1" y="2"/>');
  });

  it("closes an empty HTML element inside a foreignObject with an end tag, but a void one with a slash (X14)", () => {
    // Markup set as HTML (every adapter's SSR) parses a foreignObject's content
    // as HTML, where `<div/>` is an open div: what follows went into it.
    const xhtml = "http://www.w3.org/1999/xhtml";
    const svg = renderToSvgString({
      tag: "svg",
      children: [
        { tag: "foreignObject", children: [{ tag: "div", attrs: { xmlns: xhtml, "data-tl-slot": "a" } }] },
        { tag: "foreignObject", children: [{ tag: "div", attrs: { xmlns: xhtml }, children: [{ tag: "span", attrs: { class: "dot" } }, { tag: "br" }, { tag: "b", text: "A" }] }] },
        { tag: "rect" },
      ],
    });
    expect(svg).toBe(
      '<svg><foreignObject><div xmlns="http://www.w3.org/1999/xhtml" data-tl-slot="a"></div></foreignObject>' +
        '<foreignObject><div xmlns="http://www.w3.org/1999/xhtml"><span class="dot"></span><br/><b>A</b></div></foreignObject><rect/></svg>',
    );
  });

  it("keeps attributes in insertion order, so a fixture is stable", () => {
    const first = renderToSvgString({ tag: "g", attrs: { b: 1, a: 2 } });
    expect(first).toBe('<g b="1" a="2"/>');
  });

  it("omits an attribute whose value is undefined", () => {
    expect(renderToSvgString({ tag: "g", attrs: { class: "x", "data-y": undefined } })).toBe(
      '<g class="x"/>',
    );
  });

  it("rounds numbers and strips trailing zeros", () => {
    const svg = renderToSvgString({
      tag: "rect",
      attrs: { x: 1 / 3, y: 2.0005, width: 10, height: -0 },
    });
    expect(svg).toBe('<rect x="0.333" y="2.001" width="10" height="0"/>');
  });

  it("refuses a non-finite number rather than emitting NaN into the markup", () => {
    expect(() => renderToSvgString({ tag: "rect", attrs: { x: Number.NaN } })).toThrow(RangeError);
    expect(() =>
      renderToSvgString({ tag: "rect", attrs: { x: Number.POSITIVE_INFINITY } }),
    ).toThrow(RangeError);
  });

  it("escapes text and attribute values", () => {
    const svg = renderToSvgString({
      tag: "title",
      attrs: { "data-q": 'a"b&c<d' },
      text: "x < y & z > w",
    });
    expect(svg).toBe(
      '<title data-q="a&quot;b&amp;c&lt;d">x &lt; y &amp; z &gt; w</title>',
    );
  });

  it("keeps a text-only element on one line", () => {
    expect(renderToSvgString({ tag: "text", text: "hi" }, { pretty: true })).toBe(
      "<text>hi</text>",
    );
  });

  it("indents nested children when pretty", () => {
    const scene: SceneElement = {
      tag: "svg",
      children: [{ tag: "g", children: [{ tag: "rect" }] }],
    };
    expect(renderToSvgString(scene, { pretty: true })).toBe(
      "<svg>\n  <g>\n    <rect/>\n  </g>\n</svg>",
    );
  });

  it("emits text before children when both are present", () => {
    const scene: SceneElement = { tag: "g", text: "label", children: [{ tag: "rect" }] };
    expect(renderToSvgString(scene)).toBe("<g>label<rect/></g>");
  });

  it("is byte-identical for the same scene", () => {
    const scene: SceneElement = {
      tag: "svg",
      attrs: { width: 100 },
      children: [{ tag: "text", text: "a" }],
    };
    expect(renderToSvgString(scene)).toBe(renderToSvgString(scene));
  });
});

describe("countSceneNodes", () => {
  it("counts the root and every descendant", () => {
    const scene: SceneElement = {
      tag: "svg",
      children: [{ tag: "g", children: [{ tag: "rect" }, { tag: "rect" }] }, { tag: "g" }],
    };
    expect(countSceneNodes(scene)).toBe(5);
  });

  it("counts a leaf as one", () => {
    expect(countSceneNodes({ tag: "rect" })).toBe(1);
  });
});
