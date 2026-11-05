// Lint config. It DELIBERATELY looks only at packages/, the scripts/sdk_*.mjs
// tools and the root config files: anything else at the root is not source.
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default [
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/coverage/**",
      // Everything at the root but packages/, scripts/sdk_*.mjs and the
      // root config files.
      "*",
      "!packages/",
      "!scripts/",
      "scripts/*",
      "!scripts/sdk_*.mjs",
      "!*.config.mjs",
      // The SSR smoke test's working directory: installed frameworks and
      // their build output, not SDK source.
      "**/.ssr-work/**",
      // The templates' and the benchmark's working directories: installed
      // frameworks, for the same reason as .ssr-work.
      "**/.templates-work/**",
      "**/.bench-work/**",
      // svelte-package's working folder and the server-compiled component of
      // the Svelte hydration test: output, not source.
      "**/.svelte-kit/**",
      "**/.ssr/**",
    ],
  },
  {
    files: ["packages/**/*.ts", "packages/**/*.mts"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { project: false, sourceType: "module" },
    },
    plugins: { "@typescript-eslint": tseslint.plugin },
    rules: {
      ...js.configs.recommended.rules,
      ...tseslint.configs.recommended.reduce(
        (acc, c) => ({ ...acc, ...(c.rules ?? {}) }),
        {},
      ),
      // Zero dependencies and a typed API are the point of the product, not style.
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-imports": "error",
      "no-console": "error",
      eqeqeq: ["error", "always"],
    },
  },
  {
    // The tests and the end-to-end specs, with type information: a promise a
    // test forgets to await is an assertion that never runs, and only the
    // types can tell a promise from a value. Each file is in its package's
    // tsconfig (packages/docs/tsconfig.json for the specs and the configs).
    files: ["packages/*/test/**/*.ts", "packages/docs/e2e/**/*.ts"],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/await-thenable": "error",
      // A focused test runs alone and leaves the rest of its file unrun, green.
      "no-restricted-properties": [
        "error",
        ...["it", "test", "describe", "suite"].map((object) => ({ object, property: "only", message: "A focused test leaves the others unrun." })),
      ],
    },
  },
  {
    // The core's source must not touch the DOM at runtime. The types are
    // available (lib: DOM), the globals are not — this enforces the design
    // decision statically. It was expected that the renderer would need this
    // relaxed; it did not. The renderer produces a scene graph, and the browser
    // binding (`src/dom/`) receives the element as a PARAMETER, so it touches
    // no DOM global at all. The list stays as it is — it is proof of the
    // server-side path, not good intentions.
    files: ["packages/core/src/**/*.ts"],
    rules: {
      "no-restricted-globals": [
        "error",
        { name: "window", message: "The core is DOM-independent — this belongs to the host." },
        { name: "document", message: "The core is DOM-independent — this belongs to the host." },
        { name: "navigator", message: "The core is DOM-independent — this belongs to the host." },
        { name: "localStorage", message: "The library never persists anything." },
        { name: "sessionStorage", message: "The library never persists anything." },
        { name: "fetch", message: "The library never makes network requests — it emits an event, the host decides." },
        { name: "XMLHttpRequest", message: "The library never makes network requests." },
      ],
    },
  },
  {
    files: ["scripts/sdk_*.mjs", "*.config.mjs", "packages/*/*.config.mjs"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: {
        process: "readonly",
        console: "readonly",
        URL: "readonly",
        Buffer: "readonly",
        TextEncoder: "readonly",
      },
    },
    rules: { ...js.configs.recommended.rules },
  },
  {
    // The docs site generator and its tests: Node scripts, with the same
    // rules as the other scripts.
    files: ["packages/docs/scripts/*.mjs", "packages/docs/test/*.mjs"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: { process: "readonly", console: "readonly", URL: "readonly" },
    },
    rules: { ...js.configs.recommended.rules, eqeqeq: ["error", "always"] },
  },
  {
    // The live examples' runner: runs in the browser, on the page.
    files: ["packages/docs/site/assets/*.js"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: { document: "readonly", window: "readonly", addEventListener: "readonly", parent: "readonly", console: "readonly", requestAnimationFrame: "readonly", setTimeout: "readonly", URL: "readonly" },
    },
    rules: { ...js.configs.recommended.rules, eqeqeq: ["error", "always"] },
  },
];
