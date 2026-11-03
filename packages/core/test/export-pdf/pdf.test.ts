/**
 * G-EXPORT-PDF: the PDF the library writes itself is valid to an independent
 * parser, its text is text — selectable and copied as written — and cutting
 * a timeline into pages loses no item.
 *
 * The parser is pdf.js with `stopAtErrors`, and the cross-reference table is
 * also checked by hand ({@link xrefProblems}). The pages come from generated
 * timelines: lanes, sublane spans, single-row lanes, both orientations, three
 * sheets. For each, every item is on exactly one page's frame, and every
 * label a page's frame draws is in that page's text as the parser reads it.
 */

import { writeFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { flattenHtmlText } from "../../src/export/flatten.js";
import { printPages, resolvePaper } from "../../src/export/pages.js";
import { glyphName, parseColor, parseTransform, pathOps, scenesToPdf, textWidth } from "../../src/export/pdf.js";
import type { SceneElement } from "../../src/scene.js";
import type { Item, Lane, Orientation, PackMode } from "../../src/types.js";
import { makeRandom } from "../property/harness.js";
import { readPdf, xrefProblems } from "./pdfjs.js";

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 5);
const SEED = 0x9df;
const CASES = 24;
const LOG = new URL("../../.export-pdf-log.json", import.meta.url);

/** The ids a frame draws an item for. */
function idsOf(scene: SceneElement): Set<string> {
  const ids = new Set<string>();
  const walk = (node: SceneElement): void => {
    const id = node.attrs?.["data-tl-id"];
    if (typeof id === "string") ids.add(id);
    for (const child of node.children ?? []) walk(child);
  };
  walk(scene);
  return ids;
}

/** The text a frame draws, as the PDF writer sees it: titles and stylesheets are not drawn. */
function drawnText(scene: SceneElement): string[] {
  const out: string[] = [];
  const walk = (node: SceneElement): void => {
    if (node.tag === "title" || node.tag === "style") return;
    if (node.tag === "text" && node.text !== undefined && node.text.trim() !== "") out.push(node.text.trim());
    for (const child of node.children ?? []) walk(child);
  };
  walk(flattenHtmlText(scene));
  return out;
}

