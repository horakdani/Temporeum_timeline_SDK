import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * G-RESPONSIVE: ugyanaz a lap három szélességen, és mindegyiken a VÁRT
 * vetület.
 *
 * A mag tesztjei bizonyítják, hogy a döntések helyesek egy mérésre. Ez a
 * készlet azt, amit csak böngészőben lehet: hogy a mérés a KONTÉNERRŐL jön
 * (ResizeObserver, nem a betöltéskori méret), hogy a döntés a rajzolt SVG-n
 * is megjelenik, és hogy egyik szélességen sincs vízszintes lapgörgetés — a
 * részlet-felület kinyitása után sem, mert egy kilógó popover pont az.
 *
 * A várt értékek itt állnak, LEÍRVA, és nem a magtól kérdezve. Egy készlet,
 * ami a saját elvárását a mért kódból számolja, mindig egyetért vele.
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
 * A szerződés. A lap adataival: négynapos elemek hatvan napon.
 *
 * - 375: keskeny → függőleges; keresztben 375 px-be csak a dense oszlopok
 *   férnek (a comfortable 3 × 168 px lenne) → dense → alsó lap.
 * - 768: tablet, ujjal → vízszintes; egy elem ~51 px, a comfortable-hoz 72
 *   kellene → compact → popover koppintásra.
 * - 1440: asztal, egérrel → vízszintes; egy elem ~96 px → comfortable →
 *   popover hoverre.
 */
const EXPECTED: readonly Expected[] = [
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

/** A lap a SAJÁT lapunk, és már mért: a window.tl a bizonyíték. */
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
    throw new Error(`nincs ${id} a lapon`);
  }
  return box;
}

async function noHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
    svg: document.querySelector("svg")?.getBoundingClientRect().right ?? 0,
  }));
  expect(overflow.scroll, "a lap szélesebb a képernyőnél").toBeLessThanOrEqual(overflow.client);
  expect(overflow.svg).toBeLessThanOrEqual(overflow.client);
  // A lap tényleg nem mozdul vízszintesen, ha megpróbáljuk.
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

    test(`${String(expected.width)} px: ${expected.orientation} és ${expected.density}, a rajzolt SVG-n is`, async ({
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

    test(`${String(expected.width)} px: vízszintes lapgörgetés nincs`, async ({ page }) => {
      await open(page);
      await noHorizontalScroll(page);
    });

    test(`${String(expected.width)} px: a részlet ${expected.surface} felületen nyílik, és utána sincs vízszintes görgetés`, async ({
      page,
    }) => {
      await open(page);
      // A tartomány jobb széléig érő elem: egy középre igazított popover
      // itt lógna ki — ettől mér valamit az alábbi határ-ellenőrzés. (A
      // position: fixed elem NEM növeli a lap scrollWidth-jét, tehát a
      // görgetés-ellenőrzés egyedül vak lenne rá.)
      const box = await boxOf(page, "g");
      const x = box.x + box.width / 2;
      const y = box.y + box.height / 2;
      if (expected.touch) {
        await tapAt(page, x, y, true);
      } else {
        // Egérrel a hover nyit — kattintás nélkül.
        await page.mouse.move(x, y);
      }
      const detail = page.locator(`[data-tl-detail="${expected.surface}"]`);
      await expect(detail).toBeVisible();
      await expect(detail).toHaveAttribute("data-tl-item", "g");
      await expect(detail).toHaveAttribute("data-tl-trigger", expected.touch || expected.surface === "sheet" ? "tap" : "hover");
      await expect(detail).toContainText("Lezárás");
      const placed = await detail.boundingBox();
      expect(placed).not.toBeNull();
      if (placed !== null) {
        expect(placed.x).toBeGreaterThanOrEqual(0);
        expect(placed.x + placed.width).toBeLessThanOrEqual(expected.width);
        if (expected.surface === "sheet") {
          // Alsó lap: a teljes szélesség, a képernyő aljához tapadva.
          expect(placed.x).toBe(0);
          expect(Math.round(placed.width)).toBe(expected.width);
          expect(Math.round(placed.y + placed.height)).toBe(expected.height);
        } else {
          // A centrálás kilógatná: a határ tartotta meg.
          expect(box.x + box.width / 2 + placed.width / 2).toBeGreaterThan(expected.width);
          expect(placed.x + placed.width).toBeLessThanOrEqual(expected.width - 8);
          // Popover: az elem mellett, nem a képernyő közepén.
          const gap = Math.min(Math.abs(placed.y - (box.y + box.height)), Math.abs(box.y - (placed.y + placed.height)));
          expect(gap).toBeLessThanOrEqual(12);
        }
      }
      await noHorizontalScroll(page);
    });
  });
}

