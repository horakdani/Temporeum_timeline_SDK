import { describe, expect, it } from "vitest";

import { clusterZoom } from "../../src/cluster.js";
import type { Cluster, ClusterMarker } from "../../src/cluster.js";
import { densityMetrics } from "../../src/density.js";
import { createHitTester } from "../../src/editing.js";
import { projectPoint } from "../../src/geometry.js";
import { createInputMachine } from "../../src/input.js";
import type { InputEffect, InputMachine, TapEffect } from "../../src/input.js";
import { createNavigator } from "../../src/keyboard.js";
import { renderTimeline } from "../../src/render.js";
import type { RenderResult } from "../../src/render.js";
import { createTimeScale } from "../../src/scale.js";
import type { SceneElement } from "../../src/scene.js";
import type { Domain, Item, Orientation, PointerKind } from "../../src/types.js";
import { describeBothOrientations } from "../orientation.js";
import { DAY, HOUR, ORIGIN, readFrame } from "./fixture.js";

/**
 * A cluster opens under the finger, and the keyboard opens it the same way.
 *
 * Measured the way a host meets it: a frame is rendered, the hit tester is
 * built from what it drew, a pointer goes down and up in screen pixels
 * through the input machine, and the tap is answered with `clusterZoom` and
 * the machine's own `zoom` twin. Then the next frame is rendered and read.
 *
 * The keyboard twin walks the same frame with a clustered navigator: a
 * marker is one stop, `Enter` on it is an `activate` with its id, and the
 * same answer opens it.
 */

const WIDTH = 900;
const HEIGHT = 300;

/**
 * Three bursts of instants, an hour apart each, in one lane — b and c four
 * days apart, close enough for a finger to reach both markers from between
 * them — and a bar.
 */
function items(): Item[] {
  const all: Item[] = [];
  for (const [burst, day] of [
    ["a", 20],
    ["b", 50],
    ["c", 54],
  ] as const) {
    for (let index = 0; index < 12; index += 1) {
      all.push({ id: `${burst}${String(index)}`, start: ORIGIN + day * DAY + index * HOUR, label: `${burst.toUpperCase()}${String(index)}` });
    }
  }
  all.push({ id: "bar", start: ORIGIN + 70 * DAY, end: ORIGIN + 90 * DAY, label: "Bar" });
  return all;
}

interface Host {
  readonly orientation: Orientation;
  readonly machine: InputMachine;
  readonly frame: () => RenderResult;
  readonly mainSize: number;
  readonly domain: () => Domain;
  readonly apply: (effects: readonly InputEffect[]) => void;
  readonly answer: (effects: readonly InputEffect[], pointerType: PointerKind) => Cluster | undefined;
}

function hostFor(orientation: Orientation, data: readonly Item[] = items()): Host {
  const metrics = densityMetrics("comfortable", orientation);
  const mainSize = orientation === "horizontal" ? WIDTH : HEIGHT * 3;
  const crossSize = orientation === "horizontal" ? HEIGHT : WIDTH;
  const width = orientation === "horizontal" ? mainSize : crossSize;
  const height = orientation === "horizontal" ? crossSize : mainSize;
  let domain: Domain = [ORIGIN, ORIGIN + 100 * DAY];
  let focusedId: string | null = null;
  let result = renderTimeline({ items: data, domain, width, height, orientation, cluster: true });
  const machine = createInputMachine({ domain, mainSize, crossSize, orientation, keyboard: { reducedMotion: true } });
  const sync = (): void => {
    result = renderTimeline({ items: data, domain, width, height, orientation, cluster: true, focusedId });
    machine.setKeyboard({
      reducedMotion: true,
      navigator: createNavigator(result.layout, { crossInset: metrics.axisSize, ...(result.clustering === undefined ? {} : { clustering: result.clustering }) }),
    });
  };
  sync();
  const apply = (effects: readonly InputEffect[]): void => {
    for (const effect of effects) {
      if (effect.type === "viewport") {
        domain = effect.domain;
      } else if (effect.type === "focus") {
        focusedId = effect.id;
      }
    }
    sync();
  };
  /** The host's answer to a tap or an activate: open the cluster it names. */
  const answer = (effects: readonly InputEffect[], pointerType: PointerKind): Cluster | undefined => {
    const scale = createTimeScale(domain, mainSize);
    const tester = createHitTester({ layout: result.layout, scale, crossInset: metrics.axisSize, clusters: result.clusters });
    for (const effect of effects) {
      let cluster: Cluster | undefined;
      let anchor: number | undefined;
      if (effect.type === "tap") {
        cluster = tester.clusterAt({ main: effect.main, cross: effect.cross }, pointerType);
        anchor = effect.main;
      } else if (effect.type === "activate" && effect.id !== null) {
        cluster = result.clustering?.byId(effect.id);
      }
      if (cluster !== undefined) {
        const zoom = clusterZoom(cluster, scale, anchor === undefined ? {} : { anchor });
        apply(machine.zoom(zoom.factor, zoom.anchor));
        return cluster;
      }
    }
    return undefined;
  };
  return { orientation, machine, frame: () => result, mainSize, domain: () => domain, apply, answer };
}

