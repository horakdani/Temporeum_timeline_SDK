/**
 * A PDF writer with no dependency: scenes in, a PDF 1.4 file out.
 *
 * It reads the scene — the same tree the browser and the server draw — and
 * writes each node as PDF's own drawing operators (an HTML label as the text
 * {@link flattenHtmlText} makes of it), so the file is vector at
 * any zoom and its text is text: selectable, searchable, copied as written.
 *
 * Text is set in the standard Helvetica, which every reader has, so no font
 * is embedded. Its encoding is the file's own: ASCII as itself, every other
 * letter given a code and a glyph name (`ohungarumlaut` for "ő", from the
 * letter's Unicode decomposition), and a ToUnicode table maps each code back
 * — that is what makes the copied text right. Helvetica's glyphs cover the
 * Latin alphabets of Western and Central Europe; a script outside them needs
 * an embedded font, which this writer does not do.
 *
 * Nothing is compressed and nothing reads a clock: the same scenes are the
 * same bytes.
 */

import { formatNumber } from "../scene.js";
import type { SceneElement } from "../scene.js";
import { PX_TO_PT, resolvePaper } from "./pages.js";
import type { PaperOptions } from "./pages.js";
import { flattenHtmlText } from "./flatten.js";
import { computeStyle, sheetOf } from "./style.js";
import type { ComputedStyle, StyleSheet } from "./style.js";

/** What the file says about itself, and the sheet it is set on. */
export interface PdfOptions extends PaperOptions {
  /** The document's title, as a reader shows it. */
  readonly title?: string;
}

/** Helvetica's advance widths for ASCII 32-126, in thousandths of the size. */
const WIDTHS = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556,
  556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556,
  556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];

/** Glyphs that are not a letter and an accent. */
const NAMED: Readonly<Record<string, string>> = {
  " ": "space",
  ß: "germandbls",
  æ: "ae",
  Æ: "AE",
  ø: "oslash",
  Ø: "Oslash",
  ð: "eth",
  Ð: "Eth",
  þ: "thorn",
  Þ: "Thorn",
  ł: "lslash",
  Ł: "Lslash",
  đ: "dcroat",
  Đ: "Dcroat",
  ı: "dotlessi",
  œ: "oe",
  Œ: "OE",
  "–": "endash",
  "—": "emdash",
  "‘": "quoteleft",
  "’": "quoteright",
  "‚": "quotesinglbase",
  "“": "quotedblleft",
  "”": "quotedblright",
  "„": "quotedblbase",
  "…": "ellipsis",
  "•": "bullet",
  "€": "Euro",
  "·": "periodcentered",
  "°": "degree",
  "×": "multiply",
  "÷": "divide",
  "«": "guillemotleft",
  "»": "guillemotright",
  "‹": "guilsinglleft",
  "›": "guilsinglright",
  "©": "copyright",
  "®": "registered",
  "™": "trademark",
  "±": "plusminus",
  µ: "mu",
  "§": "section",
  "¶": "paragraph",
  "¿": "questiondown",
  "¡": "exclamdown",
  "£": "sterling",
  "¥": "yen",
  "¢": "cent",
  "†": "dagger",
  "‡": "daggerdbl",
  "−": "minus",
};

/** Combining marks to the glyph-name suffix the Adobe names use. */
const ACCENTS: Readonly<Record<string, string>> = {
  "̀": "grave",
  "́": "acute",
  "̂": "circumflex",
  "̃": "tilde",
  "̄": "macron",
  "̆": "breve",
  "̇": "dotaccent",
  "̈": "dieresis",
  "̊": "ring",
  "̋": "hungarumlaut",
  "̌": "caron",
  "̦": "commaaccent",
  "̧": "cedilla",
  "̨": "ogonek",
};

/** A character's glyph name in Helvetica, or `undefined` for one it has no glyph for. */
export function glyphName(char: string): string | undefined {
  const named = NAMED[char];
  if (named !== undefined) return named;
  const parts = [...char.normalize("NFD")];
  const base = parts[0] ?? "";
  const accent = parts[1] === undefined ? undefined : ACCENTS[parts[1]];
  return parts.length === 2 && /^[A-Za-z]$/.test(base) && accent !== undefined ? base + accent : undefined;
}

