/**
 * The independent parser: Mozilla's pdf.js, the engine of Firefox's viewer.
 *
 * It is told to stop at the first error rather than repair the file, so a
 * broken cross-reference table or a bad stream length is a failure here and
 * not a quietly rebuilt document.
 */

import { createRequire } from "node:module";

import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const require = createRequire(import.meta.url);
const STANDARD_FONTS = require.resolve("pdfjs-dist/package.json").replace(/package\.json$/, "standard_fonts/");

/** What a reader makes of a file: its pages' text, in order, and its title. */
export interface ReadPdf {
  readonly pages: readonly string[];
  readonly sizes: readonly (readonly number[])[];
  readonly title: string | undefined;
}

export async function readPdf(bytes: Uint8Array): Promise<ReadPdf> {
  // pdf.js takes the buffer over: hand it a copy.
  const task = getDocument({ data: bytes.slice(), stopAtErrors: true, standardFontDataUrl: STANDARD_FONTS, verbosity: 0 });
  const doc = await task.promise;
  const pages: string[] = [];
  const sizes: number[][] = [];
  for (let at = 1; at <= doc.numPages; at += 1) {
    const page = await doc.getPage(at);
    // Every operator, so a bad content stream is an error, not a blank page.
    await page.getOperatorList();
    const text = await page.getTextContent();
    pages.push(text.items.map((item) => ("str" in item ? item.str : "")).join("\u0001"));
    sizes.push([...page.view]);
  }
  const info = (await doc.getMetadata()).info as { Title?: string };
  // pdf.js 6: the loading task, not the document, is destroyed.
  await task.destroy();
  return { pages, sizes, title: info.Title };
}

/**
 * The file's own cross-reference table, checked by hand: every in-use entry
 * points at the start of its object, and `startxref` at the table. pdf.js
 * would rebuild a wrong table silently on a lenient path; this does not.
 */
export function xrefProblems(bytes: Uint8Array): string[] {
  const text = new TextDecoder("latin1").decode(bytes);
  const problems: string[] = [];
  const start = Number(/startxref\n(\d+)\n%%EOF\n$/.exec(text)?.[1] ?? Number.NaN);
  if (!text.startsWith("%PDF-1.4\n")) problems.push("no PDF 1.4 header");
  if (!Number.isFinite(start) || !text.startsWith("xref\n", start)) return [...problems, "startxref does not point at the table"];
  const lines = text.slice(start).split("\n");
  const count = Number(/^0 (\d+)$/.exec(lines[1] ?? "")?.[1] ?? 0);
  for (let object = 1; object < count; object += 1) {
    const offset = Number(lines[2 + object]?.slice(0, 10));
    if (!text.startsWith(`${String(object)} 0 obj\n`, offset)) problems.push(`object ${String(object)} is not at ${String(offset)}`);
  }
  for (const match of text.matchAll(/<< \/Length (\d+) >>\nstream\n/g)) {
    const end = (match.index ?? 0) + match[0].length + Number(match[1]);
    if (!text.startsWith("\nendstream", end)) problems.push(`a stream's /Length is wrong at ${String(match.index)}`);
  }
  return problems;
}
