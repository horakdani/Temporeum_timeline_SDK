/**
 * The export-svg check: the standalone SVG a frame exports to is, pixel for pixel,
 * the frame on screen — in every case of the visual matrix (three widths,
 * two orientations, two themes).
 *
 * "On screen" is the scene's markup inline in an HTML document, which is
 * what the DOM mount and a server-rendered page put there. "Exported" is the
 * standalone file opened as a document of its own, as a viewer opens it.
 * Both are drawn by Chromium at one device pixel per CSS pixel and compared
 * in the browser, pixel by pixel: the number that differ has to be zero.
 *
 * The flattening that a PNG and a PDF need, the PNG's canvas path and the
 * print view's mounting are checked here too, with stand-ins for the
 * document — they take the host's document, never a global.
 */

import { readFileSync, writeFileSync } from "node:fs";

import { chromium } from "playwright";
import type { Browser, Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Decoration } from "../../src/decorations.js";
import { flattenHtmlText } from "../../src/export/flatten.js";
import { resolvePaper } from "../../src/export/pages.js";
import { mountPrintView, PRINT_VIEW_ATTR, printCss } from "../../src/export/print.js";
import { standaloneSvg, svgToPng } from "../../src/export/svg.js";
import { ORIENTATIONS } from "../../src/geometry.js";
import { renderTimeline } from "../../src/render.js";
import type { RenderOptions } from "../../src/render.js";
import { renderToSvgString } from "../../src/scene.js";
import type { SceneElement } from "../../src/scene.js";
import { THEMES } from "../../src/theme.js";
import type { Density, Item, Lane, Orientation } from "../../src/types.js";

const read = (name: string): string => readFileSync(new URL(name, import.meta.url), "utf8");
const matrix = JSON.parse(read("../visual/matrix.json")) as { widths: readonly number[]; height: number; densityForWidth: Record<string, Density> };
const scenario = JSON.parse(read("../visual/scenario.json")) as {
  timeZone: string;
  ariaLabel: string;
  domain: readonly [string, string];
  selectedIds: readonly string[];
  lanes: readonly Lane[];
  items: readonly (Omit<Item, "start" | "end"> & { start: string; end?: string })[];
  decorations: readonly (Record<string, unknown> & { kind: string })[];
};
const at = (value: string): number => Date.parse(value);
const ITEMS: readonly Item[] = scenario.items.map(({ start, end, ...rest }) => ({ ...rest, start: at(start), ...(end === undefined ? {} : { end: at(end) }) }));
const DECORATIONS = scenario.decorations.map((decoration) => {
  const out: Record<string, unknown> = { ...decoration };
  for (const key of ["time", "start", "end"]) if (typeof out[key] === "string") out[key] = at(out[key]);
  return out;
}) as unknown as readonly Decoration[];
const LOG = new URL("../../.export-svg-log.json", import.meta.url);

function options(width: number, orientation: Orientation, theme: "light" | "dark", name: string): RenderOptions {
  return {
    items: ITEMS,
    lanes: scenario.lanes,
    domain: [at(scenario.domain[0]), at(scenario.domain[1])],
    width,
    height: matrix.height,
    orientation,
    density: matrix.densityForWidth[String(width)] ?? "comfortable",
    theme,
    instanceId: name,
    timeZone: scenario.timeZone,
    decorations: DECORATIONS,
    selectedIds: scenario.selectedIds,
    ariaLabel: scenario.ariaLabel,
  };
}

let browser: Browser;
let page: Page;

beforeAll(async () => {
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
}, 60_000);

afterAll(async () => {
  await browser.close();
});

