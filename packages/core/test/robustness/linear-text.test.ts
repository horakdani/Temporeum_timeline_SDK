/**
 * Text from outside — a calendar file, a story, a vis-timeline item, a
 * style — is read in time proportional to its length. Each input below
 * is one a backtracking pattern took quadratic time over: at this length,
 * the old patterns ran for close to a minute; a linear scan, milliseconds.
 * The bound is far from both.
 */
import { describe, expect, it } from "vitest";

import { parseICal } from "../../src/calendar/index.js";
import { computeStyle, parseStyleSheet } from "../../src/export/style.js";
import { storyPlainText } from "../../src/story/index.js";
import { visText } from "../../src/vis-compat/index.js";

const N = 300_000;
const BOUND_MS = 2000;

function within(run: () => unknown): unknown {
  const began = performance.now();
  const out = run();
  expect(performance.now() - began).toBeLessThan(BOUND_MS);
  return out;
}

describe("untrusted text in linear time", () => {
  it("a TZID of letters, and still finds the Area/City at the end of a vendor's", () => {
    const calendar = within(() =>
      parseICal(["BEGIN:VCALENDAR", "BEGIN:VEVENT", "UID:x", `DTSTART;TZID=${"a".repeat(N)}!:20260101T090000`, "END:VEVENT", "END:VCALENDAR"].join("\r\n")),
    ) as ReturnType<typeof parseICal>;
    expect(calendar.events[0]?.start).toBe(Date.UTC(2026, 0, 1, 9));
    const vendor = parseICal(["BEGIN:VCALENDAR", "BEGIN:VEVENT", "UID:y", "DTSTART;TZID=/softwarestudio.org/Olson_20011030_5/America/New_York:20260101T090000", "END:VEVENT", "END:VCALENDAR"].join("\r\n"));
    expect(vendor.events[0]?.timeZone).toBe("America/New_York");
  }, 120_000);

  it("a story headline of open brackets, and its tags still go", () => {
    expect(within(() => storyPlainText("<".repeat(N)))).toBe("<".repeat(N));
    expect(storyPlainText("a <b>bold</b> <i class='x'>move</i>")).toBe("a bold move");
  }, 120_000);

  it("a vis-timeline item of unclosed tags and scripts, and its markup still goes", () => {
    expect(within(() => visText("<a".repeat(N / 2)))).toBe("<a".repeat(N / 2));
    within(() => visText(`${"<script".repeat(N / 7)}</style>`));
    within(() => visText(`</script>${"<script".repeat(N / 7)}`));
    expect(visText("<b>x</b><script>alert(1)</script><style>p{}</style> y")).toBe("x y");
  }, 120_000);

  it("a style of unclosed var(), and a var() with a fallback still resolves", () => {
    within(() => computeStyle({ tag: "g", attrs: { style: `fill:${"var(--a,".repeat(N / 8)}` } }, {}, parseStyleSheet("")));
    const sheet = parseStyleSheet(".tl{--b:#123}");
    expect(computeStyle({ tag: "g", attrs: { style: "fill:var(--b);stroke:var(--c, #456)" } }, {}, sheet)).toEqual({ fill: "#123", stroke: "#456" });
  }, 120_000);
});
