/**
 * The scene: what a frame *is*, before anything is drawn.
 *
 * The renderer does not touch a DOM node. It produces a tree of plain
 * objects — tag, attributes, text, children — and a serialiser turns that into
 * an SVG string. Three things fall out of that choice, and they are the reason
 * for the indirection:
 *
 * 1. **Server-side rendering is the same code path as the browser.** A frame
 *    is a string in Node, which is what makes the first paint of a
 *    server-rendered page a real timeline rather than a spinner.
 * 2. **The backend is swappable.** A canvas backend — decision 6 allows one
 *    if the measured budget is ever lost — consumes this same tree, so it is
 *    a new consumer rather than a second renderer.
 * 3. **A frame is comparable.** Two scenes diff as data, and a serialised
 *    scene is a visual regression fixture that needs no browser to produce.
 *
 * Determinism is load-bearing here: attributes keep insertion order, numbers
 * are rounded to a fixed number of decimals, and nothing reads a clock or a
 * locale. A fixture that changes when nothing changed is a fixture nobody
 * reviews.
 */

/**
 * One element of a scene.
 *
 * `text` and `children` are both allowed, and `text` comes first when both are
 * present. An attribute whose value is `undefined` is omitted, so a hook can
 * build a node with conditional attributes without juggling object spreads.
 */
export interface SceneElement {
  readonly tag: string;
  readonly attrs?: Readonly<Record<string, string | number | undefined>>;
  readonly text?: string;
  readonly children?: readonly SceneElement[];
}

/** Decimals kept on a numeric attribute. Below this, pixels stop differing. */
const DECIMALS = 3;

/**
 * A number as it appears in the output.
 *
 * Rounded, never in exponential form, and never `-0`: three sources of
 * fixture noise that would otherwise make a snapshot differ from itself
 * across platforms.
 *
 * Exported for the DOM mount, which writes the same attribute values into
 * live nodes: a patched frame and a server-rendered string of the same scene
 * have to agree to the digit, or hydration is a re-render in disguise.
 *
 * @internal
 */
export function formatNumber(value: number, decimals: number = DECIMALS): string {
  if (!Number.isFinite(value)) {
    throw new RangeError(`Scene attributes must be finite numbers, got ${String(value)}`);
  }
  const rounded = Math.round(value * 10 ** decimals) / 10 ** decimals;
  const safe = rounded === 0 ? 0 : rounded;
  return safe.toFixed(decimals).replace(/\.?0+$/, "");
}

function escapeText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(value: string): string {
  return escapeText(value).replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function serializeAttrs(attrs: SceneElement["attrs"]): string {
  if (attrs === undefined) {
    return "";
  }
  let out = "";
  for (const [name, value] of Object.entries(attrs)) {
    if (value === undefined) {
      continue;
    }
    const text = typeof value === "number" ? formatNumber(value) : escapeAttr(value);
    out += ` ${name}="${text}"`;
  }
  return out;
}

/** How the serialiser lays the output out. */
export interface SvgStringOptions {
  /** One element per line, indented by depth. The form a human reviews. */
  readonly pretty?: boolean;
  /** Indent unit for `pretty`. Two spaces by default. */
  readonly indent?: string;
}

function serialize(node: SceneElement, options: SvgStringOptions, depth: number): string {
  const pretty = options.pretty === true;
  const pad = pretty ? (options.indent ?? "  ").repeat(depth) : "";
  const nl = pretty ? "\n" : "";
  const open = `${pad}<${node.tag}${serializeAttrs(node.attrs)}`;
  const children = node.children ?? [];
  const hasText = node.text !== undefined && node.text !== "";

  if (!hasText && children.length === 0) {
    return `${open}/>`;
  }
  // Text and children on one line would need mixed-content rules nobody
  // benefits from; text-only elements stay on one line, which keeps `<title>`
  // and `<text>` readable in a fixture.
  if (hasText && children.length === 0) {
    return `${open}>${escapeText(node.text ?? "")}</${node.tag}>`;
  }
  const body = children.map((child) => serialize(child, options, depth + 1)).join(nl);
  const childPad = pretty ? `${pad}${options.indent ?? "  "}` : "";
  const text = hasText ? `${childPad}${escapeText(node.text ?? "")}${nl}` : "";
  return `${open}>${nl}${text}${body}${nl}${pad}</${node.tag}>`;
}

/**
 * A scene as an SVG document fragment.
 *
 * Pure string work: no DOM, no parser, no escape from the tree it was given.
 * The output is byte-stable for a given scene, which is what lets a fixture
 * be compared rather than eyeballed.
 */
export function renderToSvgString(root: SceneElement, options: SvgStringOptions = {}): string {
  return serialize(root, options, 0);
}

/**
 * Elements in a scene, including the root.
 *
 * The node count is the number a performance budget is written in, so it is
 * part of the public surface rather than a test helper.
 */
export function countSceneNodes(root: SceneElement): number {
  let total = 1;
  for (const child of root.children ?? []) {
    total += countSceneNodes(child);
  }
  return total;
}
