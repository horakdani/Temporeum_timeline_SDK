/**
 * `@temporeum/timeline-element/export` — export and print, as a plugin.
 *
 * Register it once and an instance's `exportPNG`, `exportPDF` and `print`
 * work: the frame on screen as a PNG, and the whole range on paper — as a
 * PDF, or through the browser's own print. `exportSVG` needs no plugin: a
 * frame is SVG already.
 *
 *     import { registerPlugin } from "@temporeum/timeline-element";
 *     import { exportPlugin } from "@temporeum/timeline-element/export";
 *     registerPlugin(exportPlugin);
 *
 * Paper goes through the core's `printPages`, which cuts the lanes between
 * rows; each page then gets the element's own layers (dependency arrows,
 * the resource load, sticky lane headers) the way a frame on screen does,
 * so what prints is what the element draws, page by page.
 *
 * Its own entry point, as in the core: the PDF writer, the PNG encoder and
 * the print view import the core's `/export`, and a page that never exports
 * does not download any of it. The `<script>`-tag build carries it and
 * registers it on load.
 */

import { renderToSvgString } from "@temporeum/timeline-core";
import type { Layout, SceneElement } from "@temporeum/timeline-core";
import { bandLayout, flattenHtmlText, mountPrintView, printPages, resolvePaper, scenesToPdf, svgToPng } from "@temporeum/timeline-core/export";
import type { PngOptions, PrintOptions } from "@temporeum/timeline-core/export";

import { directionOf, frameOptions, frameScene } from "./config.js";
import type { FrameState, TimelineConfig } from "./config.js";
import { plugin } from "./plugins.js";
import type { TimelinePlugin } from "./plugins.js";

/** How the element prints, on paper or as a PDF. */
export interface TimelinePrintOptions extends PrintOptions {
  /** The document's title. The timeline's `ariaLabel` by default. */
  readonly title?: string;
}

/**
 * The pages of the whole range, each a scene with the element's layers.
 * Paper is light unless a theme is configured; the overview strip is a
 * control, not content, and does not print.
 */
export function printScenes<T>(config: TimelineConfig<T>, state: FrameState<T>, layout: Layout<T>, print: TimelinePrintOptions = {}): SceneElement[] {
  const paperConfig: TimelineConfig<T> = { ...config, minimap: false, theme: config.theme === undefined || config.theme === "auto" ? "light" : config.theme };
  // Exact frames (the element's frame state holds no scene space): nothing selected, focused or loading.
  const exact: FrameState<T> = { ...state, selectedIds: [], focusedId: null, loading: [], layout };
  const pages = printPages(frameOptions(paperConfig, exact), print);
  return pages.map(({ frame, band }) => {
    const { width, height } = frame.scene.attrs as { width: number; height: number };
    const orientation = state.view.orientation;
    const page: FrameState<T> = {
      ...exact,
      domain: frame.viewport.domain,
      view: {
        ...state.view,
        width,
        height,
        mainSize: orientation === "horizontal" ? width : height,
        crossSize: orientation === "horizontal" ? height : width,
        band: 0,
      },
      crossOffset: band.from,
      layout: bandLayout(layout, band),
    };
    return frameScene(paperConfig, page, frame);
  });
}

function png(doc: Document, scene: SceneElement, options?: PngOptions): Promise<Blob> {
  // A canvas that drew HTML cannot be read back: the labels go as SVG text.
  return svgToPng(doc, renderToSvgString(flattenHtmlText(scene)), options);
}

function pdf<T>(config: TimelineConfig<T>, state: FrameState<T>, layout: Layout<T>, options: TimelinePrintOptions): Uint8Array {
  // At least one page: `printPages` cuts an empty layout to one band, the axis.
  const scenes = printScenes(config, state, layout, options);
  // The PDF writer has no stylesheet engine to turn a mirrored frame's text back: attributes do it.
  const mirror = directionOf(config, state) === "rtl" ? plugin("intl", "A right-to-left PDF").mirrorTextNodes : undefined;
  const paper = mirror === undefined ? scenes : scenes.map((scene) => mirror(flattenHtmlText(scene)));
  const title = options.title ?? config.ariaLabel;
  return scenesToPdf(paper, { ...options, ...(title === undefined ? {} : { title }) });
}

function print<T>(doc: Document, config: TimelineConfig<T>, state: FrameState<T>, layout: Layout<T>, options: TimelinePrintOptions): void {
  const scenes = printScenes(config, state, layout, options);
  const remove = mountPrintView(doc, scenes, resolvePaper(options));
  const win = doc.defaultView;
  if (win === null) return;
  win.addEventListener("afterprint", remove, { once: true });
  win.print();
}

/** Export and print. Register it with `registerPlugin(exportPlugin)`. */
export const exportPlugin: TimelinePlugin = Object.freeze({ name: "export", feature: Object.freeze({ png, pdf, print }) });
