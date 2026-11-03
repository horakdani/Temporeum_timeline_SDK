/**
 * G-TIME-BARS: a custom time bar moves by a gesture and by a key, and gives
 * an event — the same event for the same move. Both orientations: the keys
 * are axis-relative, and the drag is along the main axis.
 */

import { describe, expect, it } from "vitest";

import { createTimeScale } from "../../src/scale.js";
import { createHiddenDates } from "../../src/tools/hidden.js";
import { snapTime } from "../../src/editing.js";
import { selectRange } from "../../src/tools/range.js";
import { PAGE_STEPS, resolveAxisKey, stepsOf } from "../../src/tools/keys.js";
import { defaultTimeBarStep, dragTimeBarTime, moveTimeBar, timeBarKeyTime, timeBarPlacements } from "../../src/tools/time-bars.js";
import type { TimeBar } from "../../src/tools/time-bars.js";
import type { Domain } from "../../src/types.js";
import { describeBothOrientations } from "../orientation.js";
import { makeRandom } from "../property/harness.js";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const T0 = Date.UTC(2026, 3, 1);
const DOMAIN: Domain = [T0, T0 + 10 * DAY];
const BARS: TimeBar[] = [
  { id: "cut", time: T0 + 3 * DAY, label: "Cut-off" },
  { id: "fixed", time: T0 + 5 * DAY, movable: false },
];
const key = (name: string, extra: Partial<{ altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }> = {}) => ({
  key: name,
  shiftKey: false,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  time: 0,
  ...extra,
});