let clock = 1000;
function tap(host: Host, main: number, cross: number, pointerType: PointerKind): readonly InputEffect[] {
  const point = projectPoint({ main, cross }, host.orientation);
  clock += 1000;
  const down = host.machine.handle({ pointerId: 1, phase: "down", x: point.x, y: point.y, time: clock, pointerType });
  const up = host.machine.handle({ pointerId: 1, phase: "up", x: point.x, y: point.y, time: clock + 60, pointerType });
  return [...down, ...up];
}

function key(host: Host, name: string): readonly InputEffect[] {
  clock += 1000;
  return host.machine.key({ key: name, shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, time: clock });
}

function markerOf(host: Host, memberId: string): ClusterMarker | undefined {
  return host.frame().clusters.find((marker) => marker.cluster.members.some((member) => member.item.id === memberId));
}

function nodeById(scene: SceneElement, id: string): SceneElement | undefined {
  if (scene.attrs?.id === id) {
    return scene;
  }
  for (const child of scene.children ?? []) {
    const found = nodeById(child, id);
    if (found !== undefined) {
      return found;
    }
  }
  return undefined;
}

describeBothOrientations("tapping a cluster", (orientation) => {
  for (const pointerType of ["mouse", "touch"] as const) {
    it(`[claim:tap-zoom] ${pointerType}: zooms in at the tap, keeping the time under it, until the members come apart [${orientation}]`, () => {
      const host = hostFor(orientation);
      let marker = markerOf(host, "b5");
      expect(marker).toBeDefined();
      let taps = 0;
      while (marker !== undefined && taps < 12) {
        const box = marker.box;
        // A finger lands a little off the marker's middle; a mouse on it.
        const main = box.main + box.mainSize / 2 + (pointerType === "touch" ? 3 : 0);
        const cross = box.cross + box.crossSize / 2;
        // The instant held under the finger: the tapped time, or, where the
        // finger is on the marker past its members, the nearest member instant.
        const cluster = marker.cluster;
        const scaleBefore = createTimeScale(host.domain(), host.mainSize);
        const held = Math.min(Math.max(scaleBefore.toTime(main), cluster.start), cluster.end);
        const heldAt = scaleBefore.toMain(held);
        expect(Math.abs(heldAt - main)).toBeLessThanOrEqual(box.mainSize);
        const effects = tap(host, main, cross, pointerType);
        const tapped = effects.find((effect): effect is TapEffect => effect.type === "tap");
        expect(tapped?.main).toBeCloseTo(main, 6);
        const opened = host.answer(effects, pointerType);
        expect(opened?.id).toBe(marker.cluster.id);
        taps += 1;
        // Decision 8: the instant under the finger stays where it was.
        expect(createTimeScale(host.domain(), host.mainSize).toMain(held)).toBeCloseTo(heldAt, 3);
        const next = markerOf(host, "b5");
        // Each tap opens it: what is left around b5 is a smaller cluster, or b5 itself.
        if (next !== undefined) {
          expect(next.cluster.members.length).toBeLessThan(marker.cluster.members.length);
        }
        marker = next;
      }
      expect(marker).toBeUndefined();
      expect(readFrame(host.frame().scene).singles).toContain("b5");
      expect(taps).toBeLessThanOrEqual(4);
    });
  }

  it(`[claim:tap-zoom] a tap beside every marker opens nothing [${orientation}]`, () => {
    const host = hostFor(orientation);
    const before = host.domain();
    const bar = host.frame().layout.items.find((placed) => placed.item.id === "bar");
    const scale = createTimeScale(before, host.mainSize);
    const effects = tap(host, scale.toMain(ORIGIN + 80 * DAY), (bar?.cross ?? 0) + densityMetrics("comfortable", orientation).axisSize + 4, "touch");
    expect(host.answer(effects, "touch")).toBeUndefined();
    expect(host.domain()).toEqual(before);
  });
});

