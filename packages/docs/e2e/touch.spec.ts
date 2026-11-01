import { expect, test } from "@playwright/test";
import type { CDPSession, Page } from "@playwright/test";

/**
 * A böngészős készlet: valódi tap, húzás és pinch, eszköz-emulációval.
 *
 * Amit a mag tesztjei bizonyítanak: a gesztus-állapotgép helyesen számol.
 * Amit CSAK itt lehet bizonyítani: hogy a böngésző is így gondolja. Három
 * állítás tartozik ide, és egyik sem mérhető DOM nélkül:
 *
 *  1. a `touch-action` tényleg leállítja a lapgörgetést a húzás alatt;
 *  2. `cooperative` módban tényleg elgörren a lap, ÉS a böngésző elveszi a
 *     gesztust — azaz valódi `pointercancel` jön, nem szimulált;
 *  3. két érintési pont tényleg zoomol, a CSS-pixelekben megadott ujjak alatt.
 *
 * A két érintési pont a böngésző saját érintés-bemenetén megy: a Playwright
 * `touchscreen` API-ja egy pontot tud, és pinch-hez kettő kell. Chromiumban
 * ez a CDP `Input.dispatchTouchEvent`-je; WebKitben (P31) a Playwright
 * WebKit-buildjének protokollja, amelynek ugyanilyen nevű parancsa van, de a
 * publikus API nem adja ki — lásd `fingersFor`. Mindkettő valódi, a böngésző
 * által gyártott (`isTrusted`) Pointer Eventeket ad, nem a lapba injektált
 * eseményt.
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
  /** Elemenként a kezdet, naptól számítva a projekt indulásától. */
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

/** A böngésző érintés-bemenete: egy vagy több ujj, valódi eseményekkel. */
interface Fingers {
  send(type: TouchType, points: readonly TouchPoint[]): Promise<void>;
  detach(): Promise<void>;
}

/** A Playwright WebKit-oldali munkamenete — a publikus API nem adja ki. */
interface WebKitSession {
  send(method: "Input.dispatchTouchEvent", params: { type: TouchType; touchPoints: { x: number; y: number; id: number }[] }): Promise<unknown>;
}

/**
 * Chromiumban a CDP. WebKitben a Playwright saját WebKit-buildjének
 * `Input.dispatchTouchEvent` parancsa (a protocol.json-ban), amelyet a
 * Playwright maga csak a koppintáshoz használ: a folyamaton belül futó
 * Playwright `toImpl`-je adja meg a szerveroldali lapot, és annak
 * munkamenetét. Két eltérés a CDP-től, mindkettő itt van elnyelve:
 * a koordináta egész (a WebKit-protokoll `integer`-t vár), és a `touchEnd`
 * a felengedett ujjakat sorolja fel (üres listára a WebKit nem enged fel
 * semmit). A WebKit a parancs után aszinkron kézbesít, ezért a `send` egy
 * képkockát vár: a lap a következő olvasás előtt feldolgozza.
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
  if (toImpl === undefined) throw new Error("a Playwright nem a folyamaton belül fut: a WebKit érintés-bemenete nem érhető el");
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

/** Egy ujj húzása, több lépésben — egy lépés nem gesztus, hanem ugrás. */
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

/** Hol van egy elem a képernyőn. A lap maga számolja: egy helyen van az igazság. */
async function boxOf(page: Page, id: string, fraction = 0.5): Promise<Point> {
  const point = await page.evaluate(
    ([itemId, at]) => window.tl.boxOf(itemId, at),
    [id, fraction] as const,
  );
  expect(point, `nincs doboz: ${id}`).toBeTruthy();
  return point as Point;
}

async function handleOf(page: Page, id: string): Promise<Point> {
  const point = await page.evaluate((itemId) => window.tl.handleOf(itemId), id);
  expect(point, `nincs fogantyú: ${id}`).toBeTruthy();
  return point as Point;
}

