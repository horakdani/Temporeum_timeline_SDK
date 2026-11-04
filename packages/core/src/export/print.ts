/**
 * The print view: the pages of {@link printPages}, in the document, for the
 * browser's own print.
 *
 * Each page is a section the size of the sheet's printable box, broken after
 * — so the browser prints one frame a sheet, at 100%, and nothing of a frame
 * runs onto the next sheet. While the view is mounted, print media shows the
 * view alone; the screen does not see it.
 */

import type { SceneElement } from "../scene.js";
import { formatNumber } from "../scene.js";
import type { Paper } from "./pages.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const XHTML_NS = "http://www.w3.org/1999/xhtml";
/** What takes each document's view away again, so a second mount can. */
const mounted = new WeakMap<Document, () => void>();

/** The attribute the view's root carries. */
export const PRINT_VIEW_ATTR = "data-tl-print";

/** The print view's stylesheet: the sheet, one section a page, nothing else on paper. */
export function printCss(paper: Paper): string {
  const root = `[${PRINT_VIEW_ATTR}]`;
  return [
    `@page{size:${String(paper.width)}pt ${String(paper.height)}pt;margin:${String(paper.margin)}pt}`,
    `@media screen{${root}{display:none}}`,
    `@media print{body>:not(${root}){display:none!important}` +
      `${root}{display:block;margin:0;-webkit-print-color-adjust:exact;print-color-adjust:exact}` +
      `${root}>section{break-after:page;overflow:hidden;width:${String(paper.contentWidth)}px;height:${String(paper.contentHeight)}px}` +
      `${root}>section:last-child{break-after:auto}${root} svg{display:block}}`,
  ].join("");
}

/**
 * A scene as live nodes, built once — the view is never patched. Its
 * `<style>`s are collected instead of built: they go into one sheet.
 */
function build(doc: Document, node: SceneElement, html: boolean, css: string[]): Element {
  const element = doc.createElementNS(html ? XHTML_NS : SVG_NS, node.tag);
  for (const [name, value] of Object.entries(node.attrs ?? {})) {
    if (value === undefined) continue;
    const text = typeof value === "number" ? formatNumber(value) : value;
    if (name === "style") (element as SVGElement).style.cssText = text;
    else element.setAttribute(name, text);
  }
  if (node.text !== undefined) element.append(node.text);
  for (const child of node.children ?? []) {
    if (child.tag === "style") css.push(child.text ?? "");
    else element.append(build(doc, child, html || node.tag === "foreignObject", css));
  }
  return element;
}

/**
 * Mount the view at the end of `doc.body`. Returns what takes it away again;
 * a second mount replaces the first.
 *
 * Built with the DOM, not markup, so that neither Trusted Types nor a
 * `style-src` without `'unsafe-inline'` stops it: the stylesheet — the
 * sheet's and the scenes' own — goes into the document's
 * `adoptedStyleSheets`, and only a browser without them gets a `<style>`,
 * with `nonce`.
 */
export function mountPrintView(doc: Document, scenes: readonly SceneElement[], paper: Paper, nonce?: string): () => void {
  mounted.get(doc)?.();
  const root = doc.createElement("div");
  root.setAttribute(PRINT_VIEW_ATTR, "");
  const css = [printCss(paper)];
  scenes.forEach((scene, at) => {
    const section = doc.createElement("section");
    section.setAttribute("data-tl-page", String(at + 1));
    section.append(build(doc, scene, false, css));
    root.append(section);
  });
  const Sheet = doc.defaultView?.CSSStyleSheet;
  let sheet: CSSStyleSheet | undefined;
  if (doc.adoptedStyleSheets !== undefined && Sheet !== undefined) {
    sheet = new Sheet();
    sheet.replaceSync(css.join(""));
    doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, sheet];
  } else {
    const style = doc.createElement("style");
    if (nonce !== undefined) style.nonce = nonce;
    style.textContent = css.join("");
    root.prepend(style);
  }
  doc.body.append(root);
  const remove = (): void => {
    root.remove();
    if (sheet !== undefined) doc.adoptedStyleSheets = doc.adoptedStyleSheets.filter((each) => each !== sheet);
    mounted.delete(doc);
  };
  mounted.set(doc, remove);
  return remove;
}
