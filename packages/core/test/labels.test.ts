import { describe, expect, it } from "vitest";

import { densityMetrics } from "../src/density.js";
import {
  LABEL_ELLIPSIS,
  estimateTextWidth,
  findLabelOverlap,
  labelSpace,
  placeLabels,
} from "../src/labels.js";
import type { LabelCandidate, LabelOverflow } from "../src/labels.js";

const metrics = densityMetrics("compact", "horizontal");
const measure = labelSpace(metrics);
const MAIN_SIZE = 800;

function candidate(
  id: string,
  main: number,
  mainSize: number,
  text: string,
  row = 0,
  extra: Partial<LabelCandidate> = {},
): LabelCandidate {
  return {
    id,
    text,
    box: { main, mainSize, cross: row * metrics.rowSize, crossSize: metrics.rowSize },
    row,
    rowSpan: 1,
    ...extra,
  };
}

function place(candidates: readonly LabelCandidate[], maxLabels?: number) {
  return placeLabels(candidates, {
    mainSize: MAIN_SIZE,
    measure,
    ...(maxLabels === undefined ? {} : { maxLabels }),
  });
}

describe("estimateTextWidth", () => {
  it("grows with the text and with the type size", () => {
    expect(estimateTextWidth("aa", 12)).toBeGreaterThan(estimateTextWidth("a", 12));
    expect(estimateTextWidth("abc", 24)).toBeCloseTo(estimateTextWidth("abc", 12) * 2);
  });

  it("knows that an m is not an i", () => {
    expect(estimateTextWidth("m", 12)).toBeGreaterThan(estimateTextWidth("i", 12) * 2);
  });

  it("is zero for the empty string", () => {
    expect(estimateTextWidth("", 12)).toBe(0);
  });

  it("treats a wide script as wide", () => {
    expect(estimateTextWidth("時間", 12)).toBeGreaterThan(estimateTextWidth("ab", 12));
  });
});

describe("labelSpace", () => {
  it("puts the width on the main axis when time runs sideways", () => {
    const space = labelSpace(densityMetrics("compact", "horizontal"))("Alpha");
    expect(space.main).toBeGreaterThan(space.cross);
    expect(space.cross).toBe(metrics.lineHeight);
  });

  it("puts the width on the cross axis when time runs down", () => {
    const vertical = densityMetrics("compact", "vertical");
    const space = labelSpace(vertical)("Alpha");
    expect(space.main).toBe(vertical.lineHeight);
    expect(space.cross).toBeGreaterThan(space.main);
  });

  it("takes a type size, which is how tick labels stay measurable", () => {
    const small = labelSpace(metrics, estimateTextWidth, metrics.tickFontSize)("Alpha");
    const normal = measure("Alpha");
    expect(small.main).toBeLessThan(normal.main);
  });
});

