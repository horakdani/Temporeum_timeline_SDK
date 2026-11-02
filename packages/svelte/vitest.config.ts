import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { svelte } from "@sveltejs/vite-plugin-svelte";
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

const here = dirname(fileURLToPath(import.meta.url));

/**
 * The component's server output, for the hydration test: compiled for the
 * server and rendered by `svelte/server` here, in Node — the browser bundle
 * only has the client build. The same source file, the same props.
 */
const ssr: BrowserCommand<[props: Record<string, unknown>]> = async (_context, props) => {
  const { compile } = await import("svelte/compiler");
  const { render } = await import("svelte/server");
  const { js } = compile(readFileSync(join(here, "src/Timeline.svelte"), "utf8"), { generate: "server", filename: "Timeline.svelte" });
  const out = join(here, ".ssr");
  mkdirSync(out, { recursive: true });
  const file = join(out, `Timeline.${String(process.pid)}.${String(Date.now())}.js`);
  writeFileSync(file, js.code);
  const { default: Timeline } = (await import(pathToFileURL(file).href)) as { default: unknown };
  return (render as (component: unknown, options: { props: Record<string, unknown> }) => { body: string })(Timeline, { props }).body;
};

/**
 * Two suites, two environments — because the package makes two promises.
 *
 * - `node`: the server side. There is NO window or document here; if a module
 *   reached for the DOM on import, this suite would not even load.
 * - `browser`: the component in a real Chromium (Playwright), with real Svelte:
 *   mount, hydrate on the server output (rendered by a Node-side command), and
 *   mouse and keyboard input sent over CDP.
 *
 * Coverage is the union of the two, with a 90% threshold per file, as in the core.
 */
export default defineConfig({
  plugins: [svelte()],
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
            commands: { mouse, ssr },
            screenshotFailures: false,
          },
        },
      },
    ],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts", "src/**/*.svelte"],
      reporter: ["text", "json-summary"],
      thresholds: { perFile: true, lines: 90, functions: 90, branches: 90, statements: 90 },
    },
  },
});
