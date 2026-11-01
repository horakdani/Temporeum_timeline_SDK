import { defineConfig, devices } from "@playwright/test";

/**
 * G-SSR böngészős fele. A szervereket a scripts/sdk_check_ssr.mjs indítja
 * (Next, Nuxt, Astro, SvelteKit, Angular, mind a csomagolt tarballokkal), és a címüket a
 * TL_SSR_TARGETS-ben adja át; ez a konfiguráció csak a mérést futtatja.
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: "ssr.spec.ts",
  workers: 1,
  retries: 0,
  reporter: [["list"], ["json", { outputFile: ".e2e-ssr-report.json" }]],
  use: { ...devices["Desktop Chrome"], channel: "chromium-headless-shell", trace: "off" },
});
