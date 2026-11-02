import { expect, test } from "@playwright/test";
import type { CDPSession, Page } from "@playwright/test";

/**
 * The browser suite: real tap, drag and pinch, with device emulation.
 *
 * What the core's tests prove: the gesture state machine computes correctly.
 * What can ONLY be proved here: that the browser agrees. Three claims belong
 * here, and none of them can be measured without a DOM:
 *
 *  1. `touch-action` really stops page scrolling during a drag;
 *  2. in `cooperative` mode the page really scrolls, AND the browser takes
 *     the gesture away — that is, a real `pointercancel` arrives, not a
 *     simulated one;
 *  3. two touch points really zoom, under fingers given in CSS pixels.
 *
 * The two touch points go through the browser's own touch input: the
 * Playwright `touchscreen` API can do one point, and a pinch needs two. In
 * Chromium this is CDP's `Input.dispatchTouchEvent`; in WebKit it is the
 * protocol of Playwright's WebKit build, which has a command of the same
 * name, but the public API does not expose it — see `fingersFor`. Both give
 * real Pointer Events produced by the browser (`isTrusted`), not events
 * injected into the page.
 */

interface TouchPoint {
  readonly x: number;
  readonly y: number;
  readonly id: number;
}

interface TimelineState {
  readonly start: string;
  readonly end: string;
  readonly spanDays: number;
  readonly crossOffset: number;
  readonly gestures: readonly string[];
  readonly edits: readonly string[];
  readonly selectedIds: readonly string[];
  readonly undoDepth: number;
  /** Per item, the start, in days from the project's start. */
  readonly days: Record<string, number>;
  readonly lanesOf: Record<string, string>;
  readonly visible: number;
}

interface Point {
  readonly x: number;
  readonly y: number;
}

const MIDDLE_Y = 130;

type TouchType = "touchStart" | "touchMove" | "touchEnd";

/** The browser's touch input: one or more fingers, with real events. */
interface Fingers {
  send(type: TouchType, points: readonly TouchPoint[]): Promise<void>;
  detach(): Promise<void>;
}

/** Playwright's WebKit-side session — the public API does not expose it. */
interface WebKitSession {
  send(method: "Input.dispatchTouchEvent", params: { type: TouchType; touchPoints: { x: number; y: number; id: number }[] }): Promise<unknown>;
}

/**
 * In Chromium, CDP. In WebKit, the `Input.dispatchTouchEvent` command of
 * Playwright's own WebKit build (in its protocol.json), which Playwright
 * itself uses only for taps: the in-process Playwright's `toImpl` gives the
 * server-side page, and its session. Two differences from CDP, both
 * absorbed here: the coordinate is an integer (the WebKit protocol expects
 * an `integer`), and `touchEnd` lists the fingers being lifted (given an
 * empty list, WebKit lifts nothing). WebKit delivers asynchronously after
 * the command, so `send` waits a frame: the page processes it before the
 * next read.
 */
async function fingersFor(page: Page): Promise<Fingers> {
  if (page.context().browser()?.browserType().name() !== "webkit") {
    const cdp: CDPSession = await page.context().newCDPSession(page);
    return {
      send: async (type, points) => {
        await cdp.send("Input.dispatchTouchEvent", {
          type,
          touchPoints: points.map((point) => ({ x: point.x, y: point.y, id: point.id })),
        });
      },
      detach: () => cdp.detach(),
    };
  }
  const internal = page as unknown as { _connection: { toImpl?: (object: unknown) => { delegate: { _pageProxySession: WebKitSession } } } };
  const toImpl = internal._connection.toImpl;
  if (toImpl === undefined) throw new Error("Playwright is not running in-process: WebKit's touch input is not reachable");
  const session = toImpl(page).delegate._pageProxySession;
  let down: readonly TouchPoint[] = [];
  return {
    send: async (type, points) => {
      const touchPoints = (type === "touchEnd" && points.length === 0 ? down : points).map((point) => ({
        x: Math.round(point.x),
        y: Math.round(point.y),
        id: point.id,
      }));
      down = type === "touchEnd" ? [] : points;
      await session.send("Input.dispatchTouchEvent", { type, touchPoints });
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve(null))));
    },
    detach: async () => {},
  };
}

