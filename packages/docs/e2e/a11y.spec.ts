import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";
import type { Frame, Page, TestInfo } from "@playwright/test";

/**
 * The axe check: the pages' accessibility in a real browser, and the keyboard path.
 *
 * It measures two things, because each catches a different kind of bug:
 *
 *  1. **axe-core, with the WCAG 2.2 AA tags**, in every state of the pages
 *     a user can bring about: initial, vertical, an item focused,
 *     selection, multiple selection, the date prompt, dark scheme, after an
 *     edit, the responsive page with its popover and bottom sheet. A state
 *     axe has not seen is not measured: focus and the dialog are exactly the
 *     states where ARIA bugs live.
 *  2. **The keyboard path** — Tab onto the timeline, arrows, Enter, Alt+arrow,
 *     g and the date, Esc — with real key events, and with reduced-motion
 *     emulated: the view change arrives in one frame, without it in several.
 *
 * Every axe run's result goes to `.axe-results.json`, and
 * `sdk_check_a11y.mjs` judges from that — not from the test titles. The
 * NEGATIVE CONTROL runs with the same harness on a deliberately broken page:
 * if axe finds nothing there, the harness is blind, and then a zero means
 * nothing either.
 */

const require = createRequire(import.meta.url);
const AXE = require.resolve("axe-core/axe.min.js");
const here = dirname(fileURLToPath(import.meta.url));
const RESULTS = join(here, "..", ".axe-results.json");
const SITE_MANIFEST = join(here, "..", "dist", "site-manifest.json");
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

interface AxeSummary {
  readonly id: string;
  readonly impact: string | null;
  readonly nodes: readonly string[];
}

interface AxeRun {
  readonly version: string;
  readonly violations: readonly AxeSummary[];
  readonly passes: readonly string[];
  readonly incomplete: readonly AxeSummary[];
  readonly inapplicable: number;
  /**
   * Contrast axe could not decide, measured here instead. SVG text is left
   * to the token test in the core (`test/a11y/contrast.test.ts`): axe cannot
   * see an SVG background, and neither can a computed style. HTML text is
   * measured from computed colours, and has to reach 4.5:1.
   */
  readonly undecided: readonly { readonly target: string; readonly svg: boolean; readonly ratio: number | null }[];
}

test.beforeAll(() => {
  mkdirSync(dirname(RESULTS), { recursive: true });
});