/** Pixels that differ between two PNGs, counted in the browser. */
async function differing(a: Buffer, b: Buffer): Promise<number> {
  await page.goto("about:blank");
  return page.evaluate(
    async ([left, right]) => {
      const pixels = async (data: string): Promise<{ data: Uint8ClampedArray; width: number; height: number }> => {
        const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${data}`)).blob());
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const context = canvas.getContext("2d");
        if (context === null) throw new Error("no 2D context");
        context.drawImage(bitmap, 0, 0);
        return context.getImageData(0, 0, bitmap.width, bitmap.height);
      };
      const one = await pixels(left);
      const two = await pixels(right);
      if (one.width !== two.width || one.height !== two.height) return Number.POSITIVE_INFINITY;
      let count = 0;
      for (let index = 0; index < one.data.length; index += 4) {
        if (one.data[index] !== two.data[index] || one.data[index + 1] !== two.data[index + 1] || one.data[index + 2] !== two.data[index + 2] || one.data[index + 3] !== two.data[index + 3]) count += 1;
      }
      return count;
    },
    [a.toString("base64"), b.toString("base64")] as const,
  );
}

const cases: { name: string; width: number; height: number; differing: number }[] = [];

describe("the standalone SVG", () => {
  for (const width of matrix.widths) {
    for (const orientation of ORIENTATIONS) {
      for (const theme of THEMES) {
        const name = `${String(width)}-${orientation}-${theme.name}`;
        it(`[claim:pixel-identical] ${name}: the exported file is the frame on screen, pixel for pixel`, async () => {
          const scene = renderTimeline(options(width, orientation, theme.name === "dark" ? "dark" : "light", name)).scene;
          const clip = { x: 0, y: 0, width, height: matrix.height };
          await page.setContent(`<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0">${renderToSvgString(scene)}</body></html>`);
          const screen = await page.screenshot({ clip });
          await page.route("http://export.test/frame.svg", (route) => route.fulfill({ contentType: "image/svg+xml; charset=utf-8", body: standaloneSvg(scene) }));
          await page.goto("http://export.test/frame.svg");
          const exported = await page.screenshot({ clip });
          await page.unroute("http://export.test/frame.svg");
          const count = await differing(screen, exported);
          cases.push({ name, width, height: matrix.height, differing: count });
          writeFileSync(LOG, `${JSON.stringify({ expected: matrix.widths.length * ORIENTATIONS.length * THEMES.length, cases }, null, 2)}\n`);
          expect(count).toBe(0);
        }, 60_000);
      }
    }
  }

  it("is the scene's string with an XML declaration, and a title when asked", () => {
    const scene: SceneElement = { tag: "svg", attrs: { xmlns: "http://www.w3.org/2000/svg", width: 10, height: 10 }, children: [{ tag: "rect" }] };
    expect(standaloneSvg(scene)).toBe(`<?xml version="1.0" encoding="UTF-8"?>\n${renderToSvgString(scene)}`);
    expect(standaloneSvg(scene, { title: "A & B" })).toContain("<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"10\" height=\"10\"><title>A &amp; B</title><rect/>");
    expect(standaloneSvg({ tag: "svg" }, { title: "t" })).toContain("<title>t</title>");
  });

  it("leaves out the characters XML does not allow, so any label still makes a document a browser parses", async () => {
    const scene: SceneElement = {
      tag: "svg",
      attrs: { xmlns: "http://www.w3.org/2000/svg", width: 10, height: 10, "data-tl-lane": "\u0000l:a" },
      children: [{ tag: "text", text: "A\u0001B\u001F\uFFFEC\uD800D\u{1F600}\tE\n" }],
    };
    const svg = standaloneSvg(scene, { title: "T\u0007" });
    expect(svg).toContain('data-tl-lane="l:a"');
    expect(svg).toContain("<text>ABCD\u{1F600}\tE\n</text>");
    expect(svg).toContain("<title>T</title>");
    const errors = await page.evaluate((text) => new DOMParser().parseFromString(text, "image/svg+xml").getElementsByTagName("parsererror").length, svg);
    expect(errors).toBe(0);
  });
});

describe("HTML text as SVG text", () => {
  it("puts a label's text in a <text> with its classes, past the padding, centred, clipped to the box", () => {
    const scene: SceneElement = {
      tag: "svg",
      children: [
        { tag: "style", text: ".tl .tl-label>div{padding:0 0 0 6px}" },
        {
          tag: "g",
          children: [
            { tag: "foreignObject", attrs: { class: "tl-label", "data-tl-label": "a", x: 10, y: 20, width: 80, height: 16 }, children: [{ tag: "div", text: "Alpha" }] },
            { tag: "foreignObject", attrs: { x: 0, y: 0, width: 10, height: 10 } },
            { tag: "foreignObject", attrs: { class: "t", x: 0, y: 0, width: 10, height: 10 }, children: [{ tag: "div", attrs: { style: "padding-left:2px" }, children: [{ tag: "b", text: " Rich  " }, { tag: "span", text: "one" }] }] },
            { tag: "rect" },
          ],
        },
      ],
    };
    const flat = flattenHtmlText(scene);
    const group = flat.children?.[1]?.children ?? [];
    expect(group[0]).toEqual({
      tag: "svg",
      attrs: { "data-tl-label": "a", x: 10, y: 20, width: 80, height: 16 },
      children: [{ tag: "text", attrs: { class: "tl-label", x: 6, y: 8, "dominant-baseline": "central" }, text: "Alpha" }],
    });
    expect(group[1]?.children?.[0]?.attrs?.x).toBe(0);
    expect(group[2]?.children?.[0]).toMatchObject({ attrs: { x: 2 }, text: "Rich one" });
    expect(group[3]).toEqual({ tag: "rect" });
  });
});