describeBothOrientations("the keyboard twin", (orientation) => {
  it(`[claim:keyboard-twin] walks a cluster as one stop, and Enter opens it like a tap [${orientation}]`, () => {
    const host = hostFor(orientation);
    const markers = host.frame().clusters.map((marker) => marker.cluster.id);
    expect(markers.length).toBeGreaterThanOrEqual(2);
    // Walk everything: every marker once, no clustered member, the bar.
    const visited: string[] = [];
    let focused: string | null = null;
    for (let step = 0; step < 10; step += 1) {
      const effects = key(host, orientation === "horizontal" ? "ArrowRight" : "ArrowDown");
      host.apply(effects);
      const focus = effects.find((effect) => effect.type === "focus");
      if (focus?.type === "focus" && focus.id !== focused) {
        focused = focus.id;
        if (focus.id !== null) {
          visited.push(focus.id);
        }
      }
    }
    expect(visited).toEqual([...markers, "bar"]);

    // Back to the cluster of b: Enter is an activate with its id.
    host.apply(key(host, "Home"));
    host.apply(key(host, orientation === "horizontal" ? "ArrowRight" : "ArrowDown"));
    const target = host.frame().clusters[1]?.cluster as Cluster;
    const scene = host.frame().scene;
    // The focus is on the marker: the root names it, the ring is drawn around it.
    expect(scene.attrs?.["aria-activedescendant"]).toBe(`tl-c-${target.id}`);
    expect(JSON.stringify(scene)).toContain("tl-focus-ring");
    const activate = key(host, "Enter");
    expect(activate.find((effect) => effect.type === "activate")).toEqual({ type: "activate", id: target.id });
    const before = host.domain();
    expect(host.answer(activate, "mouse")?.id).toBe(target.id);
    const after = host.domain();
    // The same zoom a tap would make, anchored at the cluster's visible middle.
    const expected = clusterZoom(target, createTimeScale(before, host.mainSize));
    expect((before[1] - before[0]) / (after[1] - after[0])).toBeCloseTo(expected.factor, 6);
    // The cluster is still in view, under the focus: the zoom kept its middle.
    const middle = (target.start + target.end) / 2;
    expect(createTimeScale(after, host.mainSize).toMain(middle)).toBeCloseTo(expected.anchor, 3);
    // Its first member is now drawn as itself, or in a smaller cluster.
    const now = markerOf(host, target.id);
    expect(now === undefined || now.cluster.members.length < target.members.length).toBe(true);
  });

  it(`[claim:keyboard-twin] a focused cluster is never edited from the keyboard [${orientation}]`, () => {
    const data = items();
    const metrics = densityMetrics("comfortable", orientation);
    const mainSize = orientation === "horizontal" ? WIDTH : HEIGHT * 3;
    const width = orientation === "horizontal" ? mainSize : WIDTH;
    const height = orientation === "horizontal" ? HEIGHT : mainSize;
    const domain: Domain = [ORIGIN, ORIGIN + 100 * DAY];
    const result = renderTimeline({ items: data, domain, width, height, orientation, cluster: true });
    const tester = createHitTester({ layout: result.layout, scale: createTimeScale(domain, mainSize), crossInset: metrics.axisSize, clusters: result.clusters });
    const navigator = createNavigator(result.layout, { crossInset: metrics.axisSize, clustering: result.clustering });
    const machine = createInputMachine({
      domain,
      mainSize,
      orientation,
      editing: { enabled: true, snapMs: DAY, hitTest: tester.hitTest, lookup: tester.lookup },
      keyboard: { navigator, reducedMotion: true },
    });
    machine.setFocus("a0");
    const press = (name: string, altKey: boolean, shiftKey: boolean): readonly InputEffect[] =>
      machine.key({ key: name, shiftKey, altKey, ctrlKey: false, metaKey: false, time: 5000 });
    const later = orientation === "horizontal" ? "ArrowRight" : "ArrowDown";
    const across = orientation === "horizontal" ? "ArrowDown" : "ArrowRight";
    for (const [name, alt, shift] of [
      [later, true, false],
      [later, false, true],
      [later, true, true],
      [across, true, false],
    ] as const) {
      expect(press(name, alt, shift).some((effect) => effect.type.startsWith("edit"))).toBe(false);
    }
    // A clustered member is focused through its cluster, and not edited either.
    machine.setFocus("a3");
    expect(press(later, true, false).some((effect) => effect.type.startsWith("edit"))).toBe(false);
    // The bar, drawn as itself, still moves.
    machine.setFocus("bar");
    expect(press(later, true, false).some((effect) => effect.type === "editEnd")).toBe(true);
  });
});

