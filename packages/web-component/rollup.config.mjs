// Két build. Az ESM/CJS a magot KÜLSŐNEK hagyja: egy bundleres
// alkalmazásban egy példányban van jelen, akárhány csomag kéri. A UMD a
// `<script>`-tagé, ott nincs, aki feloldja az importot — abba a mag is
// belefordul, és betöltéskor regisztrálja az elemet.
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import typescript from "@rollup/plugin-typescript";

// Egy közös darab, az elem alapja (element.shared): a pluginok és a naptár
// saját fájljai onnan importálnak, nem egy-egy szétforgácsolt darabból — egy
// oldal annyi kérést kap, mint a pluginok előtt.
const OWN = /\/src\/(gantt|resources|export|tools|groups|items|intl|story|calendar|calendar-view|task-grid|backlog|define|index)\.ts$/;
const manualChunks = (id) => (/\/src\/[^/]+\.ts$/.test(id) && !OWN.test(id) ? "element" : undefined);

const banner = "/*! @temporeum/timeline-element | MIT */";
const core = dirname(createRequire(import.meta.url).resolve("@temporeum/timeline-core/package.json"));

const ts = () =>
  typescript({
    tsconfig: "./tsconfig.build.json",
    include: ["src/**/*.ts"],
    compilerOptions: { declaration: false, declarationMap: false, sourceMap: true, outDir: undefined, rootDir: undefined },
  });

export default [
  {
    // Egy buildben, hogy a define a közös modult importálja, ne a saját
    // másolatát: két külön osztály két különböző `instanceof`-ot adna.
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
    output: { file: "dist/timeline-element.umd.js", format: "umd", name: "TemporeumTimelineElement", sourcemap: true, exports: "named", banner },
    plugins: [
      {
        // A mag a buildelt ESM-jéből fordul bele, nem a forrásából: ugyanaz
        // a kód, amit a mag maga szállít.
        name: "core-from-dist",
        resolveId(id) {
          if (id === "@temporeum/timeline-core") return join(core, "dist/index.mjs");
          // Minden alútvonal (/dom, /groups, /items) a saját buildelt fájlja.
          if (id.startsWith("@temporeum/timeline-core/")) return join(core, `dist/${id.slice("@temporeum/timeline-core/".length)}.mjs`);
          return null;
        },
      },
      ts(),
    ],
  },
];