describe("the PNG", () => {
  const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100.5"></svg>';
  function fakeDocument(setup: { context?: boolean; blob?: boolean } = {}): { doc: Document; calls: unknown[][]; canvas: { width: number; height: number } } {
    const calls: unknown[][] = [];
    const canvas = {
      width: 0,
      height: 0,
      getContext: () =>
        setup.context === false
          ? null
          : {
              set fillStyle(value: string) {
                calls.push(["fillStyle", value]);
              },
              fillRect: (...args: number[]) => calls.push(["fillRect", ...args]),
              drawImage: (_image: unknown, ...args: number[]) => calls.push(["drawImage", ...args]),
            },
      toBlob: (done: (blob: Blob | null) => void, type: string) => {
        done(setup.blob === false ? null : new Blob(["png"], { type }));
      },
    };
    const doc = {
      createElement: (tag: string) => (tag === "img" ? { src: "", decode: () => Promise.resolve() } : canvas),
    } as unknown as Document;
    return { doc, calls, canvas };
  }

  it("draws the SVG through an image into a canvas of its size at the scale, on the background asked for", async () => {
    const { doc, calls, canvas } = fakeDocument();
    const blob = await svgToPng(doc, SVG, { scale: 3, background: "#fff" });
    expect(blob.type).toBe("image/png");
    expect([canvas.width, canvas.height]).toEqual([600, 302]);
    expect(calls).toEqual([["fillStyle", "#fff"], ["fillRect", 0, 0, 600, 302], ["drawImage", 0, 0, 600, 302]]);
    const plain = fakeDocument();
    await svgToPng(plain.doc, SVG);
    expect(plain.canvas.width).toBe(400);
    expect(plain.calls).toEqual([["drawImage", 0, 0, 400, 201]]);
  });

  it("refuses an SVG with no size, and says so when the canvas gives nothing", async () => {
    await expect(svgToPng(fakeDocument().doc, "<svg></svg>")).rejects.toThrow(RangeError);
    await expect(svgToPng(fakeDocument().doc, SVG, { scale: 0 })).rejects.toThrow(RangeError);
    await expect(svgToPng(fakeDocument({ context: false }).doc, SVG)).rejects.toThrow(/2D canvas/);
    await expect(svgToPng(fakeDocument({ blob: false }).doc, SVG)).rejects.toThrow(/no PNG/);
  });
});