/** Run axe on the page as it is now, and record the result for the gate. */
async function scan(page: Page | Frame, info: TestInfo, state: string, control = false): Promise<AxeRun> {
  if (!(await page.evaluate(() => "axe" in window))) {
    // A frame that requires Trusted Types (the Content Security Policy
    // guide's example) refuses a script element's text: there axe's source
    // is evaluated as it is, which no page policy governs.
    await page.addScriptTag({ path: AXE }).catch(async (error: unknown) => {
      if (!String(error).includes("TrustedScript")) throw error;
      await page.evaluate(readFileSync(AXE, "utf8"));
    });
  }
  const run = await page.evaluate(async (tags) => {
    const axe = (window as unknown as { axe: { run: (context: Document, options: unknown) => Promise<Record<string, unknown>>; version: string } }).axe;
    const result = (await axe.run(document, { runOnly: { type: "tag", values: tags }, resultTypes: ["violations", "incomplete"] })) as {
      violations: { id: string; impact: string | null; nodes: { target: string[] }[] }[];
      passes: { id: string }[];
      incomplete: { id: string; impact: string | null; nodes: { target: string[] }[] }[];
      inapplicable: unknown[];
    };
    const summary = (list: typeof result.violations) =>
      list.map((rule) => ({ id: rule.id, impact: rule.impact, nodes: rule.nodes.map((node) => node.target.join(" ")) }));
    const channel = (value: number): number => {
      const c = value / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    const rgba = (text: string): number[] => (text.match(/[\d.]+/g) ?? []).map(Number);
    const luminance = ([r = 0, g = 0, b = 0]: number[]): number => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
    const probe = document.createElement("span");
    probe.style.cssText = "forced-color-adjust:none;background-color:Canvas";
    document.body.append(probe);
    const canvas = rgba(getComputedStyle(probe).backgroundColor).slice(0, 3);
    probe.remove();
    const undecided = result.incomplete
      .filter((rule) => rule.id === "color-contrast")
      .flatMap((rule) => rule.nodes.map((node) => node.target.join(" ")))
      .map((target) => {
        const element = document.querySelector(target);
        // The drawing's text — SVG, or an item's label, a line of
        // HTML in a foreignObject — stands on SVG fills that no CSS
        // background on the way up shows; its pairs are the token contrast
        // test's (core: test/a11y/contrast.test.ts, labels inside an item
        // and after it included).
        // A node a live page dropped between axe's pass and this one (a log that
        // slides every second) is judged by its selector: a label in a
        // foreignObject is the token test's either way. Any other node that is
        // gone still fails below, with no ratio.
        const svg =
          element === null
            ? /(^|\s|>)(svg|foreignobject)\b/i.test(target)
            : element.namespaceURI === "http://www.w3.org/2000/svg" || element.closest("foreignObject") !== null;
        if (element === null || svg) {
          return { target, svg, ratio: null };
        }
        // The first opaque background up the tree; under them all, the
        // canvas — white, but the reader's own in forced colours, where a
        // dark palette's canvas is black.
        let background = canvas;
        for (let at: Element | null = element; at !== null; at = at.parentElement) {
          const colour = rgba(getComputedStyle(at).backgroundColor);
          if (colour.length === 3 || (colour[3] ?? 0) === 1) {
            background = colour.slice(0, 3);
            break;
          }
        }
        const foreground = rgba(getComputedStyle(element).color).slice(0, 3);
        const [light, dark] = [luminance(foreground), luminance(background)].sort((a, b) => b - a) as [number, number];
        return { target, svg, ratio: (light + 0.05) / (dark + 0.05) };
      });
    return {
      version: axe.version,
      violations: summary(result.violations),
      passes: result.passes.map((rule) => rule.id),
      incomplete: summary(result.incomplete),
      inapplicable: result.inapplicable.length,
      undecided,
    };
  }, TAGS);
  appendFileSync(
    RESULTS,
    `${JSON.stringify({ project: info.project.name, state, control, tags: TAGS, url: page.url(), ...run })}\n`,
  );
  return run;
}

async function clean(page: Page | Frame, info: TestInfo, state: string): Promise<void> {
  const run = await scan(page, info, state);
  expect(run.violations, JSON.stringify(run.violations, null, 1)).toEqual([]);
  // A scan that checked nothing proves nothing.
  expect(run.passes.length).toBeGreaterThan(10);
  // Whatever axe left undecided is decided here, or it is the token test's.
  expect(run.incomplete.filter((rule) => rule.id !== "color-contrast")).toEqual([]);
  for (const node of run.undecided) {
    if (!node.svg) {
      expect(node.ratio ?? 0, node.target).toBeGreaterThanOrEqual(4.5);
    }
  }
}

interface DemoState {
  readonly start: string;
  readonly spanDays: number;
  readonly selectedIds: readonly string[];
  readonly focusedId: string | null;
  readonly views: number;
  readonly transitionPending: boolean;
  readonly transitionFrames: number;
  readonly days: Record<string, number>;
  readonly edits: readonly string[];
}

async function stateOf(page: Page): Promise<DemoState> {
  return JSON.parse((await page.locator("#state").textContent()) ?? "{}") as DemoState;
}

async function openDemo(page: Page, query = ""): Promise<void> {
  await page.goto(`/index.html${query}`);
  await expect(page.getByTestId("timeline")).toBeVisible();
  await expect(page).toHaveTitle(/Temporeum Timeline/);
}

/** Tab from the top of the page onto the timeline. */
async function tabIn(page: Page): Promise<void> {
  await page.locator("body").focus();
  await page.keyboard.press("Tab");
  await expect(page.getByTestId("timeline")).toBeFocused();
}

test.describe("axe: WCAG 2.2 AA", () => {
  test("the demo in its initial state", async ({ page }, info) => {
    await openDemo(page);
    await clean(page, info, "index:initial");
  });

  test("the demo, vertical", async ({ page }, info) => {
    await openDemo(page, "?orientation=vertical&height=420");
    await clean(page, info, "index:vertical");
  });

  test("an item focused, selected, with multiple selection", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "keyboard: desktop project");
    await openDemo(page);
    await tabIn(page);
    await page.keyboard.press("ArrowRight");
    await expect.poll(async () => (await stateOf(page)).focusedId).toBe("a");
    await expect(page.getByTestId("timeline")).toHaveAttribute("aria-activedescendant", "demo-i-a");
    await clean(page, info, "index:focused");
    await page.keyboard.press("Enter");
    await expect.poll(async () => (await stateOf(page)).selectedIds).toEqual(["a"]);
    await clean(page, info, "index:selected");
    await page.locator("#multi").check();
    await page.getByTestId("timeline").focus();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press(" ");
    await expect(page.getByTestId("timeline")).toHaveAttribute("aria-multiselectable", "true");
    await clean(page, info, "index:multi");
  });

  test("the date prompt open", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "keyboard: desktop project");
    await openDemo(page);
    await tabIn(page);
    await page.keyboard.press("g");
    await expect(page.locator("#jump")).toBeVisible();
    await clean(page, info, "index:jump-dialog");
  });

  test("in the dark scheme, after an edit", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "keyboard: desktop project");
    await page.emulateMedia({ colorScheme: "dark" });
    await openDemo(page);
    await tabIn(page);
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Alt+ArrowRight");
    await expect.poll(async () => (await stateOf(page)).edits).toContain("editEnd:move");
    await clean(page, info, "index:dark-edited");
  });

  test("the responsive page, with its detail surface", async ({ page }, info) => {
    await page.goto("/responsive.html");
    await expect(page.getByTestId("timeline")).toBeVisible();
    await clean(page, info, "responsive:initial");
    await page.getByTestId("timeline").focus();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Enter");
    await expect(page.locator("[data-tl-detail]")).toBeVisible();
    await clean(page, info, `responsive:detail-${info.project.name === "desktop" ? "popover" : "sheet"}`);
  });

  // The async page's states: while loading (aria-busy, the mark on the axis)
  // and with a failed window. Not states the axe check requires, but whatever can
  // reach the user, axe should see too.
  test("the async page while loading", async ({ page }, info) => {
    await page.goto("/async.html?latency=1500");
    await expect(page.locator("#frame svg")).toHaveAttribute("aria-busy", "true");
    await clean(page, info, "async:loading");
  });

  test("the async page with failed windows", async ({ page }, info) => {
    await page.goto("/async.html?latency=50&fail=1");
    await expect(page.locator("#frame line.tl-loading--failed").first()).toBeAttached();
    await expect(page.locator("#retry")).toBeEnabled();
    await clean(page, info, "async:failed");
  });

  test("NEGATIVE CONTROL: on a broken page axe finds the faults", async ({ page }, info) => {
    await openDemo(page);
    // Two faults in the widget's own vocabulary, and one classic: an
    // activedescendant that points nowhere, an option outside any listbox,
    // and a button with no name. If the harness misses these, it is blind.
    await page.evaluate(() => {
      const svg = document.querySelector('[data-testid="timeline"]');
      svg?.setAttribute("aria-activedescendant", "no-such-item");
      const stray = document.createElement("div");
      stray.setAttribute("role", "option");
      stray.textContent = "orphan";
      document.body.append(stray);
      document.body.append(document.createElement("button"));
    });
    const run = await scan(page, info, "control:broken", true);
    const found = run.violations.map((violation) => violation.id);
    expect(found).toEqual(expect.arrayContaining(["aria-valid-attr-value", "aria-required-parent", "button-name"]));
  });
});