/** A character's advance, in thousandths of the size: an accented letter is as wide as its letter. */
function advance(char: string): number {
  const code = char.charCodeAt(0);
  if (code >= 32 && code <= 126) return WIDTHS[code - 32] ?? 556;
  const base = char.normalize("NFD").charCodeAt(0);
  return base >= 32 && base <= 126 ? (WIDTHS[base - 32] ?? 556) : 556;
}

/** A text's width at a size, in the size's units. */
export function textWidth(text: string, size: number): number {
  let total = 0;
  for (const char of text) total += advance(char);
  return (total * size) / 1000;
}

type Rgba = readonly [number, number, number, number];

/** A CSS colour to RGBA, `undefined` for none. Hex, `rgb()`, `rgba()`, a few names. */
export function parseColor(value: string | undefined, current?: string): Rgba | undefined {
  const text = (value ?? "").trim().toLowerCase();
  if (text === "" || text === "none" || text === "transparent") return undefined;
  if (text === "currentcolor") return parseColor(current);
  if (text === "black") return [0, 0, 0, 1];
  if (text === "white") return [1, 1, 1, 1];
  const hex = /^#([0-9a-f]{3,8})$/.exec(text)?.[1];
  if (hex !== undefined) {
    const full = hex.length <= 4 ? [...hex].map((digit) => digit + digit).join("") : hex;
    const channel = (at: number): number => Number.parseInt(full.slice(at, at + 2), 16) / 255;
    return [channel(0), channel(2), channel(4), full.length === 8 ? channel(6) : 1];
  }
  const rgb = /^rgba?\(([^)]*)\)$/.exec(text)?.[1];
  if (rgb !== undefined) {
    const parts = rgb.split(/[\s,/]+/).filter((part) => part !== "");
    const read = (part: string | undefined, scale: number): number =>
      part === undefined ? 1 : part.endsWith("%") ? Number.parseFloat(part) / 100 : Number.parseFloat(part) / scale;
    return [read(parts[0], 255), read(parts[1], 255), read(parts[2], 255), read(parts[3], 1)];
  }
  // A colour this cannot read is drawn black, as SVG draws an unknown paint's fallback.
  return [0, 0, 0, 1];
}

const n = (value: number): string => formatNumber(Number.isFinite(value) ? value : 0);

/** An SVG transform list as one PDF matrix. */
export function parseTransform(value: string): readonly number[] | undefined {
  let m = [1, 0, 0, 1, 0, 0];
  let any = false;
  for (const match of value.matchAll(/(\w+)\s*\(([^)]*)\)/g)) {
    const args = (match[2] ?? "").split(/[\s,]+/).filter((part) => part !== "").map(Number);
    const [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0] = args;
    let next: number[] | undefined;
    if (match[1] === "matrix") next = [a, b, c, d, e, f];
    else if (match[1] === "translate") next = [1, 0, 0, 1, a, args.length > 1 ? b : 0];
    else if (match[1] === "scale") next = [a, 0, 0, args.length > 1 ? b : a, 0, 0];
    else if (match[1] === "rotate") {
      const r = (a * Math.PI) / 180;
      next = [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0];
    }
    if (next === undefined) continue;
    any = true;
    m = [
      m[0]! * next[0]! + m[2]! * next[1]!,
      m[1]! * next[0]! + m[3]! * next[1]!,
      m[0]! * next[2]! + m[2]! * next[3]!,
      m[1]! * next[2]! + m[3]! * next[3]!,
      m[0]! * next[4]! + m[2]! * next[5]! + m[4]!,
      m[1]! * next[4]! + m[3]! * next[5]! + m[5]!,
    ];
  }
  return any ? m : undefined;
}

/**
 * SVG path data as PDF path operators. Lines, cubic and quadratic curves,
 * absolute and relative; an arc is drawn as the straight line to its end.
 */
