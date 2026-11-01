import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";

/**
 * G-TEMPLATE böngészős fele: egy szkriptet, `onerror`-t és `onclick`-et
 * tartalmazó sablon a shippelt bundle-lel, valódi Chromiumban.
 *
 *  - Alapértelmezésben semmi nem fut le (`window.__ran` üres marad), és a
 *    szerver (`renderTimelineSvg`) ugyanazt a sablon-markupot adja, mint az
 *    élő példány.
 *  - NEGATÍV KONTROLL: `sanitize: false`-szal ugyanaz a sablon LEFUT — ha
 *    nem futna, a mérő vak volna, és a fenti „nem futott” semmit nem jelentene.
 *
 * Az eredmény a `.template-e2e.json`-be kerül; a sdk_check_template.mjs abból ítél.
 */

const here = dirname(fileURLToPath(import.meta.url));
const LOG = join(here, "..", ".template-e2e.json");
const log: Record<string, unknown> = {};

type Tl = { ready: boolean; live: string; server: string; names: string[] };

test.afterAll(() => {
  writeFileSync(LOG, `${JSON.stringify(log, null, 2)}\n`);
});

test("a sanitised template runs nothing, keeps the names, and matches the server", async ({ page }) => {
  await page.goto("/p19.html?mode=template");
  await page.waitForFunction(() => (window as unknown as { tl?: Tl }).tl?.ready === true);
  // Long enough for a failed image to fire its error handler, had it one.
  await page.waitForTimeout(1000);
  await page.locator("#timeline .tl-template span").first().click({ force: true }).catch(() => undefined);
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
  await page.goto("/p19.html?mode=template&unsafe=1");
  await page.waitForFunction(() => (window as unknown as { tl?: Tl }).tl?.ready === true);
  const ran = await page
    .waitForFunction(() => (window as unknown as { __ran?: string }).__ran, undefined, { timeout: 3000 })
    .then((handle) => handle.jsonValue())
    .catch(() => null);
  log.unsanitized = { ran: ran !== null, value: ran };
  expect(ran).not.toBeNull();
});
