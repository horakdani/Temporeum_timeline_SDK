// Two builds. ESM/CJS leave the core EXTERNAL: in a bundled application it
// is present once, however many packages ask for it. The UMD is for the
// `<script>` tag, where nothing resolves the import — the core is compiled
// into it too, and it registers the element on load.
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import typescript from "@rollup/plugin-typescript";

import { minifyUmd } from "../core/scripts/minify-umd.mjs";

// One shared chunk, the element's base (element.shared): the plugins' and the
// calendar's own files import from there, not from a scatter of small chunks —
// a page makes as many requests as it did before the plugins were split out.
const OWN = /\/src\/(gantt|resources|export|tools|groups|items|intl|story|calendar|calendar-view|task-grid|backlog|define|index)\.ts$/;
const manualChunks = (id) => (/\/src\/[^/]+\.ts$/.test(id) && !OWN.test(id) ? "element" : undefined);

const banner = "/*! @temporeum/timeline-element | MIT */";
const core = dirname(createRequire(import.meta.url).resolve("@temporeum/timeline-core/package.json"));

const ts = () =>
  typescript({
    tsconfig: "./tsconfig.build.json",
    include: ["src/**/*.ts"],
    compilerOptions: { declaration: false, declarationMap: false, sourceMap: true, inlineSources: true, outDir: undefined, rootDir: undefined },
  });

export default [
  {
    // In one build, so that define imports the shared module rather than a
    // copy of its own: two separate classes would give two different `instanceof`s.
    input: {
      index: "src/index.ts",
      define: "src/define.ts",
      calendar: "src/calendar.ts",
      gantt: "src/gantt.ts",
      resources: "src/resources.ts",
      export: "src/export.ts",
      tools: "src/tools.ts",
      groups: "src/groups.ts",
      items: "src/items.ts",
      intl: "src/intl.ts",
      story: "src/story.ts",
    },
    external: (id) => id === "@temporeum/timeline-core" || id.startsWith("@temporeum/timeline-core/"),
    output: [
      { dir: "dist", format: "es", entryFileNames: "[name].mjs", chunkFileNames: "[name].shared.mjs", manualChunks, sourcemap: true, banner },
      { dir: "dist", format: "cjs", entryFileNames: "[name].cjs", chunkFileNames: "[name].shared.cjs", manualChunks, sourcemap: true, exports: "named", banner },
    ],
    plugins: [ts()],
  },
  {
    input: "src/umd.ts",
    output: { file: "dist/timeline-element.umd.js", format: "umd", name: "TemporeumTimelineElement", sourcemap: false, exports: "named", banner, plugins: [minifyUmd()] },
    plugins: [
      {
        // The core is compiled in from its built ESM, not from its source: the
        // same code the core itself ships.
        name: "core-from-dist",
        resolveId(id) {
          if (id === "@temporeum/timeline-core") return join(core, "dist/index.mjs");
          // Every subpath (/dom, /groups, /items) is its own built file.
          if (id.startsWith("@temporeum/timeline-core/")) return join(core, `dist/${id.slice("@temporeum/timeline-core/".length)}.mjs`);
          return null;
        },
      },
      ts(),
    ],
  },
];