describeBothOrientations("hit testing a clustered frame", (orientation) => {
  const metrics = densityMetrics("comfortable", orientation);
  const mainSize = orientation === "horizontal" ? WIDTH : HEIGHT * 3;
  const width = orientation === "horizontal" ? mainSize : WIDTH;
  const height = orientation === "horizontal" ? HEIGHT : mainSize;
  const domain: Domain = [ORIGIN, ORIGIN + 100 * DAY];
  const result = renderTimeline({ items: items(), domain, width, height, orientation, cluster: true });
  const scale = createTimeScale(domain, mainSize);
  const tester = createHitTester({ layout: result.layout, scale, crossInset: metrics.axisSize, clusters: result.clusters });
  const plain = createHitTester({ layout: result.layout, scale, crossInset: metrics.axisSize });
  const marker = result.clusters[0] as ClusterMarker;
  const centre = { main: marker.box.main + marker.box.mainSize / 2, cross: marker.box.cross + marker.box.crossSize / 2 };

  it(`[claim:hit-test] the marker answers clusterAt, and its members no longer answer hitTest [${orientation}]`, () => {
    expect(tester.clusterAt(centre)?.id).toBe(marker.cluster.id);
    expect(plain.hitTest(centre)?.item.id).toMatch(/^a/);
    expect(tester.hitTest(centre)).toBeUndefined();
    expect(tester.hitTest(centre, "touch")).toBeUndefined();
    // Still found by id: a dragged selection carries a clustered member along.
    expect(tester.lookup("a3")?.item.id).toBe("a3");
    // Without markers, no cluster is ever hit.
    expect(plain.clusterAt(centre)).toBeUndefined();
  });

  it(`[claim:hit-test] a finger reaches a marker from its slop, a mouse only on it [${orientation}]`, () => {
    const beside = { main: marker.box.main + marker.box.mainSize + 6, cross: centre.cross };
    expect(tester.clusterAt(beside, "mouse")).toBeUndefined();
    expect(tester.clusterAt(beside)).toBeUndefined();
    expect(tester.clusterAt(beside, "touch")?.id).toBe(marker.cluster.id);
    const far = { main: marker.box.main + marker.box.mainSize + 40, cross: centre.cross };
    expect(tester.clusterAt(far, "touch")).toBeUndefined();
    const across = { main: centre.main, cross: marker.box.cross + marker.box.crossSize + 40 };
    expect(tester.clusterAt(across, "touch")).toBeUndefined();
  });

  it(`[claim:hit-test] between two markers within a finger's reach, the nearer one wins [${orientation}]`, () => {
    const b = result.clusters.find((each) => each.cluster.id === "b0") as ClusterMarker;
    const c = result.clusters.find((each) => each.cluster.id === "c0") as ClusterMarker;
    expect(b).toBeDefined();
    expect(c).toBeDefined();
    const gapStart = b.box.main + b.box.mainSize;
    const gapEnd = c.box.main;
    expect(gapEnd).toBeGreaterThan(gapStart);
    const cross = b.box.cross + b.box.crossSize / 2;
    // Both within a finger's 12 px in the horizontal frame, whose markers
    // are grown wide for their count.
    expect(tester.clusterAt({ main: gapStart + 3, cross }, "touch")?.id).toBe("b0");
    expect(tester.clusterAt({ main: gapEnd - 3, cross }, "touch")?.id).toBe("c0");
  });
});