async function touch(fingers: Fingers, type: TouchType, points: readonly TouchPoint[]): Promise<void> {
  await fingers.send(type, points);
}

async function stateOf(page: Page): Promise<TimelineState> {
  const text = await page.locator("#state").textContent();
  return JSON.parse(text ?? "{}") as TimelineState;
}

/** One finger's drag, in several steps — a single step is not a gesture but a jump. */
async function drag(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
  steps = 6,
): Promise<void> {
  const fingers = await fingersFor(page);
  await touch(fingers, "touchStart", [{ ...from, id: 1 }]);
  for (let step = 1; step <= steps; step += 1) {
    await touch(fingers, "touchMove", [
      {
        x: from.x + ((to.x - from.x) * step) / steps,
        y: from.y + ((to.y - from.y) * step) / steps,
        id: 1,
      },
    ]);
  }
  await touch(fingers, "touchEnd", []);
  await fingers.detach();
}

/** Where an item is on screen. The page computes it itself: the truth lives in one place. */
async function boxOf(page: Page, id: string, fraction = 0.5): Promise<Point> {
  const point = await page.evaluate(
    ([itemId, at]) => window.tl.boxOf(itemId, at),
    [id, fraction] as const,
  );
  expect(point, `no box: ${id}`).toBeTruthy();
  return point as Point;
}

async function handleOf(page: Page, id: string): Promise<Point> {
  const point = await page.evaluate((itemId) => window.tl.handleOf(itemId), id);
  expect(point, `no handle: ${id}`).toBeTruthy();
  return point as Point;
}

/**
 * Hold, then drag — with one finger.
 *
 * NOTHING moves during the hold: a single `touchMove` calls off the long
 * press, and then we would be measuring a pan. The wait here is a real
 * clock, because that is exactly what it proves: that the browser binding's
 * timer really fires — the core being clock-free is measured on the core,
 * not here.
 */
async function holdThenDrag(
  page: Page,
  from: Point,
  to: Point,
  options: { readonly holdMs?: number; readonly steps?: number } = {},
): Promise<void> {
  const steps = options.steps ?? 6;
  const fingers = await fingersFor(page);
  await touch(fingers, "touchStart", [{ ...from, id: 1 }]);
  await page.waitForTimeout(options.holdMs ?? 700);
  for (let step = 1; step <= steps; step += 1) {
    await touch(fingers, "touchMove", [
      {
        x: from.x + ((to.x - from.x) * step) / steps,
        y: from.y + ((to.y - from.y) * step) / steps,
        id: 1,
      },
    ]);
  }
  await touch(fingers, "touchEnd", []);
  await fingers.detach();
}

/**
 * Opens the demo page, and PROVES that it really is that page.
 *
 * Why `page.goto` is not enough. On 2026-10-26 another project's server sat
 * on the port, and Playwright's `reuseExistingServer: true` took it for its
 * own. The suite's 15 tests ran on a foreign page, all failed, and the
 * failures said not a word about the page underneath not being ours. The
 * config has not accepted a foreign server since — this is the second lock:
 * `window.tl` is our demo's signature, and if it is missing, the error
 * message says where to look.
 */
async function openDemo(page: Page, query = ""): Promise<void> {
  await page.goto(`/index.html${query}`);
  const mine = await page
    .waitForFunction(() => "tl" in window, undefined, { timeout: 5_000 })
    .then(() => true)
    .catch(() => false);
  if (!mine) {
    throw new Error(
      `${page.url()} is not the SDK demo page: it has no window.tl. ` +
        "Something else is probably on the port — fix the server, not the tests.",
    );
  }
  await expect(page.getByTestId("timeline")).toBeVisible();
}

