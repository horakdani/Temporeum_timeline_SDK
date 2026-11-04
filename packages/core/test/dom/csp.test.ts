import { describe, expect, it } from "vitest";

import { mountScene } from "../../src/dom/mount.js";
import type { SceneElement } from "../../src/scene.js";
import { FakeDocument, FakeElement, freshLedger } from "./fake-dom.js";

/**
 * A scene's stylesheet and its `style` attributes under a strict
 * Content-Security-Policy: a `style-src` without 'unsafe-inline'
 * blocks a `<style>`'s text and a written `style` attribute, and allows a
 * constructed sheet in `adoptedStyleSheets` and the CSSOM. The browser half
 * — the policy itself — is the web component's CSP test.
 */

class FakeSheet {
  text = "";
  replaceSync(text: string): void {
    this.text = text;
  }
}

/** An element with an inline style object, as every HTML and SVG element has. */
class StyledElement extends FakeElement {
  readonly style = { cssText: "" };
}

class StyledDocument extends FakeDocument {
  declare readonly defaultView: null;
  view: { CSSStyleSheet: typeof FakeSheet } | null = { CSSStyleSheet: FakeSheet };
  override createElementNS(_namespace: string, tag: string): FakeElement {
    this.ledger.created += 1;
    return new StyledElement(this.ledger, this, tag);
  }
}

function setup(adopting = true) {
  const ledger = freshLedger();
  const doc = new StyledDocument(ledger);
  Object.defineProperty(doc, "defaultView", { get: () => doc.view });
  const root = { adoptedStyleSheets: [] as FakeSheet[] };
  const container = new StyledElement(ledger, doc, "div");
  Object.assign(container, { getRootNode: () => (adopting ? root : container) });
  return { container, root, doc };
}

const scene = (css: string, extra: SceneElement[] = []): SceneElement => ({
  tag: "svg",
  children: [{ tag: "style", text: css }, { tag: "rect", attrs: { style: "fill:red" } }, ...extra],
});

const styleOf = (container: FakeElement): StyledElement => (container.childNodes[0] as FakeElement).childNodes[0] as StyledElement;

describe("a scene's styles under a strict CSP", () => {
  it("puts a `<style>` into the root's adoptedStyleSheets, not into the element", () => {
    const { container, root } = setup();
    const mount = mountScene(container as unknown as Element);
    mount.update(scene(".a{}"));
    expect(root.adoptedStyleSheets.map((sheet) => sheet.text)).toEqual([".a{}"]);
    expect(styleOf(container).childNodes).toEqual([]);
    mount.update(scene(".b{}"));
    expect(root.adoptedStyleSheets.map((sheet) => sheet.text)).toEqual([".b{}"]);
  });

  it("rewrites a sheet only when its text changes", () => {
    const { container, root } = setup();
    const mount = mountScene(container as unknown as Element);
    mount.update(scene(".a{}"));
    const sheet = root.adoptedStyleSheets[0] as FakeSheet;
    let writes = 0;
    const replace = sheet.replaceSync.bind(sheet);
    sheet.replaceSync = (text) => {
      writes += 1;
      replace(text);
    };
    mount.update(scene(".a{}"));
    mount.update(scene(".a{}"));
    expect(writes).toBe(0);
  });

  it("leaves the host's own sheets, and takes its own away on destroy", () => {
    const { container, root } = setup();
    const theirs = new FakeSheet();
    root.adoptedStyleSheets = [theirs];
    const mount = mountScene(container as unknown as Element);
    mount.update(scene(".a{}"));
    expect(root.adoptedStyleSheets).toHaveLength(2);
    mount.destroy();
    expect(root.adoptedStyleSheets).toEqual([theirs]);
  });

  it("empties the sheet of a `<style>` the scene no longer has", () => {
    const { container, root } = setup();
    const mount = mountScene(container as unknown as Element);
    mount.update({ tag: "svg", children: [{ tag: "style", text: ".a{}" }, { tag: "style", text: ".mirror{}" }] });
    expect(root.adoptedStyleSheets.map((sheet) => sheet.text)).toEqual([".a{}", ".mirror{}"]);
    mount.update({ tag: "svg", children: [{ tag: "style", text: ".a{}" }] });
    expect(root.adoptedStyleSheets.map((sheet) => sheet.text)).toEqual([".a{}", ""]);
  });

  it("drops the sheets with a root it replaces", () => {
    const { container, root } = setup();
    const mount = mountScene(container as unknown as Element);
    mount.update(scene(".a{}"));
    mount.update({ tag: "div", children: [{ tag: "style", text: ".calendar{}" }] });
    expect(root.adoptedStyleSheets.map((sheet) => sheet.text)).toEqual([".calendar{}"]);
  });

  it("writes a `style` attribute through the CSSOM", () => {
    const { container } = setup();
    const mount = mountScene(container as unknown as Element);
    mount.update(scene(".a{}"));
    const rect = (container.childNodes[0] as FakeElement).childNodes[1] as StyledElement;
    expect(rect.style.cssText).toBe("fill:red");
    expect(rect.attributes.has("style")).toBe(false);
  });

  it("re-applies a server's `style` through the CSSOM when it hydrates", () => {
    const { container, doc } = setup();
    const svg = doc.createElementNS("", "svg") as StyledElement;
    const rect = doc.createElementNS("", "rect") as StyledElement;
    rect.attributes.set("style", "fill:red");
    svg.appendChild(rect);
    container.appendChild(svg);
    mountScene(container as unknown as Element, { hydrate: true }).update({ tag: "svg", children: [{ tag: "rect", attrs: { style: "fill:red" } }] });
    expect(rect.style.cssText).toBe("fill:red");
  });

  it("without a root that adopts, keeps the `<style>` with its text and the nonce", () => {
    const { container, root } = setup(false);
    mountScene(container as unknown as Element, { nonce: "r4nd0m" }).update(scene(".a{}"));
    const style = styleOf(container);
    expect(style.attributes.get("nonce")).toBe("r4nd0m");
    expect(style.childNodes.map((node) => (node as { data?: string }).data)).toEqual([".a{}"]);
    expect(root.adoptedStyleSheets).toEqual([]);
  });

  it("without constructable sheets in the window, keeps the `<style>`", () => {
    const { container, root, doc } = setup();
    doc.view = null;
    mountScene(container as unknown as Element).update(scene(".a{}"));
    expect(styleOf(container).childNodes).toHaveLength(1);
    expect(root.adoptedStyleSheets).toEqual([]);
  });
});