describe("placeLabels", () => {
  it("draws a label inside an item that has room", () => {
    const { kept, dropped } = place([candidate("a", 100, 200, "Alpha")]);
    expect(dropped).toEqual([]);
    expect(kept).toHaveLength(1);
    expect(kept[0]?.placement).toBe("inside");
    // A hair past the item's start (CLEARANCE), nothing a pixel shows.
    expect(kept[0]?.box.main).toBeCloseTo(100, 5);
    expect(kept[0]?.box.mainSize).toBeCloseTo(measure("Alpha").main);
  });

  it("centres the line across the lane", () => {
    const { kept } = place([candidate("a", 0, 200, "Alpha")]);
    const expected = (metrics.rowSize - metrics.lineHeight) / 2;
    expect(kept[0]?.box.cross).toBeCloseTo(expected);
    expect(kept[0]?.box.crossSize).toBe(metrics.lineHeight);
  });

  it("moves the label after the item when the item is too narrow", () => {
    const { kept } = place([candidate("a", 100, 4, "Alpha")]);
    expect(kept[0]?.placement).toBe("after");
    expect(kept[0]?.box.main).toBe(104);
  });

  it("gives the label up when neither placement fits on screen", () => {
    const { kept, dropped } = place([candidate("a", MAIN_SIZE - 6, 4, "A very long label indeed")]);
    expect(kept).toEqual([]);
    expect(dropped).toEqual([{ id: "a", reason: "no-room" }]);
  });

  it("places within a range that does not start at zero", () => {
    // A tile of a frame drawn in a space: [1000, 1200), in space pixels.
    const options = { mainStart: 1000, mainSize: 200, measure };
    const inside = placeLabels([candidate("a", 1010, 150, "Alpha")], options);
    expect(inside.kept[0]?.box.main).toBeCloseTo(1010, 5);
    // After the item only if it still ends inside the range.
    const after = placeLabels([candidate("b", 1100, 4, "Alpha")], options);
    expect(after.kept[0]?.placement).toBe("after");
    const tooFar = placeLabels([candidate("c", 1180, 4, "Alpha")], options);
    expect(tooFar.kept).toEqual([]);
    expect(tooFar.dropped).toEqual([{ id: "c", reason: "no-room" }]);
    // Before the range start or past its end is off-screen, as at zero.
    const outside = placeLabels(
      [candidate("d", 900, 50, "Alpha"), candidate("e", 1200, 50, "Alpha")],
      options,
    );
    expect(outside.dropped.map((entry) => entry.reason)).toEqual(["off-screen", "off-screen"]);
  });

  it("reports a collision apart from a want of room", () => {
    // The second item leaves no gap after the first, so the first's label has
    // nowhere to go even though it would have fitted.
    const { kept, dropped } = place([
      candidate("a", 100, 4, "Alpha"),
      candidate("b", 104, 400, "Beta"),
    ]);
    expect(kept.map((label) => label.id)).toEqual(["b"]);
    expect(dropped).toEqual([{ id: "a", reason: "collision" }]);
  });

  it("lets an item with no label keep its own room", () => {
    const blocked = place([candidate("a", 100, 4, "Alpha"), candidate("b", 104, 400, "")]);
    expect(blocked.kept).toEqual([]);
    expect(blocked.dropped).toEqual([{ id: "a", reason: "collision" }]);
    // The same item with the neighbour removed has somewhere to go.
    const free = place([candidate("a", 100, 4, "Alpha")]);
    expect(free.kept).toHaveLength(1);
  });

  it("neither keeps nor reports an item that asked for no label", () => {
    const { kept, dropped } = place([candidate("a", 0, 200, "")]);
    expect(kept).toEqual([]);
    expect(dropped).toEqual([]);
  });

  it("gives the room to the widest item when two want it", () => {
    const { kept, dropped } = place([
      candidate("narrow", 100, 6, "Alpha"),
      candidate("wide", 110, 300, "Beta", 0),
    ]);
    expect(kept.map((label) => label.id)).toEqual(["wide"]);
    expect(dropped.map((label) => label.id)).toEqual(["narrow"]);
  });

  it("lets an explicit priority win over width when room is contended", () => {
    // Width decides by default, so under a budget of one the wide item keeps
    // its label...
    const byWidth = place(
      [candidate("narrow", 0, 6, "Alpha"), candidate("wide", 200, 300, "Beta")],
      1,
    );
    expect(byWidth.kept.map((label) => label.id)).toEqual(["wide"]);
    // ...and an explicit priority is what overrules that.
    const byPriority = place(
      [
        candidate("narrow", 0, 6, "Alpha", 0, { priority: 1000 }),
        candidate("wide", 200, 300, "Beta"),
      ],
      1,
    );
    expect(byPriority.kept.map((label) => label.id)).toEqual(["narrow"]);
    expect(byPriority.dropped).toEqual([{ id: "wide", reason: "over-budget" }]);
  });

  it("does not depend on the input order", () => {
    const items = [
      candidate("a", 0, 120, "Alpha"),
      candidate("b", 130, 40, "Beta"),
      candidate("c", 300, 300, "Gamma"),
      candidate("d", 80, 30, "Delta", 1),
    ];
    const forwards = place(items);
    const backwards = place([...items].reverse());
    expect(backwards.kept).toEqual(forwards.kept);
    expect(new Set(backwards.dropped.map((label) => label.id))).toEqual(
      new Set(forwards.dropped.map((label) => label.id)),
    );
  });

  it("drops a label whose item is entirely off screen", () => {
    const { dropped } = place([
      candidate("left", -200, 50, "Alpha"),
      candidate("right", MAIN_SIZE + 10, 50, "Beta"),
    ]);
    expect(dropped).toEqual([
      { id: "left", reason: "off-screen" },
      { id: "right", reason: "off-screen" },
    ]);
  });

  it("honours a label budget, lowest priority first", () => {
    const { kept, dropped } = place(
      [
        candidate("a", 0, 300, "Alpha"),
        candidate("b", 0, 200, "Beta", 1),
        candidate("c", 0, 100, "Gamma", 2),
      ],
      2,
    );
    expect(kept.map((label) => label.id)).toEqual(["a", "b"]);
    expect(dropped).toEqual([{ id: "c", reason: "over-budget" }]);
  });

  it("blocks every row a tall item covers", () => {
    const tall = candidate("tall", 0, 300, "Alpha", 0, { rowSpan: 3 });
    const { kept, dropped } = place([tall, candidate("under", 10, 200, "Beta", 2)]);
    expect(kept.map((label) => label.id)).toEqual(["tall"]);
    expect(dropped).toEqual([{ id: "under", reason: "collision" }]);
  });

  it("never lets two drawn labels overlap", () => {
    const { kept } = place([
      candidate("a", 0, 60, "Alphabet soup"),
      candidate("b", 40, 60, "Beta"),
      candidate("c", 80, 60, "Gamma"),
      candidate("d", 120, 400, "Delta"),
    ]);
    expect(findLabelOverlap(kept)).toBeUndefined();
  });
});