describe("the PDF writer", () => {
  it("[claim:valid] writes a file pdf.js opens without repair, its table and stream lengths exact", async () => {
    const items: Item[] = [{ id: "a", start: T0, end: T0 + 3 * DAY, label: "Alpha" }];
    const pages = printPages({ items, domain: [T0, T0 + 5 * DAY], width: 800, height: 400 });
    const bytes = scenesToPdf(
      pages.map((page) => page.frame.scene),
      { title: "Plan" },
    );
    expect(xrefProblems(bytes)).toEqual([]);
    const read = await readPdf(bytes);
    expect(read.pages).toHaveLength(1);
    expect(read.title).toBe("Plan");
    // A4 landscape by default.
    expect(read.sizes[0]).toEqual([0, 0, 842, 595]);
  });

  it("[claim:selectable] sets its text as text: what a reader copies is what was written, accents and all", async () => {
    const labels = ["Árvíztűrő tükörfúrógép", "Łódź – Kraków", "Straße “quoted” €5", "Ő Ű ő ű"];
    const items: Item[] = labels.map((label, at) => ({ id: `i${String(at)}`, laneId: `l${String(at)}`, start: T0, end: T0 + 20 * DAY, label }));
    const pages = printPages({ items, domain: [T0, T0 + 21 * DAY], width: 800, height: 400 });
    const read = await readPdf(scenesToPdf(pages.map((page) => page.frame.scene)));
    const text = read.pages.join("\u0001").split("\u0001");
    for (const label of labels) expect(text).toContain(label);
  });

  it("[claim:no-item-lost] cuts generated timelines into pages: each item on one page, each drawn label in that page's text", async () => {
    const random = makeRandom(SEED);
    const sheets = [{ size: "a4" as const }, { size: "letter" as const, orientation: "portrait" as const }, { size: "a5" as const, margin: 18 }];
    let items = 0;
    let pagesSeen = 0;
    let labels = 0;
    let multiPage = 0;
    for (let index = 0; index < CASES; index += 1) {
      const orientation: Orientation = random() < 0.5 ? "horizontal" : "vertical";
      const lanes: Lane[] = Array.from({ length: 1 + Math.floor(random() * 14) }, (_, at) => ({
        id: `l${String(at)}`,
        ...(random() < 0.15 ? { packMode: "single" as PackMode } : {}),
      }));
      const generated: Item[] = Array.from({ length: 20 + Math.floor(random() * 260) }, (_, at) => {
        const start = T0 + Math.floor(random() * 120) * DAY;
        return {
          id: `c${String(index)}-${String(at)}`,
          start,
          ...(random() < 0.08 ? {} : { end: start + (1 + Math.floor(random() * 15)) * DAY }),
          laneId: lanes[Math.floor(random() * lanes.length)]?.id ?? "l0",
          ...(random() < 0.08 ? { sublaneSpan: 2 } : {}),
          label: `L${String(index)}x${String(at)}`,
        };
      });
      const sheet = sheets[index % sheets.length] ?? {};
      const pages = printPages({ items: generated, lanes, orientation, domain: [T0, T0 + 30 * DAY], width: 900, height: 500 }, sheet);
      const paper = resolvePaper(sheet);
      // Every item on exactly one page.
      const where = new Map<string, number>();
      pages.forEach((page, at) => {
        for (const id of idsOf(page.frame.scene)) {
          expect(where.has(id), `${id} is on two pages`).toBe(false);
          where.set(id, at);
        }
      });
      expect([...where.keys()].sort()).toEqual(generated.map((item) => item.id).sort());
      // Contiguous bands, each a page's size at most.
      const capacity = orientation === "horizontal" ? paper.contentHeight : paper.contentWidth;
      pages.forEach((page, at) => {
        expect(page.band.from).toBe(at === 0 ? 0 : pages[at - 1]?.band.to);
        const size = Number(page.frame.scene.attrs?.[orientation === "horizontal" ? "height" : "width"]);
        expect(size).toBeLessThanOrEqual(capacity);
      });
      // What the PDF holds, page by page.
      const bytes = scenesToPdf(
        pages.map((page) => page.frame.scene),
        sheet,
      );
      expect(xrefProblems(bytes)).toEqual([]);
      const read = await readPdf(bytes);
      expect(read.pages).toHaveLength(pages.length);
      pages.forEach((page, at) => {
        const text = (read.pages[at] ?? "").split("\u0001").map((part) => part.trim());
        for (const label of drawnText(page.frame.scene)) {
          expect(text, `page ${String(at + 1)} of case ${String(index)}`).toContain(label);
          labels += 1;
        }
      });
      items += generated.length;
      pagesSeen += pages.length;
      if (pages.length > 1) multiPage += 1;
    }
    // The cut is what is tested: most cases need more than one page.
    expect(multiPage).toBeGreaterThan(CASES / 2);
    writeFileSync(LOG, `${JSON.stringify({ cases: CASES, items, pages: pagesSeen, labels, multiPage }, null, 2)}\n`);
  }, 240_000);

  it("[claim:deterministic] writes the same bytes for the same scenes", () => {
    const items: Item[] = [{ id: "a", start: T0, end: T0 + DAY, label: "Ő" }];
    const scenes = printPages({ items, domain: [T0, T0 + 2 * DAY], width: 400, height: 300 }).map((page) => page.frame.scene);
    expect(scenesToPdf(scenes, { title: "x" })).toEqual(scenesToPdf(scenes, { title: "x" }));
  });

  it("draws what a scene holds: shapes, transforms, opacity, dashes, anchors, a nested viewport", async () => {
    const scene: SceneElement = {
      tag: "svg",
      attrs: { class: "tl", width: 300, height: 200 },
      children: [
        { tag: "style", text: ".tl{--tl-a:#336699;font-size:10px}.tl .k{fill:var(--tl-a);stroke:rgb(10, 20, 30);stroke-dasharray:4 2}@media print{.tl .k{fill:red}}.tl .k:hover{fill:blue}" },
        { tag: "title", text: "not drawn" },
        { tag: "rect", attrs: { class: "k", x: 1, y: 2, width: 30, height: 10, rx: 3 } },
        { tag: "rect", attrs: { x: 1, y: 2, width: 30, height: 10, style: "fill:none;stroke:none" } },
        { tag: "circle", attrs: { cx: 50, cy: 50, r: 5, fill: "#abc", opacity: 0.5 } },
        { tag: "line", attrs: { x1: 0, y1: 0, x2: 10, y2: 10, stroke: "black", "stroke-width": 2 } },
        { tag: "polygon", attrs: { points: "0,0 5,5 0,10", fill: "rgba(0,0,0,0.25)" } },
        { tag: "polyline", attrs: { points: "0 0 5 5 0 10", fill: "none", stroke: "currentColor", color: "#123456" } },
        { tag: "path", attrs: { d: "M1 1 L2 2 H5 V6 C1 1 2 2 3 3 S4 4 5 5 Q6 6 7 7 T8 8 A1 1 0 0 1 9 9 l1 1 h1 v1 z m1 1 2 2", fill: "#000000aa" } },
        { tag: "g", attrs: { transform: "translate(5) scale(2) rotate(90) skewX(3) matrix(1 0 0 1 0 0)", style: "display:none" }, children: [{ tag: "rect", attrs: { width: 1, height: 1 } }] },
        {
          tag: "g",
          attrs: { transform: "translate(5 5) scale(2 1)", visibility: "hidden" },
          children: [{ tag: "rect", attrs: { width: 1, height: 1 } }],
        },
        { tag: "text", attrs: { x: 150, y: 20, "text-anchor": "middle", "dominant-baseline": "central", "font-weight": "bold" }, text: "Middle" },
        { tag: "text", attrs: { x: 290, y: 40, "text-anchor": "end", "fill-opacity": 0.5 }, text: "End" },
        { tag: "text", attrs: { x: 10, y: 60, fill: "none" }, text: "Unseen" },
        { tag: "text", attrs: { x: 10, y: 80, fill: "teal" }, text: "Teal" },
        {
          tag: "foreignObject",
          attrs: { class: "k", x: 10, y: 100, width: 80, height: 20 },
          children: [{ tag: "div", attrs: { style: "padding:0 4px" }, children: [{ tag: "span", text: "Rich" }, { tag: "span", text: " text" }] }],
        },
        { tag: "unknown", attrs: {} },
      ],
    };
    const bytes = scenesToPdf([scene], { size: [400, 300], orientation: "portrait", margin: 10 });
    expect(xrefProblems(bytes)).toEqual([]);
    const read = await readPdf(bytes);
    const text = (read.pages[0] ?? "").split("\u0001");
    expect(text).toEqual(expect.arrayContaining(["Middle", "End", "Teal", "Rich text"]));
    expect(text).not.toContain("Unseen");
    expect(text).not.toContain("not drawn");
    expect(read.sizes[0]).toEqual([0, 0, 300, 400]);
    const source = new TextDecoder("latin1").decode(bytes);
    // The rule's colour from the token, its dash; the opacity as a graphics state; bold for the bold text.
    expect(source).toContain("0.2 0.4 0.6 rg");
    expect(source).toContain("[4 2] 0 d");
    expect(source).toMatch(/\/ExtGState << \/G0 << \/Type \/ExtGState \/ca 0.5 \/CA [\d.]+ >>/);
    expect(source).toContain("/F2 ");
  });

  it("fits a frame wider than the sheet, and encodes letters Helvetica lacks as a question mark", async () => {
    const wide: SceneElement = { tag: "svg", attrs: { width: 4000, height: 100 }, children: [{ tag: "text", attrs: { x: 0, y: 50 }, text: "漢字 ok" }] };
    const bytes = scenesToPdf([wide, { tag: "svg", attrs: {} }]);
    const source = new TextDecoder("latin1").decode(bytes);
    expect(source).toMatch(/^0\.\d+ 0 0 -0\.\d+ 36 559 cm$/m);
    const read = await readPdf(bytes);
    expect(read.pages[0]).toContain("?? ok");
    // More than 128 letters beyond ASCII: the rest are question marks too, and the file still opens.
    const many = Array.from({ length: 140 }, (_, at) => String.fromCharCode(0x100 + at)).join("");
    const crowded = scenesToPdf([{ tag: "svg", attrs: { width: 100, height: 100 }, children: [{ tag: "text", attrs: { x: 0, y: 10 }, text: many }] }]);
    expect(xrefProblems(crowded)).toEqual([]);
    await expect(readPdf(crowded)).resolves.toBeDefined();
  });
});

