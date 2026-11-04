import { defineConfig, devices } from "@playwright/test";

/**
 * The browser half of the ssr check. The servers are started by scripts/sdk_check_ssr.mjs
 * (Next, Nuxt, Astro, SvelteKit, Angular, all with the packed tarballs), which passes
 * their addresses in TL_SSR_TARGETS; this config only runs the measurement.
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: "ssr.spec.ts",
  workers: 1,
  retries: 0,
  reporter: [["list"], ["json", { outputFile: ".e2e-ssr-report.json" }]],
  use: { ...devices["Desktop Chrome"], channel: "chromium-headless-shell", trace: "off" },
});
