/**
 * G-RTL: right to left is the mirror image of left to right — in both
 * orientations, for what is drawn, what a pointer and a wheel do, and what
 * the arrows do — and the visual matrix's right-to-left cases are the
 * committed fixtures.
 *
 * Horizontally time flows from the right; vertically time still runs down,
 * and the lanes start at the right. Both are the screen's `x` mirrored, which
 * is what every claim here checks against: an exact mirror, not a second
 * geometry that might drift from the first.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import { attachInput, MIRRORED_KEYS } from "../../src/dom/attach.js";
import { createInputMachine } from "../../src/input.js";
import { mirrorCss, MIRROR_CLASS, mirrorScene, mirrorTextNodes } from "../../src/intl/mirror.js";
import { resolveKey } from "../../src/keyboard.js";
import { renderTimeline } from "../../src/render.js";
import { renderToSvgString } from "../../src/scene.js";
import type { SceneElement } from "../../src/scene.js";
import { THEMES } from "../../src/theme.js";
import { ORIENTATIONS } from "../../src/geometry.js";
import type { Density, Item, Orientation } from "../../src/types.js";
import { describeBothOrientations } from "../orientation.js";
import { makeRandom } from "../property/harness.js";

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 5);

function generated(seed: number, count = 40): Item[] {
  const random = makeRandom(seed);
  return Array.from({ length: count }, (_, index) => {
    const start = T0 + Math.floor(random() * 60) * DAY;
    const open = random() < 0.1;
    const instant = !open && random() < 0.15;
    return {
      id: `i${String(index)}`,
      laneId: `l${String(Math.floor(random() * 4))}`,
      start,
      ...(open || instant ? {} : { end: start + (1 + Math.floor(random() * 10)) * DAY }),
      ...(open ? { open: true } : {}),
      label: `Item ${String(index)}`,
    } as Item;
  });
}

const LANES = [0, 1, 2, 3].map((n) => ({ id: `l${String(n)}`, label: `Lane ${String(n)}` }));

function frame(orientation: Orientation, items: readonly Item[], density: Density = "comfortable"): SceneElement {
  return renderTimeline({
    items,
    lanes: LANES,
    domain: [T0 - 2 * DAY, T0 + 64 * DAY],
    width: orientation === "horizontal" ? 1200 : 480,
    height: orientation === "horizontal" ? 420 : 900,
    orientation,
    density,
  }).scene;
}

/** Every `[data-tl-id]` rect of a scene, with its screen box (the mirror applied). */
function itemBoxes(scene: SceneElement): Map<string, { x: number; y: number; width: number; height: number }> {
  const width = Number(scene.attrs?.width);
  const out = new Map<string, { x: number; y: number; width: number; height: number }>();
  const walk = (node: SceneElement, mirrored: boolean, shift: number): void => {
    const isMirror = String(node.attrs?.class ?? "").split(" ").includes(MIRROR_CLASS);
    const transform = typeof node.attrs?.transform === "string" ? node.attrs.transform : undefined;
    // The item layer's own translate (a scene space) along x.
    const translate = transform !== undefined && !isMirror ? /matrix\(1 0 0 1 ([-\d.]+) 0\)/.exec(transform) : null;
    const next = shift + (translate === null ? 0 : Number(translate[1]));
    if (node.tag === "rect" && typeof node.attrs?.["data-tl-id"] === "string") {
      const x = Number(node.attrs.x) + next;
      const w = Number(node.attrs.width);
      out.set(node.attrs["data-tl-id"], {
        x: mirrored ? width - x - w : x,
        y: Number(node.attrs.y),
        width: w,
        height: Number(node.attrs.height),
      });
    }
    for (const child of node.children ?? []) walk(child, mirrored || isMirror, next);
  };
  walk(scene, false, 0);
  return out;
}

