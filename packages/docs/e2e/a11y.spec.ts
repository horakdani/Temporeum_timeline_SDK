import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";
import type { Frame, Page, TestInfo } from "@playwright/test";

/**
 * G-AXE: a lapok akadálymentessége igazi böngészőben, és a billentyűzet útja.
 *
 * Két dolgot mér, mert a kettő más hibát fog meg:
 *
 *  1. **axe-core, WCAG 2.2 AA címkékkel**, a lapok minden olyan állapotában,
 *     amit a felhasználó előidézhet: alaphelyzet, függőleges, fókuszban egy
 *     elem, kijelölés, többes kijelölés, a dátumbekérő, sötét séma, szerkesztés
 *     után, a reszponzív lap popoverrel és alsó lappal. Egy állapot, amit az
 *     axe nem látott, az nincs mérve: a fókusz és a dialógus pont azok az
 *     állapotok, ahol az ARIA-hibák élnek.
 *  2. **A billentyűzet útja** — Tab az idővonalra, nyilak, Enter, Alt+nyíl,
 *     g és a dátum, Esc —, valódi billentyű-eseményekkel, és a reduced-motion
 *     emulációval: a nézetváltás egy képkockában érkezik, nélküle többen.
 *
 * Minden axe-futás eredménye a `.axe-results.json`-be kerül, és a
 * `sdk_check_a11y.mjs` abból ítél — nem a tesztek címéből. A NEGATÍV KONTROLL
 * ugyanezzel a harnesszel fut egy szándékosan elrontott lapon: ha ott az axe
 * nem talál, a harness vak, és akkor a nulla sem jelent semmit.
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
    await page.addScriptTag({ path: AXE });
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
    const undecided = result.incomplete
      .filter((rule) => rule.id === "color-contrast")
      .flatMap((rule) => rule.nodes.map((node) => node.target.join(" ")))
      .map((target) => {
        const element = document.querySelector(target);
        // The drawing's text — SVG, or since P17 an item's label, a line of
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
        // The first opaque background up the tree; the canvas is white.
        let background = [255, 255, 255];
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
  readonly days: Record<string, number>;
  readonly edits: readonly string[];
}

async function stateOf(page: Page): Promise<DemoState> {
  return JSON.parse((await page.locator("#state").textContent()) ?? "{}") as DemoState;
}

async function openDemo(page: Page, query = ""): Promise<void> {
  await page.goto(`/index.html${query}`);
  await expect(page.getByTestId("timeline")).toBeVisible();
  await expect(page).toHaveTitle(/Idővonal SDK/);
}

/** Tab from the top of the page onto the timeline. */
async function tabIn(page: Page): Promise<void> {
  await page.locator("body").focus();
  await page.keyboard.press("Tab");
  await expect(page.getByTestId("timeline")).toBeFocused();
}

