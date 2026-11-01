import type { MouseStep } from "../vitest.config.js";

declare module "vitest/browser" {
  interface BrowserCommands {
    mouse: (steps: readonly MouseStep[]) => Promise<void>;
  }
}