describeBothOrientations("right to left", (orientation) => {
  it("[claim:mirror-exact] is the left-to-right frame inside one group mirrored across its width, and nothing else", () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const ltr = frame(orientation, generated(seed));
      const rtl = mirrorScene(ltr);
      const width = Number(ltr.attrs?.width);
      expect(rtl.attrs).toEqual({ ...ltr.attrs, dir: "rtl", "data-tl-direction": "rtl" });
      const mirrors = (rtl.children ?? []).filter((child) => child.attrs?.class === MIRROR_CLASS);
      expect(mirrors).toHaveLength(1);
      expect(mirrors[0]?.attrs?.transform).toBe(`matrix(-1 0 0 1 ${String(width)} 0)`);
      // The very same nodes, in the same order: the mirror adds no geometry of its own.
      expect(mirrors[0]?.children).toEqual((ltr.children ?? []).filter((child) => child.tag !== "style"));
      const styles = (rtl.children ?? []).filter((child) => child.tag === "style");
      expect(styles.slice(0, -1)).toEqual((ltr.children ?? []).filter((child) => child.tag === "style"));
      expect(styles.at(-1)?.text).toBe(mirrorCss("comfortable"));
    }
  });

  it("[claim:time-direction] runs time from the right horizontally, and the lanes from the right vertically", () => {
    const items = generated(11);
    const ltr = itemBoxes(frame(orientation, items));
    const rtl = itemBoxes(mirrorScene(frame(orientation, items)));
    const width = orientation === "horizontal" ? 1200 : 480;
    expect(rtl.size).toBe(ltr.size);
    expect(rtl.size).toBeGreaterThan(10);
    for (const [id, box] of ltr) {
      const mirrored = rtl.get(id);
      expect(mirrored).toBeDefined();
      // x mirrored across the frame, y untouched.
      expect(mirrored?.x).toBeCloseTo(width - box.x - box.width, 6);
      expect(mirrored?.y).toBe(box.y);
    }
    const byStart = [...items].filter((item) => item.end !== undefined).sort((a, b) => Number(a.start) - Number(b.start));
    const first = byStart[0];
    const last = byStart.at(-1);
    if (orientation === "horizontal" && first !== undefined && last !== undefined) {
      // The earliest item's start edge is right of the latest one's.
      const a = rtl.get(first.id);
      const b = rtl.get(last.id);
      expect((a?.x ?? 0) + (a?.width ?? 0)).toBeGreaterThan((b?.x ?? 0) + (b?.width ?? 0));
    }
    if (orientation === "vertical") {
      // Lane 0's items are right of lane 3's.
      const lane = (id: string): number => Number(items.find((item) => item.id === id)?.laneId?.slice(1));
      const rightmost = [...rtl].sort((p, q) => q[1].x - p[1].x)[0];
      const leftmost = [...rtl].sort((p, q) => p[1].x - q[1].x)[0];
      expect(lane(rightmost?.[0] ?? "")).toBeLessThan(lane(leftmost?.[0] ?? ""));
    }
  });

  it("[claim:gestures-mirrored] measures a pointer and the wheel from the right edge: a drag pans the mirror way", () => {
    const run = (direction: "ltr" | "rtl", act: (dispatch: (type: string, event: Record<string, unknown>) => void) => void): readonly number[] => {
      const listeners: { type: string; handler: (event: Event) => void }[] = [];
      const target = {
        addEventListener: (type: string, handler: (event: Event) => void) => listeners.push({ type, handler }),
        removeEventListener: () => undefined,
        getBoundingClientRect: () => ({ left: 20, top: 10, width: 900, height: 200, right: 920, bottom: 210 }),
        setPointerCapture: () => undefined,
        setAttribute: () => undefined,
        removeAttribute: () => undefined,
      };
      const machine = createInputMachine({ domain: [T0, T0 + 30 * DAY], mainSize: orientation === "horizontal" ? 900 : 200, orientation });
      attachInput(target as unknown as Element, { machine, direction: () => direction, followReducedMotion: false });
      act((type, event) => {
        for (const listener of listeners) if (listener.type === type) listener.handler({ preventDefault: () => undefined, ...event } as unknown as Event);
      });
      return machine.domain;
    };
    const drag = (dispatch: (type: string, event: Record<string, unknown>) => void): void => {
      const at = (x: number, time: number): Record<string, unknown> => ({ pointerId: 1, clientX: x, clientY: 100, timeStamp: time, pointerType: "mouse" });
      dispatch("pointerdown", at(400, 0));
      dispatch("pointermove", at(450, 16));
      dispatch("pointermove", at(500, 32));
      dispatch("pointerup", at(500, 48));
    };
    const wheel = (dispatch: (type: string, event: Record<string, unknown>) => void): void => {
      dispatch("wheel", { clientX: 400, clientY: 100, deltaX: 120, deltaY: 0, ctrlKey: false, shiftKey: false, timeStamp: 0 });
    };
    for (const act of [drag, wheel]) {
      const ltr = run("ltr", act);
      const rtl = run("rtl", act);
      if (orientation === "horizontal") {
        // The same move, the mirror pan: as far, the other way.
        expect(ltr[0]).not.toBe(T0);
        expect((rtl[0] ?? T0) - T0).toBeCloseTo(-((ltr[0] ?? T0) - T0), -1);
      } else {
        // Vertically x is across: the time axis is the same in both directions.
        expect(rtl).toEqual(ltr);
      }
    }
  });

  it("[claim:keys-mirrored] hands the machine the other arrow, so the arrow that points later goes later", () => {
    const listeners: { type: string; handler: (event: Event) => void }[] = [];
    const target = {
      addEventListener: (type: string, handler: (event: Event) => void) => listeners.push({ type, handler }),
      removeEventListener: () => undefined,
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 900, height: 200, right: 900, bottom: 200 }),
      setPointerCapture: () => undefined,
      setAttribute: () => undefined,
      removeAttribute: () => undefined,
    };
    const machine = createInputMachine({ domain: [T0, T0 + 30 * DAY], mainSize: 900, orientation });
    const seen: string[] = [];
    const key = machine.key.bind(machine);
    vi.spyOn(machine, "key").mockImplementation((sample) => {
      seen.push(sample.key);
      return key(sample);
    });
    attachInput(target as unknown as Element, { machine, direction: () => "rtl", followReducedMotion: false });
    for (const name of ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home"]) {
      for (const listener of listeners) {
        if (listener.type === "keydown") {
          listener.handler({ key: name, target, isComposing: false, shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, timeStamp: 0, preventDefault: () => undefined } as unknown as Event);
        }
      }
    }
    expect(seen).toEqual(["ArrowRight", "ArrowLeft", "ArrowUp", "ArrowDown", "Home"]);
    // What that means: horizontally, the left arrow is the next item (later);
    // vertically, the left arrow is the next lane (the lanes run from the right).
    const sample = (name: string) => ({ key: MIRRORED_KEYS[name] ?? name, shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, time: 0 });
    expect(resolveKey(sample("ArrowLeft"), orientation)).toBe(orientation === "horizontal" ? "next" : "rowNext");
    expect(resolveKey(sample("ArrowRight"), orientation)).toBe(orientation === "horizontal" ? "previous" : "rowPrevious");
  });

  it("[claim:text-readable] turns every text back about its own box, by the stylesheet and by attributes", () => {
    const css = mirrorCss("compact");
    expect(css).toContain(`.tl .${MIRROR_CLASS} text{transform-box:fill-box;transform-origin:center;transform:scaleX(-1)`);
    expect(css).toContain(`.tl .${MIRROR_CLASS} foreignObject>*{transform:scaleX(-1)`);
    // The attribute form, for the PDF: a text's box maps onto itself.
    const text: SceneElement = { tag: "text", attrs: { x: 100, y: 10, "text-anchor": "start" }, text: "Label" };
    const turned = mirrorTextNodes({ tag: "g", children: [text] }).children?.[0];
    expect(turned?.attrs?.["text-anchor"]).toBe("end");
    expect(turned?.attrs?.transform).toBe("matrix(-1 0 0 1 200 0)");
    // Anchored at its end, a text of width w spans [x - w, x]; the matrix maps that to [x, x + w].
    const w = 37;
    const map = (value: number): number => -value + 200;
    expect([map(100), map(100 - w)].sort((a, b) => a - b)).toEqual([100, 100 + w]);
    // A text with a transform of its own keeps it, the turn applied inside it.
    const own = mirrorTextNodes({ tag: "text", attrs: { x: 5, transform: "translate(3 0)" }, text: "x" });
    expect(own.attrs?.transform).toBe("translate(3 0) matrix(-1 0 0 1 10 0)");
  });
});

