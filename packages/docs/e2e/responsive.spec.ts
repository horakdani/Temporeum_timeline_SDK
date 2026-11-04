import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * The responsive check: the same page at four widths, and at each the EXPECTED
 * projection.
 *
 * The core's tests prove that the decisions are right for a measurement.
 * This suite proves what only a browser can: that the measurement comes from
 * the CONTAINER (ResizeObserver, not the size at load), that the decision
 * shows on the drawn SVG as well, and that no width has horizontal page
 * scrolling — not even after the detail surface opens, because an
 * overflowing popover is exactly that.
 *
 * The expected values stand here, WRITTEN OUT, not asked from the core. A
 * suite that computes its own expectation from the code it measures always
 * agrees with it.
 */

interface Expected {
  readonly width: number;
  readonly height: number;
  readonly touch: boolean;
  readonly orientation: "horizontal" | "vertical";
  readonly density: "comfortable" | "compact" | "dense";
  readonly surface: "popover" | "sheet";
}

/**
 * The contract. With the page's data: four-day items over sixty days.
 *
 * - 320: WCAG's reflow width (1.4.10), a 1280-pixel window at 400% or the
 *   smallest phones → vertical, dense, bottom sheet, as at 375.
 * - 375: narrow → vertical; across, only the dense columns fit into 375 px
 *   (comfortable would be 3 × 168 px) → dense → bottom sheet.
 * - 768: tablet, by finger → horizontal; an item is ~51 px, comfortable
 *   would need 72 → compact → popover on tap.
 * - 1440: desktop, with a mouse → horizontal; an item is ~96 px →
 *   comfortable → popover on hover.
 */
const EXPECTED: readonly Expected[] = [
  { width: 320, height: 640, touch: true, orientation: "vertical", density: "dense", surface: "sheet" },
  { width: 375, height: 667, touch: true, orientation: "vertical", density: "dense", surface: "sheet" },
  { width: 768, height: 1024, touch: true, orientation: "horizontal", density: "compact", surface: "popover" },
  { width: 1440, height: 900, touch: false, orientation: "horizontal", density: "comfortable", surface: "popover" },
];

interface PageState {
  readonly width: number;
  readonly orientation: string;
  readonly density: string;
  readonly draws: number;
  readonly changes: readonly string[];
  readonly detail: { surface: string; item: string; trigger: string } | null;
}

async function stateOf(page: Page): Promise<PageState> {
  return page.evaluate(() => {
    const tl = (window as unknown as { tl: PageState & { clientBoxOf: unknown } }).tl;
    return {
      width: tl.width,
      orientation: tl.orientation,
      density: tl.density,
      draws: tl.draws,
      changes: tl.changes,
      detail: tl.detail,
    };
  });
}

/** The page is OUR page, and has measured already: window.tl is the proof. */
async function open(page: Page, query = ""): Promise<void> {
  await page.goto(`/responsive.html${query}`);
  await page.waitForFunction(() => {
    const tl = (window as unknown as { tl?: { draws: number } }).tl;
    return tl !== undefined && tl.draws > 0;
  });
}

async function boxOf(page: Page, id: string) {
  const box = await page.evaluate(
    (itemId) =>
      (
        window as unknown as {
          tl: { clientBoxOf: (id: string) => { x: number; y: number; width: number; height: number } };
        }
      ).tl.clientBoxOf(itemId),
    id,
  );
  if (box === undefined || box === null) {
    throw new Error(`no ${id} on the page`);
  }
  return box;
}

async function noHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
    svg: document.querySelector("svg")?.getBoundingClientRect().right ?? 0,
  }));
  expect(overflow.scroll, "the page is wider than the screen").toBeLessThanOrEqual(overflow.client);
  expect(overflow.svg).toBeLessThanOrEqual(overflow.client);
  // The page really does not move sideways when we try.
  await page.evaluate(() => window.scrollTo(500, window.scrollY));
  expect(await page.evaluate(() => window.scrollX)).toBe(0);
}

async function tapAt(page: Page, x: number, y: number, touch: boolean): Promise<void> {
  if (touch) {
    await page.touchscreen.tap(x, y);
  } else {
    await page.mouse.click(x, y);
  }
}