export function pathOps(d: string): string {
  const tokens = d.match(/[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi) ?? [];
  const out: string[] = [];
  let at = 0;
  let command = "";
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;
  let controlX = 0;
  let controlY = 0;
  const num = (): number => Number(tokens[at++] ?? 0);
  while (at < tokens.length) {
    if (/[a-z]/i.test(tokens[at] ?? "")) command = tokens[at++] ?? "";
    const rel = command === command.toLowerCase();
    const ox = rel ? x : 0;
    const oy = rel ? y : 0;
    const upper = command.toUpperCase();
    if (upper === "Z") {
      out.push("h");
      x = startX;
      y = startY;
      continue;
    }
    if (upper === "M" || upper === "L" || upper === "T") {
      x = ox + num();
      y = oy + num();
      out.push(`${n(x)} ${n(y)} ${upper === "M" ? "m" : "l"}`);
      if (upper === "M") {
        startX = x;
        startY = y;
        // Further pairs after a move are lines.
        command = rel ? "l" : "L";
      }
    } else if (upper === "H" || upper === "V") {
      if (upper === "H") x = ox + num();
      else y = oy + num();
      out.push(`${n(x)} ${n(y)} l`);
    } else if (upper === "C" || upper === "S") {
      const reflected = [2 * x - controlX, 2 * y - controlY];
      const [x1, y1] = upper === "C" ? [ox + num(), oy + num()] : reflected;
      const x2 = ox + num();
      const y2 = oy + num();
      x = ox + num();
      y = oy + num();
      out.push(`${n(x1 ?? x)} ${n(y1 ?? y)} ${n(x2)} ${n(y2)} ${n(x)} ${n(y)} c`);
      controlX = x2;
      controlY = y2;
      continue;
    } else if (upper === "Q") {
      const qx = ox + num();
      const qy = oy + num();
      const ex = ox + num();
      const ey = oy + num();
      out.push(`${n(x + (2 / 3) * (qx - x))} ${n(y + (2 / 3) * (qy - y))} ${n(ex + (2 / 3) * (qx - ex))} ${n(ey + (2 / 3) * (qy - ey))} ${n(ex)} ${n(ey)} c`);
      x = ex;
      y = ey;
    } else if (upper === "A") {
      at += 5;
      x = ox + num();
      y = oy + num();
      out.push(`${n(x)} ${n(y)} l`);
    } else {
      // Not path data: stop rather than guess.
      break;
    }
    controlX = x;
    controlY = y;
  }
  return out.join(" ");
}

const KAPPA = 0.5523;

function roundedRect(x: number, y: number, w: number, h: number, r: number): string {
  if (!(r > 0)) return `${n(x)} ${n(y)} ${n(w)} ${n(h)} re`;
  const k = r * (1 - KAPPA);
  const right = x + w;
  const bottom = y + h;
  return [
    `${n(x + r)} ${n(y)} m`,
    `${n(right - r)} ${n(y)} l ${n(right - k)} ${n(y)} ${n(right)} ${n(y + k)} ${n(right)} ${n(y + r)} c`,
    `${n(right)} ${n(bottom - r)} l ${n(right)} ${n(bottom - k)} ${n(right - k)} ${n(bottom)} ${n(right - r)} ${n(bottom)} c`,
    `${n(x + r)} ${n(bottom)} l ${n(x + k)} ${n(bottom)} ${n(x)} ${n(bottom - k)} ${n(x)} ${n(bottom - r)} c`,
    `${n(x)} ${n(y + r)} l ${n(x)} ${n(y + k)} ${n(x + k)} ${n(y)} ${n(x + r)} ${n(y)} c h`,
  ].join(" ");
}

function circle(cx: number, cy: number, r: number): string {
  return roundedRect(cx - r, cy - r, 2 * r, 2 * r, r);
}

function pointsPath(points: string, close: boolean): string {
  const values = points.split(/[\s,]+/).filter((part) => part !== "").map(Number);
  const out: string[] = [];
  for (let at = 0; at + 1 < values.length; at += 2) out.push(`${n(values[at] ?? 0)} ${n(values[at + 1] ?? 0)} ${at === 0 ? "m" : "l"}`);
  return out.join(" ") + (close && out.length > 0 ? " h" : "");
}

/** Everything one file shares across its pages: the codes of its letters, its transparency states. */
class Fonts {
  readonly codes = new Map<string, number>();
  readonly extra: string[] = [];
  readonly alphas: number[] = [];

  /** A text as a hex string of the file's codes. A letter Helvetica lacks is a question mark. */
  encode(text: string): string {
    let hex = "";
    for (const char of text) {
      let code = this.codes.get(char);
      if (code === undefined) {
        const ascii = char.charCodeAt(0);
        if (char.length === 1 && ascii >= 32 && ascii <= 126) code = ascii;
        else if (glyphName(char) !== undefined && this.extra.length < 128) {
          code = 128 + this.extra.length;
          this.extra.push(char);
        } else code = 63;
        if (code !== 63 || char === "?") this.codes.set(char, code);
      }
      hex += code.toString(16).padStart(2, "0");
    }
    return `<${hex}>`;
  }

  /** The graphics state for an opacity: `/G0`, `/G1`… */
  alpha(fill: number, stroke: number): string {
    const key = Math.round(fill * 1000) * 10000 + Math.round(stroke * 1000);
    let at = this.alphas.indexOf(key);
    if (at < 0) at = this.alphas.push(key) - 1;
    return `/G${String(at)} gs`;
  }
}

const SKIP = new Set(["title", "desc", "style", "defs", "clipPath", "mask", "marker", "symbol", "metadata", "script"]);

function attr(node: SceneElement, name: string): number {
  const value = Number(node.attrs?.[name] ?? 0);
  return Number.isFinite(value) ? value : 0;
}

function px(value: string | undefined, fallback: number): number {
  const parsed = Number.parseFloat(value ?? "");
  return Number.isFinite(parsed) ? parsed : fallback;
}

function textOf(node: SceneElement): string {
  return (node.text ?? "") + (node.children ?? []).map(textOf).join("");
}

/** The operators that draw one node and what it holds. */
function drawNode(node: SceneElement, parent: ComputedStyle, sheet: StyleSheet, fonts: Fonts, out: string[]): void {
  if (SKIP.has(node.tag)) return;
  const style = computeStyle(node, parent, sheet);
  if (style.display === "none") return;
  const hidden = style.visibility === "hidden";
  const opacity = px(style.opacity, 1);
  const transform = typeof node.attrs?.transform === "string" ? parseTransform(node.attrs.transform) : undefined;
  out.push("q");
  if (transform !== undefined) out.push(`${transform.map(n).join(" ")} cm`);
  const fill = parseColor(style.fill ?? "black", style.color);
  const stroke = parseColor(style.stroke, style.color);
  const strokeWidth = px(style["stroke-width"], 1);
  const size = px(style["font-size"], 16);
  // Helvetica's x-height over two: a central baseline puts the letters' middle on the line.
  const central = size * 0.35;

  const paint = (path: string, canFill = true): void => {
    if (hidden || path === "") return;
    const filling = canFill ? fill : undefined;
    const stroking = strokeWidth > 0 ? stroke : undefined;
    if (filling === undefined && stroking === undefined) return;
    const fillAlpha = (filling?.[3] ?? 1) * px(style["fill-opacity"], 1) * opacity;
    const strokeAlpha = (stroking?.[3] ?? 1) * px(style["stroke-opacity"], 1) * opacity;
    if (fillAlpha < 1 || strokeAlpha < 1) out.push(fonts.alpha(fillAlpha, strokeAlpha));
    if (filling !== undefined) out.push(`${n(filling[0])} ${n(filling[1])} ${n(filling[2])} rg`);
    if (stroking !== undefined) {
      out.push(`${n(stroking[0])} ${n(stroking[1])} ${n(stroking[2])} RG ${n(strokeWidth)} w`);
      const dash = (style["stroke-dasharray"] ?? "none").split(/[\s,]+/).map(Number).filter((value) => Number.isFinite(value));
      if (dash.some((value) => value > 0)) out.push(`[${dash.map(n).join(" ")}] 0 d`);
    }
    out.push(path, filling === undefined ? "S" : stroking === undefined ? "f" : "B");
  };

  /** A line of text from `x` at a baseline. */
  const write = (text: string, x: number, baseline: number): void => {
    const color = parseColor(style.fill ?? "black", style.color);
    if (hidden || text === "" || color === undefined) return;
    const bold = style["font-weight"] === "bold" || px(style["font-weight"], 400) >= 600;
    const anchor = style["text-anchor"] ?? "start";
    const width = textWidth(text, size);
    const left = anchor === "middle" ? x - width / 2 : anchor === "end" ? x - width : x;
    out.push("q");
    const alpha = color[3] * px(style["fill-opacity"], 1) * opacity;
    if (alpha < 1) out.push(fonts.alpha(alpha, 1));
    out.push(`${n(color[0])} ${n(color[1])} ${n(color[2])} rg BT /F${bold ? "2" : "1"} ${n(size)} Tf 1 0 0 -1 ${n(left)} ${n(baseline)} Tm ${fonts.encode(text)} Tj ET Q`);
  };

  const attrs = node.attrs ?? {};
  switch (node.tag) {
    case "rect":
      paint(roundedRect(attr(node, "x"), attr(node, "y"), attr(node, "width"), attr(node, "height"), Math.min(attr(node, "rx") || attr(node, "ry"), attr(node, "width") / 2, attr(node, "height") / 2)));
      break;
    case "circle":
      paint(circle(attr(node, "cx"), attr(node, "cy"), attr(node, "r")));
      break;
    case "line":
      paint(`${n(attr(node, "x1"))} ${n(attr(node, "y1"))} m ${n(attr(node, "x2"))} ${n(attr(node, "y2"))} l`, false);
      break;
    case "polygon":
    case "polyline":
      paint(pointsPath(String(attrs.points ?? ""), node.tag === "polygon"), node.tag === "polygon");
      break;
    case "path":
      paint(pathOps(String(attrs.d ?? "")));
      break;
    case "text": {
      const baseline = style["dominant-baseline"] === "central" || style["dominant-baseline"] === "middle" ? central : 0;
      write(textOf(node), attr(node, "x"), attr(node, "y") + baseline);
      break;
    }
    case "svg":
      // A nested viewport (a flattened label): it clips to its box, and its children are in its own coordinates.
      out.push(`${n(attr(node, "x"))} ${n(attr(node, "y"))} ${n(attr(node, "width"))} ${n(attr(node, "height"))} re W n 1 0 0 1 ${n(attr(node, "x"))} ${n(attr(node, "y"))} cm`);
      break;
    default:
      break;
  }
  if (node.tag !== "text") {
    for (const child of node.children ?? []) drawNode(child, style, sheet, fonts, out);
  }
  out.push("Q");
}

/** One page's content stream: the scene, fitted into the sheet's printable box at most at 100%. */
function pageContent(scene: SceneElement, paper: ReturnType<typeof resolvePaper>, fonts: Fonts): string {
  const width = attr(scene, "width");
  const height = attr(scene, "height");
  const room = [paper.width - 2 * paper.margin, paper.height - 2 * paper.margin];
  const scale = Math.min(PX_TO_PT, width > 0 ? (room[0] ?? 0) / width : PX_TO_PT, height > 0 ? (room[1] ?? 0) / height : PX_TO_PT);
  const out: string[] = [`${n(scale)} 0 0 ${n(-scale)} ${n(paper.margin)} ${n(paper.height - paper.margin)} cm`, `0 0 ${n(width)} ${n(height)} re W n`];
  // The root is the page, not a nested viewport: its children are drawn into the page as they are.
  const flat = flattenHtmlText(scene);
  const sheet = sheetOf(flat);
  const root = computeStyle(flat, {}, sheet);
  for (const child of flat.children ?? []) drawNode(child, root, sheet, fonts, out);
  return out.join("\n");
}

/** UTF-16BE with its mark, as a PDF hex string: a text string any reader decodes. */
function textString(value: string): string {
  let hex = "feff";
  for (let at = 0; at < value.length; at += 1) hex += value.charCodeAt(at).toString(16).padStart(4, "0");
  return `<${hex}>`;
}

function toUnicode(fonts: Fonts): string {
  const pairs: string[] = [];
  for (const [char, code] of fonts.codes) {
    let hex = "";
    for (let at = 0; at < char.length; at += 1) hex += char.charCodeAt(at).toString(16).padStart(4, "0");
    pairs.push(`<${code.toString(16).padStart(2, "0")}> <${hex}>`);
  }
  const blocks: string[] = [];
  for (let at = 0; at < pairs.length; at += 100) {
    const chunk = pairs.slice(at, at + 100);
    blocks.push(`${String(chunk.length)} beginbfchar\n${chunk.join("\n")}\nendbfchar`);
  }
  return [
    "/CIDInit /ProcSet findresource begin 12 dict begin begincmap",
    "/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def",
    "/CMapName /Adobe-Identity-UCS def /CMapType 2 def",
    "1 begincodespacerange <00> <ff> endcodespacerange",
    ...blocks,
    "endcmap CMapName currentdict /CMap defineresource pop end end",
  ].join("\n");
}

/**
 * Scenes as a PDF, one page each.
 *
 * Each scene sits in the sheet's printable box from its top-left corner, at
 * 100% (a CSS pixel is ¾ of a point) or smaller when it would not fit — so
 * {@link printPages}' frames, drawn at the printable box's size, print at
 * exactly 100%.
 */
export function scenesToPdf(scenes: readonly SceneElement[], options: PdfOptions = {}): Uint8Array {
  const paper = resolvePaper(options);
  const fonts = new Fonts();
  const contents = scenes.map((scene) => pageContent(scene, paper, fonts));
  // 1 catalog, 2 pages, 3-4 fonts, 5 encoding, 6 ToUnicode, 7 info, 8 resources, then a page and its content each.
  const objects: string[] = [];
  const kids = contents.map((_, at) => `${String(9 + 2 * at)} 0 R`).join(" ");
  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  objects.push(`<< /Type /Pages /Kids [${kids}] /Count ${String(contents.length)} >>`);
  for (const name of ["Helvetica", "Helvetica-Bold"]) {
    objects.push(`<< /Type /Font /Subtype /Type1 /BaseFont /${name} /Encoding 5 0 R /ToUnicode 6 0 R >>`);
  }
  const differences = fonts.extra.length === 0 ? "" : ` /Differences [128 ${fonts.extra.map((char) => `/${glyphName(char) ?? "question"}`).join(" ")}]`;
  objects.push(`<< /Type /Encoding /BaseEncoding /WinAnsiEncoding${differences} >>`);
  const cmap = toUnicode(fonts);
  objects.push(`<< /Length ${String(cmap.length)} >>\nstream\n${cmap}\nendstream`);
  objects.push(`<< /Producer (Temporeum Timeline)${options.title === undefined ? "" : ` /Title ${textString(options.title)}`} >>`);
  const states = fonts.alphas
    .map((key, at) => `/G${String(at)} << /Type /ExtGState /ca ${n(Math.floor(key / 10000) / 1000)} /CA ${n((key % 10000) / 1000)} >>`)
    .join(" ");
  objects.push(`<< /Font << /F1 3 0 R /F2 4 0 R >> /ExtGState << ${states} >> >>`);
  contents.forEach((content, at) => {
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n(paper.width)} ${n(paper.height)}] /Resources 8 0 R /Contents ${String(10 + 2 * at)} 0 R >>`);
    objects.push(`<< /Length ${String(content.length)} >>\nstream\n${content}\nendstream`);
  });

  // Every byte is ASCII but the header's marker, which tells a transfer the file is binary.
  let file = "%PDF-1.4\n%âãÏÓ\n";
  const offsets: number[] = [];
  objects.forEach((body, at) => {
    offsets.push(file.length);
    file += `${String(at + 1)} 0 obj\n${body}\nendobj\n`;
  });
  const xref = file.length;
  file += `xref\n0 ${String(objects.length + 1)}\n0000000000 65535 f \n`;
  for (const offset of offsets) file += `${String(offset).padStart(10, "0")} 00000 n \n`;
  file += `trailer\n<< /Size ${String(objects.length + 1)} /Root 1 0 R /Info 7 0 R >>\nstartxref\n${String(xref)}\n%%EOF\n`;
  const bytes = new Uint8Array(file.length);
  for (let at = 0; at < file.length; at += 1) bytes[at] = file.charCodeAt(at);
  return bytes;
}
