import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * G-TOOLTIP, in a real browser, through the shipped bundles: an item's
 * tooltip appears for a mouse, for the keyboard's focus and for a long
 * press; and it is what WCAG 1.4.13 asks of content on hover or focus —
 * dismissible (Escape takes it away without moving the pointer or the
 * focus), hoverable (the pointer can move onto it), persistent (it stays
 * until the pointer or the focus leaves).
 *
 * What the browser showed goes to `.tooltip-browser-log.json`; the check
 * (sdk_check_tooltip.mjs) judges from it, not from the test titles.
 */

const here = dirname(fileURLToPath(import.meta.url));
const LOG = join(here, "..", ".tooltip-browser-log.json");

function record(key: string, value: unknown): void {
  const log = existsSync(LOG) ? (JSON.parse(readFileSync(LOG, "utf8")) as Record<string, unknown>) : {};
  log[key] = value;
  writeFileSync(LOG, `${JSON.stringify(log, null, 2)}\n`);
}

type Tl = {
  ready: boolean;
  shown(): boolean;
  text(): string;
  box(): { x: number; y: number; width: number; height: number } | undefined;
  focusedId(): string | null;
  selectedIds(): readonly string[];
  option(id: string): { x: number; y: number } | undefined;
};

/** A method of the page's `window.tl`, called in the page. */
async function tl<K extends Exclude<keyof Tl, "ready">>(page: Page, method: K): Promise<Tl[K] extends () => infer R ? R : never> {
  return page.evaluate((name) => {
    const each = (window as unknown as { tl: Record<string, () => unknown> }).tl;
    return (each[name] as () => unknown)();
  }, method) as never;
}

async function open(page: Page): Promise<void> {
  await page.goto("/p24.html");
  await page.waitForFunction(() => (window as unknown as { tl?: Tl }).tl?.ready === true);
}

async function centreOf(page: Page, id: string): Promise<{ x: number; y: number }> {
  const at = await page.evaluate((each) => (window as unknown as { tl: Tl }).tl.option(each), id);
  expect(at, `item ${id} on screen`).toBeDefined();
  return at as { x: number; y: number };
}

/**
 * A point where the item itself is on top, along its middle row: a mouse
 * rests on what is under it. The page's cut-off bar stands at the shown
 * middle of "b" (its nights are hidden), and a mouse there rests on the bar.
 */
async function restingPoint(page: Page, id: string): Promise<{ x: number; y: number }> {
  const at = await page.evaluate((each) => {
    const node = document.querySelector(`[data-tl-id="${each}"]`);
    const rect = node?.getBoundingClientRect();
    if (node === null || rect === undefined) return undefined;
    for (const fraction of [0.5, 0.3, 0.7, 0.2, 0.8]) {
      const x = rect.x + rect.width * fraction;
      const y = rect.y + rect.height / 2;
      if (document.elementFromPoint(x, y)?.closest(`[data-tl-id="${each}"]`) === node) return { x, y };
    }
    return undefined;
  }, id);
  expect(at, `a point on item ${id} that nothing covers`).toBeDefined();
  return at as { x: number; y: number };
}

test("[claim:hover] a mouse resting on an item shows its tooltip, with its label and dates", async ({ page }) => {
  await open(page);
  const at = await restingPoint(page, "b");
  await page.mouse.move(at.x, at.y);
  await expect.poll(() => tl(page, "shown")).toBe(true);
  const text = await tl(page, "text");
  record("hover", { shown: true, text });
  expect(text).toContain("Welding");
});

test("[claim:hoverable] the pointer can move onto the tooltip, and it stays; [claim:persistent] it does not time out", async ({ page }) => {
  await open(page);
  const at = await restingPoint(page, "b");
  await page.mouse.move(at.x, at.y);
  await expect.poll(() => tl(page, "shown")).toBe(true);
  const box = await tl(page, "box");
  expect(box).toBeDefined();
  // Onto the tooltip, in steps — past the gap between the item and it.
  await page.mouse.move((box?.x ?? 0) + (box?.width ?? 0) / 2, (box?.y ?? 0) + (box?.height ?? 0) / 2, { steps: 8 });
  await page.waitForTimeout(1500);
  const stayed = await tl(page, "shown");
  // And away from both: it goes.
  await page.mouse.move(5, 5);
  await expect.poll(() => tl(page, "shown"), { timeout: 3000 }).toBe(false);
  record("hoverable", { stayedOnTooltip: stayed, wentAfterLeaving: true, heldMs: 1500 });
  expect(stayed).toBe(true);
});

test("[claim:focus] the keyboard's focus on an item shows its tooltip; [claim:dismiss] Escape takes it away and nothing else", async ({ page }) => {
  await open(page);
  await page.locator("#timeline svg[role=listbox]").focus();
  await page.keyboard.press("Home");
  await expect.poll(() => tl(page, "focusedId")).not.toBeNull();
  await expect.poll(() => tl(page, "shown")).toBe(true);
  const focused = await tl(page, "focusedId");
  const text = await tl(page, "text");
  const before = { selected: [...(await tl(page, "selectedIds"))] };
  const active = await page.evaluate(() => document.activeElement?.getAttribute("role"));
  await page.keyboard.press("Escape");
  await expect.poll(() => tl(page, "shown")).toBe(false);
  const after = { focused: await tl(page, "focusedId"), selected: [...(await tl(page, "selectedIds"))] };
  const stillActive = await page.evaluate(() => document.activeElement?.getAttribute("role"));
  record("focus", { shown: true, focused, text });
  record("dismiss", {
    hidden: true,
    focusKept: after.focused === focused && stillActive === active,
    selectionKept: JSON.stringify(after.selected) === JSON.stringify(before.selected),
  });
  expect(after.focused).toBe(focused);
  expect(after.selected).toEqual(before.selected);
  expect(stillActive).toBe(active);
  // The next step of the focus brings a tooltip again.
  await page.keyboard.press("ArrowRight");
  await expect.poll(() => tl(page, "shown")).toBe(true);
});

test("[claim:long-press] a long press of a finger shows the tooltip, and a press elsewhere lets it go", async ({ browser }) => {
  const context = await browser.newContext({ hasTouch: true, viewport: { width: 1200, height: 800 } });
  const page = await context.newPage();
  await open(page);
  const at = await centreOf(page, "c");
  const session = await context.newCDPSession(page);
  await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: at.x, y: at.y }] });
  await page.waitForTimeout(800);
  const shownWhileHeld = await tl(page, "shown");
  await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  const text = await tl(page, "text");
  const stays = await tl(page, "shown");
  await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 20, y: 200 }] });
  await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect.poll(() => tl(page, "shown")).toBe(false);
  record("longPress", { shown: shownWhileHeld, staysAfterLift: stays, text });
  expect(shownWhileHeld).toBe(true);
  expect(text).toContain("Painting");
  await context.close();
});