test.describe("375 px, ujjal", () => {
  test.use({ viewport: { width: 375, height: 667 }, hasTouch: true, isMobile: true });

  test("375 px: az alsó lap a saját gombjával záródik", async ({ page }) => {
    await open(page);
    const box = await boxOf(page, "c");
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    const sheet = page.locator('[data-tl-detail="sheet"]');
    await expect(sheet).toBeVisible();
    await sheet.getByRole("button", { name: "Bezárás" }).tap();
    await expect(sheet).toHaveCount(0);
    expect((await stateOf(page)).detail).toBeNull();
  });

  test("375 px: ujjal a 2 px-es pillanat is eltalálható, 11,5 px mellőle — egérrel ugyanott nem", async ({
    page,
  }) => {
    await open(page);
    const box = await boxOf(page, "moment");
    // Függőlegesen a pillanat egy 2 px magas vonás az oszlopában. 11,5 px-re
    // alatta: a dense minimum (24 px-es cél, oldalanként 11) már nem éri el,
    // csak az ujj 12 px-es ráhagyása — tehát ez az ujjat méri, nem a dense-t.
    expect(Math.round(box.height)).toBe(2);
    const x = box.x + box.width / 2;
    const y = box.y + box.height + 11.5;
    await page.touchscreen.tap(x, y);
    const sheet = page.locator('[data-tl-detail="sheet"]');
    await expect(sheet).toBeVisible();
    await expect(sheet).toHaveAttribute("data-tl-item", "moment");
    // A koppintás tényleg ott landolt, ahova céloztunk, nem kerekítve közelebb.
    const tap = await page.evaluate(
      () => (window as unknown as { tl: { lastTap: { main: number; pointerType: string } } }).tl.lastTap,
    );
    expect(tap.pointerType).toBe("touch");
    const frameTop = await page.evaluate(
      () => document.querySelector("#frame")?.getBoundingClientRect().top ?? 0,
    );
    expect(tap.main - (box.y - frameTop + box.height)).toBeGreaterThan(11);
    await sheet.getByRole("button", { name: "Bezárás" }).tap();
    await expect(sheet).toHaveCount(0);
    // Ugyanaz a pont egérrel: a 4 px és a dense 11 px-e sem éri el.
    //
    // Előbb ki kell várni a dupla koppintás ablakát (320 ms). Enélkül a gép
    // az ujjas koppintás és az egérkattintás párját DUPLA KOPPINTÁSNAK veszi
    // és zoomol — a lastTap nem jegyzi a pointer típusát. Ez a P4 gépének
    // valódi hibája hibrid eszközön, és ez a teszt találta meg; javítása nem
    // a P6 hatóköre (ajánlások, 9. szakasz).
    await page.waitForTimeout(400);
    await page.mouse.click(x, y);
    await expect(page.locator("[data-tl-detail]")).toHaveCount(0);
    const click = await page.evaluate(
      () => (window as unknown as { tl: { lastTap: { pointerType: string } } }).tl.lastTap,
    );
    expect(click.pointerType).toBe("mouse");
  });

  test("375 px: az explicit orientáció felülírja a mérést, és a lap akkor sem görget oldalra", async ({
    page,
  }) => {
    await open(page, "?orientation=horizontal");
    const state = await stateOf(page);
    expect(state.orientation).toBe("horizontal");
    await expect(page.getByTestId("timeline")).toHaveAttribute("data-tl-orientation", "horizontal");
    await noHorizontalScroll(page);
  });
});

test.describe("élő átméretezés, egérrel", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("élő átméretezés: 1440 → 375 → 768 → 1440 újratöltés nélkül vált (ResizeObserver)", async ({
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

  test("a hiszterézis: 630 px-en vízszintes marad, 610-en függőleges, vissza csak 640-nél", async ({
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
    // Pontosan két váltás a kezdő után — oda-vissza villogás nincs.
    expect(changes.filter((value, index) => index === 0 || value !== changes[index - 1])).toEqual([
      "horizontal",
      "vertical",
      "horizontal",
    ]);
  });

  test("1440 px: az egér elhagyja az elemet, és a popover bezárul", async ({ page }) => {
    await open(page);
    const box = await boxOf(page, "d");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    const popover = page.locator('[data-tl-detail="popover"]');
    await expect(popover).toBeVisible();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height + 60);
    await expect(popover).toHaveCount(0);
  });
});