for (const expected of EXPECTED) {
  test.describe(`${String(expected.width)} px`, () => {
    test.use({
      viewport: { width: expected.width, height: expected.height },
      hasTouch: expected.touch,
      isMobile: expected.touch,
    });

    test(`${String(expected.width)} px: ${expected.orientation} and ${expected.density}, on the drawn SVG too`, async ({
      page,
    }) => {
      await open(page);
      const state = await stateOf(page);
      expect(state.width).toBe(expected.width);
      expect(state.orientation).toBe(expected.orientation);
      expect(state.density).toBe(expected.density);
      const svg = page.getByTestId("timeline");
      await expect(svg).toHaveAttribute("data-tl-orientation", expected.orientation);
      await expect(svg).toHaveAttribute("data-tl-density", expected.density);
    });

    test(`${String(expected.width)} px: no horizontal page scroll`, async ({ page }) => {
      await open(page);
      await noHorizontalScroll(page);
    });

    test(`${String(expected.width)} px: the detail opens on the ${expected.surface} surface, and afterwards there is no horizontal scroll either`, async ({
      page,
    }) => {
      await open(page);
      // An item reaching the right edge of the range: a centred popover
      // would overflow here — which is what gives the bounds check below
      // something to measure. (A position: fixed element does NOT grow the
      // page's scrollWidth, so the scroll check alone would be blind to it.)
      const box = await boxOf(page, "g");
      const x = box.x + box.width / 2;
      const y = box.y + box.height / 2;
      if (expected.touch) {
        await tapAt(page, x, y, true);
      } else {
        // With a mouse, hover opens it — no click.
        await page.mouse.move(x, y);
      }
      const detail = page.locator(`[data-tl-detail="${expected.surface}"]`);
      await expect(detail).toBeVisible();
      await expect(detail).toHaveAttribute("data-tl-item", "g");
      await expect(detail).toHaveAttribute("data-tl-trigger", expected.touch || expected.surface === "sheet" ? "tap" : "hover");
      await expect(detail).toContainText("Wrap-up");
      const placed = await detail.boundingBox();
      expect(placed).not.toBeNull();
      if (placed !== null) {
        expect(placed.x).toBeGreaterThanOrEqual(0);
        expect(placed.x + placed.width).toBeLessThanOrEqual(expected.width);
        if (expected.surface === "sheet") {
          // Bottom sheet: the full width, stuck to the bottom of the screen.
          expect(placed.x).toBe(0);
          expect(Math.round(placed.width)).toBe(expected.width);
          expect(Math.round(placed.y + placed.height)).toBe(expected.height);
        } else {
          // Centring would push it out: the bound held it in.
          expect(box.x + box.width / 2 + placed.width / 2).toBeGreaterThan(expected.width);
          expect(placed.x + placed.width).toBeLessThanOrEqual(expected.width - 8);
          // Popover: next to the item, not in the middle of the screen.
          const gap = Math.min(Math.abs(placed.y - (box.y + box.height)), Math.abs(box.y - (placed.y + placed.height)));
          expect(gap).toBeLessThanOrEqual(12);
        }
      }
      await noHorizontalScroll(page);
    });
  });
}

