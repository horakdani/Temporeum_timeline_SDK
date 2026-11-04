/**
 * Labels: which text gets drawn, where, and which text is given up.
 *
 * A timeline with more items than room is the normal case, not the edge case,
 * so dropping labels is a first-class outcome here rather than an overflow
 * accident. Three rules decide it:
 *
 * 1. **Priority, then position.** The widest item on screen claims its room
 *    first; ties break by start time and then by id, so the same data always
 *    yields the same labels. A label that flickers between frames is worse
 *    than no label. Priority decides the cases where room is genuinely
 *    contended — a label budget, or a gap two labels both reach into.
 * 2. **An item always keeps its own room.** Every item is an obstacle, label
 *    or not, so a label placed after one item can never cover the next. This
 *    is why the function takes *all* items and not only the labelled ones.
 * 3. **Dropping is reported, never silent.** Each dropped label carries a
 *    reason, which is what lets a host show the text some other way — a
 *    tooltip, a detail surface, a cluster — instead of losing it.
 *
 * Everything is in `(main, cross)` space, so the vertical orientation is the
 * same code path: what changes is the room a line of text needs, and that
 * comes from {@link labelSpace}.
 */

import type { DensityMetrics } from "./density.js";
import type { MainCross, MainCrossRect } from "./types.js";

/** Width of one line of text at a type size, in pixels. */
export type MeasureText = (text: string, fontSize: number) => number;

/**
 * Average advance width per character, as a fraction of the type size.
 *
 * Deliberately on the generous side: over-estimating drops a label that would
 * just have fitted, under-estimating lets text spill out of its box. The first
 * is a judgement call, the second is a bug.
 */
function advanceFactor(code: number): number {
  // Narrow: i l j t f r I ! . , : ; ' ` | ( ) [ ] { }
  if (
    code === 105 || code === 108 || code === 106 || code === 116 || code === 102 ||
    code === 114 || code === 73 || code === 33 || code === 46 || code === 44 ||
    code === 58 || code === 59 || code === 39 || code === 96 || code === 124 ||
    code === 40 || code === 41 || code === 91 || code === 93 || code === 123 || code === 125
  ) {
    return 0.34;
  }
  if (code === 32) {
    return 0.29;
  }
  // m, w, M, W, @ — the characters a flat average gets wrong by a third.
  if (code === 109 || code === 119 || code === 77 || code === 87 || code === 64) {
    return 0.93;
  }
  if (code >= 48 && code <= 57) {
    return 0.57;
  }
  if (code >= 65 && code <= 90) {
    return 0.69;
  }
  if (code >= 97 && code <= 122) {
    return 0.54;
  }
  // Everything else, CJK included. A wide default is the safe default.
  return code > 0x2e7f ? 1 : 0.6;
}

/**
 * Text width without a DOM.
 *
 * The core cannot measure a font, so it estimates one. A host that can
 * measure — canvas `measureText`, or `getComputedTextLength` on a mounted
 * node — passes its own measurement in and gets exact placement; the estimate
 * is what makes server-side rendering and Node tests possible at all.
 */
export const estimateTextWidth: MeasureText = (text, fontSize) => {
  let width = 0;
  for (let i = 0; i < text.length; i += 1) {
    width += advanceFactor(text.charCodeAt(i));
  }
  return width * fontSize;
};

/**
 * Room one line of text needs, in `(main, cross)`.
 *
 * In a horizontal timeline text runs along the time axis, so the width is a
 * main extent. In a vertical one the text still reads horizontally, across
 * the lane, so the same width becomes a *cross* extent and the line height
 * becomes the main one. One function, two orientations, no second renderer.
 */
export function labelSpace(
  metrics: DensityMetrics,
  measure: MeasureText = estimateTextWidth,
  fontSize: number = metrics.fontSize,
): (text: string) => MainCross {
  const pad = metrics.labelPadding * 2;
  return (text) => {
    const width = measure(text, fontSize) + pad;
    return metrics.orientation === "horizontal"
      ? { main: width, cross: metrics.lineHeight }
      : { main: metrics.lineHeight, cross: width };
  };
}

/** What a shortened label ends with. */
export const LABEL_ELLIPSIS = "…";

/**
 * Fewest characters of its text a shortened label keeps, before the
 * ellipsis. Two letters and an ellipsis name nothing; three start to — a
 * reader tells "Des…" from "Rev…" — and a narrower room gives the label up.
 */