/**
 * The docs site: every page the builder wrote, as a reader gets it — with
 * its live examples run — and every example's own frame. The list is the
 * site's manifest, so a page cannot be added without being scanned; the
 * gate (sdk_check_a11y.mjs) requires a run for each, in both projects.
 */
test.describe("axe: the docs site", () => {
  const site = JSON.parse(readFileSync(SITE_MANIFEST, "utf8")) as {
    pages: { id: string; path: string }[];
    examples: { id: string; page: string }[];
  };
  for (const entry of site.pages) {
    test(`site: ${entry.id}`, async ({ page }, info) => {
      await page.goto(`/site/${entry.path}`);
      const examples = site.examples.filter((example) => example.page === entry.id);
      for (const example of examples) {
        const section = page.locator(`section#example-${example.id}`);
        // A cross-origin frame below the fold gets no animation frames: scroll to it, as a reader does.
        await section.locator("iframe").scrollIntoViewIfNeeded();
        await expect(section).toHaveAttribute("data-state", "ok", { timeout: 15_000 });
      }
      await page.evaluate(() => window.scrollTo(0, 0));
      await clean(page, info, `site:${entry.id}`);
      for (const example of examples) {
        const handle = await page.locator(`section#example-${example.id} iframe`).elementHandle();
        const frame = await handle?.contentFrame();
        expect(frame, `the frame of ${example.id}`).toBeTruthy();
        await handle?.scrollIntoViewIfNeeded();
        // In view, a frame gets animation frames again, and an example that
        // fills its overscan at rest draws for a few more. Scan the picture
        // it settles on, not one being replaced under axe.
        await (frame as Frame).evaluate(
          () =>
            new Promise<void>((done) => {
              let timer = setTimeout(finish, 500);
              const observer = new MutationObserver(() => {
                clearTimeout(timer);
                timer = setTimeout(finish, 500);
              });
              function finish(): void {
                observer.disconnect();
                done();
              }
              observer.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
            }),
        );
        await clean(frame as Frame, info, `site-example:${example.id}`);
      }
      // Reflow (1.4.10): at 320 CSS pixels the page scrolls one way only — an
      // inline address or a table's hidden name pushed five pages sideways (V22).
      await page.setViewportSize({ width: 320, height: 640 });
      const sideways = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(sideways, `${entry.id} scrolls sideways at 320 px`).toBeLessThanOrEqual(0);
    });
  }
});