describeBothOrientations("time bars", (orientation) => {
  const later = orientation === "horizontal" ? "ArrowRight" : "ArrowDown";
  const earlier = orientation === "horizontal" ? "ArrowLeft" : "ArrowUp";

  it("[claim:gesture] follows a drag, keeping where it was grabbed, and lands on the grid", () => {
    const scale = createTimeScale(DOMAIN, 1000);
    const at = timeBarPlacements(BARS, scale)[0];
    expect(at?.inView).toBe(true);
    // Grabbed four pixels right of its line, dragged 100 pixels.
    const grab = { time: at?.time ?? 0, main: (at?.main ?? 0) + 4 };
    const time = dragTimeBarTime(grab, grab.main + 100, scale);
    expect(time).toBeCloseTo((at?.time ?? 0) + 100 * scale.msPerPx, 3);
    const moved = moveTimeBar(BARS, "cut", time, { snapMs: HOUR });
    expect(moved?.moved).toEqual({ id: "cut", time: snapTime(time, HOUR), previous: T0 + 3 * DAY });
    expect(moved?.bars[0]?.time).toBe(snapTime(time, HOUR));
    expect(moved?.bars[1]).toBe(BARS[1]);
  });

  it("[claim:keyboard] moves a step with an arrow along the axis, ten with a page, and to the view's ends with Home and End", () => {
    expect(resolveAxisKey(key(later), orientation)).toBe("later");
    expect(resolveAxisKey(key(earlier), orientation)).toBe("earlier");
    expect(resolveAxisKey(key("PageDown"), orientation)).toBe("pageLater");
    expect(resolveAxisKey(key("PageUp"), orientation)).toBe("pageEarlier");
    expect(resolveAxisKey(key("Home"), orientation)).toBe("first");
    expect(resolveAxisKey(key("End"), orientation)).toBe("last");
    // The cross arrows and a modifier are someone else's.
    expect(resolveAxisKey(key(orientation === "horizontal" ? "ArrowDown" : "ArrowRight"), orientation)).toBeUndefined();
    expect(resolveAxisKey(key(later, { altKey: true }), orientation)).toBeUndefined();
    const step = defaultTimeBarStep(DOMAIN, HOUR);
    expect(step % HOUR).toBe(0);
    const time = T0 + 3 * DAY;
    expect(timeBarKeyTime(time, "later", { stepMs: step, domain: DOMAIN })).toBe(time + step);
    expect(timeBarKeyTime(time, "earlier", { stepMs: step, domain: DOMAIN })).toBe(time - step);
    expect(timeBarKeyTime(time, "pageLater", { stepMs: step, domain: DOMAIN })).toBe(time + PAGE_STEPS * step);
    expect(timeBarKeyTime(time, "pageEarlier", { stepMs: step, domain: DOMAIN })).toBe(time - PAGE_STEPS * step);
    expect(timeBarKeyTime(time, "first", { stepMs: step, domain: DOMAIN })).toBe(DOMAIN[0]);
    expect(timeBarKeyTime(time, "last", { stepMs: step, domain: DOMAIN })).toBe(DOMAIN[1]);
    expect(stepsOf("first")).toBeUndefined();
  });

  it("[claim:same-event] gives the same event for a drag and for the keys that move it as far", () => {
    const random = makeRandom(0x7b);
    for (let index = 0; index < 40; index += 1) {
      const mainSize = 400 + Math.floor(random() * 1200);
      const scale = createTimeScale(DOMAIN, mainSize);
      const step = defaultTimeBarStep(DOMAIN, HOUR);
      const steps = 1 + Math.floor(random() * 12);
      const at = timeBarPlacements(BARS, scale)[0];
      const grab = { time: at?.time ?? 0, main: at?.main ?? 0 };
      const dragged = moveTimeBar(BARS, "cut", dragTimeBarTime(grab, grab.main + (steps * step) / scale.msPerPx, scale), { snapMs: HOUR });
      let time = at?.time ?? 0;
      for (let k = 0; k < steps; k += 1) time = timeBarKeyTime(time, "later", { stepMs: step, domain: DOMAIN });
      const keyed = moveTimeBar(BARS, "cut", time, { snapMs: HOUR });
      expect(keyed?.moved).toEqual(dragged?.moved);
    }
  });

  it("does not move a bar that is not movable, is not there, or would not move; and keeps a bar inside its limits", () => {
    expect(moveTimeBar(BARS, "fixed", T0)).toBeUndefined();
    expect(moveTimeBar(BARS, "nope", T0)).toBeUndefined();
    expect(moveTimeBar(BARS, "cut", T0 + 3 * DAY + 10, { snapMs: HOUR })).toBeUndefined();
    expect(moveTimeBar(BARS, "cut", Number.NaN)).toBeUndefined();
    expect(moveTimeBar(BARS, "cut", T0 - 100 * DAY, { limits: DOMAIN })?.moved.time).toBe(DOMAIN[0]);
    expect(defaultTimeBarStep(DOMAIN)).toBe((DOMAIN[1] - DOMAIN[0]) / 100);
    expect(snapTime(T0 + 7, undefined)).toBe(T0 + 7);
  });

  it("is placed in shown time with hidden dates, and a bar outside the view says so", () => {
    const hidden = createHiddenDates([{ start: T0 + 18 * HOUR, end: T0 + DAY + 8 * HOUR, repeat: "daily" }]);
    const scale = createTimeScale(DOMAIN, 1000, hidden);
    const [cut] = timeBarPlacements([{ id: "c", time: T0 + DAY + 12 * HOUR }, { id: "out", time: T0 - DAY }], scale);
    expect(cut?.main).toBeCloseTo(scale.toMain(T0 + DAY + 12 * HOUR), 9);
    expect(timeBarPlacements([{ id: "out", time: T0 - DAY }], scale)[0]?.inView).toBe(false);
  });
});

describe("time bars — a drag over hidden time", () => {
  it("lands where the pointer is, though the real distance is longer than the shown one", () => {
    const hidden = createHiddenDates([{ start: T0 + 18 * HOUR, end: T0 + DAY + 8 * HOUR, repeat: "daily" }]);
    const scale = createTimeScale(DOMAIN, 1000, hidden);
    const grab = { time: T0 + 12 * HOUR, main: scale.toMain(T0 + 12 * HOUR) };
    const target = T0 + DAY + 12 * HOUR;
    expect(dragTimeBarTime(grab, scale.toMain(target), scale)).toBeCloseTo(target, -1);
  });

  it("a grid that is not finite snaps nothing, in the tools as in the editor (one snapTime)", () => {
    for (const snapMs of [Infinity, Number.NaN, -HOUR, 0]) {
      expect(selectRange(T0 + 7, T0 + 3 * HOUR + 11, { snapMs })).toEqual({ start: T0 + 7, end: T0 + 3 * HOUR + 11 });
    }
  });
});
