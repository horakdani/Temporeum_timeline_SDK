import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * The async check, in a real browser: during a fast zoom, the results of aborted
 * requests NEVER reach the canvas.
 *
 * The page (public/async.html) queries a fake, delayed server, and every
 * item carries the request's sequence number in its name (`@r<n>`). A
 * MutationObserver records the name of EVERY option ever inserted or
 * rewritten, not just the final state: a leak lasting one frame leaves a
 * trace too. At the end the test compares the names seen with the aborted
 * requests.
 *
 * Two server behaviours: one that aborts on the signal, and one that CANNOT
 * abort and answers the aborted request anyway — the harder case, because
 * there the answer really arrives, and the loader has to drop it.
 *
 * The summary goes to `.async-browser-log.json`; sdk_check_async.mjs judges
 * from that, not from the test titles.
 */

const here = dirname(fileURLToPath(import.meta.url));
const LOG = join(here, "..", ".async-browser-log.json");
/**
 * One entry per test, merged into the file as it finishes. Not an afterAll:
 * Playwright starts a fresh worker after a failing test, and a log held in
 * memory would lose everything recorded before the failure.
 */
function record(key: string, value: unknown): void {
  const log = existsSync(LOG) ? (JSON.parse(readFileSync(LOG, "utf8")) as Record<string, unknown>) : {};
  log[key] = value;
  writeFileSync(LOG, `${JSON.stringify(log, null, 2)}\n`);
}

/** A line's drawn extent: a horizontal line has no height, so "visible" is not the question. */
async function drawnLength(page: Page, selector: string): Promise<number> {
  const box = await page.locator(selector).first().boundingBox();
  return box === null ? 0 : Math.max(box.width, box.height);
}

interface Report {
  readonly requests: number;
  readonly aborted: number;
  readonly answeredAfterAbort: number;
  readonly namesSeen: number;
  readonly draws: number;
  readonly leaks: readonly string[];
}

const report = (page: Page): Promise<Report> =>
  page.evaluate(() => (window as unknown as { tl: { report(): Report } }).tl.report());

async function idle(page: Page): Promise<void> {
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { tl: { loader: { busy: boolean } } }).tl.loader.busy), { timeout: 15_000 })
    .toBe(false);
}

/** Bursts of Ctrl+wheel steps a frame apart, in and out, at random points. */
async function fastZoom(page: Page, bursts: number): Promise<void> {
  const box = (await page.locator("[data-testid=frame] svg, #frame svg").first().boundingBox())!;
  let seed = 11;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  await page.keyboard.down("Control");
  for (let burst = 0; burst < bursts; burst += 1) {
    const x = box.x + 40 + random() * (box.width - 80);
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    const inward = burst % 2 === 0;
    const steps = 4 + Math.floor(random() * 8);
    for (let step = 0; step < steps; step += 1) {
      await page.mouse.wheel(0, inward ? -60 : 80);
      await page.waitForTimeout(16);
    }
    // Sometimes a short pause, so some answers land mid-gesture.
    if (random() < 0.4) {
      await page.waitForTimeout(80 + random() * 200);
    }
  }
  await page.keyboard.up("Control");
}

for (const mode of ["abort", "ignore-abort"] as const) {
  test(`[claim:browser-no-stale] ${mode}: during a fast Ctrl+wheel zoom, no item of an aborted request reaches the canvas`, async ({ page }) => {
    await page.goto(`/async.html?latency=250${mode === "ignore-abort" ? "&ignoreAbort=1" : ""}`);
    await idle(page);
    await fastZoom(page, 24);
    await idle(page);
    // In the end every request settles, the late ones too.
    await page.waitForTimeout(700);
    const result = await report(page);
    record(mode, result);
    expect(result.leaks).toEqual([]);
    expect(result.aborted).toBeGreaterThan(5);
    expect(result.namesSeen).toBeGreaterThan(50);
    if (mode === "ignore-abort") {
      // Not vacuous: the answers to the aborted requests really arrived.
      expect(result.answeredAfterAbort).toBeGreaterThan(5);
    }
  });
}

test("[claim:browser-negative-control] NEGATIVE CONTROL: the meter finds a leak in a loader that keeps every answer", async ({ page }) => {
  await page.goto("/async.html?latency=250&ignoreAbort=1&naive=1");
  await idle(page);
  await fastZoom(page, 24);
  await idle(page);
  await page.waitForTimeout(700);
  const result = await report(page);
  record("control", { ...result, leaks: result.leaks.length });
  expect(result.answeredAfterAbort).toBeGreaterThan(5);
  expect(result.leaks.length).toBeGreaterThan(0);
});

test("[claim:browser-loading-mark] loading shows on the axis, the root is aria-busy, and at the end it is gone", async ({ page }) => {
  await page.goto("/async.html?latency=900");
  const svg = page.locator("#frame svg");
  await expect(svg).toHaveAttribute("aria-busy", "true");
  await expect(page.locator("#frame line.tl-loading").first()).toBeAttached();
  expect(await drawnLength(page, "#frame line.tl-loading")).toBeGreaterThan(100);
  const animation = await page.locator("#frame line.tl-loading").first().evaluate((node) => getComputedStyle(node).animationName);
  expect(animation).toBe("tl-loading");
  await idle(page);
  await expect(svg).not.toHaveAttribute("aria-busy", "true");
  await expect(page.locator("#frame line.tl-loading")).toHaveCount(0);
  await expect(page.locator("#frame [role=option]").first()).toBeAttached();
});

test("[claim:browser-reduced-motion] with reduced motion the loading mark stands still", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/async.html?latency=900");
  const mark = page.locator("#frame line.tl-loading").first();
  await expect(mark).toBeAttached();
  expect(await mark.evaluate((node) => getComputedStyle(node).animationName)).toBe("none");
});

test("[claim:browser-failure] a failed window shows dotted, and the Retry button requests it again", async ({ page }) => {
  await page.goto("/async.html?latency=100&fail=1");
  const failed = page.locator("#frame line.tl-loading--failed").first();
  await expect(failed).toBeAttached();
  expect(await drawnLength(page, "#frame line.tl-loading--failed")).toBeGreaterThan(100);
  expect(await failed.evaluate((node) => getComputedStyle(node).strokeDasharray)).toMatch(/^2(px)?,? 4(px)?$/);
  await expect(page.locator("#frame svg")).not.toHaveAttribute("aria-busy", "true");
  const before = (await report(page)).requests;
  const retry = page.locator("#retry");
  await expect(retry).toBeEnabled();
  await retry.click();
  expect((await report(page)).requests).toBeGreaterThan(before);
});
