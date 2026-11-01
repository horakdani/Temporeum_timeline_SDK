import { appendFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";
import type { FrameLocator, Locator, Page } from "@playwright/test";

/**
 * G-EXAMPLES in a real browser: every live example on the docs site runs.
 *
 * The list comes from dist/site-manifest.json, which the builder writes from
 * the pages themselves — so a page cannot add an example this suite does not
 * see. For each example, on its own page, as a reader gets it:
 *
 *  1. It runs: the playground reports "ok", with no error from the frame (an
 *     uncaught error, a rejected promise, a console.error) and none from the
 *     page around it.
 *  2. It shows what it claims: every `expect` entry of its meta.json — a
 *     selector, piercing the element's shadow root, and a minimum count.
 *  3. It can be edited: a line appended to the code and Run again shows up
 *     in the frame, and the claims still hold.
 *
 * Every result goes to .examples-results.json; sdk_check_examples.mjs
 * decides from that file, not from the test titles. Two NEGATIVE CONTROLS
 * run on the same harness: an example edited to throw must read "error", and
 * one edited to draw nothing must fail its claims. If either passed, the
 * harness would be blind and its green would mean nothing.
 */

interface ExampleEntry {
  readonly id: string;
  readonly title: string;
  readonly page: string;
  readonly path: string;
  readonly expect: readonly { readonly selector: string; readonly min: number }[];
}

const here = dirname(fileURLToPath(import.meta.url));
const docs = join(here, "..");
const RESULTS = join(docs, ".examples-results.json");
const manifest = JSON.parse(readFileSync(join(docs, "dist", "site-manifest.json"), "utf8")) as { examples: ExampleEntry[] };

// The results file is emptied by sdk_check_examples.mjs before the run, not
// here: a failed test restarts the worker, and a beforeAll would erase the
// results of every test before it.
function record(entry: Record<string, unknown>): void {
  appendFileSync(RESULTS, `${JSON.stringify(entry)}\n`);
}

/** Errors from the page around the examples: they count against every example on it. */
function watch(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    // The frame's own errors reach the playground by postMessage and are counted there.
    if (message.type() === "error" && message.page() === page && !message.location().url.startsWith("about:srcdoc")) {
      errors.push(`console: ${message.text()}`);
    }
  });
  return errors;
}

async function settle(section: Locator, run: number): Promise<{ state: string; errors: number; status: string }> {
  await expect(section).toHaveAttribute("data-run", String(run));
  await expect(section).toHaveAttribute("data-state", /^(ok|error)$/, { timeout: 15_000 });
  // Give a late error — an async source, a second frame — its chance to arrive.
  await section.page().waitForTimeout(400);
  return {
    state: (await section.getAttribute("data-state")) ?? "",
    errors: Number(await section.getAttribute("data-errors")),
    status: (await section.locator(".example-status").textContent()) ?? "",
  };
}

async function claims(frame: FrameLocator, example: ExampleEntry): Promise<{ selector: string; min: number; count: number }[]> {
  const out = [];
  for (const claim of example.expect) {
    const locator = frame.locator(claim.selector);
    // Poll: an async source or a hydration takes a few frames.
    let count = 0;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      count = await locator.count();
      if (count >= claim.min) break;
      await frame.owner().page().waitForTimeout(100);
    }
    out.push({ selector: claim.selector, min: claim.min, count });
  }
  return out;
}

async function rerun(section: Locator, code: string): Promise<number> {
  // A showcase folds its code away; a reader opens it before editing, and so does the suite.
  const folded = section.locator("details.example-code:not([open]) > summary");
  if ((await folded.count()) > 0) await folded.click();
  await section.locator("textarea").fill(code);
  const before = Number(await section.getAttribute("data-run"));
  await section.locator('button[data-action="run"]').click();
  // In a showcase the result is above the code: a reader scrolls back up to it, and a frame out of view draws nothing.
  await section.locator("iframe").scrollIntoViewIfNeeded();
  return before + 1;
}

for (const example of manifest.examples) {
  test(`example ${example.id} runs, shows what it claims, and can be edited (${example.page})`, async ({ page }) => {
    const pageErrors = watch(page);
    await page.goto(`/site/${example.path}`);
    const section = page.locator(`section#example-${example.id}`);
    // A reader scrolls to it; a cross-origin frame below the fold gets no animation frames.
    await section.locator("iframe").scrollIntoViewIfNeeded();
    const frame = section.frameLocator("iframe");
    const firstRun = Number(await section.getAttribute("data-run"));
    const first = await settle(section, firstRun);
    const shown = await claims(frame, example);

    const original = await section.locator("textarea").inputValue();
    const edited = await settle(section, await rerun(section, `${original}\ndocument.body.dataset.edited = String(6 * 7);\n`));
    const editedSeen = (await frame.locator('body[data-edited="42"]').count()) === 1;
    const shownAfterEdit = await claims(frame, example);

    record({ kind: "example", id: example.id, page: example.page, first, shown, edited, editedSeen, shownAfterEdit, pageErrors });
    expect(first.state, first.status).toBe("ok");
    expect(first.errors).toBe(0);
    for (const claim of [...shown, ...shownAfterEdit]) expect(claim.count, claim.selector).toBeGreaterThanOrEqual(claim.min);
    expect(edited.state, edited.status).toBe("ok");
    expect(editedSeen).toBe(true);
    expect(pageErrors).toEqual([]);
  });
}

test("NEGATIVE CONTROL: a broken example reads as broken", async ({ page }) => {
  const example = manifest.examples[0] as ExampleEntry;
  await page.goto(`/site/${example.path}`);
  const section = page.locator(`section#example-${example.id}`);
  await section.locator("iframe").scrollIntoViewIfNeeded();
  await settle(section, Number(await section.getAttribute("data-run")));
  const original = await section.locator("textarea").inputValue();

  // 1. It throws: the playground must say "error".
  const thrown = await settle(section, await rerun(section, original.replace(/createTimeline\(/, "createTimelin(")));
  // 2. It runs and draws nothing: the claims must not hold.
  const empty = await settle(section, await rerun(section, 'import "@temporeum/timeline-element";\n'));
  const emptyClaims = await claims(section.frameLocator("iframe"), example);
  // 3. A missing module: the import itself fails.
  const missing = await settle(section, await rerun(section, 'import { nothing } from "@temporeum/timeline-element/nowhere";\nnothing();\n'));

  record({ kind: "control", id: example.id, thrown, empty, emptyClaims, missing });
  expect(thrown.state).toBe("error");
  expect(emptyClaims.some((claim) => claim.count < claim.min)).toBe(true);
  expect(missing.state).toBe("error");
});
