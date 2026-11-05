import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { storyHtml } from "../src/story.js";

/**
 * Event handler attributes under `script-src-attr 'none'` (R79). A slide's
 * HTML is untrusted text: parsed where the page's policy reads it, each
 * `onclick` in it was a violation report — nothing ran, but whoever writes
 * the slides could fill the page's report endpoint. It is parsed in a
 * document of its own, which has no policy to report to.
 */

const violations: string[] = [];

beforeAll(() => {
  document.addEventListener("securitypolicyviolation", (event) => violations.push(`${event.violatedDirective}: ${event.sample}`));
  const meta = document.createElement("meta");
  meta.httpEquiv = "Content-Security-Policy";
  meta.content = "script-src-attr 'none'";
  document.head.append(meta);
});

afterEach(() => {
  document.body.replaceChildren();
});

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 50));

describe("a slide's HTML under script-src-attr 'none'", () => {
  it("the policy is in force: a handler attribute in the page is reported", async () => {
    const probe = document.createElement("div");
    probe.setAttribute("onclick", "void 0");
    document.body.append(probe);
    probe.click();
    await settle();
    expect(violations.length).toBeGreaterThan(0);
    violations.length = 0;
  });

  it("is read without a report, and keeps no handler", async () => {
    const html = '<p onclick="x()">Tranquillity <b onmouseover="y()">Base</b><img src="x" onerror="z()"><a href="https://example.com" onfocus="w()">link</a></p>'.repeat(6);
    const fragment = storyHtml(document, html);
    const box = document.createElement("div");
    box.append(fragment);
    document.body.append(box);
    await settle();
    expect(violations).toEqual([]);
    expect(box.querySelectorAll("b")).toHaveLength(6);
    expect([...box.querySelectorAll("*")].flatMap((node) => node.getAttributeNames()).filter((name) => name.startsWith("on"))).toEqual([]);
  });

  it("leaves the text and the kept attributes as they were", () => {
    const box = document.createElement("div");
    box.append(storyHtml(document, '<p>Turn on the <abbr title="switch on" onclick="x()">light</abbr> / on <a href=\'https://example.com/?on=1\' onfocus=y>here</a> on</p>'));
    expect(box.textContent).toBe("Turn on the light / on here on");
    expect(box.querySelector("abbr")?.getAttribute("title")).toBe("switch on");
    expect(box.querySelector("a")?.getAttribute("href")).toBe("https://example.com/?on=1");
  });
});
