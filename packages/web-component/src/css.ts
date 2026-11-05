/**
 * Styles under a strict Content-Security-Policy.
 *
 * A `style-src` without `'unsafe-inline'` blocks the text of a `<style>` and
 * a `style` attribute written with `setAttribute`, and allows the two things
 * this file uses instead: a constructed sheet in the `adoptedStyleSheets` of
 * the document or shadow root, and the CSSOM (`element.style`). A sheet
 * adopted there applies exactly as the `<style>` did, which reached the
 * whole of the same root too.
 *
 * A box not yet in a document has no such root yet: its sheet is adopted
 * once it is in one, before the first frame that paints it. Only a browser
 * without constructable stylesheets gets the `<style>`, with the host's
 * nonce, which such a policy needs.
 */

/** Each root's sheets by their text, with how many holders keep each. */
const held = new WeakMap<Node, Map<string, [CSSStyleSheet, number]>>();

/**
 * A stylesheet for what `parent` is drawn in. Returns its release: the last
 * holder of a sheet takes it out of the root again.
 *
 * Without a root that adopts, a `<style>` goes first into `parent` — unless
 * one is there already, as in what a server rendered.
 */
export function adoptCss(parent: Element | DocumentFragment, css: string, nonce?: string): () => void {
  const root = parent.getRootNode() as Node & Partial<DocumentOrShadowRoot>;
  const doc = parent.ownerDocument as Document;
  const win = doc.defaultView;
  const Sheet = win?.CSSStyleSheet;
  if (Sheet !== undefined && doc.adoptedStyleSheets !== undefined && !parent.isConnected && win !== null) {
    // Detached: a `<style>` here would be blocked by the policy the moment the
    // box is put in, and nothing would adopt the sheet after (R78). Animation
    // frames run before the paint, so the first paint has the sheet.
    let release: (() => void) | undefined;
    let frame = 0;
    const wait = (): void => {
      if (parent.isConnected) release = adoptCss(parent, css, nonce);
      else frame = win.requestAnimationFrame(wait);
    };
    frame = win.requestAnimationFrame(wait);
    return () => {
      win.cancelAnimationFrame(frame);
      release?.();
      release = () => undefined;
    };
  }
  if (root.adoptedStyleSheets === undefined || Sheet === undefined) {
    if (Array.from(parent.children).some((child) => child.localName === "style")) return () => undefined;
    const style = doc.createElement("style");
    if (nonce !== undefined) style.nonce = nonce;
    style.textContent = css;
    parent.prepend(style);
    return () => style.remove();
  }
  let sheets = held.get(root);
  if (sheets === undefined) held.set(root, (sheets = new Map()));
  let entry = sheets.get(css);
  if (entry === undefined) {
    const sheet = new Sheet();
    sheet.replaceSync(css);
    sheets.set(css, (entry = [sheet, 0]));
  }
  const mine = entry;
  if (mine[1]++ === 0) root.adoptedStyleSheets = [...root.adoptedStyleSheets, mine[0]];
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--mine[1] === 0) root.adoptedStyleSheets = (root.adoptedStyleSheets as CSSStyleSheet[]).filter((sheet) => sheet !== mine[0]);
  };
}

/** The `style` each element was last given here: the CSSOM reads back a normalised one. */
const styles = new WeakMap<Element, string>();

/**
 * An attribute, written only when it changed; a `style` through the CSSOM.
 *
 * A server's `style` that the policy kept from applying is written once
 * more, on the first patch, and from then on it applies.
 */
export function writeAttr(node: HTMLElement, name: string, value: string): void {
  if (name !== "style") {
    if (node.getAttribute(name) !== value) node.setAttribute(name, value);
  } else if (styles.get(node) !== value) {
    node.style.cssText = value;
    styles.set(node, value);
  }
}