test.describe("real touch on an emulated phone", () => {
  test.beforeEach(async ({ page }) => {
    await openDemo(page);
  });

  test("a one-finger drag pans, and the zoom stays unchanged", async ({ page }) => {
    const before = await stateOf(page);
    await drag(page, { x: 320, y: MIDDLE_Y }, { x: 90, y: MIDDLE_Y });
    const after = await stateOf(page);
    // Right to left: the content moves left, so the window moves forward in time.
    expect(new Date(after.start).getTime()).toBeGreaterThan(new Date(before.start).getTime());
    expect(after.spanDays).toBeCloseTo(before.spanDays, 3);
    expect(after.gestures).toContain("gestureStart:pan");
    expect(after.gestures).toContain("gestureEnd:pan");
  });

  test("the page does NOT scroll during the drag — touch-action really takes effect", async ({ page }) => {
    // This test is the reason the whole browser suite exists: of the generated
    // stylesheet, the core's test can only know that the text is in it.
    expect(
      await page.evaluate(() => {
        const svg = document.querySelector("#frame svg");
        return svg === null ? "" : getComputedStyle(svg).touchAction;
      }),
    ).toBe("none");
    await drag(page, { x: 200, y: MIDDLE_Y }, { x: 200, y: MIDDLE_Y - 90 });
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    const after = await stateOf(page);
    expect(after.gestures).toContain("gestureStart:pan");
    // A downward drag moves neither time nor the lanes: there is nothing to scroll.
    expect(after.crossOffset).toBe(0);
  });

  test("in cooperative mode the page scrolls, and the browser TAKES the gesture", async ({ page }) => {
    await openDemo(page, "?touchAction=cooperative");
    expect(
      await page.evaluate(() => {
        const svg = document.querySelector("#frame svg");
        return svg === null ? "" : getComputedStyle(svg).touchAction;
      }),
    ).toBe("pan-y");
    await drag(page, { x: 200, y: MIDDLE_Y }, { x: 200, y: MIDDLE_Y - 140 }, 10);
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    // And here comes the real pointercancel: the browser has taken over the
    // gesture, and the library has to let go. A synthetic event cannot prove
    // this, only assert it.
    const after = await stateOf(page);
    expect(after.gestures.some((entry) => entry.endsWith(":cancelled"))).toBe(true);
  });

  test("two fingers pinch, and the starting instants stay under the fingers", async ({ page }) => {
    const before = await stateOf(page);
    const fingers = await fingersFor(page);
    const left = 120;
    const right = 280;
    await touch(fingers, "touchStart", [
      { x: left, y: MIDDLE_Y, id: 1 },
      { x: right, y: MIDDLE_Y, id: 2 },
    ]);
    const anchors = await page.evaluate(
      ([a, b]) => {
        const timeline = window.tl;
        const span = timeline.domain[1] - timeline.domain[0];
        const width = document.querySelector("#frame").clientWidth;
        return [timeline.domain[0] + (a / width) * span, timeline.domain[0] + (b / width) * span];
      },
      [left, right],
    );
    for (let step = 1; step <= 6; step += 1) {
      await touch(fingers, "touchMove", [
        { x: left - 10 * step, y: MIDDLE_Y, id: 1 },
        { x: right + 10 * step, y: MIDDLE_Y, id: 2 },
      ]);
    }
    const movedLeft = left - 60;
    const movedRight = right + 60;
    // The browser is asynchronous: the last pointermove has to be WAITED for,
    // not assumed. The `poll` is not a loosening — if the expected state never
    // arrives, the test fails; we just don't race the event queue.
    const expectedSpan = (before.spanDays * (right - left)) / (movedRight - movedLeft);
    await expect
      .poll(async () => (await stateOf(page)).spanDays, { timeout: 3000 })
      .toBeCloseTo(expectedSpan, 2);
    const after = await stateOf(page);
    // Spreading: the visible span narrows in proportion.
    expect(after.spanDays).toBeLessThan(before.spanDays);
    // The anchor: the instants under the fingers did not move.
    const errors = await page.evaluate(
      ([anchorA, anchorB, mainA, mainB]) => {
        const timeline = window.tl;
        const width = document.querySelector("#frame").clientWidth;
        const span = timeline.domain[1] - timeline.domain[0];
        const toMain = (time) => ((time - timeline.domain[0]) / span) * width;
        return [Math.abs(toMain(anchorA) - mainA), Math.abs(toMain(anchorB) - mainB)];
      },
      [anchors[0], anchors[1], movedLeft, movedRight],
    );
    // One CSS pixel: in the browser the coordinates round to pixels too.
    expect(Math.max(...errors)).toBeLessThan(1);
    await touch(fingers, "touchEnd", []);
    await fingers.detach();
    expect((await stateOf(page)).gestures).toContain("gestureStart:pinch");
  });

  test("a double tap zooms in on the tapped point", async ({ page }) => {
    const before = await stateOf(page);
    await page.touchscreen.tap(200, MIDDLE_Y);
    await page.touchscreen.tap(200, MIDDLE_Y);
    const after = await stateOf(page);
    expect(after.spanDays).toBeCloseTo(before.spanDays / 2, 3);
    expect(after.gestures).toContain("tap:1x2");
  });

  test("a two-finger tap zooms out", async ({ page }) => {
    const before = await stateOf(page);
    const fingers = await fingersFor(page);
    await touch(fingers, "touchStart", [
      { x: 140, y: MIDDLE_Y, id: 1 },
      { x: 260, y: MIDDLE_Y, id: 2 },
    ]);
    await touch(fingers, "touchEnd", []);
    await fingers.detach();
    const after = await stateOf(page);
    expect(after.spanDays).toBeCloseTo(before.spanDays * 2, 3);
    expect(after.gestures).toContain("tap:2x1");
  });

  test("the running gesture shows on the element, and afterwards does not", async ({ page }) => {
    const fingers = await fingersFor(page);
    await touch(fingers, "touchStart", [{ x: 300, y: MIDDLE_Y, id: 1 }]);
    await touch(fingers, "touchMove", [{ x: 200, y: MIDDLE_Y, id: 1 }]);
    // On the container, because the binding is attached there — the SVG is new every frame.
    await expect(page.locator("#frame")).toHaveAttribute("data-tl-gesture", "pan");
    await touch(fingers, "touchEnd", []);
    await fingers.detach();
    await expect(page.locator("#frame")).not.toHaveAttribute("data-tl-gesture", "pan");
  });
});

