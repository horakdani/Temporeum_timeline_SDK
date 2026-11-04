import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

/**
 * The print check, in a real browser, through the shipped bundles: with print media,
 * every item of the whole range is on exactly one page.
 *
 * The page (`print.html`) is a quarter's plan, two weeks of it on screen. The
 * print view is what `print()` mounts — the dialog stubbed — and it is read
 * twice: as the DOM the browser lays out for print media, one section a
 * sheet; and as the PDF the browser itself prints from that media
 * (`page.pdf`, the sheet size from the view's own `@page`), read back by
 * pdf.js. Both must put each item on exactly one page, the same one.
 *
 * What the browser showed goes to `.print-browser-log.json`; the check
 * (sdk_check_print.mjs) judges from it, not from the test titles.
 */

const here = dirname(fileURLToPath(import.meta.url));
const LOG = join(here, "..", ".print-browser-log.json");
const require = createRequire(import.meta.url);
const STANDARD_FONTS = require.resolve("pdfjs-dist/package.json").replace(/package\.json$/, "standard_fonts/");
// A4 landscape with half-inch margins, in CSS pixels: the print view's default sheet.
const PRINTABLE = { width: 1026, height: 697 };

function record(key: string, value: unknown): void {
  const log = existsSync(LOG) ? (JSON.parse(readFileSync(LOG, "utf8")) as Record<string, unknown>) : {};
  log[key] = value;
  writeFileSync(LOG, `${JSON.stringify(log, null, 2)}\n`);
}

interface Section {
  readonly ids: readonly string[];
  readonly height: number;
  readonly svgHeight: number;
}

async function open(page: Page): Promise<void> {
  await page.goto("/print.html");
  await page.waitForFunction(() => (window as unknown as { tl?: { ready: boolean } }).tl?.ready === true);
}

async function sections(page: Page): Promise<Section[]> {
  return page.evaluate(() => {
    const view = document.querySelectorAll("body > [data-tl-print] > section");
    return [...view].map((section) => ({
      ids: [...new Set([...section.querySelectorAll("[data-tl-id]")].map((node) => node.getAttribute("data-tl-id") ?? ""))],
      height: section.getBoundingClientRect().height,
      svgHeight: section.querySelector("svg")?.getBoundingClientRect().height ?? 0,
    }));
  });
}

/** Each page's text, as pdf.js reads it. */
async function pdfText(bytes: Uint8Array): Promise<string[][]> {
  // pdf.js 6 destroys through the loading task; the document has no destroy() of its own.
  const task = getDocument({ data: bytes.slice(), stopAtErrors: true, standardFontDataUrl: STANDARD_FONTS, verbosity: 0 });
  const doc = await task.promise;
  const pages: string[][] = [];
  for (let at = 1; at <= doc.numPages; at += 1) {
    const content = await (await doc.getPage(at)).getTextContent();
    pages.push(content.items.map((item) => ("str" in item ? item.str.trim() : "")).filter((text) => text !== ""));
  }
  await task.destroy();
  return pages;
}

/** The pages each label is found on. */
function pagesOfLabels(pages: readonly (readonly string[])[], labels: Readonly<Record<string, string>>): Map<string, number[]> {
  const found = new Map<string, number[]>();
  pages.forEach((texts, at) => {
    for (const [id, label] of Object.entries(labels)) {
      if (texts.includes(label)) found.set(id, [...(found.get(id) ?? []), at]);
    }
  });
  return found;
}

