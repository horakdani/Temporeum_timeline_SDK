/**
 * Where a stylesheet now lives (C1): a scene's `<style>` and the element's
 * own go into `adoptedStyleSheets` of the document or the shadow root, and
 * the `<style>` stays empty. A test of what a stylesheet says reads it here.
 *
 * A constructed sheet gives its rules back normalised (`touch-action:
 * pan-y`), so the text each was given is recorded as it is given.
 */

const given = new WeakMap<CSSStyleSheet, string>();
const replaceSync = CSSStyleSheet.prototype.replaceSync;
CSSStyleSheet.prototype.replaceSync = function (this: CSSStyleSheet, text: string): void {
  given.set(this, text);
  replaceSync.call(this, text);
};

/** The text of each sheet adopted where `node` is drawn — its shadow root, or the document — in order. */
export function adoptedCss(node: Node): string[] {
  const root = (node instanceof Document || node instanceof ShadowRoot ? node : node.getRootNode()) as Document | ShadowRoot;
  return root.adoptedStyleSheets.map((sheet) => given.get(sheet) ?? [...sheet.cssRules].map((rule) => rule.cssText).join(""));
}

/**
 * The scene's stylesheet where `node` is drawn: the adopted sheet with the
 * item rule — of the drawing's own scope, when it has one.
 */
export function sceneCss(node: ParentNode & Node): string {
  const svg = node instanceof SVGSVGElement ? node : node.querySelector("svg");
  const scope = svg?.getAttribute("data-tl-instance");
  return adoptedCss(node).find((text) => text.includes(".tl-item{") && (scope === null || scope === undefined || text.includes(`[data-tl-instance="${scope}"]`))) ?? "";
}

/** An element's markup with each `style` as the CSSOM writes it, so a server's and a client's compare. */
export function normalisedHtml(node: Element): string {
  const copy = node.cloneNode(true) as Element;
  for (const each of [copy, ...copy.querySelectorAll("[style]")] as HTMLElement[]) {
    if (each.hasAttribute("style")) each.setAttribute("style", each.style.cssText);
  }
  return copy.outerHTML;
}