/**
 * Tartás, majd húzás — egy ujjal.
 *
 * A tartás alatt SEMMI nem mozdul: egyetlen `touchMove` lefújja a hosszú
 * nyomást, és akkor pásztázást mérnénk. A várakozás itt valódi óra, mert
 * éppen azt bizonyítja, hogy a böngésző-kötés időzítője tényleg lefut — a
 * mag óramentességét a magon mérjük, nem itt.
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
 * A demó lap megnyitása, és annak BIZONYÍTÁSA, hogy tényleg az a lap.
 *
 * Miért nem elég a `page.goto`. 2026-10-26-án egy másik projekt szervere ült
 * a porton, a Playwright `reuseExistingServer: true`-ja pedig elfogadta a
 * sajátjának. A készlet 15 tesztje egy idegen lapon futott, mind bukott, és
 * a bukás egyetlen szót sem mondott arról, hogy nem a mi lapunk van alatta.
 * A konfiguráció azóta nem fogad el idegen szervert — ez itt a második zár:
 * a `window.tl` a mi demónk kézjegye, és ha nincs ott, a hibaüzenet megmondja
 * hova nézzen az ember.
 */
async function openDemo(page: Page, query = ""): Promise<void> {
  await page.goto(`/index.html${query}`);
  const mine = await page
    .waitForFunction(() => "tl" in window, undefined, { timeout: 5_000 })
    .then(() => true)
    .catch(() => false);
  if (!mine) {
    throw new Error(
      `A ${page.url()} nem az SDK demó lapja: nincs rajta window.tl. ` +
        "Valószínűleg más ül a porton — ne a teszteket javítsd, hanem a szervert.",
    );
  }
  await expect(page.getByTestId("timeline")).toBeVisible();
}