test.describe("the keyboard in a real browser", () => {
  test.beforeEach(() => {
    test.skip(test.info().project.name !== "desktop", "keyboard: desktop project");
  });

  test("Tab onto the timeline, every item by arrow keys, the focus is visible", async ({ page }) => {
    await openDemo(page);
    await tabIn(page);
    const seen: string[] = [];
    await page.keyboard.press("Home");
    for (let step = 0; step < 5; step += 1) {
      const focused = (await stateOf(page)).focusedId;
      if (focused !== null) {
        seen.push(focused);
      }
      // The ring is drawn, and the browser shows it: the timeline has focus.
      await expect(page.locator(".tl-focus-ring")).toBeVisible();
      await page.keyboard.press("ArrowRight");
    }
    expect([...seen].sort()).toEqual(["a", "b", "c", "d", "e"]);
    // Focus leaves: the ring goes with it. (The undo button is disabled and
    // cannot take focus; the checkbox can.)
    await page.locator("#multi").focus();
    await expect(page.locator(".tl-focus-ring")).toBeHidden();
  });

  test("Alt+arrow moves, Shift+arrow the end, and undo works the same", async ({ page }) => {
    await openDemo(page);
    await tabIn(page);
    // Reading order: a, b, c, d, e. The first press lands on "a".
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await expect.poll(async () => (await stateOf(page)).focusedId).toBe("b");
    const before = (await stateOf(page)).days.b ?? 0;
    await page.keyboard.press("Alt+ArrowRight");
    await expect.poll(async () => (await stateOf(page)).days.b).toBe(before + 1);
    await page.keyboard.press("Shift+ArrowRight");
    await expect.poll(async () => (await stateOf(page)).edits).toContain("editEnd:resize-end");
    await page.locator("#undo").click();
    await page.locator("#undo").click();
    await expect.poll(async () => (await stateOf(page)).days.b).toBe(before);
  });

  test("the host's rule holds for the keyboard too, and the locked item does not move", async ({ page }) => {
    await openDemo(page);
    await tabIn(page);
    await page.keyboard.press("Home");
    await expect.poll(async () => (await stateOf(page)).focusedId).toBe("a");
    // "a" starts on the first day: one step earlier is before the project.
    await page.keyboard.press("Alt+ArrowLeft");
    await expect.poll(async () => (await stateOf(page)).edits).toContain("vetoed");
    expect((await stateOf(page)).days.a).toBe(0);
    // The last in reading order is "e", the locked one.
    await page.keyboard.press("End");
    await expect.poll(async () => (await stateOf(page)).focusedId).toBe("e");
    const locked = (await stateOf(page)).days.e;
    await page.keyboard.press("Alt+ArrowRight");
    expect((await stateOf(page)).days.e).toBe(locked);
  });

  test("g, date, Enter: the view jumps there, and the focus returns", async ({ page }) => {
    await openDemo(page);
    await tabIn(page);
    await page.keyboard.press("g");
    await expect(page.locator("#jump-date")).toBeFocused();
    await page.locator("#jump-date").fill("2026-06-15");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("timeline")).toBeFocused();
    await expect
      .poll(async () => {
        const state = await stateOf(page);
        return Date.parse(state.start) + (state.spanDays * 86_400_000) / 2;
      })
      .toBe(Date.UTC(2026, 5, 15));
  });

  test("Esc releases the focus and the selection", async ({ page }) => {
    await openDemo(page);
    await tabIn(page);
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Enter");
    await expect.poll(async () => (await stateOf(page)).selectedIds).toEqual(["a"]);
    await page.keyboard.press("Escape");
    await expect.poll(async () => (await stateOf(page)).selectedIds).toEqual([]);
    expect((await stateOf(page)).focusedId).toBeNull();
    await expect(page.getByTestId("timeline")).not.toHaveAttribute("aria-activedescendant", /.+/);
  });

  test("an arrow inside the list does not scroll the page, the other keys stay with the page", async ({ page }) => {
    await openDemo(page);
    await tabIn(page);
    await page.keyboard.press("PageDown");
    await page.keyboard.press("ArrowDown");
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    // Tab is not ours: it moves on to the next control (the undo button is
    // still disabled, so that is the checkbox).
    await page.keyboard.press("Tab");
    await expect(page.locator("#multi")).toBeFocused();
  });

  test("reduced-motion: paging arrives in one frame, without it in several", async ({ page }) => {
    await openDemo(page);
    await tabIn(page);
    const before = (await stateOf(page)).views;
    await page.keyboard.press("PageDown");
    await expect.poll(async () => (await stateOf(page)).views - before, { timeout: 2000 }).toBeGreaterThan(5);
    // The flag the reduced case relies on sees a transition, and sees it end.
    expect((await stateOf(page)).transitionFrames).toBeGreaterThan(0);
    await expect.poll(async () => (await stateOf(page)).transitionPending, { timeout: 2000 }).toBe(false);
    const moving = (await stateOf(page)).views - before;

    await page.emulateMedia({ reducedMotion: "reduce" });
    await openDemo(page);
    await tabIn(page);
    const still = (await stateOf(page)).views;
    await page.keyboard.press("PageDown");
    // Arrived, and no transition is waiting for a frame: nothing more is on its way.
    await expect.poll(async () => (await stateOf(page)).views - still).toBeGreaterThan(0);
    expect((await stateOf(page)).transitionPending).toBe(false);
    expect((await stateOf(page)).views - still).toBe(1);
    writeFileSync(join(here, "..", ".motion-frames.json"), `${JSON.stringify({ moving, reduced: 1 })}\n`);
  });

  test("follows a change of the media setting while running", async ({ page }) => {
    await openDemo(page);
    await tabIn(page);
    await page.emulateMedia({ reducedMotion: "reduce" });
    // The change event is dispatched at the next rendering step, not inside
    // emulateMedia: two frames later it has been.
    await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
    const before = (await stateOf(page)).views;
    await page.keyboard.press("PageDown");
    await expect.poll(async () => (await stateOf(page)).views - before).toBeGreaterThan(0);
    expect((await stateOf(page)).transitionPending).toBe(false);
    expect((await stateOf(page)).views - before).toBe(1);
  });
});