test.describe("375 px, by finger", () => {
  test.use({ viewport: { width: 375, height: 667 }, hasTouch: true, isMobile: true });

  test("375 px: the bottom sheet closes with its own button", async ({ page }) => {
    await open(page);
    const box = await boxOf(page, "c");
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    const sheet = page.locator('[data-tl-detail="sheet"]');
    await expect(sheet).toBeVisible();
    await sheet.getByRole("button", { name: "Dismiss" }).tap();
    await expect(sheet).toHaveCount(0);
    expect((await stateOf(page)).detail).toBeNull();
  });

  test("375 px: by finger even the 2 px moment can be hit from 11.5 px beside it — by mouse at the same spot it cannot", async ({
    page,
  }) => {
    await open(page);
    const box = await boxOf(page, "moment");
    // Vertically, the moment is a 2 px tall stroke in its column. 11.5 px
    // below it: the dense minimum (a 24 px target, 11 per side) no longer
    // reaches it, only the finger's 12 px allowance does — so this measures
    // the finger, not dense.
    expect(Math.round(box.height)).toBe(2);
    const x = box.x + box.width / 2;
    const y = box.y + box.height + 11.5;
    await page.touchscreen.tap(x, y);
    const sheet = page.locator('[data-tl-detail="sheet"]');
    await expect(sheet).toBeVisible();
    await expect(sheet).toHaveAttribute("data-tl-item", "moment");
    // The tap really landed where we aimed, not rounded closer.
    const tap = await page.evaluate(
      () => (window as unknown as { tl: { lastTap: { main: number; pointerType: string } } }).tl.lastTap,
    );
    expect(tap.pointerType).toBe("touch");
    const frameTop = await page.evaluate(
      () => document.querySelector("#frame")?.getBoundingClientRect().top ?? 0,
    );
    expect(tap.main - (box.y - frameTop + box.height)).toBeGreaterThan(11);
    await sheet.getByRole("button", { name: "Dismiss" }).tap();
    await expect(sheet).toHaveCount(0);
    // The same point with a mouse: neither its 4 px nor dense's 11 px reach it.
    //
    // First the double-tap window (320 ms) has to pass. Without that the
    // machine takes the finger tap and the mouse click as a DOUBLE TAP and
    // zooms — lastTap does not record the pointer type. This is a real bug
    // of the gesture machine on hybrid devices, and this test found it;
    // fixing it was out of scope here.
    await page.waitForTimeout(400);
    await page.mouse.click(x, y);
    await expect(page.locator("[data-tl-detail]")).toHaveCount(0);
    const click = await page.evaluate(
      () => (window as unknown as { tl: { lastTap: { pointerType: string } } }).tl.lastTap,
    );
    expect(click.pointerType).toBe("mouse");
  });

  test("375 px: an explicit orientation overrides the measurement, and the page still does not scroll sideways", async ({
    page,
  }) => {
    await open(page, "?orientation=horizontal");
    const state = await stateOf(page);
    expect(state.orientation).toBe("horizontal");
    await expect(page.getByTestId("timeline")).toHaveAttribute("data-tl-orientation", "horizontal");
    await noHorizontalScroll(page);
  });
});

test.describe("live resizing, with a mouse", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("live resizing: 1440 → 375 → 768 → 1440 switches without a reload (ResizeObserver)", async ({
    page,
  }) => {
    await open(page);
    await page.evaluate(() => {
      (window as unknown as { loadMarker: string }).loadMarker = "same-page";
    });
    const steps: readonly [number, string, string][] = [
      [375, "vertical", "dense"],
      [768, "horizontal", "compact"],
      [1440, "horizontal", "comfortable"],
    ];
    for (const [width, orientation, density] of steps) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForFunction(
        ([w, o, d]) => {
          const tl = (window as unknown as { tl: { width: number; orientation: string; density: string } }).tl;
          return tl.width === w && tl.orientation === o && tl.density === d;
        },
        [width, orientation, density] as const,
      );
      await expect(page.getByTestId("timeline")).toHaveAttribute("data-tl-orientation", orientation);
      await expect(page.getByTestId("timeline")).toHaveAttribute("data-tl-density", density);
      await noHorizontalScroll(page);
    }
    expect(await page.evaluate(() => (window as unknown as { loadMarker?: string }).loadMarker)).toBe(
      "same-page",
    );
  });

  test("hysteresis: at 630 px it stays horizontal, at 610 it turns vertical, and back only at 640", async ({
    page,
  }) => {
    await open(page);
    const settle = async (width: number) => {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForFunction((w) => (window as unknown as { tl: { width: number } }).tl.width === w, width);
      return (await stateOf(page)).orientation;
    };
    expect(await settle(630)).toBe("horizontal");
    expect(await settle(610)).toBe("vertical");
    expect(await settle(630)).toBe("vertical");
    expect(await settle(640)).toBe("horizontal");
    const changes = (await stateOf(page)).changes.map((change) => change.split(":")[1]);
    // Exactly two switches after the initial one — no flickering back and forth.
    expect(changes.filter((value, index) => index === 0 || value !== changes[index - 1])).toEqual([
      "horizontal",
      "vertical",
      "horizontal",
    ]);
  });

  test("1440 px: the mouse leaves the item, and the popover closes", async ({ page }) => {
    await open(page);
    const box = await boxOf(page, "d");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    const popover = page.locator('[data-tl-detail="popover"]');
    await expect(popover).toBeVisible();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height + 60);
    await expect(popover).toHaveCount(0);
  });
});

/**
 * Reflow (WCAG 1.4.10) and page zoom (1.4.4) on the ELEMENT — what a host
 * installs, with its own decision about orientation and density, its own
 * canvas measurement of the labels, and the lane scroll across that the
 * keyboard drives. The page above decides with the core's functions; this
 * one decides nothing (public/a11y.html).
 */