/**
 * Editing in the browser.
 *
 * What the core's tests prove: the machine decides correctly when a drag
 * starts. What can ONLY be proved here: that the browser binding's single
 * timer really fires, that `touch-action` holds the page during an edit as
 * well, and that on the same page, in the same session, the mouse drags at
 * once while the finger waits for a hold. The last is the hybrid device's
 * claim — an emulated phone has a mouse too, and the question is precisely
 * that the two do not blur into each other.
 */
test.describe("editing with real touch", () => {
  test.beforeEach(async ({ page }) => {
    await openDemo(page);
  });

  test("after a long press the finger DRAGS the item, and the page does not scroll", async ({ page }) => {
    const before = await stateOf(page);
    const from = await boxOf(page, "d");
    await holdThenDrag(page, from, { x: from.x + 70, y: from.y });
    const after = await stateOf(page);
    // The item moved...
    expect(after.days.d).toBeGreaterThan(before.days.d);
    // ...the view did NOT: an edit is not a pan.
    expect(after.start).toBe(before.start);
    expect(after.gestures).toEqual([]);
    expect(after.edits).toContain("editStart:move:long-press");
    expect(after.edits).toContain("editEnd:move");
    expect(after.undoDepth).toBe(1);
    // The page did not scroll during the drag either.
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
  });

  test("the same drag WITHOUT a hold pans, it does not edit", async ({ page }) => {
    const before = await stateOf(page);
    const from = await boxOf(page, "d");
    await drag(page, from, { x: from.x + 70, y: from.y });
    const after = await stateOf(page);
    expect(after.days.d).toBe(before.days.d);
    expect(after.edits).toEqual([]);
    expect(after.gestures).toContain("gestureStart:pan");
  });

  test("the mouse on the same page drags at once, without a hold", async ({ page }) => {
    const before = await stateOf(page);
    const from = await boxOf(page, "d");
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    for (let step = 1; step <= 6; step += 1) {
      await page.mouse.move(from.x + (70 * step) / 6, from.y);
    }
    // The running edit shows on the element — a drag that does not change
    // the cursor reads as a frozen page.
    await expect(page.locator("#frame")).toHaveAttribute("data-tl-edit", "move");
    await page.mouse.up();
    await expect(page.locator("#frame")).not.toHaveAttribute("data-tl-edit", "move");
    const after = await stateOf(page);
    expect(after.days.d).toBeGreaterThan(before.days.d);
    expect(after.edits).toContain("editStart:move:pointer");
  });

  test("the handle resizes at once by finger too, without a hold", async ({ page }) => {
    const before = await stateOf(page);
    const handle = await handleOf(page, "d");
    await drag(page, handle, { x: handle.x + 40, y: handle.y });
    const after = await stateOf(page);
    // Aiming at the handle is intent in itself: it needs no ceremony.
    expect(after.edits).toContain("editStart:resize-end:handle");
    expect(after.edits).toContain("editEnd:resize-end");
    // The start did not move: the far edge stays where it was.
    expect(after.days.d).toBe(before.days.d);
    expect(after.undoDepth).toBe(1);
  });

  test("the host's rule stops the drag, and no command is created", async ({ page }) => {
    const before = await stateOf(page);
    const from = await boxOf(page, "a");
    // "a" starts when the project starts; the rule forbids dragging it left.
    await holdThenDrag(page, from, { x: from.x - 60, y: from.y });
    const after = await stateOf(page);
    expect(after.days.a).toBe(before.days.a);
    expect(after.edits).toContain("vetoed");
    expect(after.undoDepth).toBe(0);
  });

  test("the locked item does not move, the view pans instead", async ({ page }) => {
    const before = await stateOf(page);
    const from = await boxOf(page, "e");
    await holdThenDrag(page, from, { x: from.x - 60, y: from.y });
    const after = await stateOf(page);
    expect(after.days.e).toBe(before.days.e);
    expect(after.edits).toEqual([]);
    // There is nothing to grab, so the gesture does what it otherwise does: it pans.
    expect(after.gestures).toContain("gestureStart:pan");
  });

  test("undo restores the starting state EXACTLY", async ({ page }) => {
    const before = await stateOf(page);
    const from = await boxOf(page, "d");
    // Two steps, two on the stack — an undo stack unwinds LIFO.
    await holdThenDrag(page, from, { x: from.x + 40, y: from.y });
    const handle = await handleOf(page, "d");
    await drag(page, handle, { x: handle.x + 30, y: handle.y });
    const edited = await stateOf(page);
    expect(edited.undoDepth).toBe(2);
    expect(edited.days.d).not.toBe(before.days.d);

    await page.getByRole("button", { name: "Undo" }).click();
    await page.getByRole("button", { name: "Undo" }).click();
    const undone = await stateOf(page);
    expect(undone.undoDepth).toBe(0);
    expect(undone.days).toEqual(before.days);
    expect(undone.lanesOf).toEqual(before.lanesOf);
    await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled();
  });

  test("a tap selects, and the selected items move as ONE command", async ({ page }) => {
    await page.getByRole("checkbox").check();
    const first = await boxOf(page, "a");
    await page.touchscreen.tap(first.x, first.y);
    const second = await boxOf(page, "b");
    await page.touchscreen.tap(second.x, second.y);
    const selected = await stateOf(page);
    expect(selected.selectedIds).toEqual(["a", "b"]);

    const from = await boxOf(page, "b");
    await holdThenDrag(page, from, { x: from.x + 40, y: from.y });
    const after = await stateOf(page);
    // Both moved by the same amount, and it became a single command.
    expect(after.days.a - selected.days.a).toBe(after.days.b - selected.days.b);
    expect(after.days.b).toBeGreaterThan(selected.days.b);
    expect(after.undoDepth).toBe(1);
  });
});
