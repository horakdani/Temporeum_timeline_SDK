import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The core runs in Node, without a DOM — the basis of the G-NODOM check.
    environment: "node",
    include: ["test/**/*.test.ts"],
    // A per-test time limit, not a performance threshold (G-PERF measures that).
    // The vitest default is 5 s, and that measures the MACHINE's load: the
    // [claim:contiguous] property takes 1.4 s on its own, 3.9–5.4 s in the
    // parallel coverage run, and once timed out at 5.36 s in a gate run.
    // Likewise the render-cache, mount and room properties run in 2–4 s
    // without a limit. The heaviest ones (conservation, no-stale) already set
    // 120–240 s themselves; this is the common upper bound for the rest. A
    // real hang still fails — at 30 s, not from the load of neighbouring tests.
    testTimeout: 30_000,
    typecheck: {
      // A type test is as much a test as a runtime one: the shape of the
      // public API is part of the product.
      enabled: true,
      include: ["test/**/*.test-d.ts"],
      tsconfig: "./tsconfig.json",
    },
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      // Type declarations have no executable lines; they would dilute the
      // coverage figure.
      exclude: ["src/types.ts"],
      reporter: ["text", "json-summary"],
      thresholds: {
        // Per file, not in aggregate. The aggregate threshold let the whole
        // test suite of ticks.ts disappear: other tests still ran the module
        // indirectly, so its lines stayed "covered" while nothing asserted
        // anything about them — at 94.7% in aggregate. The per-file threshold
        // does not allow that silence.
        perFile: true,
        lines: 90,
        functions: 90,
        branches: 90,
        statements: 90,
      },
    },
  },
});