/**
 * What axe cannot judge: text spacing (1.4.12), text size (1.4.4), forced
 * colours (1.4.11, 2.4.7) and a focus outline in a container that clips
 * (2.4.7). Measured on the demo (the core, its labels fitted by the
 * estimate) and on the element's own page (public/a11y.html, its labels
 * fitted by a canvas measurement), each with a negative control where the
 * check is a judgement of pixels or boxes.
 */

/**
 * WCAG's text-spacing override, as the Understanding document's bookmarklet
 * applies it: line height 1.5, paragraphs 2em apart, letters 0.12em, words
 * 0.16em — all `!important`, so no stylesheet of ours can refuse them.
 */
const TEXT_SPACING =
  "* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; } p { margin-bottom: 2em !important; }";

interface LabelVerdict {
  readonly id: string;
  readonly text: string;
  /** `whole`: the text fits its box. `shortened`: it does not, and ends in an ellipsis. `cut`: it does not, and is cut off. */
  readonly verdict: "whole" | "shortened" | "cut";
  /** How far the laid-out text reaches past its box, in px (negative: room to spare). */
  readonly overflow: number;
  /** How far the text's line reaches above or below its box, in px. */
  readonly across: number;
  /** The laid-out text's width, in px. */
  readonly width: number;
  readonly name: string | null;
  readonly full: string;
}

interface SpacingVerdict {
  readonly labels: readonly LabelVerdict[];
  /** Pairs of axis labels drawn over each other. */
  readonly axisOverlaps: readonly string[];
  /** Item labels drawn over an axis label. */
  readonly onAxis: readonly string[];
}

/** Every item label of the timeline on the page, judged; and the axis. */
async function judgeSpacing(page: Page): Promise<SpacingVerdict> {
  return page.evaluate(() => {
    const host = window as unknown as { tl: { labels?: Record<string, string>; items?: { id: string; label: string }[] } };
    const full = host.tl.labels ?? Object.fromEntries((host.tl.items ?? []).map((item) => [item.id, item.label]));
    const svg = document.querySelector("svg.tl") as SVGSVGElement;
    const meet = (a: DOMRect, b: DOMRect) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5;
    const labels = [...svg.querySelectorAll<SVGForeignObjectElement>("foreignObject.tl-label")].map((box) => {
      const line = box.firstElementChild as HTMLElement;
      const outer = box.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(line);
      const text = range.getBoundingClientRect();
      const style = getComputedStyle(line);
      const overflow = text.right - outer.right;
      const over = overflow > 0.5 || line.scrollWidth > line.clientWidth;
      const ellipsis = style.textOverflow === "ellipsis" && style.overflowX === "hidden";
      const id = box.getAttribute("data-tl-label") ?? "";
      return {
        id,
        text: line.textContent ?? "",
        verdict: (over ? (ellipsis ? "shortened" : "cut") : "whole") as "whole" | "shortened" | "cut",
        overflow: Math.round(overflow * 10) / 10,
        across: Math.round(Math.max(outer.top - text.top, text.bottom - outer.bottom, 0) * 10) / 10,
        width: Math.round(text.width * 10) / 10,
        name: svg.querySelector(`[role="option"][data-tl-id="${id}"]`)?.getAttribute("aria-label") ?? null,
        full: full[id] ?? "",
      };
    });
    const ticks = [...svg.querySelectorAll("text.tl-tick-label")].map((node) => ({ text: node.textContent ?? "", box: node.getBoundingClientRect() }));
    const axisOverlaps: string[] = [];
    for (const [index, a] of ticks.entries()) {
      for (const b of ticks.slice(index + 1)) if (meet(a.box, b.box)) axisOverlaps.push(`${a.text} / ${b.text}`);
    }
    const onAxis = [...svg.querySelectorAll("foreignObject.tl-label")].flatMap((box) =>
      ticks.filter((tick) => meet(box.getBoundingClientRect(), tick.box)).map((tick) => `${box.textContent ?? ""} on ${tick.text}`),
    );
    return { labels, axisOverlaps, onAxis };
  });
}

