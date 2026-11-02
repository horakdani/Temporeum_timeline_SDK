import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";
import type { Frame, Page } from "playwright";
import type { BrowserCommand } from "vitest/node";

/** One step of real mouse input, in the test frame's CSS pixels. */
export interface MouseStep {
  readonly type: "move" | "down" | "up" | "wheel";
  readonly x?: number;
  readonly y?: number;
  readonly steps?: number;
  readonly deltaY?: number;
  readonly modifiers?: readonly ("Control" | "Shift" | "Alt")[];
}

/**
 * Real mouse input through Playwright (CDP), for what `userEvent` cannot
 * say: a drag with intermediate moves, a wheel with Ctrl held. The test
 * runs in an iframe, so its coordinates are shifted by the frame's box.
 */
const mouse: BrowserCommand<[steps: readonly MouseStep[]]> = async (context, steps) => {
  const { page } = context as unknown as { page: Page };
  const frame = await (context as unknown as { frame(): Promise<Frame> }).frame();
  const box = (await (await frame.frameElement()).boundingBox()) ?? { x: 0, y: 0 };
  for (const step of steps) {
    for (const key of step.modifiers ?? []) await page.keyboard.down(key);
    if (step.type === "move") await page.mouse.move(box.x + (step.x ?? 0), box.y + (step.y ?? 0), { steps: step.steps ?? 1 });
    else if (step.type === "down") await page.mouse.down();
    else if (step.type === "up") await page.mouse.up();
    else await page.mouse.wheel(0, step.deltaY ?? 0);
    for (const key of [...(step.modifiers ?? [])].reverse()) await page.keyboard.up(key);
  }
};

/**
 * Two suites, two environments — because the package makes two promises.
 *
 * - `node`: the server side. There is NO window or document here; if a module
 *   reached for the DOM on import, this suite would not even load.
 * - `browser`: the component in a real Chromium (Playwright), with real Vue:
 *   createApp, createSSRApp on the server output (hydration), and mouse and
 *   keyboard input sent over CDP. Renders are counted by the probe
 *   components' own counters (every render is one increment).
 *
 * Coverage is the union of the two, with a 90% threshold per file, as in the core.
 */
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "node",
          environment: "node",
          include: ["test/**/*.node.test.ts"],
        },
      },
      {
        test: {
          name: "browser",
          include: ["test/**/*.browser.test.ts"],
          browser: {
            enabled: true,
            headless: true,
            provider: playwright({ launchOptions: { channel: "chromium-headless-shell" } }),
            instances: [{ browser: "chromium", viewport: { width: 1200, height: 900 } }],
            commands: { mouse },
            screenshotFailures: false,
          },
        },
      },
    ],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      reporter: ["text", "json-summary"],
      thresholds: { perFile: true, lines: 90, functions: 90, branches: 90, statements: 90 },
    },
  },
});