describe("the PDF writer's parts", () => {
  it("names glyphs from the letter and its accent, and knows the ones that are neither", () => {
    expect(glyphName("ő")).toBe("ohungarumlaut");
    expect(glyphName("Ű")).toBe("Uhungarumlaut");
    expect(glyphName("č")).toBe("ccaron");
    expect(glyphName("ß")).toBe("germandbls");
    expect(glyphName("ł")).toBe("lslash");
    expect(glyphName("漢")).toBeUndefined();
    expect(glyphName("ǖ")).toBeUndefined();
    expect(textWidth("Aő", 10)).toBeCloseTo(6.67 + 5.56, 1);
    expect(textWidth("漢", 10)).toBeCloseTo(5.56, 2);
  });

  it("measures bold text in Helvetica-Bold's widths, so it centres where it is drawn (M15)", () => {
    expect(textWidth("Hi", 10)).toBeCloseTo(9.44, 6);
    expect(textWidth("Hi", 10, "bold")).toBeCloseTo(10, 6);
    expect(textWidth("Wm'`~", 10, "bold")).toBeCloseTo((944 + 889 + 238 + 333 + 584) / 100, 6);
    expect(textWidth("ő", 10, "bold")).toBeCloseTo(6.11, 6);
    const scene: SceneElement = {
      tag: "svg",
      attrs: { width: 200, height: 40 },
      children: [{ tag: "text", attrs: { x: 100, y: 20, "text-anchor": "middle", "font-weight": "bold", "font-size": 10 }, text: "Wide" }],
    };
    const source = new TextDecoder("latin1").decode(scenesToPdf([scene]));
    const left = 100 - textWidth("Wide", 10, "bold") / 2;
    expect(source).toMatch(new RegExp(`/F2 10 Tf 1 0 0 -1 ${String(Math.round(left * 1000) / 1000).replace(".", "\\.")} `));
  });

  it("names only glyphs Helvetica has: a comma below where Unicode writes a cedilla, nothing for a pair it lacks (M8)", () => {
    // Latvian and Romanian: Unicode decomposes these with a cedilla, Helvetica names a comma accent.
    expect(["ķ", "ļ", "ņ", "ģ", "ŗ", "ţ", "Ķ", "Ļ", "Ņ", "Ģ", "Ŗ", "Ţ"].map(glyphName)).toEqual([
      "kcommaaccent", "lcommaaccent", "ncommaaccent", "gcommaaccent", "rcommaaccent", "tcommaaccent",
      "Kcommaaccent", "Lcommaaccent", "Ncommaaccent", "Gcommaaccent", "Rcommaaccent", "Tcommaaccent",
    ]);
    expect(["ș", "ț", "ş", "ç", "ą", "ů", "ĺ", "ľ", "ż", "İ", "ā", "Ğ"].map(glyphName)).toEqual([
      "scommaaccent", "tcommaaccent", "scedilla", "ccedilla", "aogonek", "uring", "lacute", "lcaron", "zdotaccent", "Idotaccent", "amacron", "Gbreve",
    ]);
    // A letter and an accent Helvetica has no glyph of together: a question mark, not an invented name.
    for (const char of ["ǎ", "ẍ", "ẽ", "ḱ", "ẁ", "ǹ", "ǵ"]) expect(glyphName(char), char).toBeUndefined();
  });

  it("writes a text whose accents come apart as the letters they make (M9)", async () => {
    const text = "Re\u0301sume\u0301 Ła\u0328ka";
    const bytes = scenesToPdf([{ tag: "svg", attrs: { width: 200, height: 40 }, children: [{ tag: "text", attrs: { x: 0, y: 20 }, text }] }]);
    expect((await readPdf(bytes)).pages[0]).toContain("Résumé Łąka");
    expect(textWidth(text, 10)).toBeCloseTo(textWidth(text.normalize("NFC"), 10), 6);
  });

  it("reads the colours a stylesheet writes", () => {
    expect(parseColor("#fff")).toEqual([1, 1, 1, 1]);
    expect(parseColor("#00000080")?.[3]).toBeCloseTo(0.5, 2);
    expect(parseColor("rgb(255 0 0 / 50%)")).toEqual([1, 0, 0, 0.5]);
    expect(parseColor("rgba(0, 0, 255, 0.2)")).toEqual([0, 0, 1, 0.2]);
    expect(parseColor("none")).toBeUndefined();
    expect(parseColor("transparent")).toBeUndefined();
    expect(parseColor(undefined)).toBeUndefined();
    expect(parseColor("currentColor", "white")).toEqual([1, 1, 1, 1]);
    expect(parseColor("black")).toEqual([0, 0, 0, 1]);
    expect(parseColor("papayawhip")).toEqual([0, 0, 0, 1]);
  });

  it("reads transforms and path data", () => {
    expect(parseTransform("")).toBeUndefined();
    expect(parseTransform("translate(3 4)")).toEqual([1, 0, 0, 1, 3, 4]);
    expect(parseTransform("scale(2)")).toEqual([2, 0, 0, 2, 0, 0]);
    expect(parseTransform("matrix(1 0 0 1 5 6) translate(1)")).toEqual([1, 0, 0, 1, 6, 6]);
    const rotated = parseTransform("rotate(90)") ?? [];
    expect(rotated[1]).toBeCloseTo(1, 6);
    expect(pathOps("M0 0 L10 0 Z")).toBe("0 0 m 10 0 l h");
    expect(pathOps("m1 1 2 2")).toBe("1 1 m 3 3 l");
    expect(pathOps("M0 0 Q10 0 10 10")).toBe("0 0 m 6.667 0 10 3.333 10 10 c");
    expect(pathOps("M0 0 X 1 1")).toBe("0 0 m");
    // An arc's flags are one digit each, written without a separator or with one (M14).
    expect(pathOps("M0 0 a5 5 0 015 5")).toBe("0 0 m 5 5 l");
    expect(pathOps("M0 0 a5 5 0 1 0 5 5")).toBe("0 0 m 5 5 l");
    expect(pathOps("M0 0A5,5,0,1,1,10,10l1-1")).toBe("0 0 m 10 10 l 11 9 l");
    expect(pathOps("M0 0 a5 5 0 1110 0 5 5 0 00-10 0")).toBe("0 0 m 10 0 l 0 0 l");
    expect(pathOps("M1e1 +2")).toBe("10 2 m");
  });
});