/** No label cut, every name whole, nothing on the axis — and what the spacing did, for the record. */
function expectSpacingHolds(verdict: SpacingVerdict, where: string): number {
  for (const label of verdict.labels) {
    expect(label.verdict, `${where}: "${label.text}" is cut through, ${String(label.overflow)} px past its box`).not.toBe("cut");
    // The taller line stays centred: what it adds above and below is the line's leading, not the glyphs.
    expect(label.across, `${where}: "${label.text}" reaches ${String(label.across)} px out of its box`).toBeLessThanOrEqual(1);
    expect(label.name?.startsWith(`${label.full}, `), `${where}: the name of ${label.id} is ${String(label.name)}`).toBe(true);
    if (!label.text.endsWith("…")) expect(label.full, where).toBe(label.text);
  }
  expect(verdict.axisOverlaps, where).toEqual([]);
  expect(verdict.onAxis, where).toEqual([]);
  const shortened = verdict.labels.filter((label) => label.verdict === "shortened").length;
  test.info().annotations.push({
    type: "text spacing",
    description: `${where}: ${String(verdict.labels.length)} labels, ${String(verdict.labels.length - shortened)} whole, ${String(shortened)} shortened with an ellipsis (${verdict.labels.map((label) => `${label.text} ${String(label.overflow)}`).join(", ")})`,
  });
  return shortened;
}

/** Two frames: whatever the last change asked for has been laid out and painted. */
async function settle(page: Page): Promise<void> {
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
}