const ELEMENT_IDS = ["a", "b", "c", "d", "e", "f", "g", "moment"];
/** By start: the order the keyboard walks them in. */
const ELEMENT_ORDER = ["a", "b", "c", "d", "e", "moment", "f", "g"];

async function openElement(page: Page, query = ""): Promise<void> {
  await page.goto(`/a11y.html${query}`);
  await page.waitForFunction(() => (window as unknown as { tl?: { ready: boolean } }).tl?.ready === true);
}

/** Every item is an option whose name begins with its WHOLE label, however the drawing shortens it. */
async function namesAreWhole(page: Page): Promise<void> {
  const names = await page.evaluate(() => {
    const labels = (window as unknown as { tl: { labels: Record<string, string> } }).tl.labels;
    return Object.entries(labels).map(([id, label]) => ({
      id,
      label,
      name: document.querySelector(`svg.tl [role="option"][data-tl-id="${id}"]`)?.getAttribute("aria-label") ?? null,
    }));
  });
  expect(names.map((entry) => entry.id).sort()).toEqual([...ELEMENT_IDS].sort());
  for (const entry of names) {
    expect(entry.name, entry.id).not.toBeNull();
    expect(entry.name?.startsWith(`${entry.label}, `), `${entry.id}: ${String(entry.name)}`).toBe(true);
  }
}

/** The item the keyboard is on: the root's aria-activedescendant, read back to its id. */
async function activeItem(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const ref = document.querySelector("svg.tl")?.getAttribute("aria-activedescendant");
    return ref ? (document.getElementById(ref)?.getAttribute("data-tl-id") ?? null) : null;
  });
}

/**
 * Home, then `next` until the last item: every item the keys reach, and
 * how far each one stuck out of the drawing once the view had settled on
 * it (0 when it is wholly in view).
 */
async function walk(page: Page, next: string): Promise<{ readonly reached: string[]; readonly outside: Record<string, number> }> {
  await page.locator("svg.tl").focus();
  await page.keyboard.press("Home");
  const reached: string[] = [];
  const outside: Record<string, number> = {};
  for (const [index, id] of ELEMENT_ORDER.entries()) {
    if (index > 0) {
      await page.keyboard.press(next);
    }
    await expect.poll(() => activeItem(page)).toBe(id);
    reached.push(id);
    // With reduced motion the view arrives in one frame; two frames later it is drawn.
    await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
    outside[id] = await page.evaluate((itemId) => {
      const view = document.querySelector("svg.tl")?.getBoundingClientRect();
      const box = document.querySelector(`svg.tl [data-tl-id="${itemId}"]`)?.getBoundingClientRect();
      if (view === undefined || box === undefined) return Number.POSITIVE_INFINITY;
      return Math.max(0, view.left - box.left, box.right - view.right, view.top - box.top, box.bottom - view.bottom);
    }, id);
  }
  // The numbers, for the record (the JSON report keeps them).
  test.info().annotations.push({ type: "outside the view, px", description: JSON.stringify(outside) });
  return { reached, outside };
}

