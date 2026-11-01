import { defineConfig, devices } from "@playwright/test";

/**
 * A port. SZÁNDÉKOSAN nem 4173: az a Vite `preview` alapértelmezése, tehát a
 * gépen futó bármelyik másik projekt ráülhet. Egy kapu, ami idegen lapot mér,
 * rosszabb, mint a hiányzó kapu.
 */
const PORT = Number(process.env.TL_E2E_PORT ?? 41737);

/**
 * Playwright: a böngészős bizonyíték.
 *
 * Amit a mag tesztjei nem tudnak megmondani: hogy a BÖNGÉSZŐ egyetért-e.
 * A gesztus-logika szintetikus pointer-szekvenciákon fut, DOM nélkül, és ott
 * is kell futnia; de hogy a `touch-action` tényleg leállítja-e a lapgörgetést
 * egy igazi ujj alatt, azt csak igazi ujjal lehet megmérni.
 *
 * `chromium-headless-shell`: a telepített, verzióhoz kötött binárist
 * használja. Eszköz-emulációval (Pixel 7) a lap érintőképernyőt lát, a
 * koordináták CSS-pixelben mennek, és a CDP `Input.dispatchTouchEvent`
 * KÉT érintési pontot is tud — ezért van egyáltalán pinch-tesztünk.
 */
export default defineConfig({
  testDir: "./e2e",
  // A gesztusok állapotgépe soros: párhuzamos futás egy porton osztozna.
  workers: 1,
  fullyParallel: false,
  // Egy flaky e2e rosszabb, mint egy hiányzó: újrapróbálás nincs, hogy a
  // bizonytalanság látszódjon.
  retries: 0,
  reporter: [["list"], ["json", { outputFile: ".e2e-touch-report.json" }]],
  use: {
    baseURL: `http://127.0.0.1:${String(PORT)}`,
    channel: "chromium-headless-shell",
    trace: "off",
  },
  projects: [
    {
      name: "pixel-7",
      use: { ...devices["Pixel 7"], channel: "chromium-headless-shell" },
    },
  ],
  webServer: {
    command: "node e2e/serve.mjs",
    url: `http://127.0.0.1:${String(PORT)}/index.html`,
    // `false`, és nem `true`. A `true` azt jelenti: ha valaki ül a porton,
    // tegyük fel, hogy az a mi szerverünk. 2026-10-26-án nem az volt: egy
    // másik projekt `vite preview --port 4173`-ja ült rajta, és a böngészős
    // készlet 15 tesztje egy IDEGEN lapon futott. Mind bukott, és a bukás
    // semmit nem mondott arról, hogy miért. Az igazi veszély viszont a
    // fordítottja: a MI szerverünk egy régi dist-tel, amitől a készlet
    // ZÖLDEN hazudik. `false` mellett a Playwright maga indítja, és ha a
    // port foglalt, a szerver hangosan elhasal.
    reuseExistingServer: false,
    timeout: 20_000,
  },
});
