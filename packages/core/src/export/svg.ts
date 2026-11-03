/**
 * The frame as files: a standalone SVG document, and a PNG of it.
 *
 * A scene already carries everything it is drawn with — its own stylesheet,
 * its own namespace — so a standalone SVG is the scene's string with an XML
 * declaration in front, and it shows in any viewer as it showed on screen.
 * The theme is what the frame was rendered with: an `auto` frame follows the
 * viewer's colour scheme, so an export meant to look one way renders with
 * that theme pinned.
 */

import { renderToSvgString } from "../scene.js";
import type { SceneElement } from "../scene.js";

/**
 * A scene as a standalone SVG document.
 *
 * A character XML 1.0 allows nowhere — a C0 control other than tab and the
 * line ends, U+FFFE, U+FFFF, half a surrogate pair — is left out of the
 * text and the attribute values: with one, the string is no document, and
 * no viewer opens it. An HTML page takes the scene's string as it is.
 */
export function standaloneSvg(scene: SceneElement, options: { readonly title?: string } = {}): string {
  const titled: SceneElement =
    options.title === undefined ? scene : { ...scene, children: [{ tag: "title", text: options.title }, ...(scene.children ?? [])] };
  return `<?xml version="1.0" encoding="UTF-8"?>\n${xmlSafe(renderToSvgString(titled))}`;
}

// Markup is all printable ASCII, so what this drops is only ever content.
function xmlSafe(svg: string): string {
// eslint-disable-next-line no-control-regex -- these are the characters it is about
  return svg.replace(/[\0-\b\v\f\x0e-\x1f\ufffe\uffff\p{Cs}]/gu, "");
}

/** What a PNG is made at. */
export interface PngOptions {
  /** Device pixels per CSS pixel. 2 by default: sharp on a high-density screen and in print. */
  readonly scale?: number;
  /** A colour under the drawing; transparent where the frame draws nothing, by default. */
  readonly background?: string;
}

/**
 * An SVG document as a PNG, in the browser: drawn into a canvas through an
 * image, as the browser itself would draw it. The document is the host's,
 * as for every other part of the core that touches one.
 *
 * A browser will not let a canvas that drew a `foreignObject` be read back,
 * so the SVG of a scene with HTML labels goes through
 * {@link flattenHtmlText} first.
 */
export async function svgToPng(doc: Document, svg: string, options: PngOptions = {}): Promise<Blob> {
  const size = (name: string): number => Number(new RegExp(`<svg[^>]*\\s${name}="([\\d.]+)"`).exec(svg)?.[1] ?? 0);
  const width = size("width");
  const height = size("height");
  const scale = options.scale ?? 2;
  if (!(width > 0 && height > 0 && scale > 0)) throw new RangeError("The SVG needs a width and a height, and the scale must be positive");
  const url = URL.createObjectURL(new Blob([xmlSafe(svg)], { type: "image/svg+xml" }));
  try {
    const image = doc.createElement("img");
    image.src = url;
    await image.decode();
    const canvas = doc.createElement("canvas");
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const context = canvas.getContext("2d");
    if (context === null) throw new Error("No 2D canvas to draw the PNG in");
    if (options.background !== undefined) {
      context.fillStyle = options.background;
      context.fillRect(0, 0, canvas.width, canvas.height);
    }
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => (blob === null ? reject(new Error("The canvas gave no PNG")) : resolve(blob)), "image/png");
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}
