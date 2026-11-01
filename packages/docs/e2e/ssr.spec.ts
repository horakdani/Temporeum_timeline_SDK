import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * G-SSR: a szerveren renderelt HTML hidratálódik — Next, Nuxt, Astro,
 * SvelteKit, Angular (a P23 óta a Nuxt, a SvelteKit és az Angular a saját
 * keretrendszer-adapterével).
 *
 * A közös konfiguráció a P26 óta jobbról balra és magyar szótárral rajzol
 * (ssr/shared/data.mjs): minden állítás RTL-ben és más nyelven áll.
 *
 * Három állítás keretrendszerenként:
 *  - server-html: a nyers válaszban (JavaScript előtt) ott a rajz, minden
 *    elemével, a kisegítő szerepekkel.
 *  - no-js: kikapcsolt JavaScripttel is látszik és olvasható.
 *  - hydrates: a kliens UGYANAZOKAT a csomópontokat veszi át — egy
 *    betöltés előtt beállított MutationObserver szerint egyetlen svg és
 *    egyetlen elem-csomópont sem tűnik el —, konzolhiba (hidratálási
 *    eltérés) nélkül, és utána egy valódi kattintás kijelöl.
 */

interface Target {
  readonly name: string;
  /** "adapter": a keretrendszer-komponens (window.__tl, #selected); "element": a <temporeum-timeline>. */
  readonly kind: "adapter" | "element";
  readonly url: string;
}

const targets = JSON.parse(process.env.TL_SSR_TARGETS ?? "[]") as Target[];
const ITEMS = 4;
const DEPENDENCIES = 3;

/**
 * Before the page's first byte: watch the document, and every shadow root
 * as it appears, for removed nodes; and remember the first listbox seen —
 * the server's — so it can be compared with the one the client ends with.
 */
async function watch(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const state = { removed: [] as string[], server: null as Element | null, watched: new WeakSet<Node>() };
    (window as unknown as { __ssr: typeof state }).__ssr = state;
    const look = (root: Document | ShadowRoot): void => {
      state.server ??= root.querySelector("svg[role=listbox]");
      for (const host of root.querySelectorAll("*")) {
        if (host.shadowRoot !== null && !state.watched.has(host.shadowRoot)) {
          state.watched.add(host.shadowRoot);
          observer.observe(host.shadowRoot, { childList: true, subtree: true });
          look(host.shadowRoot);
        }
      }
    };
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.removedNodes) {
          // A host whose shadow root held the drawing counts too: a query
          // does not see into a shadow root, and a replaced element would
          // otherwise take the server's drawing away unrecorded.
          const holds = (each: Element): boolean =>
            each.localName === "svg" ||
            each.hasAttribute("data-tl-id") ||
            // A dependency arrow (P20): the server drew it, the client keeps it.
            each.hasAttribute("data-tl-dep") ||
            (each.shadowRoot?.querySelector("svg") ?? null) !== null;
          if (node instanceof Element && (holds(node) || [...node.querySelectorAll("*")].some(holds))) {
            state.removed.push(node.localName + (node.getAttribute("data-tl-id") ?? ""));
          }
        }
      }
      look(document);
    });
    observer.observe(document, { childList: true, subtree: true });
  });
}

async function hydrated(page: Page, kind: Target["kind"]): Promise<void> {
  await page.waitForFunction((which) => {
    if (which === "adapter") return (window as unknown as { __tl?: { result?: unknown } }).__tl?.result !== undefined;
    return (document.querySelector("temporeum-timeline") as unknown as { timeline?: { result?: unknown } } | null)?.timeline?.result !== undefined;
  }, kind);
}

/** Load a page with the watcher on, wait for the client, and say what became of the server's drawing. */
async function takeOver(page: Page, url: string, kind: Target["kind"]) {
  await watch(page);
  await page.goto(url);
  await hydrated(page, kind);
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
  return page.evaluate(() => {
    const ssr = (window as unknown as { __ssr: { removed: string[]; server: Element | null } }).__ssr;
    const host = document.querySelector("temporeum-timeline");
    const root = host?.shadowRoot ?? document;
    const live = root.querySelector("svg[role=listbox]");
    return { removed: ssr.removed, sawServer: ssr.server !== null, same: ssr.server === live, listboxes: root.querySelectorAll("svg[role=listbox]").length };
  });
}

