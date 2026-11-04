/**
 * A key named `__proto__` is data, not the prototype. JSON.parse makes
 * one an own property; copied with `target[key] = value`, it would set the
 * copy's prototype, and every field the planted object holds would show
 * through the copy.
 */
import { describe, expect, it } from "vitest";

import { applyItemChanges } from "../../src/live/index.js";
import type { Item } from "../../src/types.js";

describe("an own __proto__ key", () => {
  it("in a live update does not set the item's prototype", () => {
    const items: Item[] = [{ id: "a", start: 0, end: 10, label: "A" }];
    const update = JSON.parse('{"id":"a","label":"B","__proto__":{"laneId":"planted","hidden":true}}') as { id: string };
    const { items: next } = applyItemChanges(items, { update: [update] });
    const item = next[0] as Item & { hidden?: unknown };
    expect(item.label).toBe("B");
    expect(Object.getPrototypeOf(item)).toBe(Object.prototype);
    expect(item.laneId).toBeUndefined();
    expect(item.hidden).toBeUndefined();
  });
});
