/**
 * G-EXPORT-SVG: the standalone SVG a frame exports to is, pixel for pixel,
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
  it("mounts one section a page with the sheet's stylesheet, replaces an earlier view, and leaves when asked", () => {
    interface FakeNode {
      attrs: Record<string, string>;
      innerHTML: string;
      attached: boolean;
      setAttribute(name: string, value: string): void;
      remove(): void;
    }
    const nodes: FakeNode[] = [];
    const doc = {
      querySelector: (selector: string) => (selector === `body>[${PRINT_VIEW_ATTR}]` ? nodes.find((node) => node.attached) ?? null : null),
      createElement: (): FakeNode => ({
        attrs: {},
        innerHTML: "",
        attached: false,
        setAttribute(name: string, value: string) {
          this.attrs[name] = value;
        },
        remove() {
          this.attached = false;
        },
      }),
      body: {
        append(node: FakeNode) {
          node.attached = true;
          nodes.push(node);
        },
      },
    } as unknown as Document;
    const paper = resolvePaper({ size: "a4" });
    const scenes: SceneElement[] = [{ tag: "svg", attrs: { width: 10, height: 10 } }, { tag: "svg" }];
    mountPrintView(doc, scenes, paper);
    const remove = mountPrintView(doc, scenes, paper);
    expect(nodes.map((node) => node.attached)).toEqual([false, true]);
    const view = nodes[1];
    expect(view?.attrs).toEqual({ [PRINT_VIEW_ATTR]: "" });
    expect(view?.innerHTML).toBe(`<style>${printCss(paper)}</style><section data-tl-page="1"><svg width="10" height="10"/></section><section data-tl-page="2"><svg/></section>`);
    remove();
    expect(view?.attached).toBe(false);
    expect(printCss(paper)).toContain("@page{size:842pt 595pt;margin:36pt}");
    expect(printCss(paper)).toContain("width:1026px;height:697px");
  });
});
