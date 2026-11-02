import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * G-CLUSTER, in a real browser: the sum of the markers' counts ALWAYS
 * equals the number of visible items — read from the live DOM.
 *
 * The page (public/cluster.html) draws with the shipped bundle, through the
 * patching mount. After every step the page's `measure()` compares the live
 * DOM's items and markers with the frame the same renderer would draw
 * without clustering (fixture: the browser counterpart of the core's
 * meter). The steps are real input: Ctrl+wheel, mouse drag, tap (Pixel 7
 * emulation, touch events), click, keys.
 *
 * The summary goes to `.cluster-browser-log.json`;
 * sdk_check_cluster.mjs judges from that, not from the test titles.
 */

const here = dirname(fileURLToPath(import.meta.url));
const LOG = join(here, "..", ".cluster-browser-log.json");
const AXE = createRequire(import.meta.url).resolve("axe-core/axe.min.js");

/** One entry per test, merged into the file as it finishes. */
function record(key: string, value: unknown): void {
  const log = existsSync(LOG) ? (JSON.parse(readFileSync(LOG, "utf8")) as Record<string, unknown>) : {};
  log[key] = value;
  writeFileSync(LOG, `${JSON.stringify(log, null, 2)}\n`);
}

interface Measured {
  readonly visible: number;
  readonly sum: number;
  readonly singles: number;
  readonly markers: number;
  readonly extras: number;
  readonly problems: readonly string[];
  readonly draws: number;
}

const measure = (page: Page): Promise<Measured> =>
  page.evaluate(() => (window as unknown as { tl: { measure(): Measured } }).tl.measure());

const spanOf = (page: Page): Promise<number> =>
  page.evaluate(() => {
    const domain = (window as unknown as { tl: { domain: [number, number] } }).tl.domain;
    return domain[1] - domain[0];
  });

const opened = (page: Page): Promise<{ id: string; count: number }[]> =>
  page.evaluate(() => (window as unknown as { tl: { opened: { id: string; count: number }[] } }).tl.opened);