describe("findLabelOverlap", () => {
  const base = {
    text: "x",
    placement: "inside" as const,
    row: 0,
    rowSpan: 1,
    box: { main: 0, mainSize: 50, cross: 0, crossSize: 14 },
  };

  it("finds two labels that overlap in one row", () => {
    const found = findLabelOverlap([
      { ...base, id: "a" },
      { ...base, id: "b", box: { ...base.box, main: 20 } },
    ]);
    expect(found?.a.id).toBe("a");
    expect(found?.b.id).toBe("b");
  });

  it("allows the same main extent in different rows", () => {
    expect(
      findLabelOverlap([
        { ...base, id: "a" },
        { ...base, id: "b", row: 1 },
      ]),
    ).toBeUndefined();
  });

  it("treats touching labels as not overlapping", () => {
    expect(
      findLabelOverlap([
        { ...base, id: "a" },
        { ...base, id: "b", box: { ...base.box, main: 50 } },
      ]),
    ).toBeUndefined();
  });

  it("catches an overlap across a tall label's rows", () => {
    expect(
      findLabelOverlap([
        { ...base, id: "a", rowSpan: 2 },
        { ...base, id: "b", row: 1 },
      ]),
    ).toBeDefined();
  });
});

describe("placeLabels across the lane axis", () => {
  const vertical = densityMetrics("dense", "vertical");
  const verticalMeasure = labelSpace(vertical);

  function placeVertical(text: string, mainSize: number, overflow: LabelOverflow = "drop") {
    return placeLabels(
      [
        {
          id: "a",
          text,
          box: { main: 0, mainSize, cross: 0, crossSize: vertical.rowSize },
          row: 0,
          rowSpan: 1,
        },
      ],
      { mainSize: 600, measure: verticalMeasure, overflow },
    );
  }

  // Under `overflow: "drop"`, the behaviour before 1.0.0-rc.5; the default
  // shortens instead, below.
  it("gives up a label that is too wide for the lane, in either placement", () => {
    const long = "A very long description that will certainly not fit";
    expect(verticalMeasure(long).cross).toBeGreaterThan(vertical.rowSize);
    // Not inside a tall item...
    expect(placeVertical(long, 400).dropped).toEqual([{ id: "a", reason: "no-room" }]);
    // ...and not after a short one either: "after" moves along time, which
    // does not make the lane any wider.
    expect(placeVertical(long, 2).dropped).toEqual([{ id: "a", reason: "no-room" }]);
  });

  it("shortens a label too wide for the lane to what fits across it, by default", () => {
    const long = "A very long description that will certainly not fit";
    for (const mainSize of [400, 2]) {
      const { kept, dropped } = placeVertical(long, mainSize, "ellipsis");
      expect(dropped).toEqual([]);
      const label = kept[0];
      expect(label?.shortened).toBe(true);
      expect(label?.text.endsWith(LABEL_ELLIPSIS)).toBe(true);
      expect(long.startsWith(label?.text.slice(0, -1).trimEnd() ?? "\u0000")).toBe(true);
      // Across: inside the lane. Along: inside a tall item, after a short one.
      expect(label?.box.crossSize).toBeLessThanOrEqual(vertical.rowSize);
      expect(label?.placement).toBe(mainSize === 400 ? "inside" : "after");
      // And as long as fits: one character more would not.
      const more = long.slice(0, (label?.text.length ?? 0)) + LABEL_ELLIPSIS;
      expect(verticalMeasure(more).cross).toBeGreaterThan(vertical.rowSize);
    }
  });

  it("keeps a label that fits across the lane", () => {
    const { kept } = placeVertical("Research", 400);
    expect(kept).toHaveLength(1);
    expect(kept[0]?.box.crossSize).toBeLessThanOrEqual(vertical.rowSize);
  });

  it("never lets a drawn label leave its lane", () => {
    const { kept } = placeVertical("Research", 2);
    for (const label of kept) {
      expect(label.box.cross).toBeGreaterThanOrEqual(0);
      expect(label.box.cross + label.box.crossSize).toBeLessThanOrEqual(vertical.rowSize);
    }
  });
});

describe("placement cost", () => {
  it("looks at an item's neighbours in its row, not at the whole row", () => {
    // R5: every check walked every interval claimed in the row, so one row of
    // 8k items took 708 ms a frame; these 80k took 52 s.
    const candidates = Array.from({ length: 80_000 }, (_, n) => candidate(`i${String(n)}`, n * 10, 6, n % 3 === 0 ? "" : "a"));
    const started = performance.now();
    const layout = placeLabels(candidates, { mainSize: 800_000, measure: (text) => ({ main: text.length * 4, cross: 10 }) });
    expect(performance.now() - started).toBeLessThan(3000);
    expect(layout.kept.length + layout.dropped.length).toBe(candidates.filter((c) => c.text !== "").length);
  });
});