test.describe("beyond axe: spacing, size, forced colours and clipping", () => {
  test.beforeEach(() => {
    test.skip(test.info().project.name !== "desktop", "measured with a keyboard: desktop project");
  });

  test("text spacing (1.4.12): on the demo, horizontal and vertical, no label is cut through a letter, every name keeps the whole label, nothing runs into the axis, and the keys still work", async ({
    page,
  }) => {
    let shortened = 0;
    for (const query of ["", "?orientation=vertical&height=420"]) {
      await openDemo(page, query);
      expectSpacingHolds(await judgeSpacing(page), `index${query}: as drawn`);
      await page.addStyleTag({ content: TEXT_SPACING });
      await settle(page);
      shortened += expectSpacingHolds(await judgeSpacing(page), `index${query}: with the spacing`);
    }
    // The spacing really did push labels past the room they were measured for:
    // otherwise this test measured nothing.
    expect(shortened).toBeGreaterThan(0);
    await tabIn(page);
    await page.keyboard.press("ArrowDown");
    await expect.poll(async () => (await stateOf(page)).focusedId).toBe("a");
    await page.keyboard.press("Enter");
    await expect.poll(async () => (await stateOf(page)).selectedIds).toEqual(["a"]);
  });

  test("text spacing (1.4.12): on the element, measured by canvas with the reader's spacing — it draws again by itself when the spacing comes, every label's box holds its text, and again after a resize", async ({ page }) => {
    await page.goto("/a11y.html");
    await page.waitForFunction(() => (window as unknown as { tl?: { ready: boolean } }).tl?.ready === true);
    const plain = await judgeSpacing(page);
    expect(expectSpacingHolds(plain, "element: as drawn")).toBe(0);
    await page.addStyleTag({ content: TEXT_SPACING });
    // No resize and no call: the spacing itself makes the element measure and
    // lay out again, so no label is left shortened by its box.
    await expect.poll(async () => (await judgeSpacing(page)).labels.filter((label) => label.verdict !== "whole").map((label) => label.text)).toEqual([]);
    const spaced = await judgeSpacing(page);
    expect(expectSpacingHolds(spaced, "element: with the spacing")).toBe(0);
    // The spacing really did widen the text: otherwise this test measured nothing.
    const widened = spaced.labels.filter((label) => {
      const before = plain.labels.find((other) => other.id === label.id && other.text === label.text);
      return before !== undefined && label.width > before.width + 5;
    });
    expect(widened.length).toBeGreaterThan(0);
    // A resize makes the element measure and lay out again, under the spacing still.
    await page.setViewportSize({ width: 1200, height: 720 });
    await expect.poll(() => page.evaluate(() => document.querySelector("svg.tl")?.getAttribute("width"))).toBe("1200");
    await settle(page);
    expect(expectSpacingHolds(await judgeSpacing(page), "element: drawn again with the spacing")).toBe(0);
    await page.locator("svg.tl").focus();
    await page.keyboard.press("Home");
    await expect.poll(() => page.evaluate(() => document.querySelector("svg.tl")?.getAttribute("aria-activedescendant"))).toMatch(/.+/);
  });

  test("NEGATIVE CONTROL: text spacing — a label cut through a letter, without its ellipsis, is caught", async ({ page }) => {
    await openDemo(page);
    // The stylesheet as it was before 1.0: the box clips, and nothing says so.
    await page.addStyleTag({ content: `${TEXT_SPACING} .tl .tl-label>div{text-overflow:clip !important}` });
    await settle(page);
    const cut = (await judgeSpacing(page)).labels.filter((label) => label.verdict === "cut");
    expect(cut.length).toBeGreaterThan(0);
  });

  test("text-only enlargement (1.4.4): the root font size at 200% and a 32-pixel default font leave the timeline's pixel sizes as they were — page zoom is what enlarges it", async ({
    page,
  }) => {
    await page.goto("/a11y.html");
    await page.waitForFunction(() => (window as unknown as { tl?: { ready: boolean } }).tl?.ready === true);
    const sizes = () =>
      page.evaluate(() => {
        let probe = document.querySelector<HTMLElement>("#rem-probe");
        if (probe === null) {
          probe = document.createElement("p");
          probe.id = "rem-probe";
          probe.style.fontSize = "1rem";
          probe.textContent = "Text in the page's own units";
          document.body.append(probe);
        }
        const size = (selector: string) => getComputedStyle(document.querySelector(selector) as Element).fontSize;
        return { page: size("#rem-probe"), label: size("svg.tl .tl-label"), tick: size("svg.tl .tl-tick-label") };
      });
    const before = await sizes();
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Page.setFontSizes", { fontSizes: { standard: 32, fixed: 26 } });
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "200%";
    });
    await settle(page);
    const after = await sizes();
    // The page's own text took both settings: 32 px default, at 200%.
    expect(Number.parseFloat(after.page)).toBe(64);
    // The timeline's did not: its sizes are pixels, the density's.
    expect(after.label).toBe(before.label);
    expect(after.tick).toBe(before.tick);
    test.info().annotations.push({ type: "text-only enlargement", description: `page text ${before.page} → ${after.page}; label ${before.label} → ${after.label}; axis ${before.tick} → ${after.tick}` });
  });

  for (const scheme of ["light", "dark"] as const) {
    test(`forced colours, ${scheme}: the surface, an item, its label, an axis label and the focus paint in the reader's system colours, wider where selected, and axe finds nothing`, async ({
      page,
    }, info) => {
      await page.emulateMedia({ forcedColors: "active", colorScheme: scheme });
      await openDemo(page);
      await tabIn(page);
      await page.keyboard.press("ArrowRight");
      await page.keyboard.press("Enter");
      await expect.poll(async () => (await stateOf(page)).selectedIds).toEqual(["a"]);
      const seen = await page.evaluate(() => {
        // What the system colours are in this palette. The probe opts out of
        // forced colours, or the browser would force its colour too.
        const system = (keyword: string) => {
          const probe = document.createElement("span");
          probe.style.cssText = `forced-color-adjust:none;color:${keyword}`;
          document.body.append(probe);
          const value = getComputedStyle(probe).color;
          probe.remove();
          return value;
        };
        const style = (selector: string) => getComputedStyle(document.querySelector(selector) as Element);
        return {
          system: { Canvas: system("Canvas"), CanvasText: system("CanvasText"), Highlight: system("Highlight"), GrayText: system("GrayText") },
          surface: style("svg.tl .tl-surface").fill,
          itemFill: style("svg.tl .tl-item:not(.tl-item--selected)").fill,
          itemStroke: style("svg.tl .tl-item:not(.tl-item--selected)").stroke,
          label: style("svg.tl .tl-label").color,
          tickLabel: style("svg.tl .tl-tick-label").fill,
          tick: style("svg.tl .tl-tick").stroke,
          selected: [style("svg.tl .tl-item--selected").stroke, style("svg.tl .tl-item--selected").strokeWidth],
          ring: [style("svg.tl .tl-focus-ring").stroke, style("svg.tl .tl-focus-ring").strokeWidth],
          outline: [style("svg.tl").outlineColor, style("svg.tl").outlineStyle],
        };
      });
      const { Canvas, CanvasText, Highlight, GrayText } = seen.system;
      // A palette in which the four are told apart, or the comparisons below prove nothing.
      expect(new Set([Canvas, CanvasText, Highlight, GrayText]).size).toBe(4);
      expect(seen.surface).toBe(Canvas);
      expect(seen.itemFill).toBe(Canvas);
      expect(seen.itemStroke).toBe(CanvasText);
      expect(seen.label).toBe(CanvasText);
      expect(seen.tickLabel).toBe(CanvasText);
      expect(seen.tick).toBe(GrayText);
      expect(seen.selected).toEqual([Highlight, "3px"]);
      expect(seen.ring).toEqual([Highlight, "3px"]);
      expect(seen.outline).toEqual([Highlight, "solid"]);
      test.info().annotations.push({ type: `forced colours, ${scheme}`, description: JSON.stringify(seen.system) });
      await clean(page, info, `index:forced-colors-${scheme}`);
    });
  }

  test("the focus outline is drawn inside the timeline: in an overflow: hidden card of exactly its size it is not cut", async ({ page }) => {
    await page.goto("/a11y.html?clip=1&height=240");
    await page.waitForFunction(() => (window as unknown as { tl?: { ready: boolean } }).tl?.ready === true);
    const boxes = await page.evaluate(() => {
      const rect = (selector: string) => {
        const box = (document.querySelector(selector) as Element).getBoundingClientRect();
        return [box.x, box.y, box.width, box.height];
      };
      return { card: rect("#box"), svg: rect("svg.tl"), overflow: getComputedStyle(document.querySelector("#box") as Element).overflow };
    });
    expect(boxes.overflow).toBe("hidden");
    expect(boxes.svg).toEqual(boxes.card);
    // By the keyboard, so that the outline is the :focus-visible one.
    await page.locator("body").focus();
    await page.keyboard.press("Tab");
    await expect(page.locator("svg.tl")).toBeFocused();
    const outline = await page.evaluate(() => {
      const style = getComputedStyle(document.querySelector("svg.tl") as Element);
      return { colour: style.outlineColor, width: style.outlineWidth, offset: style.outlineOffset, visible: (document.querySelector("svg.tl") as Element).matches(":focus-visible") };
    });
    expect(outline.visible).toBe(true);
    expect(outline.width).toBe("2px");
    expect(outline.offset).toBe("-2px");
    const colour = (outline.colour.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
    /** The share of each edge's outermost pixels, on the screenshot of the card, that are the outline's colour. */
    const edges = async () => {
      const png = await page.locator("#box").screenshot();
      return page.evaluate(
        async ({ data, rgb }) => {
          const image = new Image();
          image.src = `data:image/png;base64,${data}`;
          await image.decode();
          const canvas = document.createElement("canvas");
          canvas.width = image.width;
          canvas.height = image.height;
          const context = canvas.getContext("2d") as CanvasRenderingContext2D;
          context.drawImage(image, 0, 0);
          const pixels = context.getImageData(0, 0, image.width, image.height).data;
          const near = (x: number, y: number) => {
            const at = (y * image.width + x) * 4;
            return Math.abs((pixels[at] ?? 0) - (rgb[0] ?? 0)) + Math.abs((pixels[at + 1] ?? 0) - (rgb[1] ?? 0)) + Math.abs((pixels[at + 2] ?? 0) - (rgb[2] ?? 0)) <= 48;
          };
          const share = (points: [number, number][]) => points.filter(([x, y]) => near(x, y)).length / points.length;
          const across = [...Array(image.width).keys()];
          const down = [...Array(image.height).keys()];
          return {
            top: share(across.map((x) => [x, 0])),
            bottom: share(across.map((x) => [x, image.height - 1])),
            left: share(down.map((y) => [0, y])),
            right: share(down.map((y) => [image.width - 1, y])),
          };
        },
        { data: png.toString("base64"), rgb: colour },
      );
    };
    const inside = await edges();
    for (const [edge, share] of Object.entries(inside)) expect(share, `${edge} edge`).toBeGreaterThanOrEqual(0.95);
    // NEGATIVE CONTROL: the same outline drawn outside the box, as a focus
    // outline is by default. The card cuts it, and the pixels say so.
    await page.addStyleTag({ content: ".tl:focus-visible{outline-offset:1px !important}" });
    await settle(page);
    const outside = await edges();
    for (const [edge, share] of Object.entries(outside)) expect(share, `${edge} edge, outline outside`).toBeLessThanOrEqual(0.05);
    test.info().annotations.push({ type: "focus outline at the card's edges", description: `inset: ${JSON.stringify(inside)}; outside (control): ${JSON.stringify(outside)}` });
  });
});
