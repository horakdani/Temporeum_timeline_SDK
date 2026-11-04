import { afterEach, describe, expect, it } from "vitest";

import { adoptCss, writeAttr } from "../src/css.js";
import { trustedHtml, TRUSTED_TYPES_POLICY } from "../src/trusted.js";

/** The two helpers under C1–C4, at their edges. */

afterEach(() => {
  document.body.replaceChildren();
});

describe("adoptCss", () => {
  it("adopts one sheet for one text however many hold it, until the last lets go", () => {
    const parent = document.body.appendChild(document.createElement("div"));
    const before = document.adoptedStyleSheets.length;
    const first = adoptCss(parent, ".x-shared{color:red}");
    const second = adoptCss(parent, ".x-shared{color:red}");
    expect(document.adoptedStyleSheets.length).toBe(before + 1);
    first();
    first();
    expect(document.adoptedStyleSheets.length).toBe(before + 1);
    second();
    expect(document.adoptedStyleSheets.length).toBe(before);
    expect(parent.children).toHaveLength(0);
  });

  it("where nothing adopts, writes a <style> first — or keeps the one already there", () => {
    const detached = document.createElement("div");
    detached.append(document.createElement("span"));
    const release = adoptCss(detached, ".x{}", "n");
    expect(detached.firstElementChild?.localName).toBe("style");
    expect((detached.firstElementChild as HTMLStyleElement).nonce).toBe("n");
    adoptCss(detached, ".y{}")();
    expect(detached.querySelectorAll("style")).toHaveLength(1);
    release();
    expect(detached.querySelectorAll("style")).toHaveLength(0);
  });
});

describe("writeAttr", () => {
  it("writes a style through the CSSOM once, and other attributes only when they change", () => {
    const node = document.body.appendChild(document.createElement("div"));
    writeAttr(node, "style", "left:4px;top:2px");
    expect(node.style.left).toBe("4px");
    node.style.left = "9px";
    // The same value again: nothing is written.
    writeAttr(node, "style", "left:4px;top:2px");
    expect(node.style.left).toBe("9px");
    writeAttr(node, "title", "a");
    expect(node.getAttribute("title")).toBe("a");
  });
});

describe("trustedHtml", () => {
  it("passes the markup as it is without Trusted Types, and through a host's policy when given", () => {
    expect(trustedHtml(null, "<b>x</b>")).toBe("<b>x</b>");
    expect(trustedHtml({} as Window, "<b>x</b>")).toBe("<b>x</b>");
    expect(trustedHtml(null, "<b>x</b>", { createHTML: (input) => `[${input}]` })).toBe("[<b>x</b>]");
  });

  it("makes the element's own policy once a window, and goes without one the page refuses", () => {
    const made: string[] = [];
    const allowing = { trustedTypes: { createPolicy: (name: string, rules: { createHTML(input: string): string }) => (made.push(name), rules) } } as unknown as Window;
    expect(trustedHtml(allowing, "<i>a</i>")).toBe("<i>a</i>");
    expect(trustedHtml(allowing, "<i>b</i>")).toBe("<i>b</i>");
    expect(made).toEqual([TRUSTED_TYPES_POLICY]);
    const refusing = {
      trustedTypes: {
        createPolicy: () => {
          throw new TypeError("Policy not allowed");
        },
      },
    } as unknown as Window;
    expect(trustedHtml(refusing, "<i>c</i>")).toBe("<i>c</i>");
    expect(trustedHtml(refusing, "<i>d</i>")).toBe("<i>d</i>");
  });
});
