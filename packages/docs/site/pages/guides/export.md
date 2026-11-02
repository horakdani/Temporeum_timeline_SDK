# Export and print

A timeline leaves the screen in four ways, and none of them needs a server: the view as a standalone SVG or a PNG, and the whole range as a PDF or on paper through the browser's own print. All four start from the frame the screen draws, so a file is the picture, not a screenshot of it.

```js excerpt:example/export
  svg: () => download("plan.svg", new Blob([timeline.exportSVG()], { type: "image/svg+xml" })),
  png: async () => download("plan.png", await timeline.exportPNG({ scale: 2 })),
```

::: example export

## The plugin

```js excerpt:example/export
import { createTimeline, registerPlugin } from "@temporeum/timeline-element";
import { exportPlugin } from "@temporeum/timeline-element/export";
import { ganttPlugin } from "@temporeum/timeline-element/gantt";

// PNG, PDF and print are a plugin, and so is the Gantt chart this page prints.
registerPlugin(exportPlugin, ganttPlugin);
```

The PNG encoder, the PDF writer and the print view are a plugin on their own entry point, `@temporeum/timeline-element/export`: a page that never exports does not download them. `exportSVG()` needs no plugin — a frame is SVG already. Without the plugin, `exportPNG`, `exportPDF` and `print` throw, naming the import that is missing. Registered once, it serves every timeline on the page. A page that runs the timeline inside a sandboxed `<iframe>` has to allow what the export does: `allow-downloads` to save a file, `allow-modals` for `print()`.

## The view: SVG and PNG

`exportSVG()` returns the view as a standalone SVG document — its own stylesheet inside, so any viewer shows it as the screen did. A theme of `"auto"` is pinned to the one the screen shows when you export: a file must not change with the colour scheme of whoever opens it.

`exportPNG({ scale })` draws the same frame into a canvas, `scale` device pixels to a CSS pixel (2 by default), and resolves to a PNG `Blob`. Item labels are HTML on screen, and a browser will not let a canvas that drew HTML be read back, so in a PNG they are set as SVG text in the same place, size and colour.

## The whole range: PDF and print

```js excerpt:example/export
  pdf: () => {
    const pdf = timeline.exportPDF({ size: "a4", orientation: "landscape" });
```

`exportPDF(options)` returns the bytes of a PDF of the **whole range** — the time the items cover — and `print(options)` sends the same pages to the browser's print dialog. The pages are cut the same way for both:

- **Time is not cut.** Every page shows the whole range across the sheet's width.
- **Lanes are cut between rows**, where no item spans the break — so every item is on exactly one page, and none is cut in two. The exception is a page with no such place: an item taller than a whole page (the break goes through it, and through nothing else where it can), or rows of overlapping multi-row items that together are taller than a page. Then the cut is at the page's edge, and an item it goes through prints on its first page, up to that edge.
- **A page prints at 100%.** It is drawn at the sheet's printable size, a CSS pixel to ¾ of a point.
- **What prints is the content.** Selection, focus and loading marks are not printed, nor is the overview strip; dependency arrows, the resource load and sticky lane headers are. Paper is light unless you configured a theme.

The options are the sheet: `size` (`"a3"`, `"a4"`, `"a5"`, `"letter"`, `"legal"`, or `[width, height]` in points; `"a4"` by default), `orientation` (`"landscape"` by default), `margin` in points (36, half an inch), `range` (`"all"`, or two instants), and for the PDF a `title` — the timeline's `ariaLabel` by default.

The PDF is written by the library itself, with no dependency: vector shapes, and text set in Helvetica that a reader selects, searches and copies as written. Helvetica covers the Latin alphabets of Western and Central Europe; a script outside them needs a font embedded in the file, which the writer does not do yet.

`print()` puts a print view at the end of the document — one section a sheet, shown to print media only — calls `window.print()`, and takes the view away when the browser says the print is over (`afterprint`).

## Without the element

The pieces are in `@temporeum/timeline-core/export`, pure functions over the scene, so they also run on a server or in a build step: `printPages(options, sheet)` gives the frames of a print, `scenesToPdf(scenes, sheet)` writes them as a PDF, `standaloneSvg(scene)` and `svgToPng(document, svg)` make the files of one frame, and `mountPrintView(document, scenes, paper)` is the print view.