test("[claim:one-page] with print media, every item of the whole range is on exactly one page, and each page fits its sheet", async ({ page }) => {
  await open(page);
  const ids = await page.evaluate(() => (window as unknown as { tl: { ids(): string[] } }).tl.ids());
  await page.evaluate(() => (window as unknown as { tl: { mountPrint(): unknown } }).tl.mountPrint());
  const onScreen = await page.evaluate(() => getComputedStyle(document.querySelector("body > [data-tl-print]") as Element).display);
  await page.emulateMedia({ media: "print" });
  const shown = await page.evaluate(() => ({
    view: getComputedStyle(document.querySelector("body > [data-tl-print]") as Element).display,
    main: getComputedStyle(document.querySelector("main") as Element).display,
  }));
  const pages = await sections(page);
  const where = new Map<string, number[]>();
  pages.forEach((section, at) => {
    for (const id of section.ids) where.set(id, [...(where.get(id) ?? []), at]);
  });
  const missing = ids.filter((id) => !where.has(id));
  const duplicated = ids.filter((id) => (where.get(id)?.length ?? 0) > 1);
  const overflowing = pages.filter((section) => section.height > PRINTABLE.height + 0.5 || section.svgHeight > section.height + 0.5).length;
  record("onePage", {
    items: ids.length,
    pages: pages.length,
    perPage: pages.map((section) => section.ids.length),
    missing: missing.length,
    duplicated: duplicated.length,
    overflowing,
    hiddenOnScreen: onScreen === "none",
    aloneInPrint: shown.view !== "none" && shown.main === "none",
    where: Object.fromEntries([...where].map(([id, at]) => [id, at[0]])),
  });
  expect(pages.length).toBeGreaterThan(1);
  expect(missing).toEqual([]);
  expect(duplicated).toEqual([]);
  expect(overflowing).toBe(0);
  expect(onScreen).toBe("none");
  expect(shown.main).toBe("none");
});

test("[claim:browser-print] the browser's own print gives a sheet a page, each label on its page's sheet only", async ({ page }) => {
  await open(page);
  const labels = await page.evaluate(() => (window as unknown as { tl: { labels(): Record<string, string> } }).tl.labels());
  await page.evaluate(() => (window as unknown as { tl: { mountPrint(): unknown } }).tl.mountPrint());
  await page.emulateMedia({ media: "print" });
  const pages = await sections(page);
  const section = new Map<string, number>();
  pages.forEach((each, at) => {
    for (const id of each.ids) section.set(id, at);
  });
  const printed = await page.pdf({ preferCSSPageSize: true, printBackground: true });
  const sheets = await pdfText(new Uint8Array(printed));
  const found = pagesOfLabels(sheets, labels);
  const once = [...found].filter(([, at]) => at.length === 1).length;
  const agreeing = [...found].filter(([id, at]) => at.length === 1 && at[0] === section.get(id)).length;
  record("browserPrint", { sheets: sheets.length, pages: pages.length, labels: Object.keys(labels).length, found: found.size, once, agreeing });
  expect(sheets.length).toBe(pages.length);
  expect(found.size).toBe(Object.keys(labels).length);
  expect(agreeing).toBe(found.size);
});

test("[claim:leaves] after the print the view leaves the document", async ({ page }) => {
  await open(page);
  await page.evaluate(() => (window as unknown as { tl: { mountPrint(): unknown } }).tl.mountPrint());
  const left = await page.evaluate(() => (window as unknown as { tl: { afterPrint(): boolean } }).tl.afterPrint());
  record("leaves", { left });
  expect(left).toBe(true);
});

test("[claim:pdf-export] the element's own PDF agrees with the print view, page for page", async ({ page }) => {
  await open(page);
  const labels = await page.evaluate(() => (window as unknown as { tl: { labels(): Record<string, string> } }).tl.labels());
  const pages = await page.evaluate(() => (window as unknown as { tl: { mountPrint(): { ids: string[] }[] } }).tl.mountPrint());
  const bytes = await page.evaluate(() => (window as unknown as { tl: { pdf(): Promise<number[]> } }).tl.pdf());
  const sheets = await pdfText(new Uint8Array(bytes));
  const found = pagesOfLabels(sheets, labels);
  const section = new Map<string, number>();
  pages.forEach((each, at) => {
    for (const id of each.ids) section.set(id, at);
  });
  const agreeing = [...found].filter(([id, at]) => at.length === 1 && at[0] === section.get(id)).length;
  record("pdfExport", { sheets: sheets.length, pages: pages.length, found: found.size, agreeing });
  expect(sheets.length).toBe(pages.length);
  expect(found.size).toBe(Object.keys(labels).length);
  expect(agreeing).toBe(found.size);
});
