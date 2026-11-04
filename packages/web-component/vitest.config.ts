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
 * - `browser`: the element and the instance in a real Chromium (Playwright),
 *   with a real custom element registry, shadow DOM, declarative shadow root,
 *   and mouse, wheel and keyboard input sent over CDP. Of these, a simulated
 *   DOM could not do hydration in particular.
 *
 * Coverage is the union of the two, with a 90% threshold per file, as in the core.
 */
/**
 * The browser suite's engine: Chromium unless TL_BROWSER names another
 * (`firefox`, `webkit`) — scripts/sdk_test_browsers.mjs runs the suite in all
 * three. Only Chromium has a headless shell.
 */
const engine = (process.env.TL_BROWSER ?? "chromium") as "chromium" | "firefox" | "webkit";
if (!["chromium", "firefox", "webkit"].includes(engine)) throw new Error(`TL_BROWSER: no such engine: ${engine}`);

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
          // Playwright's Firefox and WebKit run the files' frames in one page,
          // with one mouse: two files dragging at once move each other's pointer.
          fileParallelism: engine === "chromium",
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(engine === "chromium" ? { launchOptions: { channel: "chromium-headless-shell" } } : {}),
            instances: [{ browser: engine, viewport: { width: 1200, height: 900 } }],
            commands: { mouse },
            screenshotFailures: false,
          },
        },
      },
    ],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      // It only re-exports and registers on load: its executable line is one
      // call, which the UMD test measures on the finished bundle.
      exclude: ["src/umd.ts"],
      reporter: ["text", "json-summary"],
      thresholds: { perFile: true, lines: 90, functions: 90, branches: 90, statements: 90 },
    },
  },
});