for (const target of targets) {
  if (target.name === "astro") {
    test(`[claim:control] @${target.name} NEGATÍV KONTROLL: egy kliens, ami újraírja a markupot, a mérőn bukik`, async ({ page }) => {
      const state = await takeOver(page, new URL("naive/", target.url).href, target.kind);
      expect(state.sawServer).toBe(true);
      // The drawing works — it is just not the server's any more.
      expect(state.listboxes).toBe(1);
      expect(state.same).toBe(false);
      expect(state.removed.length).toBeGreaterThan(0);
    });
  }

  test(`[claim:server-html] @${target.name} a nyers HTML-ben ott a rajz`, async ({ request }) => {
    const html = await (await request.get(target.url)).text();
    expect(html).toContain('role="listbox"');
    expect(html.match(/role="option"/g)).toHaveLength(ITEMS);
    // The Gantt arrows are in the server's drawing, in their layer under the
    // items: a path per look, naming its arrows (P20, after G-PERF-GANTT).
    const arrows = [...html.matchAll(/data-tl-dep="([^"]*)"/g)].flatMap((match) => (match[1] ?? "").split(" "));
    expect(arrows).toHaveLength(DEPENDENCIES);
    expect(html.indexOf("tl-layer--deps")).toBeLessThan(html.indexOf("tl-layer--items"));
    // The resource view's load is in it too, under the arrows: the load
    // lanes, the overbooked stretch in red, and its items marked (P22).
    expect(html.indexOf("tl-layer--load")).toBeGreaterThan(-1);
    expect(html.indexOf("tl-layer--load")).toBeLessThan(html.indexOf("tl-layer--deps"));
    expect(html).toContain("tl-load--over");
    expect(html.match(/tl-item--overbooked/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(html).toContain('aria-label="Projekt idővonal"');
    // P24: az áttekintő sáv és a ragadó sávfejlécek a szerver rajzában.
    expect(html).toContain("tl-layer--minimap");
    expect(html).toContain("data-tl-minimap-window");
    expect(html).toContain("tl-layer--lane-headers");
    if (target.kind === "element") expect(html).toContain('<template shadowrootmode="open">');
    // P26: jobbról balra, magyar szavakkal — a tükröző csoport és a szótár a szerver rajzában.
    expect(html).toContain('dir="rtl"');
    expect(html).toContain("tl-mirror");
    expect(html).toContain("% kész");
    expect(html).toContain("túlfoglalt, a kapacitás");
    expect(html).not.toContain("% done");
  });

  test(`[claim:no-js] @${target.name} JavaScript nélkül is látszik`, async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto(target.url);
    const listbox = page.locator("svg[role=listbox]");
    await expect(listbox).toBeVisible();
    await expect(page.locator("[role=option]")).toHaveCount(ITEMS);
    await expect(page.locator('[data-tl-id="b"]')).toBeVisible();
    await context.close();
  });

  test(`[claim:hydrates] @${target.name} a kliens a szerver csomópontjait veszi át, és él`, async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("pageerror", (error) => errors.push(error.message));
    const state = await takeOver(page, target.url, target.kind);
    expect(state.sawServer).toBe(true);
    expect(state.removed).toEqual([]);
    expect(state.same).toBe(true);
    expect(state.listboxes).toBe(1);
    expect(errors).toEqual([]);

    await page.locator('[data-tl-id="b"]').click();
    await expect(page.locator('[data-tl-id="b"]')).toHaveAttribute("aria-selected", "true");
    // The selection, read back through the framework's own store (P23: every adapter).
    if (target.kind === "adapter") await expect(page.locator("#selected")).toHaveText("b");
  });
}
