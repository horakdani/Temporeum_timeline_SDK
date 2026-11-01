/**
 * `@temporeum/timeline-core/export` — the timeline as files, with no server:
 * a standalone SVG, a PNG, a PDF, and the browser's own print.
 *
 * Everything starts from the scene, the tree the screen and the server draw,
 * so an export is the frame and not a screenshot of it. The PDF writer is the
 * library's own and has no dependency: vector shapes, selectable text, one
 * page per frame. A print — on paper or as a PDF — is {@link printPages}: the
 * whole range across every page, the lanes cut between rows, each item on
 * exactly one page. The entry point is separate so that the core's own
 * budget does not grow with it.
 */

export { bandLayout, contentRange, onBand, paginate } from "./paginate.js";
export type { PageBand } from "./paginate.js";
export { PAPER_SIZES, printPages, PX_TO_PT, resolvePaper } from "./pages.js";
export type { Paper, PaperOptions, PrintedPage, PrintOptions } from "./pages.js";
export { flattenHtmlText } from "./flatten.js";
export { glyphName, parseColor, parseTransform, pathOps, scenesToPdf, textWidth } from "./pdf.js";
export type { PdfOptions } from "./pdf.js";
export { computeStyle, parseStyleSheet, sheetOf } from "./style.js";
export type { ComputedStyle, StyleSheet } from "./style.js";
export { standaloneSvg, svgToPng } from "./svg.js";
export type { PngOptions } from "./svg.js";
export { mountPrintView, PRINT_VIEW_ATTR, printCss } from "./print.js";