test.describe("axe: WCAG 2.2 AA", () => {
  test("a demó alaphelyzetben", async ({ page }, info) => {
    await openDemo(page);
    await clean(page, info, "index:initial");
  });

  test("a demó függőlegesen", async ({ page }, info) => {
    await openDemo(page, "?orientation=vertical&height=420");
    await clean(page, info, "index:vertical");
  });

  test("egy elem fókuszban, kijelölve, többes kijelöléssel", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "billentyűzet: asztali projekt");
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

  test("a dátumbekérő nyitva", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "billentyűzet: asztali projekt");
    await openDemo(page);
    await tabIn(page);
    await page.keyboard.press("g");
    await expect(page.locator("#jump")).toBeVisible();
    await clean(page, info, "index:jump-dialog");
  });

  test("sötét sémában, szerkesztés után", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "billentyűzet: asztali projekt");
    await page.emulateMedia({ colorScheme: "dark" });
    await openDemo(page);
    await tabIn(page);
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Alt+ArrowRight");
    await expect.poll(async () => (await stateOf(page)).edits).toContain("editEnd:move");
    await clean(page, info, "index:dark-edited");
  });

  test("a reszponzív lap, részlet-felülettel", async ({ page }, info) => {
    await page.goto("/responsive.html");
    await expect(page.getByTestId("timeline")).toBeVisible();
    await clean(page, info, "responsive:initial");
    await page.getByTestId("timeline").focus();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Enter");
    await expect(page.locator("[data-tl-detail]")).toBeVisible();
    await clean(page, info, `responsive:detail-${info.project.name === "desktop" ? "popover" : "sheet"}`);
  });

  // A P9 állapotai: a betöltés alatt (aria-busy, a tengely jele) és egy
  // elbukott ablakkal. Nem kötelező G-AXE-állapotok, de ami a felhasználó
  // elé kerülhet, azt az axe is lássa.
  test("az aszinkron lap betöltés közben", async ({ page }, info) => {
    await page.goto("/async.html?latency=1500");
    await expect(page.locator("#frame svg")).toHaveAttribute("aria-busy", "true");
    await clean(page, info, "async:loading");
  });

  test("az aszinkron lap elbukott ablakokkal", async ({ page }, info) => {
    await page.goto("/async.html?latency=50&fail=1");
    await expect(page.locator("#frame line.tl-loading--failed").first()).toBeAttached();
    await expect(page.locator("#retry")).toBeEnabled();
    await clean(page, info, "async:failed");
  });

  test("NEGATÍV KONTROLL: egy elrontott lapon az axe talál", async ({ page }, info) => {
    await openDemo(page);
    // Two faults in the widget's own vocabulary, and one classic: an
    // activedescendant that points nowhere, an option outside any listbox,
    // and a button with no name. If the harness misses these, it is blind.
    await page.evaluate(() => {
      const svg = document.querySelector('[data-testid="timeline"]');
      svg?.setAttribute("aria-activedescendant", "no-such-item");
      const stray = document.createElement("div");
      stray.setAttribute("role", "option");
      stray.textContent = "árva";
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
    });
  }
});

test.describe("billentyűzet igazi böngészőben", () => {
  test.beforeEach(() => {
    test.skip(test.info().project.name !== "desktop", "billentyűzet: asztali projekt");
  });

  test("Tab az idővonalra, nyilakkal minden elem, a fókusz látszik", async ({ page }) => {
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

  test("Alt+nyíl mozgat, Shift+nyíl a végét, és a visszavonás ugyanaz", async ({ page }) => {
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

  test("a hoszt szabálya a billentyűre is áll, és a lezárt elem nem mozdul", async ({ page }) => {
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

  test("g, dátum, Enter: a nézet oda ugrik, és a fókusz visszatér", async ({ page }) => {
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

  test("Esc elengedi a fókuszt és a kijelölést", async ({ page }) => {
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

  test("a nyíl a listán belül nem görgeti a lapot, a többi billentyű a lapé marad", async ({ page }) => {
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

  test("reduced-motion: a lapozás egy képkockában érkezik, nélküle többen", async ({ page }) => {
    await openDemo(page);
    await tabIn(page);
    const before = (await stateOf(page)).views;
    await page.keyboard.press("PageDown");
    await expect.poll(async () => (await stateOf(page)).views - before, { timeout: 2000 }).toBeGreaterThan(5);
    const moving = (await stateOf(page)).views - before;

    await page.emulateMedia({ reducedMotion: "reduce" });
    await openDemo(page);
    await tabIn(page);
    const still = (await stateOf(page)).views;
    await page.keyboard.press("PageDown");
    // Wait as long as a transition would take, then count.
    await page.waitForTimeout(400);
    expect((await stateOf(page)).views - still).toBe(1);
    writeFileSync(join(here, "..", ".motion-frames.json"), `${JSON.stringify({ moving, reduced: 1 })}\n`);
  });

  test("a média-beállítás változását menet közben is követi", async ({ page }) => {
    await openDemo(page);
    await tabIn(page);
    await page.emulateMedia({ reducedMotion: "reduce" });
    // The change event is dispatched at the next rendering step, not inside
    // emulateMedia: two frames later it has been.
    await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
    const before = (await stateOf(page)).views;
    await page.keyboard.press("PageDown");
    await page.waitForTimeout(400);
    expect((await stateOf(page)).views - before).toBe(1);
  });
});
