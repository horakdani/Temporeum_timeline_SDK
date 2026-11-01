/**
 * Patching is rebuilding, only cheaper.
 *
 * The mount keeps nodes across frames and changes what changed. The one way
 * that goes wrong is silently: a stale attribute left on a reused node, a
 * label in the wrong slot, a pooled rect still carrying a previous item's
 * title. None of that throws, and most of it is invisible until someone
 * squints. So the property is the strongest one available: after EVERY
 * update in a generated sequence of frames, the live tree is exactly the
 * tree of the scene — the same thing an `innerHTML` rebuild would have
 * produced, attribute for attribute.
 *
 * The sequences mix everything a host does between two frames: pan, zoom,
 * lane scroll, selection, density, orientation, theme, an edit that brings
 * in a new items array, and the item space switching on and off — so pooled
 * nodes are reused across tags, layers and orientations.
 */

import { afterAll, describe, it } from "vitest";

import { mountScene } from "../../src/dom/mount.js";
import { planSceneSpace } from "../../src/scene-space.js";
import type { SceneSpace } from "../../src/scene-space.js";
import { renderTimeline } from "../../src/render.js";
import type { Density, Item, Orientation } from "../../src/types.js";
import { differs, fakeContainer } from "../dom/fake-dom.js";
import type { FakeElement } from "../dom/fake-dom.js";
import { forAll, generateCase, writePropertyReport } from "./harness.js";
import type { GeneratedCase } from "./harness.js";

const DAY = 86_400_000;
const ORIGIN = Date.UTC(2020, 0, 1);
const CASES = 600;

type Step =
  | { readonly kind: "pan"; readonly days: number }
  | { readonly kind: "zoom"; readonly factor: number }
  | { readonly kind: "scroll"; readonly px: number }
  | { readonly kind: "select"; readonly index: number }
  | { readonly kind: "density"; readonly density: Density }
  | { readonly kind: "orientation"; readonly orientation: Orientation }
  | { readonly kind: "theme"; readonly theme: "light" | "dark" }
  | { readonly kind: "edit"; readonly index: number; readonly days: number }
  | { readonly kind: "space"; readonly on: boolean }
  | { readonly kind: "cluster"; readonly on: boolean };

const DENSITIES: readonly Density[] = ["comfortable", "compact", "dense"];

function generate(random: () => number): GeneratedCase<Step> {
  const base = generateCase(random, { open: true, tall: true, granularity: true, lanes: 3 });
  const steps: Step[] = [];
  const count = 3 + Math.floor(random() * 10);
  for (let index = 0; index < count; index += 1) {
    const roll = Math.floor(random() * 10);
    const value = random();
    if (roll === 0) {
      steps.push({ kind: "pan", days: Math.round((value - 0.5) * 120) });
    } else if (roll === 1) {
      steps.push({ kind: "zoom", factor: 0.5 + value * 1.5 });
    } else if (roll === 2) {
      steps.push({ kind: "scroll", px: Math.floor(value * 200) });
    } else if (roll === 3) {
      steps.push({ kind: "select", index: Math.floor(value * 30) });
    } else if (roll === 4) {
      steps.push({ kind: "density", density: DENSITIES[Math.floor(value * 3)] as Density });
    } else if (roll === 5) {
      steps.push({ kind: "orientation", orientation: value < 0.5 ? "horizontal" : "vertical" });
    } else if (roll === 6) {
      steps.push({ kind: "theme", theme: value < 0.5 ? "light" : "dark" });
    } else if (roll === 7) {
      steps.push({ kind: "edit", index: Math.floor(value * 30), days: Math.round((random() - 0.5) * 40) });
    } else if (roll === 8) {
      steps.push({ kind: "space", on: value < 0.6 });
    } else {
      // Markers come and go with their members: a node keyed in one frame
      // and gone in the next is what a zoom does to a cluster.
      steps.push({ kind: "cluster", on: value < 0.7 });
    }
  }
  return { ...base, steps };
}

function check(generated: GeneratedCase<Step>): string | undefined {
  const { container } = fakeContainer();
  const mount = mountScene(container as unknown as Element);
  let items: readonly Item[] = generated.items;
  let domain: readonly [number, number] = [ORIGIN, ORIGIN + 200 * DAY];
  let crossOffset = 0;
  let selectedIds: readonly string[] = [];
  let density: Density = "comfortable";
  let orientation: Orientation = "horizontal";
  let theme: "light" | "dark" = "light";
  let spaced = false;
  let clustered = false;
  let space: SceneSpace | undefined;
  const steps = generated.steps ?? [];
  for (let index = -1; index < steps.length; index += 1) {
    const step = steps[index];
    if (step?.kind === "pan") {
      domain = [domain[0] + step.days * DAY, domain[1] + step.days * DAY];
    } else if (step?.kind === "zoom") {
      const middle = (domain[0] + domain[1]) / 2;
      const half = ((domain[1] - domain[0]) / 2) * step.factor;
      domain = [middle - half, middle + half];
    } else if (step?.kind === "scroll") {
      crossOffset = step.px;
    } else if (step?.kind === "select") {
      const item = items[step.index % Math.max(items.length, 1)];
      selectedIds = item === undefined ? [] : [item.id];
    } else if (step?.kind === "density") {
      density = step.density;
    } else if (step?.kind === "orientation") {
      orientation = step.orientation;
    } else if (step?.kind === "theme") {
      theme = step.theme;
    } else if (step?.kind === "edit") {
      const at = step.index % Math.max(items.length, 1);
      items = items.map((item, position) =>
        position === at && typeof item.start === "number"
          ? { ...item, start: item.start + step.days * DAY, label: `${item.label ?? ""}!` }
          : item,
      );
    } else if (step?.kind === "space") {
      spaced = step.on;
    } else if (step?.kind === "cluster") {
      clustered = step.on;
    }
    const width = 640;
    const height = 360;
    const mainSize = orientation === "horizontal" ? width : height;
    space = spaced ? planSceneSpace(space, { domain, mainSize }) : undefined;
    const result = renderTimeline({
      items,
      ...(generated.lanes === undefined ? {} : { lanes: generated.lanes }),
      domain,
      width,
      height,
      orientation,
      density,
      theme,
      crossOffset,
      selectedIds,
      cluster: clustered,
      hooks: {
        renderDetail: (context) => ({
          tag: "rect",
          attrs: { class: "detail", "data-tl-id": context.placed.item.id, x: context.box.main },
          children: [{ tag: "title", text: `részlet ${context.placed.item.id}` }],
        }),
      },
      ...(space === undefined ? {} : { space }),
    });
    mount.update(result.scene);
    const root = container.childNodes[0];
    if (container.childNodes.length !== 1 || root === undefined) {
      return `after step ${String(index + 1)} the container holds ${String(container.childNodes.length)} nodes`;
    }
    const reason = differs(root as FakeElement, result.scene);
    if (reason !== undefined) {
      return `after step ${String(index + 1)} (${step?.kind ?? "first frame"}): ${reason}`;
    }
  }
  return undefined;
}

describe("mount properties", () => {
  it("leaves the live tree identical to the scene after every patch", () => {
    forAll("a patched frame equals a rebuilt one", CASES, 0x9a7c4, generate, check);
  });
});

afterAll(() => {
  writePropertyReport("mount");
});