test.describe("valódi érintés egy emulált telefonon", () => {
  test.beforeEach(async ({ page }) => {
    await openDemo(page);
  });

  test("egy ujjas húzás pásztáz, a nagyítás változatlan", async ({ page }) => {
    const before = await stateOf(page);
    await drag(page, { x: 320, y: MIDDLE_Y }, { x: 90, y: MIDDLE_Y });
    const after = await stateOf(page);
    // Jobbról balra: a tartalom balra megy, tehát az ablak előre az időben.
    expect(new Date(after.start).getTime()).toBeGreaterThan(new Date(before.start).getTime());
    expect(after.spanDays).toBeCloseTo(before.spanDays, 3);
    expect(after.gestures).toContain("gestureStart:pan");
    expect(after.gestures).toContain("gestureEnd:pan");
  });

  test("a lap NEM görren el a húzás alatt — a touch-action tényleg szól", async ({ page }) => {
    // Ez a teszt a létjogosultsága az egész böngészős készletnek: a generált
    // stíluslapról a mag tesztje csak annyit tud, hogy a szöveg benne van.
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
    // Lefelé húzás nem mozgatja az időt, de sávot sem: nincs mit görgetni.
    expect(after.crossOffset).toBe(0);
  });

  test("cooperative módban a lap görren, és a böngésző ELVESZI a gesztust", async ({ page }) => {
    await openDemo(page, "?touchAction=cooperative");
    expect(
      await page.evaluate(() => {
        const svg = document.querySelector("#frame svg");
        return svg === null ? "" : getComputedStyle(svg).touchAction;
      }),
    ).toBe("pan-y");
    await drag(page, { x: 200, y: MIDDLE_Y }, { x: 200, y: MIDDLE_Y - 140 }, 10);
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    // És itt jön a valódi pointercancel: a böngésző átvette a gesztust, a
    // könyvtárnak el kell engednie. Ezt szintetikus eseménnyel nem lehet
    // bizonyítani, csak állítani.
    const after = await stateOf(page);
    expect(after.gestures.some((entry) => entry.endsWith(":cancelled"))).toBe(true);
  });

  test("két ujj pinch-el, és a kezdő időpillanatok az ujjak alatt maradnak", async ({ page }) => {
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
    // A böngésző aszinkron: az utolsó pointermove feldolgozására VÁRNI kell,
    // nem feltételezni. A `poll` nem lazítás — ha a várt állapot sosem jön
    // meg, a teszt bukik; csak nem versenyzünk az eseménysorral.
    const expectedSpan = (before.spanDays * (right - left)) / (movedRight - movedLeft);
    await expect
      .poll(async () => (await stateOf(page)).spanDays, { timeout: 3000 })
      .toBeCloseTo(expectedSpan, 2);
    const after = await stateOf(page);
    // Szétfeszítés: a látható szakasz arányosan szűkül.
    expect(after.spanDays).toBeLessThan(before.spanDays);
    // A horgony: az ujjak alatti időpillanatok nem mozdultak.
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
    // Egy CSS-pixel: a böngészőben a koordináták is pixelre kerekítenek.
    expect(Math.max(...errors)).toBeLessThan(1);
    await touch(fingers, "touchEnd", []);
    await fingers.detach();
    expect((await stateOf(page)).gestures).toContain("gestureStart:pinch");
  });

  test("dupla koppintás bezoomol a megkoppintott pontra", async ({ page }) => {
    const before = await stateOf(page);
    await page.touchscreen.tap(200, MIDDLE_Y);
    await page.touchscreen.tap(200, MIDDLE_Y);
    const after = await stateOf(page);
    expect(after.spanDays).toBeCloseTo(before.spanDays / 2, 3);
    expect(after.gestures).toContain("tap:1x2");
  });

  test("két ujjas koppintás kizoomol", async ({ page }) => {
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

  test("a futó gesztus látszik az elemen, és utána nem", async ({ page }) => {
    const fingers = await fingersFor(page);
    await touch(fingers, "touchStart", [{ x: 300, y: MIDDLE_Y, id: 1 }]);
    await touch(fingers, "touchMove", [{ x: 200, y: MIDDLE_Y, id: 1 }]);
    // A konténeren, mert a kötés arra megy — az SVG minden képkockán új.
    await expect(page.locator("#frame")).toHaveAttribute("data-tl-gesture", "pan");
    await touch(fingers, "touchEnd", []);
    await fingers.detach();
    await expect(page.locator("#frame")).not.toHaveAttribute("data-tl-gesture", "pan");
  });
});

/**
 * A szerkesztés a böngészőben.
 *
 * Amit a mag tesztjei bizonyítanak: a gép helyesen dönt arról, mikor kezdődik
 * egy húzás. Amit CSAK itt lehet bizonyítani: hogy a böngésző-kötés egyetlen
 * időzítője tényleg lefut, hogy a `touch-action` a szerkesztés alatt is fogja
 * a lapot, és hogy ugyanazon a lapon, ugyanabban a munkamenetben az egér
 * azonnal húz, az ujj pedig tartásra vár. Ez utóbbi a hibrid eszköz állítása
 * — emulált telefonon is van egér, és pont az a kérdés, hogy a kettő nem
 * mossa össze egymást.
 */
test.describe("szerkesztés valódi érintéssel", () => {
  test.beforeEach(async ({ page }) => {
    await openDemo(page);
  });

  test("hosszú nyomás után az ujj HÚZZA az elemet, és a lap nem görren el", async ({ page }) => {
    const before = await stateOf(page);
    const from = await boxOf(page, "d");
    await holdThenDrag(page, from, { x: from.x + 70, y: from.y });
    const after = await stateOf(page);
    // Az elem elmozdult...
    expect(after.days.d).toBeGreaterThan(before.days.d);
    // ...a nézet NEM: egy szerkesztés nem pásztázás.
    expect(after.start).toBe(before.start);
    expect(after.gestures).toEqual([]);
    expect(after.edits).toContain("editStart:move:long-press");
    expect(after.edits).toContain("editEnd:move");
    expect(after.undoDepth).toBe(1);
    // A lap a húzás alatt sem görrent el.
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
  });

  test("ugyanaz a húzás tartás NÉLKÜL pásztáz, nem szerkeszt", async ({ page }) => {
    const before = await stateOf(page);
    const from = await boxOf(page, "d");
    await drag(page, from, { x: from.x + 70, y: from.y });
    const after = await stateOf(page);
    expect(after.days.d).toBe(before.days.d);
    expect(after.edits).toEqual([]);
    expect(after.gestures).toContain("gestureStart:pan");
  });

  test("az egér ugyanezen a lapon azonnal húz, tartás nélkül", async ({ page }) => {
    const before = await stateOf(page);
    const from = await boxOf(page, "d");
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    for (let step = 1; step <= 6; step += 1) {
      await page.mouse.move(from.x + (70 * step) / 6, from.y);
    }
    // A futó szerkesztés látszik az elemen — egy húzás, ami nem változtat
    // kurzort, leállt lapnak olvasódik.
    await expect(page.locator("#frame")).toHaveAttribute("data-tl-edit", "move");
    await page.mouse.up();
    await expect(page.locator("#frame")).not.toHaveAttribute("data-tl-edit", "move");
    const after = await stateOf(page);
    expect(after.days.d).toBeGreaterThan(before.days.d);
    expect(after.edits).toContain("editStart:move:pointer");
  });

  test("a fogantyú ujjal is azonnal méretez, tartás nélkül", async ({ page }) => {
    const before = await stateOf(page);
    const handle = await handleOf(page, "d");
    await drag(page, handle, { x: handle.x + 40, y: handle.y });
    const after = await stateOf(page);
    // A fogantyúra célozni már önmagában szándék: nem kell hozzá ceremónia.
    expect(after.edits).toContain("editStart:resize-end:handle");
    expect(after.edits).toContain("editEnd:resize-end");
    // A kezdet nem mozdult: a távolabbi él marad, ahol volt.
    expect(after.days.d).toBe(before.days.d);
    expect(after.undoDepth).toBe(1);
  });

  test("a hoszt szabálya megállítja a húzást, és nem keletkezik command", async ({ page }) => {
    const before = await stateOf(page);
    const from = await boxOf(page, "a");
    // Az „a" a projekt indulásakor kezdődik; balra húzni a szabály tiltja.
    await holdThenDrag(page, from, { x: from.x - 60, y: from.y });
    const after = await stateOf(page);
    expect(after.days.a).toBe(before.days.a);
    expect(after.edits).toContain("vetoed");
    expect(after.undoDepth).toBe(0);
  });

  test("a lezárt elem nem mozdul, a nézet pásztáz helyette", async ({ page }) => {
    const before = await stateOf(page);
    const from = await boxOf(page, "e");
    await holdThenDrag(page, from, { x: from.x - 60, y: from.y });
    const after = await stateOf(page);
    expect(after.days.e).toBe(before.days.e);
    expect(after.edits).toEqual([]);
    // Nincs mit megfogni, tehát a gesztus azt teszi, amit egyébként: pásztáz.
    expect(after.gestures).toContain("gestureStart:pan");
  });

  test("a visszavonás PONTOSAN visszaállítja a kiindulást", async ({ page }) => {
    const before = await stateOf(page);
    const from = await boxOf(page, "d");
    // Két lépés, kettő a veremben — egy undo-verem LIFO-ban bont.
    await holdThenDrag(page, from, { x: from.x + 40, y: from.y });
    const handle = await handleOf(page, "d");
    await drag(page, handle, { x: handle.x + 30, y: handle.y });
    const edited = await stateOf(page);
    expect(edited.undoDepth).toBe(2);
    expect(edited.days.d).not.toBe(before.days.d);

    await page.getByRole("button", { name: "Visszavonás" }).click();
    await page.getByRole("button", { name: "Visszavonás" }).click();
    const undone = await stateOf(page);
    expect(undone.undoDepth).toBe(0);
    expect(undone.days).toEqual(before.days);
    expect(undone.lanesOf).toEqual(before.lanesOf);
    await expect(page.getByRole("button", { name: "Visszavonás" })).toBeDisabled();
  });

  test("koppintás kijelöl, és a kijelölt elemek EGY commandként mozdulnak", async ({ page }) => {
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
    // Mindkettő ugyanannyit mozdult, és egyetlen command lett belőle.
    expect(after.days.a - selected.days.a).toBe(after.days.b - selected.days.b);
    expect(after.days.b).toBeGreaterThan(selected.days.b);
    expect(after.undoDepth).toBe(1);
  });
});