describeBothOrientations("a marker's semantics", (orientation) => {
  const mainSize = orientation === "horizontal" ? WIDTH : HEIGHT * 3;
  const width = orientation === "horizontal" ? mainSize : WIDTH;
  const height = orientation === "horizontal" ? HEIGHT : mainSize;
  const domain: Domain = [ORIGIN, ORIGIN + 100 * DAY];

  it(`[claim:a11y] a marker is an option named by its count and dates, positioned among the frame's stops [${orientation}]`, () => {
    const lanes = [{ id: "", label: "Releases" }];
    const result = renderTimeline({ items: items(), lanes, domain, width, height, orientation, cluster: true, focusedId: "a4", instanceId: "x" });
    const node = nodeById(result.scene, "x-c-a0");
    expect(node?.attrs?.role).toBe("option");
    expect(node?.attrs?.["aria-label"]).toBe("12 items, Jan 21, 2021, 12:00 AM – Jan 21, 2021, 11:00 AM, Releases");
    expect(node?.children?.[0]?.text).toBe(node?.attrs?.["aria-label"]);
    // Four stops: three markers and the bar.
    expect(node?.attrs?.["aria-setsize"]).toBe(4);
    expect(node?.attrs?.["aria-posinset"]).toBe(1);
    expect(nodeById(result.scene, "x-i-bar")?.attrs?.["aria-posinset"]).toBe(4);
    // A focused member is focus on its marker.
    expect(result.scene.attrs?.["aria-activedescendant"]).toBe("x-c-a0");
    // Selecting a member selects the marker.
    const selected = renderTimeline({ items: items(), domain, width, height, orientation, cluster: true, selectedIds: ["b2"], instanceId: "x" });
    expect(nodeById(selected.scene, "x-c-b0")?.attrs?.["aria-selected"]).toBe("true");
    expect(nodeById(selected.scene, "x-c-b0")?.attrs?.class).toBe("tl-cluster tl-cluster--selected");
    expect(nodeById(selected.scene, "x-c-a0")?.attrs?.["aria-selected"]).toBe("false");
  });

  it(`[claim:a11y] names a cluster of whole days by date only, and the host may rename it [${orientation}]`, () => {
    const days: Item[] = Array.from({ length: 6 }, (_, index) => ({ id: `d${String(index)}`, start: ORIGIN + (40 + index) * DAY, granularity: "day" }));
    const wide: Domain = [ORIGIN, ORIGIN + 2000 * DAY];
    const result = renderTimeline({ items: days, domain: wide, width, height, orientation, cluster: true, instanceId: "y" });
    expect(nodeById(result.scene, "y-c-d0")?.attrs?.["aria-label"]).toBe("6 items, Feb 10, 2021 – Feb 15, 2021");
    const renamed = renderTimeline({
      items: [...days],
      domain: wide,
      width,
      height,
      orientation,
      cluster: true,
      instanceId: "y",
      hooks: { describeCluster: (cluster) => `${String(cluster.members.length)} releases` },
    });
    expect(nodeById(renamed.scene, "y-c-d0")?.attrs?.["aria-label"]).toBe("6 releases");
    // A non-interactive frame has no options, and no ids.
    const image = renderTimeline({ items: [...days], domain: wide, width, height, orientation, cluster: true, interactive: false });
    expect(JSON.stringify(image.scene)).not.toContain('"role":"option"');
    expect(readFrame(image.scene).markers).toEqual([{ id: "d0", count: 6 }]);
  });

  it(`[claim:hooks] renderCluster draws the marker, null draws none, and a cluster's count reaches renderLabel [${orientation}]`, () => {
    const seen: string[] = [];
    const result = renderTimeline({
      items: items(),
      domain,
      width,
      height,
      orientation,
      cluster: true,
      hooks: {
        renderCluster: (context) => (context.cluster.id === "c0" ? null : { tag: "circle", attrs: { "data-tl-cluster": context.cluster.id, "data-tl-count": context.cluster.members.length, r: context.rect.width } }),
        renderLabel: (context) => {
          if (context.cluster !== undefined) {
            seen.push(`${context.cluster.id}:${context.label.text}`);
          }
          return null;
        },
      },
    });
    expect(readFrame(result.scene).markers.map((marker) => marker.id)).toEqual(["a0", "b0"]);
    expect(JSON.stringify(result.scene)).toContain('"tag":"circle"');
    expect(seen).toContain("a0:12");
  });
});