export const MIN_SHORT_LABEL_CHARACTERS = 3;

/**
 * How a label too long for its room is drawn: shortened with an ellipsis,
 * given up, or — `"auto"`, the renderer's default — shortened where a
 * viewport's width holds no more than a thousand items, and given up where
 * it holds more (`renderTimeline`); to `placeLabels`, which sees no
 * viewport, `"auto"` is `"ellipsis"`.
 */
export type LabelOverflow = "auto" | "ellipsis" | "drop";

/**
 * The text cut into what a reader sees as characters.
 *
 * Grapheme clusters where the runtime can tell them (`Intl.Segmenter`), so a
 * cut never splits an accented letter from its mark or an emoji from its
 * modifier; code points otherwise, which at least never split a surrogate
 * pair. Text with nothing a cluster could join — no combining mark, no
 * surrogate, no joiner, which is most labels — is cut by code unit, without
 * the segmenter: shortening runs for every label a dense frame draws.
 */
let segmenter: { segment(text: string): Iterable<{ readonly segment: string }> } | null | undefined;

/** Anything from the combining marks on, where a code unit may not be a character. */
const CLUSTERING = /[\u0300-\uffff]/;

function charactersOf(text: string): readonly string[] | undefined {
  if (!CLUSTERING.test(text)) {
    return undefined;
  }
  if (segmenter === undefined) {
    const Segmenter = (Intl as { Segmenter?: new (locale?: string, options?: { granularity: "grapheme" }) => typeof segmenter }).Segmenter;
    segmenter = Segmenter === undefined ? null : new Segmenter(undefined, { granularity: "grapheme" });
  }
  if (segmenter === null || segmenter === undefined) {
    return Array.from(text);
  }
  const characters: string[] = [];
  for (const part of segmenter.segment(text)) {
    characters.push(part.segment);
  }
  return characters;
}

/**
 * The longest start of `text`, with an ellipsis, whose room fits `fits`.
 *
 * At least {@link MIN_SHORT_LABEL_CHARACTERS} characters, or nothing:
 * `undefined` when not even that fits, or when the text is no longer than
 * that and so has nothing to shorten. The shortest cut is tried first — in
 * a dense frame most rooms do not even take that — and then a binary search
 * over the cut, so a label costs a handful of measurements, not one per
 * character. Widths grow with the cut, which is what makes the search valid.
 */
