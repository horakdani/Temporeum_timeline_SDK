import { describe, expect, it } from "vitest";

import { intlStable } from "../intl-text.mjs";

/** The fixtures' comparison forgives an ICU's spacing, and nothing else. */
describe("intlStable", () => {
  it("makes the spaces ICU versions have written differently the same", () => {
    expect(intlStable("Mar 26, 2025, 12:00 AM – Mar 26, 2025")).toBe(intlStable("Mar 26, 2025, 12:00 AM – Mar 26, 2025"));
    expect(intlStable("10 Mar–2 Apr")).toBe(intlStable("10 Mar – 2 Apr"));
  });

  it("still tells a changed character, digit or word apart", () => {
    const fixture = "Release, Apr 5, 2025, Milestones";
    expect(intlStable("Release, Apr 6, 2025, Milestones")).not.toBe(intlStable(fixture));
    expect(intlStable("Release, Apr 5, 2025, Planning")).not.toBe(intlStable(fixture));
    expect(intlStable("Release,Apr 5, 2025, Milestones")).not.toBe(intlStable(fixture));
  });
});