describe("clusters through a stretched space", () => {
  it("[claim:space] hands the hit tester the markers where the viewport shows them", () => {
    const domain: Domain = [ORIGIN, ORIGIN + 100 * DAY];
    const msPerPx = (100 * DAY) / WIDTH;
    // The space is the viewport, shifted 50 px and zoomed 1.2x — mid-pinch.
    const space = { origin: ORIGIN - 50 * msPerPx * 1.2, msPerPx: msPerPx * 1.2, extent: [ORIGIN - 10 * DAY, ORIGIN + 120 * DAY] as const };
    const spaced = renderTimeline({ items: items(), domain, width: WIDTH, height: HEIGHT, cluster: true, space });
    const marker = spaced.clusters.find((each) => each.cluster.id === "a0") as ClusterMarker;
    const exact = createTimeScale(domain, WIDTH);
    // Its first member starts where the viewport puts it, not where the space does.
    expect(marker.box.main).toBeLessThanOrEqual(exact.toMain(ORIGIN + 20 * DAY) + 1e-6);
    expect(marker.box.main + marker.box.mainSize).toBeGreaterThan(exact.toMain(ORIGIN + 20 * DAY + 11 * HOUR));
    const tester = createHitTester({ layout: spaced.layout, scale: exact, crossInset: densityMetrics("comfortable", "horizontal").axisSize, clusters: spaced.clusters });
    expect(tester.clusterAt({ main: marker.box.main + marker.box.mainSize / 2, cross: marker.box.cross + 2 })?.id).toBe("a0");
  });
});

describe("clusters through the tile cache", () => {
  it("[claim:space] a member's selection reaches its marker, and new settings reach every tile", () => {
    const domain: Domain = [ORIGIN, ORIGIN + 100 * DAY];
    const data = items();
    const space = { origin: ORIGIN - 30 * DAY, msPerPx: (100 * DAY) / WIDTH, extent: [ORIGIN - 30 * DAY, ORIGIN + 130 * DAY] as const };
    const base = { items: data, domain, width: WIDTH, height: HEIGHT, cluster: true, space, instanceId: "s" } as const;
    const first = renderTimeline(base);
    expect(nodeById(first.scene, "s-c-b0")?.attrs?.["aria-selected"]).toBe("false");
    // The same space, so the tiles are reused — except the one whose marker changed.
    const selected = renderTimeline({ ...base, selectedIds: ["b7"] });
    expect(nodeById(selected.scene, "s-c-b0")?.attrs?.["aria-selected"]).toBe("true");
    expect(nodeById(selected.scene, "s-c-a0")?.attrs?.["aria-selected"]).toBe("false");
    // Stricter settings in the same space: no tile keeps the old markers.
    const strict = renderTimeline({ ...base, cluster: { minCount: 13 } });
    expect(readFrame(strict.scene).markers).toEqual([]);
    expect(strict.clusters).toEqual([]);
    const loose = renderTimeline({ ...base, cluster: { gap: 40 } });
    expect(readFrame(loose.scene).markers.map((marker) => marker.count)).toEqual([12, 24]);
  });
});

describe("the clustered navigator", () => {
  it("refuses a clustering of another layout", () => {
    const one = renderTimeline({ items: items(), domain: [ORIGIN, ORIGIN + 100 * DAY], width: WIDTH, height: HEIGHT, cluster: true });
    const other = renderTimeline({ items: [...items()], domain: [ORIGIN, ORIGIN + 100 * DAY], width: WIDTH, height: HEIGHT, cluster: true });
    expect(() => createNavigator(one.layout, { clustering: other.clustering })).toThrow(RangeError);
    const navigator = createNavigator(one.layout, { clustering: one.clustering });
    expect(createNavigator(one.layout, { clustering: one.clustering })).toBe(navigator);
    expect(navigator.indexOf("a7")).toBe(navigator.indexOf("a0"));
    expect(navigator.entries.find((entry) => entry.id === "a0")?.count).toBe(12);
    expect(navigator.indexOf("nope")).toBe(-1);
  });
});
