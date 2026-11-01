/**
 * G-RANGE-SELECT: a range selected by a gesture and by the keys gives the
 * same event. Both orientations: the keys are axis-relative.
 */

import { describe, expect, it } from "vitest";

import { createTimeScale } from "../../src/scale.js";
import { createHiddenDates } from "../../src/tools/hidden.js";
import { rangeFromDrag, rangeKeyStep, resolveRangeKey, selectRange } from "../../src/tools/range.js";
import type { RangeDraft } from "../../src/tools/range.js";
import type { Domain } from "../../src/types.js";
import { describeBothOrientations } from "../orientation.js";
import { makeRandom } from "../property/harness.js";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const T0 = Date.UTC(2026, 5, 1);
const DOMAIN: Domain = [T0, T0 + 10 * DAY];
const key = (name: string, extra: Partial<{ altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }> = {}) => ({
  key: name,
  shiftKey: false,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  time: 0,
  ...extra,
});

describeBothOrientations("range selection", (orientation) => {
  const later = orientation === "horizontal" ? "ArrowRight" : "ArrowDown";
  const earlier = orientation === "horizontal" ? "ArrowLeft" : "ArrowUp";

  it("[claim:gesture] selects the stretch a drag along the axis covers, in order and on the grid", () => {
    const scale = createTimeScale(DOMAIN, 1000);
    const forward = rangeFromDrag(scale, 200, 450, { snapMs: HOUR });
    const backward = rangeFromDrag(scale, 450, 200, { snapMs: HOUR });
    expect(forward).toEqual(backward);
    expect(forward?.start).toBe(T0 + 2 * DAY);
    expect(forward?.end).toBe(T0 + 4.5 * DAY);
    // A press without a drag selects nothing.
    expect(rangeFromDrag(scale, 300, 300)).toBeUndefined();
    expect(selectRange(T0, T0 + 10, { snapMs: HOUR })).toBeUndefined();
  });

  it("[claim:keyboard] starts with r at the middle, moves its end with the axis arrows and pages, selects with Enter, lets go with Escape", () => {
    expect(resolveRangeKey(key("r"), orientation, false)).toBe("start");
    expect(resolveRangeKey(key("R"), orientation, false)).toBe("start");
    expect(resolveRangeKey(key("r", { ctrlKey: true }), orientation, false)).toBeUndefined();
    expect(resolveRangeKey(key(later), orientation, false)).toBeUndefined();
    expect(resolveRangeKey(key(later), orientation, true)).toBe("later");
    expect(resolveRangeKey(key(earlier), orientation, true)).toBe("earlier");
    expect(resolveRangeKey(key("PageDown"), orientation, true)).toBe("pageLater");
    expect(resolveRangeKey(key("PageUp"), orientation, true)).toBe("pageEarlier");
    expect(resolveRangeKey(key("Home"), orientation, true)).toBeUndefined();
    expect(resolveRangeKey(key("Enter"), orientation, true)).toBe("commit");
    expect(resolveRangeKey(key("Escape"), orientation, true)).toBe("cancel");
    const options = { domain: DOMAIN, stepMs: 3 * HOUR, snapMs: HOUR };
    let draft: RangeDraft = rangeKeyStep(undefined, "start", options);
    expect(draft).toEqual({ anchor: T0 + 5 * DAY, head: T0 + 5 * DAY });
    draft = rangeKeyStep(draft, "later", options);
    draft = rangeKeyStep(draft, "pageLater", options);
    draft = rangeKeyStep(draft, "earlier", options);
    expect(draft.head).toBe(T0 + 5 * DAY + 10 * 3 * HOUR);
    expect(selectRange(draft.anchor, draft.head, options)).toEqual({ start: T0 + 5 * DAY, end: T0 + 5 * DAY + 30 * HOUR });
    // A step with no draft starts one.
    expect(rangeKeyStep(undefined, "later", options)).toEqual({ anchor: T0 + 5 * DAY, head: T0 + 5 * DAY });
  });

  it("[claim:same-event] gives the same event for a drag and for the keys over the same stretch", () => {
    const random = makeRandom(0x5e1);
    for (const hiddenDates of [undefined, createHiddenDates([{ start: T0 + 18 * HOUR, end: T0 + DAY + 8 * HOUR, repeat: "daily" }])]) {
      for (let index = 0; index < 40; index += 1) {
        const mainSize = 500 + Math.floor(random() * 1000);
        const scale = createTimeScale(DOMAIN, mainSize, hiddenDates);
        const stepMs = HOUR * (1 + Math.floor(random() * 6));
        const steps = Math.floor(random() * 30) - 10;
        // The keys: r, then `steps` arrows.
        let draft = rangeKeyStep(undefined, "start", { domain: DOMAIN, stepMs, snapMs: HOUR });
        for (let k = 0; k < Math.abs(steps); k += 1) draft = rangeKeyStep(draft, steps > 0 ? "later" : "earlier", { domain: DOMAIN, stepMs, snapMs: HOUR });
        const keyed = selectRange(draft.anchor, draft.head, { snapMs: HOUR });
        // The drag: from where the keys began to where they ended.
        const dragged = rangeFromDrag(scale, scale.toMain(draft.anchor), scale.toMain(draft.head), { snapMs: HOUR });
        if (hiddenDates?.isHidden(draft.head) === true || hiddenDates?.isHidden(draft.anchor) === true) continue;
        expect(dragged).toEqual(keyed);
      }
    }
  });
});

describe("range selection — no grid", () => {
  it("keeps the instants it is given", () => {
    expect(selectRange(T0 + 7, T0 + 3)).toEqual({ start: T0 + 3, end: T0 + 7 });
  });
});
