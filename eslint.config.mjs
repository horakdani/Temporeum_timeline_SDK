// Az idővonal-SDK lintje. SZÁNDÉKOSAN csak a packages/ és a scripts/sdk_*.mjs
// alá néz: a repó többi része nem ennek a kampánynak a hatóköre, és a
// lintelése hamis pirosat adna a CI-ban.
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default [
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/coverage/**",
      "static/**",
      "templates/**",
      ".venv/**",
      "demo/**",
      "fix/**",
      "qa/**",
      "sdk/reports/**",
      // A G-SSR smoke munkakönyvtára: telepített keretrendszerek és a
      // buildjeik kimenete, nem a kampány forrása.
      "**/.ssr-work/**",
      // A sablonok es a benchmark munkakonyvtara: telepitett keretrendszerek,
      // ugyanazert, amiert a .ssr-work.
      "**/.templates-work/**",
      "**/.bench-work/**",
      // A svelte-package munkamappaja és a Svelte-hidratálás tesztjének
      // szerverre fordított komponense: kimenet, nem forrás.
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
      // A nulla-függőség és a típusos API a termék lényege, nem stílus.
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-imports": "error",
      "no-console": "error",
      eqeqeq: ["error", "always"],
    },
  },
  {
    // A mag forrása nem nyúlhat a DOM-hoz futásidőben. A típusok rendelkezésre
    // állnak (lib: DOM), a globálok nem — ez a PLAN.md 2. döntésének statikus
    // kikényszerítése. A P0 azt várta, hogy a renderelő ezt fel fogja
    // lazítani; nem kellett. A P3 scene-gráfot ad, a P4 böngésző-kötése
    // (`src/dom/`) pedig PARAMÉTERBEN kapja az elemet, ezért egyetlen DOM
    // globálhoz sem nyúl. A lista a kampány végéig érintetlen — ez a
    // szerveroldali út bizonyítéka, nem jószándék.
    files: ["packages/core/src/**/*.ts"],
    rules: {
      "no-restricted-globals": [
        "error",
        { name: "window", message: "A mag DOM-független — a hostra tartozik." },
        { name: "document", message: "A mag DOM-független — a hostra tartozik." },
        { name: "navigator", message: "A mag DOM-független — a hostra tartozik." },
        { name: "localStorage", message: "A könyvtár soha nem ment." },
        { name: "sessionStorage", message: "A könyvtár soha nem ment." },
        { name: "fetch", message: "A könyvtár soha nem hálózik — esemény jön ki, a host dönt." },
        { name: "XMLHttpRequest", message: "A könyvtár soha nem hálózik." },
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
    // A docs-oldal generatora es a tesztjei: Node-szkriptek, a kampany
    // tobbi szkriptjenek szabalyaival.
    files: ["packages/docs/scripts/*.mjs", "packages/docs/test/*.mjs"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: { process: "readonly", console: "readonly", URL: "readonly" },
    },
    rules: { ...js.configs.recommended.rules, eqeqeq: ["error", "always"] },
  },
  {
    // Az elo peldak futtatoja: bongeszoben fut, a lapon.
    files: ["packages/docs/site/assets/*.js"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: { document: "readonly", window: "readonly", addEventListener: "readonly", parent: "readonly", console: "readonly", requestAnimationFrame: "readonly", setTimeout: "readonly", URL: "readonly" },
    },
    rules: { ...js.configs.recommended.rules, eqeqeq: ["error", "always"] },
  },
];