export function shortenLabel(
  text: string,
  measure: (text: string) => MainCross,
  fits: (need: MainCross) => boolean,
): { readonly text: string; readonly need: MainCross } | undefined {
  const characters = charactersOf(text);
  const length = characters === undefined ? text.length : characters.length;
  if (length <= MIN_SHORT_LABEL_CHARACTERS) {
    return undefined;
  }
  const cut = (count: number): string =>
    `${(characters === undefined ? text.slice(0, count) : characters.slice(0, count).join("")).trimEnd()}${LABEL_ELLIPSIS}`;
  const shortest = cut(MIN_SHORT_LABEL_CHARACTERS);
  const shortestNeed = measure(shortest);
  if (!fits(shortestNeed)) {
    return undefined;
  }
  let best: { readonly text: string; readonly need: MainCross } = { text: shortest, need: shortestNeed };
  let low = MIN_SHORT_LABEL_CHARACTERS + 1;
  let high = length - 1;
  while (low <= high) {
    const middle = (low + high) >>> 1;
    const candidate = cut(middle);
    const need = measure(candidate);
    if (fits(need)) {
      best = { text: candidate, need };
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return best;
}

/** An item that would like its label drawn. */
export interface LabelCandidate {
  readonly id: string;
  /** Empty means the item wants no label; it still reserves its own room. */
  readonly text: string;
  /** The item's box as drawn, clipped to the viewport. */
  readonly box: MainCrossRect;
  readonly row: number;
  readonly rowSpan: number;
  /** Higher wins. Defaults to the item's main extent on screen. */
  readonly priority?: number;
}

/** Inside the item, or after its end in the same row. */
export type LabelPlacement = "inside" | "after";

/** Why a label was given up. */
export type LabelDropReason = "off-screen" | "no-room" | "collision" | "over-budget";

/** One drawn label. */
export interface PlacedLabel {
  readonly id: string;
  readonly text: string;
  readonly placement: LabelPlacement;
  /** The box the text occupies, in `(main, cross)` space. */
  readonly box: MainCrossRect;
  readonly row: number;
  readonly rowSpan: number;
  /** The text is a start of the item's own, ending in {@link LABEL_ELLIPSIS}. */
  readonly shortened?: true;
}

/** One label that was not drawn, and why. */
export interface DroppedLabel {
  readonly id: string;
  readonly reason: LabelDropReason;
}

/** What the caller tunes. */
export interface LabelOptions {
  /** Viewport extent along the time axis; nothing is placed past it. */
  readonly mainSize: number;
  /**
   * Where that extent starts. 0 by default; a renderer drawing a band wider
   * than the viewport, in coordinates that do not start at its edge, passes
   * the band's start here instead of shifting every box in and out.
   */
  readonly mainStart?: number;
  /** Room a line of text needs. {@link labelSpace} builds this. */
  readonly measure: (text: string) => MainCross;
  /** Ceiling on drawn labels. The lowest priority is given up first. */
  readonly maxLabels?: number;
  /**
   * How far past the extent's end a label placed after its item may run. 0
   * by default: nothing is placed past the extent. A renderer that places a
   * band at a time passes the room it has reserved beyond it — every item
   * there has to be among the candidates, or a label could land on one.
   */
  readonly afterReach?: number;
  /**
   * A label longer than the room it could take: `"ellipsis"` (the default)
   * draws as much of it as fits, at least {@link MIN_SHORT_LABEL_CHARACTERS}
   * characters, ending in an ellipsis — inside the item, or in the free room
   * after it, whichever shows more; `"drop"` gives it up, as before 1.0.0-rc.5.
   */
  readonly overflow?: LabelOverflow;
  /**
   * The share of its room a label is fitted to, 1 by default. A renderer
   * drawing a gesture at a finer scale than the one the reader last saw at
   * rest passes the ratio of the two: the room an item had there. A label
   * then shows where it fitted before — not, all at once, everywhere it
   * fits now. Where it goes does not change, only whether it goes.
   */
  readonly roomScale?: number;
}

/** The outcome: what is drawn, and what was given up. */
export interface LabelLayout {
  readonly kept: readonly PlacedLabel[];
  readonly dropped: readonly DroppedLabel[];
}

interface Interval {
  readonly id: string;
  readonly start: number;
  readonly end: number;
}

/**
 * Where an inside label starts, past its item's start: a hair, in pixels.
 *
 * Two items that touch — one ends where the next starts — come out of
 * separate float computations, so the first can end a few ulps past the
 * second's start. A label placed exactly at that start then "overlapped"
 * the first item, and was sent out after its own, where a tile during a
 * gesture could not reach it: a label that blinked. A millionth of a
 * pixel is far above any such error and far below anything drawn.
 */
const CLEARANCE = 1e-6;

function overlapsInterval(a: Interval, start: number, end: number): boolean {
  return !(a.end <= start || a.start >= end);
}

function rowsOf(candidate: Pick<LabelCandidate, "row" | "rowSpan">): readonly number[] {
  const rows: number[] = [];
  for (let offset = 0; offset < Math.max(candidate.rowSpan, 1); offset += 1) {
    rows.push(candidate.row + offset);
  }
  return rows;
}

/**
 * Place as many labels as fit, and say which did not.
 *
 * Pass every item, not only the labelled ones: an item with no text still
 * occupies its row, which is what keeps a neighbour's label off it.
 */
export function placeLabels(
  candidates: readonly LabelCandidate[],
  options: LabelOptions,
): LabelLayout {
  const occupied = new Map<number, Interval[]>();
  const claim = (rows: readonly number[], interval: Interval): void => {
    for (const row of rows) {
      const bucket = occupied.get(row);
      if (bucket === undefined) {
        occupied.set(row, [interval]);
      } else {
        bucket.push(interval);
      }
    }
  };
  const isFree = (rows: readonly number[], start: number, end: number, ownId: string): boolean => {
    for (const row of rows) {
      for (const taken of occupied.get(row) ?? []) {
        if (taken.id !== ownId && overlapsInterval(taken, start, end)) {
          return false;
        }
      }
    }
    return true;
  };
  /**
   * Where the room inside an item starts: past anything that reaches into
   * its start — the minimum width of an instant just before it. Items in a
   * row never overlap in time, but an instant is drawn a few pixels wide.
   */
  const startPast = (rows: readonly number[], start: number, ownId: string): number => {
    let at = start;
    for (let moved = true; moved; ) {
      moved = false;
      for (const row of rows) {
        for (const taken of occupied.get(row) ?? []) {
          if (taken.id !== ownId && taken.start <= at && taken.end > at) {
            at = taken.end;
            moved = true;
          }
        }
      }
    }
    return at;
  };
  /** Where the room from `start` on ends in `rows`: the nearest thing taken there. */
  const freeUntil = (rows: readonly number[], start: number, ownId: string): number => {
    let end = Number.POSITIVE_INFINITY;
    for (const row of rows) {
      for (const taken of occupied.get(row) ?? []) {
        if (taken.id !== ownId && taken.end > start) {
          end = Math.min(end, Math.max(taken.start, start));
        }
      }
    }
    return end;
  };

  // Every item reserves its own extent up front, so placement order cannot
  // let one label steal the room another item is drawn in.
  for (const candidate of candidates) {
    claim(rowsOf(candidate), {
      id: candidate.id,
      start: candidate.box.main,
      end: candidate.box.main + candidate.box.mainSize,
    });
  }

  const wanted = candidates
    .filter((candidate) => candidate.text !== "")
    .map((candidate, index) => ({ candidate, index }))
    .sort((a, b) => {
      const byPriority =
        (b.candidate.priority ?? b.candidate.box.mainSize) -
        (a.candidate.priority ?? a.candidate.box.mainSize);
      if (byPriority !== 0) {
        return byPriority;
      }
      const byMain = a.candidate.box.main - b.candidate.box.main;
      return byMain !== 0 ? byMain : a.candidate.id.localeCompare(b.candidate.id);
    });

  const kept: PlacedLabel[] = [];
  const dropped: DroppedLabel[] = [];
  const budget = options.maxLabels ?? Number.POSITIVE_INFINITY;
  const low = options.mainStart ?? 0;
  const high = low + options.mainSize;

  for (const { candidate } of wanted) {
    const box = candidate.box;
    if (box.main + box.mainSize <= low || box.main >= high) {
      dropped.push({ id: candidate.id, reason: "off-screen" });
      continue;
    }
    if (kept.length >= budget) {
      dropped.push({ id: candidate.id, reason: "over-budget" });
      continue;
    }

    const need = options.measure(candidate.text);
    // Centred across the lane, so a 14-pixel line sits in the middle of a
    // 22-pixel row instead of on its edge.
    const cross = box.cross + Math.max(box.crossSize - need.cross, 0) / 2;
    const rows = rowsOf(candidate);
    // The cross fit binds BOTH placements. In a horizontal timeline it is
    // almost free — a line of text is shorter than a row is tall — but in a
    // vertical one the text runs ACROSS the lane, so a long label simply does
    // not fit a column and has to be given up rather than drawn over the
    // neighbouring lane. Checking it only for the inside placement is what let
    // vertical labels spill across columns.
    const crossFits = need.cross <= box.crossSize;
    // The room inside starts past whatever reaches into the item; the hair
    // only where there is room for it — a box sized to its label, a
    // cluster's marker to its count, keeps the label at its start.
    const boxEnd = box.main + box.mainSize;
    const insideFrom = startPast(rows, box.main, candidate.id);
    const insideRoom = boxEnd - insideFrom;
    const inside = insideFrom + Math.min(CLEARANCE, Math.max(insideRoom - need.main, 0));
    const insideFits = crossFits && need.main <= insideRoom;
    const afterMain0 = box.main + box.mainSize;
    // Whether the item gets a label at all, at a share of its room: the room
    // it had where the reader last saw it. Where the label goes, and how much
    // of it shows, is then decided in the room it has now.
    const fitted = options.roomScale ?? 1;
    if (fitted < 1) {
      const then = Math.max(insideRoom, freeUntil(rows, afterMain0, candidate.id) - afterMain0) * fitted;
      const fitsThen = (fit: MainCross): boolean => fit.cross <= box.crossSize && fit.main <= then;
      if (!fitsThen(need) && (options.overflow === "drop" || shortenLabel(candidate.text, options.measure, fitsThen) === undefined)) {
        dropped.push({ id: candidate.id, reason: "no-room" });
        continue;
      }
    }
    const afterMain = box.main + box.mainSize;
    // The reach is the tile's own bound, not the item's room: not scaled.
    const afterFits = crossFits && afterMain + need.main <= high + (options.afterReach ?? 0);

    if (insideFits && isFree(rows, inside, inside + need.main, candidate.id)) {
      const placed: PlacedLabel = {
        id: candidate.id,
        text: candidate.text,
        placement: "inside",
        box: { main: inside, mainSize: need.main, cross, crossSize: need.cross },
        row: candidate.row,
        rowSpan: candidate.rowSpan,
      };
      kept.push(placed);
      claim(rows, { id: `label:${candidate.id}`, start: inside, end: inside + need.main });
      continue;
    }

    if (afterFits && isFree(rows, afterMain, afterMain + need.main, candidate.id)) {
      const placed: PlacedLabel = {
        id: candidate.id,
        text: candidate.text,
        placement: "after",
        box: { main: afterMain, mainSize: need.main, cross, crossSize: need.cross },
        row: candidate.row,
        rowSpan: candidate.rowSpan,
      };
      kept.push(placed);
      claim(rows, { id: `label:${candidate.id}`, start: afterMain, end: afterMain + need.main });
      continue;
    }

    if (options.overflow !== "drop") {
      // As much of the text as fits, where more of it fits: inside the item,
      // or in the room after it up to whatever is next in its rows. Both are
      // the item's own — every other item is reserved, and a label placed
      // after one item ends before the next — so shortening never takes a
      // room another label could have had.
      // One search, in the larger of the two rooms; the cut then goes inside
      // when it fits there too — at the same length, inside reads as the
      // item's own — and after it otherwise.
      const afterRoom = Math.min(freeUntil(rows, afterMain, candidate.id), high + (options.afterReach ?? 0)) - afterMain;
      const room = Math.max(insideRoom, afterRoom);
      const short = shortenLabel(candidate.text, options.measure, (fit) => fit.cross <= box.crossSize && fit.main <= room);
      const useAfter = short !== undefined && short.need.main > insideRoom;
      const start = useAfter || short === undefined ? afterMain : insideFrom + Math.min(CLEARANCE, insideRoom - short.need.main);
      if (short !== undefined && isFree(rows, start, start + short.need.main, candidate.id)) {
        kept.push({
          id: candidate.id,
          text: short.text,
          placement: useAfter ? "after" : "inside",
          box: { main: start, mainSize: short.need.main, cross: box.cross + Math.max(box.crossSize - short.need.cross, 0) / 2, crossSize: short.need.cross },
          row: candidate.row,
          rowSpan: candidate.rowSpan,
          shortened: true,
        });
        claim(rows, { id: `label:${candidate.id}`, start, end: start + short.need.main });
        continue;
      }
    }

    // "No room" means the text does not fit anywhere it could go; "collision"
    // means it would have fitted but something is already there. The host can
    // act differently on the two — shorten the text, or move it.
    dropped.push({
      id: candidate.id,
      // Reaching here with a placement that fitted means something was in
      // the way; reaching here with neither fitting means the text is too
      // long for the room there is.
      reason: insideFits || afterFits ? "collision" : "no-room",
    });
  }

  return { kept, dropped };
}

/**
 * Whether any two drawn labels overlap.
 *
 * The invariant the module exists to hold, exported so a host — and the
 * property-based test — can check it instead of trusting it.
 */
export function findLabelOverlap(
  labels: readonly PlacedLabel[],
): { readonly a: PlacedLabel; readonly b: PlacedLabel } | undefined {
  const byRow = new Map<number, PlacedLabel[]>();
  for (const label of labels) {
    for (const row of rowsOf(label)) {
      const bucket = byRow.get(row);
      if (bucket === undefined) {
        byRow.set(row, [label]);
      } else {
        bucket.push(label);
      }
    }
  }
  for (const bucket of byRow.values()) {
    for (let i = 0; i < bucket.length; i += 1) {
      for (let j = i + 1; j < bucket.length; j += 1) {
        const a = bucket[i];
        const b = bucket[j];
        if (
          a !== undefined &&
          b !== undefined &&
          !(
            a.box.main + a.box.mainSize <= b.box.main ||
            b.box.main + b.box.mainSize <= a.box.main
          )
        ) {
          return { a, b };
        }
      }
    }
  }
  return undefined;
}