describe("the print view", () => {
  /** Just enough of a document for the view: elements, attributes, children, inline style, adopted sheets. */
  class FakeNode {
    attrs: Record<string, string> = {};
    children: (FakeNode | string)[] = [];
    parent: FakeNode | undefined;
    nonce = "";
    textContent = "";
    readonly style = { cssText: "" };
    constructor(
      readonly tag: string,
      readonly ns: string,
    ) {}
    setAttribute(name: string, value: string) {
      this.attrs[name] = value;
    }
    append(...nodes: (FakeNode | string)[]) {
      for (const node of nodes) {
        if (typeof node !== "string") node.parent = this;
        this.children.push(node);
      }
    }
    prepend(node: FakeNode) {
      node.parent = this;
      this.children.unshift(node);
    }
    remove() {
      if (this.parent !== undefined) this.parent.children = this.parent.children.filter((child) => child !== this);
      this.parent = undefined;
    }
    /** Serialised, the way the markup used to be written. */
    toString(): string {
      const attrs = Object.entries(this.attrs).map(([name, value]) => ` ${name}="${value}"`).join("");
      const style = this.style.cssText === "" ? "" : ` style="${this.style.cssText}"`;
      const inner = this.children.map(String).join("") + this.textContent;
      return `<${this.tag}${attrs}${style}${this.nonce === "" ? "" : ` nonce="${this.nonce}"`}>${inner}</${this.tag}>`;
    }
  }
  class FakeSheet {
    text = "";
    replaceSync(text: string) {
      this.text = text;
    }
  }
  function fakeDocument(adopting: boolean) {
    const body = new FakeNode("body", "");
    const doc = {
      body,
      adoptedStyleSheets: adopting ? ([] as FakeSheet[]) : undefined,
      defaultView: { CSSStyleSheet: FakeSheet },
      createElement: (tag: string) => new FakeNode(tag, "html"),
      createElementNS: (ns: string, tag: string) => new FakeNode(tag, ns),
    };
    return doc;
  }
  const paper = resolvePaper({ size: "a4" });
  const scenes: SceneElement[] = [
    {
      tag: "svg",
      attrs: { width: 10, height: 10 },
      children: [
        { tag: "style", text: ".tl-item{fill:red}" },
        { tag: "path", attrs: { d: "M0 0", style: "stroke:blue" } },
        { tag: "foreignObject", children: [{ tag: "div", text: "<b>not markup</b>" }] },
      ],
    },
    { tag: "svg" },
  ];

  it("builds one section a page with the DOM, the stylesheets in one adopted sheet, and leaves when asked", () => {
    const doc = fakeDocument(true);
    mountPrintView(doc as unknown as Document, scenes, paper);
    const remove = mountPrintView(doc as unknown as Document, scenes, paper);
    expect(doc.body.children).toHaveLength(1);
    const view = doc.body.children[0] as FakeNode;
    expect(view.attrs).toEqual({ [PRINT_VIEW_ATTR]: "" });
    expect(String(view)).toBe(
      `<div ${PRINT_VIEW_ATTR}="">` +
        `<section data-tl-page="1"><svg width="10" height="10"><path d="M0 0" style="stroke:blue"></path><foreignObject><div><b>not markup</b></div></foreignObject></svg></section>` +
        `<section data-tl-page="2"><svg></svg></section></div>`,
    );
    // The text is a text node, not markup: the fake keeps it as the string it was given.
    const foreign = ((view.children[0] as FakeNode).children[0] as FakeNode).children[1] as FakeNode;
    expect(foreign.children[0]).toBeInstanceOf(FakeNode);
    expect((foreign.children[0] as FakeNode).ns).toBe("http://www.w3.org/1999/xhtml");
    expect((foreign.children[0] as FakeNode).children).toEqual(["<b>not markup</b>"]);
    expect(((view.children[0] as FakeNode).children[0] as FakeNode).ns).toBe("http://www.w3.org/2000/svg");
    expect((doc.adoptedStyleSheets ?? []).map((sheet) => sheet.text)).toEqual([printCss(paper) + ".tl-item{fill:red}"]);
    remove();
    expect(doc.body.children).toEqual([]);
    expect(doc.adoptedStyleSheets).toEqual([]);
    expect(printCss(paper)).toContain("@page{size:842pt 595pt;margin:36pt}");
    expect(printCss(paper)).toContain("width:1026px;height:697px");
  });

  it("without adopted sheets, writes one `<style>` first, with the nonce", () => {
    const doc = fakeDocument(false);
    mountPrintView(doc as unknown as Document, scenes, paper, "r4nd0m");
    const view = doc.body.children[0] as FakeNode;
    const style = view.children[0] as FakeNode;
    expect(style.tag).toBe("style");
    expect(style.nonce).toBe("r4nd0m");
    expect(style.textContent).toBe(printCss(paper) + ".tl-item{fill:red}");
    expect(view.children.filter((child) => (child as FakeNode).tag === "section")).toHaveLength(2);
  });

  it("leaves out an undefined attribute, keeps HTML below a foreignObject HTML, and takes a fallback view away without a nonce", () => {
    const doc = { ...fakeDocument(true), defaultView: null };
    const remove = mountPrintView(doc as unknown as Document, [
      {
        tag: "svg",
        attrs: { width: 4, title: undefined },
        children: [{ tag: "style" }, { tag: "foreignObject", children: [{ tag: "div", children: [{ tag: "span", text: "deep" }] }] }],
      },
    ], paper);
    const view = doc.body.children[0] as FakeNode;
    const style = view.children[0] as FakeNode;
    // No constructable sheets in a document without a window: a `<style>`, without a nonce.
    expect(style.tag).toBe("style");
    expect(style.nonce).toBe("");
    expect(style.textContent).toBe(printCss(paper));
    const svg = (view.children[1] as FakeNode).children[0] as FakeNode;
    expect(svg.attrs).toEqual({ width: "4" });
    const span = ((svg.children[0] as FakeNode).children[0] as FakeNode).children[0] as FakeNode;
    expect(span.ns).toBe("http://www.w3.org/1999/xhtml");
    remove();
    expect(doc.body.children).toEqual([]);
    expect(doc.adoptedStyleSheets).toEqual([]);
  });
});
