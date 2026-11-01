import { afterEach, expect, it } from "vitest";

import { createTimeline } from "../src/index.js";

/**
 * The instance is not a plain object. A framework's deep state proxies plain
 * objects — Svelte's `$state` when its prototype is `Object.prototype`, Vue's
 * `ref` when `Object.prototype.toString` calls it an Object — and a bound
 * instance would come back as a proxy of itself.
 */

afterEach(() => {
  document.body.replaceChildren();
});

it("has a prototype of its own, named Timeline, under Object.prototype", () => {
  const element = document.createElement("div");
  document.body.append(element);
  const timeline = createTimeline(element, { items: [] });
  const prototype = Object.getPrototypeOf(timeline) as object;
  expect(prototype).not.toBe(Object.prototype);
  expect(Object.getPrototypeOf(prototype)).toBe(Object.prototype);
  expect(Object.prototype.toString.call(timeline)).toBe("[object Timeline]");
  expect(Object.isFrozen(prototype)).toBe(true);
  // Still an ordinary object to the host: its own methods, spread and listed.
  expect(Object.keys(timeline)).toContain("destroy");
  expect(typeof { ...timeline }.update).toBe("function");
  timeline.destroy();
});
