import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";

/**
 * The drop check, in a real browser: an external element lands at the time and in
 * the lane under the pointer — real HTML5 drag-and-drop, with the shipped
 * bundles — and its keyboard twin (Enter on the source → `dropItem`) puts
 * the same into the focused lane, in the middle of the view.
 *
 * The result goes to `.drop-browser-log.json`; sdk_check_drop.mjs judges
 * from that, not from the test titles.
 */

const here = dirname(fileURLToPath(import.meta.url));
const LOG = join(here, "..", ".drop-browser-log.json");

function record(key: string, value: unknown): void {
  const log = existsSync(LOG) ? (JSON.parse(readFileSync(LOG, "utf8")) as Record<string, unknown>) : {};
  log[key] = value;
  writeFileSync(LOG, `${JSON.stringify(log, null, 2)}\n`);
}

interface Placed {
  readonly laneId: string;
  readonly start: number;
  readonly end: number;
}

type Tl = {
  ready: boolean;
  domain(): [number, number];
  width(): number;
  laneBox(id: string): { cross: number; crossSize: number } | undefined;
  find(id: string): Placed | undefined;
  focusedLane(): string | undefined;
  dropped?: boolean;
};

test("a dragged external element lands at the time and in the lane under the pointer", async ({ page }) => {
  await page.goto("/drop-template.html?mode=drop");
  await page.waitForFunction(() => (window as unknown as { tl?: Tl }).tl?.ready === true);
  const lane = await page.evaluate(() => (window as unknown as { tl: Tl }).tl.laneBox("ops"));
  expect(lane).toBeDefined();
  const x = 600;
  const y = (lane?.cross ?? 0) + (lane?.crossSize ?? 0) / 2;
  await page.locator("#source-a").dragTo(page.locator("#timeline"), { targetPosition: { x, y } });
  await page.waitForFunction(() => (window as unknown as { tl: Tl }).tl.find("ext-a") !== undefined, undefined, { timeout: 5000 });
  const result = await page.evaluate((at) => {
    const tl = (window as unknown as { tl: Tl }).tl;
    const [start, end] = tl.domain();
    const msPerPx = (end - start) / tl.width();
    return { placed: tl.find("ext-a"), expected: start + at * msPerPx, msPerPx };
  }, x);
  const errorPx = Math.abs((result.placed?.start ?? Number.NaN) - result.expected) / result.msPerPx;
  record("pointer", { laneId: result.placed?.laneId, expectedLane: "ops", errorPx, durationMs: (result.placed?.end ?? 0) - (result.placed?.start ?? 0) });
  expect(result.placed?.laneId).toBe("ops");
  expect(errorPx).toBeLessThanOrEqual(2);
});

test("its keyboard twin: Enter on the source adds to the focused lane, in the middle of the view", async ({ page }) => {
  await page.goto("/drop-template.html?mode=drop");
  await page.waitForFunction(() => (window as unknown as { tl?: Tl }).tl?.ready === true);
  // Keyboard only: into the timeline, onto the last item, out to the source.
  await page.locator("#timeline svg").focus();
  await page.keyboard.press("End");
  // The key lands in the next frame, like every input: wait for it, don't race it.
  const focusedLane = (): Promise<string | undefined> => page.evaluate(() => (window as unknown as { tl: Tl }).tl.focusedLane());
  await expect.poll(focusedLane, { timeout: 5000 }).toBeDefined();
  const focused = await focusedLane();
  await page.locator("#source-b").focus();
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => (window as unknown as { tl: Tl }).tl.find("ext-b") !== undefined, undefined, { timeout: 5000 });
  const result = await page.evaluate(() => {
    const tl = (window as unknown as { tl: Tl }).tl;
    const [start, end] = tl.domain();
    return { placed: tl.find("ext-b"), middle: (start + end) / 2, dropped: tl.dropped };
  });
  record("keyboard", { laneId: result.placed?.laneId, expectedLane: focused, errorMs: Math.abs((result.placed?.start ?? Number.NaN) - result.middle), dropped: result.dropped });
  expect(result.placed?.laneId).toBe(focused);
  expect(Math.abs((result.placed?.start ?? Number.NaN) - result.middle)).toBeLessThanOrEqual(1);
});
