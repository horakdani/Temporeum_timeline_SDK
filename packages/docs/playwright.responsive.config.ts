import { defineConfig } from "@playwright/test";

/** Ugyanaz a saját port, mint az érintéses készleté — a kettő sorban fut. */
const PORT = Number(process.env.TL_E2E_PORT ?? 41737);

/**
 * A reszponzív készlet konfigja — KÜLÖN fájl, nem egy második projekt az
 * érintéses mellett.
 *
 * Két ok. Az érintéses készlet minden projektjén lefut (`playwright test
 * e2e/touch.spec.ts` projekt-szűrés nélkül), tehát egy itt felvett asztali
 * projekt ott is futtatná a Pixel 7-re írt gesztusokat. És a riportja más
 * fájlba megy: a két kapu két külön bizonyítékot olvas, és egyik futás sem
 * írhatja felül a másik riportját.
 *
 * Az eszközök a spec-ben vannak, szélességenként (`test.use`), mert a
 * szélesség maga a mérés tárgya: 375 / 768 / 1440 px, és mindegyik a saját
 * kezével — a telefon és a tablet érintéssel, az asztal egérrel.
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: "responsive.spec.ts",
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [["list"], ["json", { outputFile: ".e2e-responsive-report.json" }]],
  use: {
    baseURL: `http://127.0.0.1:${String(PORT)}`,
    channel: "chromium-headless-shell",
    trace: "off",
  },
  projects: [{ name: "widths", use: { channel: "chromium-headless-shell" } }],
  webServer: {
    command: "node e2e/serve.mjs",
    url: `http://127.0.0.1:${String(PORT)}/responsive.html`,
    // Lásd az érintéses konfigot: idegen vagy régi szervert nem fogadunk el.
    reuseExistingServer: false,
    timeout: 20_000,
  },
});
