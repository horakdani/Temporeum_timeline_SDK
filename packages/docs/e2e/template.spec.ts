import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";

/**
 * The browser half of the template check: a template holding a script, an `onerror`
 * and an `onclick`, with the shipped bundle, in a real Chromium.
 *
 *  - By default nothing runs (`window.__ran` stays empty), and the server
 *    (`renderTimelineSvg`) gives the same template markup as the live
 *    instance.
 *  - NEGATIVE CONTROL: with `sanitize: false` the same template DOES run —
 *    if it did not, the meter would be blind, and "did not run" above would
 *    mean nothing.
 *
 * The result goes to `.template-e2e.json`; sdk_check_template.mjs judges from that.
 */

const here = dirname(fileURLToPath(import.meta.url));
const LOG = join(here, "..", ".template-e2e.json");
const log: Record<string, unknown> = {};

type Tl = { ready: boolean; live: string; server: string; names: string[] };

test.afterAll(() => {
  writeFileSync(LOG, `${JSON.stringify(log, null, 2)}\n`);
});

test("a sanitised template runs nothing, keeps the names, and matches the server", async ({ page }) => {
  await page.goto("/drop-template.html?mode=template");
  await page.waitForFunction(() => (window as unknown as { tl?: Tl }).tl?.ready === true);
  // The browser's own answer for the planted image's address: once a control
  // image's error has come, the planted one's handler would have run, had it survived.
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        const control = new Image();
        control.addEventListener("error", resolve, { once: true });
        control.addEventListener("load", resolve, { once: true });
        control.src = "/missing.png";
      }),
  );
  // A click on the template's content, had a handler survived the sanitiser. A click that
  // cannot happen fails the test: a negative proof needs the event to have been sent.
  await page.locator("#timeline .tl-template span").first().click({ force: true });
  const state = await page.evaluate(() => {
    const tl = (window as unknown as { tl: Tl }).tl;
    return { ran: (window as unknown as { __ran?: string }).__ran ?? null, live: tl.live, server: tl.server, names: tl.names };
  });
  log.sanitized = { ran: state.ran !== null, value: state.ran };
  log.ssrEqual = state.live !== "" && state.live === state.server;
  log.names = state.names;
  expect(state.ran).toBeNull();
  expect(state.live).not.toBe("");
  expect(state.live).toBe(state.server);
  expect(state.names.some((name) => name.startsWith("First"))).toBe(true);
});

test("the negative control: with sanitize false the same template does run", async ({ page }) => {
  await page.goto("/drop-template.html?mode=template&unsafe=1");
  await page.waitForFunction(() => (window as unknown as { tl?: Tl }).tl?.ready === true);
  const ran = await page
    .waitForFunction(() => (window as unknown as { __ran?: string }).__ran, undefined, { timeout: 3000 })
    .then((handle) => handle.jsonValue())
    .catch(() => null);
  log.unsanitized = { ran: ran !== null, value: ran };
  expect(ran).not.toBeNull();
});