/** The marker standing for `member` now, if any: its id and its box on the page. */
async function markerHolding(page: Page, member: string): Promise<{ id: string; x: number; y: number } | undefined> {
  const id = await page.evaluate(
    (wanted) =>
      (window as unknown as { tl: { result: { clusters: { cluster: { id: string; members: { item: { id: string } }[] } }[] } } }).tl.result.clusters.find(
        (marker) => marker.cluster.members.some((each) => each.item.id === wanted),
      )?.cluster.id,
    member,
  );
  if (id === undefined) {
    return undefined;
  }
  const box = await page.locator(`.tl-layer--items [data-tl-cluster="${id}"]`).boundingBox();
  if (box === null) {
    return undefined;
  }
  return { id, x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** The member of the largest marker on screen: a target that needs several taps. */
async function busiestMember(page: Page): Promise<string> {
  return page.evaluate(() => {
    const clusters = (window as unknown as { tl: { result: { clusters: { box: { main: number }; cluster: { members: { item: { id: string } }[] } }[] } } }).tl.result.clusters
      .filter((marker) => marker.box.main > 40 && marker.box.main < 300);
    clusters.sort((a, b) => b.cluster.members.length - a.cluster.members.length);
    const members = clusters[0]?.cluster.members ?? [];
    return members[Math.floor(members.length / 2)]?.item.id ?? "";
  });
}

async function openPage(page: Page): Promise<void> {
  await page.goto("/cluster.html");
  await expect(page.locator(".tl-layer--items [data-tl-cluster]").first()).toBeAttached();
}

function expectClean(measured: Measured, where: string): void {
  expect(measured.problems, where).toEqual([]);
  expect(measured.sum, where).toBe(measured.visible + measured.extras);
}

test.describe("clustering in a real browser", () => {
  test("[claim:browser-conservation] @desktop after wheel zoom and drag, at every step the sum is the number of visible items", async ({ page }) => {
    await openPage(page);
    const box = await page.locator("#frame svg").boundingBox();
    if (box === null) throw new Error("no canvas");
    let seed = 41;
    const random = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const totals = { steps: 0, withMarkers: 0, markers: 0, visible: 0, sum: 0, extras: 0, problems: [] as string[] };
    const step = async (what: string): Promise<void> => {
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve(undefined))));
      const measured = await measure(page);
      totals.steps += 1;
      totals.markers += measured.markers;
      totals.visible += measured.visible;
      totals.sum += measured.sum;
      totals.extras += measured.extras;
      if (measured.markers > 0) totals.withMarkers += 1;
      totals.problems.push(...measured.problems.map((problem) => `${what}: ${problem}`));
    };
    await step("load");
    for (let index = 0; index < 60; index += 1) {
      const x = box.x + 20 + random() * (box.width - 40);
      const y = box.y + box.height / 2;
      if (random() < 0.6) {
        await page.mouse.move(x, y);
        await page.keyboard.down("Control");
        await page.mouse.wheel(0, random() < 0.5 ? -120 : 120);
        await page.keyboard.up("Control");
        await step(`zoom ${String(index)}`);
      } else {
        await page.mouse.move(x, y);
        await page.mouse.down();
        await page.mouse.move(x + (random() - 0.5) * 400, y, { steps: 4 });
        await page.mouse.up();
        await step(`pan ${String(index)}`);
      }
    }
    record("conservation", { ...totals, problems: totals.problems.slice(0, 5), problemCount: totals.problems.length });
    expect(totals.problems.slice(0, 5)).toEqual([]);
    expect(totals.withMarkers).toBeGreaterThan(totals.steps / 3);
  });

  test("[claim:browser-tap-zoom] @touch a tapped cluster opens under the finger, until its member stands on its own", async ({ page }) => {
    await openPage(page);
    const target = await busiestMember(page);
    expect(target).not.toBe("");
    const taps: { id: string; count: number; span: number }[] = [];
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const marker = await markerHolding(page, target);
      if (marker === undefined) break;
      const before = await spanOf(page);
      await page.touchscreen.tap(marker.x, marker.y);
      // Not a double tap: the machine would zoom on its own.
      await page.waitForTimeout(400);
      const after = await spanOf(page);
      const last = (await opened(page)).at(-1);
      expect(last?.id).toBe(marker.id);
      expect(after).toBeLessThan(before / 1.9);
      taps.push({ id: marker.id, count: last?.count ?? 0, span: after });
      expectClean(await measure(page), `tap ${String(attempt)}`);
    }
    await expect(page.locator(`.tl-layer--items [data-tl-id="${target}"]`)).toBeAttached();
    // Each tap opened a smaller cluster than the one before.
    for (let index = 1; index < taps.length; index += 1) {
      expect(taps[index]?.count ?? 0).toBeLessThan(taps[index - 1]?.count ?? 0);
    }
    record("tap", { target, taps });
    expect(taps.length).toBeGreaterThanOrEqual(1);
  });

  test("[claim:browser-click] @desktop a mouse click opens it the same way", async ({ page }) => {
    await openPage(page);
    const target = await busiestMember(page);
    const marker = await markerHolding(page, target);
    if (marker === undefined) throw new Error("no marker");
    const before = await spanOf(page);
    await page.mouse.click(marker.x, marker.y);
    await page.waitForTimeout(100);
    expect((await opened(page)).at(-1)?.id).toBe(marker.id);
    expect(await spanOf(page)).toBeLessThan(before / 1.9);
    expectClean(await measure(page), "click");
    record("click", { id: marker.id });
  });

  test("[claim:browser-keyboard] @desktop by keyboard a cluster is one stop, and Enter opens it the same way", async ({ page }) => {
    await openPage(page);
    await page.locator("#frame svg").focus();
    let active: string | null = null;
    for (let press = 0; press < 60; press += 1) {
      await page.keyboard.press("ArrowRight");
      active = await page.locator("#frame svg").getAttribute("aria-activedescendant");
      if (active?.startsWith("cl-c-") === true) break;
    }
    expect(active).toMatch(/^cl-c-/);
    const option = page.locator(`[id="${String(active)}"]`);
    await expect(option).toHaveAttribute("role", "option");
    const label = await option.getAttribute("aria-label");
    // The host names its clusters in its own words (`describeCluster`): "events", not the default "items".
    expect(label).toMatch(/^\d+ events, /);
    const before = await spanOf(page);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(100);
    const last = (await opened(page)).at(-1);
    expect(`cl-c-${String(last?.id)}`).toBe(active);
    expect(await spanOf(page)).toBeLessThan(before / 1.9);
    expectClean(await measure(page), "enter");
    record("keyboard", { active, label });
  });

  test("[claim:browser-negative-control] @desktop NEGATIVE CONTROL: on a page that drops an item the meter finds it", async ({ page }) => {
    await page.goto("/cluster.html?lossy=1");
    await expect(page.locator(".tl-layer--items [data-tl-cluster]").first()).toBeAttached();
    const measured = await measure(page);
    record("control", { problems: measured.problems.slice(0, 3), problemCount: measured.problems.length });
    expect(measured.problems.some((problem) => problem.endsWith("shown 0 times"))).toBe(true);
  });

  test("[claim:browser-axe] @desktop axe: 0 violations on the clustered page, WCAG 2.2 AA", async ({ page }) => {
    await openPage(page);
    await page.locator("#frame svg").focus();
    await page.keyboard.press("ArrowRight");
    await page.addScriptTag({ path: AXE });
    const result = await page.evaluate(async () => {
      const axe = (window as unknown as { axe: { run: (context: Document, options: unknown) => Promise<{ violations: { id: string; nodes: unknown[] }[] }> } }).axe;
      const run = await axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] } });
      return run.violations.map((violation) => `${violation.id} (${String(violation.nodes.length)})`);
    });
    const markers = await page.locator(".tl-layer--items [data-tl-cluster][role=option]").count();
    record("axe", { violations: result, markers });
    expect(markers).toBeGreaterThan(0);
    expect(result).toEqual([]);
  });
});
