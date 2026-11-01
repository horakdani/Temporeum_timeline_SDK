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
import { renderToSvgString } from "../scene.js";
import type { Paper } from "./pages.js";

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
 * Mount the view at the end of `doc.body`. Returns what takes it away again;
 * a second mount replaces the first.
 */
export function mountPrintView(doc: Document, scenes: readonly SceneElement[], paper: Paper): () => void {
  doc.querySelector(`body>[${PRINT_VIEW_ATTR}]`)?.remove();
  const root = doc.createElement("div");
  root.setAttribute(PRINT_VIEW_ATTR, "");
  root.innerHTML =
    `<style>${printCss(paper)}</style>` +
    scenes.map((scene, at) => `<section data-tl-page="${String(at + 1)}">${renderToSvgString(scene)}</section>`).join("");
  doc.body.append(root);
  return () => root.remove();
}