test.describe("320 px, a 1280-pixel window at 400% (WCAG 1.4.10)", () => {
  test.use({ viewport: { width: 320, height: 640 }, reducedMotion: "reduce" });

  test("320 px reflow: the element turns vertical and dense, the page does not scroll sideways, every item keeps its whole name, and the keys bring each one into view", async ({
    page,
  }) => {
    await openElement(page);
    const svg = page.locator("svg.tl");
    await expect(svg).toHaveAttribute("data-tl-orientation", "vertical");
    await expect(svg).toHaveAttribute("data-tl-density", "dense");
    await noHorizontalScroll(page);
    await namesAreWhole(page);
    // Vertically, the next in time is the arrow down. The two lanes across
    // are 336 px in the dense layout, 16 more than the view: an item in the
    // second lane is brought into view by scrolling the lanes, not the page.
    const { reached, outside } = await walk(page, "ArrowDown");
    expect(reached).toEqual(ELEMENT_ORDER);
    for (const id of ELEMENT_ORDER) {
      expect(outside[id], `${id} sticks out of the view by ${String(outside[id])} px`).toBeLessThanOrEqual(1);
    }
    await noHorizontalScroll(page);
  });

  test("320 px: the bottom sheet never hides the focused item entirely (WCAG 2.4.11)", async ({ page }) => {
    await open(page);
    const svg = page.getByTestId("timeline");
    await svg.focus();
    await page.keyboard.press("Home");
    const seen = new Set<string>();
    for (let step = 0; step < 8; step += 1) {
      await page.keyboard.press("Enter");
      const sheet = page.locator('[data-tl-detail="sheet"]');
      await expect(sheet).toBeVisible();
      const focused = await page.evaluate(() => (window as unknown as { tl: { focusedId: string | null } }).tl.focusedId ?? "");
      seen.add(focused);
      await expect(sheet).toHaveAttribute("data-tl-item", focused);
      const shown = await page.evaluate(() => {
        const ring = document.querySelector(".tl-focus-ring")?.getBoundingClientRect();
        const cover = document.querySelector('[data-tl-detail="sheet"]')?.getBoundingClientRect();
        if (ring === undefined || cover === undefined) return 0;
        const clip = (a0: number, a1: number, b0: number, b1: number) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
        const inView = clip(ring.left, ring.right, 0, innerWidth) * clip(ring.top, ring.bottom, 0, innerHeight);
        const covered = clip(ring.left, ring.right, cover.left, cover.right) * clip(ring.top, ring.bottom, cover.top, cover.bottom);
        return inView - covered;
      });
      expect(shown, `the focused ${focused} is hidden`).toBeGreaterThan(0);
      test.info().annotations.push({ type: "focus ring in view and not under the sheet, px²", description: `${focused}: ${String(Math.round(shown))}` });
      // The sheet does not take the focus: the next arrow still moves on the timeline.
      await expect(svg).toBeFocused();
      await page.keyboard.press("ArrowDown");
    }
    expect([...seen].sort()).toEqual([...ELEMENT_IDS].sort());
  });
});

test.describe("256 px tall, a wide window at 400% (WCAG 1.4.10)", () => {
  test.use({ viewport: { width: 1280, height: 256 }, reducedMotion: "reduce" });

  test("256 px tall reflow: horizontal, the whole timeline within the height, so it scrolls in one direction only, and the keys reach every item in view", async ({
    page,
  }) => {
    // The timeline's height is the host's: one that fits a 256-pixel window under the page's heading.
    await openElement(page, "?height=200");
    const svg = page.locator("svg.tl");
    await expect(svg).toHaveAttribute("data-tl-orientation", "horizontal");
    await noHorizontalScroll(page);
    const fit = await page.evaluate(() => {
      const view = document.querySelector("svg.tl")?.getBoundingClientRect();
      const lanes = [...document.querySelectorAll("svg.tl .tl-lane")].map((lane) => lane.getBoundingClientRect().bottom);
      return { bottom: view?.bottom ?? Number.POSITIVE_INFINITY, lanes: Math.max(...lanes), scroll: document.documentElement.scrollHeight };
    });
    // Nothing to scroll vertically: not the page, and not the lanes inside the timeline.
    expect(fit.bottom).toBeLessThanOrEqual(256);
    expect(fit.scroll).toBeLessThanOrEqual(256);
    expect(fit.lanes).toBeLessThanOrEqual(fit.bottom);
    await namesAreWhole(page);
    const { reached, outside } = await walk(page, "ArrowRight");
    expect(reached).toEqual(ELEMENT_ORDER);
    for (const id of ELEMENT_ORDER) {
      expect(outside[id], `${id} sticks out of the view by ${String(outside[id])} px`).toBeLessThanOrEqual(1);
    }
  });
});

test.describe("page zoom 200% (WCAG 1.4.4)", () => {
  // A 1280 × 800 window at 200% zoom: 640 × 400 CSS pixels, two device pixels to each.
  test.use({ viewport: { width: 640, height: 400 }, deviceScaleFactor: 2, reducedMotion: "reduce" });

  test("page zoom 200%: a 1280 × 800 window at 200% is 640 × 400 CSS pixels — the element lays out again, horizontal, and loses no item, name or key", async ({
    page,
  }) => {
    await openElement(page, "?height=300");
    expect(await page.evaluate(() => devicePixelRatio)).toBe(2);
    await expect(page.locator("svg.tl")).toHaveAttribute("data-tl-orientation", "horizontal");
    await noHorizontalScroll(page);
    await namesAreWhole(page);
    const { reached, outside } = await walk(page, "ArrowRight");
    expect(reached).toEqual(ELEMENT_ORDER);
    for (const id of ELEMENT_ORDER) {
      expect(outside[id], `${id} sticks out of the view by ${String(outside[id])} px`).toBeLessThanOrEqual(1);
    }
  });
});