describe("the right-to-left visual matrix", () => {
  const matrix = JSON.parse(readFileSync(new URL("../visual/matrix.json", import.meta.url), "utf8")) as {
    widths: number[];
    height: number;
    densityForWidth: Record<string, Density>;
  };
  const raw = JSON.parse(readFileSync(new URL("../visual/scenario.json", import.meta.url), "utf8")) as {
    timeZone: string;
    ariaLabel: string;
    domain: [string, string];
    selectedIds?: string[];
    lanes: { id: string; label?: string }[];
    items: (Omit<Item, "start" | "end"> & { start: string; end?: string })[];
    decorations: Record<string, unknown>[];
  };
  const at = (value: unknown): number => Date.parse(String(value));
  const scenario = {
    ...raw,
    domain: [at(raw.domain[0]), at(raw.domain[1])] as const,
    items: raw.items.map((item) => ({ ...item, start: at(item.start), ...(item.end === undefined ? {} : { end: at(item.end) }) })) as Item[],
    decorations: raw.decorations.map((decoration) =>
      decoration.time === undefined
        ? decoration.start === undefined
          ? decoration
          : { ...decoration, start: at(decoration.start), end: at(decoration.end) }
        : { ...decoration, time: at(decoration.time) },
    ),
  };
  for (const width of matrix.widths) {
    for (const orientation of ORIENTATIONS) {
      for (const theme of THEMES) {
        const name = `${String(width)}-${orientation}-${theme.name}-rtl`;
        it(`[claim:visual-rtl] [${orientation}] ${name} is its committed fixture, byte for byte`, () => {
          const result = renderTimeline({
            items: scenario.items,
            lanes: scenario.lanes,
            domain: scenario.domain,
            width,
            height: matrix.height,
            orientation,
            density: matrix.densityForWidth[String(width)] ?? "comfortable",
            theme: theme.name as "light" | "dark",
            instanceId: name,
            timeZone: scenario.timeZone,
            decorations: scenario.decorations as never,
            selectedIds: scenario.selectedIds ?? [],
            ariaLabel: scenario.ariaLabel,
          });
          const svg = `${renderToSvgString(mirrorScene(result.scene), { pretty: true })}\n`;
          expect(svg).toBe(readFileSync(new URL(`./fixtures/${name}.svg`, import.meta.url), "utf8"));
        });
      }
    }
  }
});
