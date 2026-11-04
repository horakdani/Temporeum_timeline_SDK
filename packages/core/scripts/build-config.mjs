// The factory for the core's rollup configuration — the entry points come
// from entries.json, not from this file.
//
// Why a factory, and why rollup.config.mjs alone is not enough. The
// the treeshake check (`npm run test:treeshake`, scripts/sdk_check_treeshake.mjs) builds a small sample
// package with THIS factory as well, to prove the shared chunking on the
// mechanism of the shipped build — even when the real entry points happen not
// to share code. If the sample were built with a configuration of its own, the
// check would prove that configuration, not ours.
//
// Three outputs:
//
//  - ESM and CJS in ONE multi-input build, with shared chunks (`chunks/`).
//    An entry point that uses the core's code imports it rather than copying
//    it: a consumer of two entry points gets the shared code once. Chunk
//    names carry no hash, so that dist is deterministic (the fingerprint and
//    the deps check read the file names).
//  - UMD standalone per entry point: a <script> tag cannot load a chunk, so
//    there duplication is the price of single-file use.
//
// `external` is empty ON PURPOSE: the core has zero runtime dependencies.
import typescript from "@rollup/plugin-typescript";

import { minifyUmd } from "./minify-umd.mjs";

/**
 * @param {{
 *   entries: ReadonlyArray<{ name: string; input: string; umd: string }>;
 *   banner: string;
 *   tsconfig: string;
 *   split?: boolean;
 * }} options `split: false` gives the unchunked ESM/CJS build, standalone
 *   per entry point — the negative control of the treeshake check, not a release mode.
 */
export function createConfig({ entries, banner, tsconfig, split = true }) {
  const ts = () =>
    typescript({
      tsconfig,
      // The `build:types` step writes the .d.ts files; rollup only produces code.
      compilerOptions: {
        declaration: false,
        declarationMap: false,
        sourceMap: true,
        // The maps carry the source: the package ships dist/, not src/.
        inlineSources: true,
        outDir: undefined,
      },
    });

  // The preserved (`/*!`) license header sits only in the base entry point's
  // file; the other ESM/CJS files get the same text as a plain comment, which
  // the minifier drops. Minifiers keep every `/*!` the bundle touches, so a
  // consumer would pay for the header as many times as it loads one of our
  // files — on the standalone /dom measurement that was 22 bytes of the 4 kB
  // budget. The license is not lost: a non-base entry point imports the core
  // from the base, and the bundle keeps the base's header. The standalone UMDs
  // keep their own header.
  const plainBanner = banner.replace(/^\/\*!/, "/*");
  const modular = (format, ext) => ({
    format,
    dir: "dist",
    entryFileNames: `[name].${ext}`,
    chunkFileNames: `chunks/[name].${ext}`,
    sourcemap: true,
    banner: (chunk) => (chunk.isEntry && chunk.name === "index" ? banner : plainBanner),
    ...(format === "cjs" ? { exports: "named" } : {}),
  });

  const umd = (entry) => ({
    input: entry.input,
    external: [],
    output: {
      file: `dist/${entry.name}.umd.js`,
      format: "umd",
      name: entry.umd,
      // The script-tag build, minified: the ESM and CommonJS builds carry
      // the maps, and are the ones a bundler reads.
      sourcemap: false,
      exports: "named",
      banner,
      plugins: [minifyUmd()],
    },
    plugins: [ts()],
  });

  // Where a module goes. The rule: a non-base entry point's OWN code is in its
  // own folder (`src/<name>/`), everything else is the core, and the core's
  // code stays in the base entry point's (`index`) file. So a consumer of the
  // base alone gets the same single file as before chunking (the boundary of a
  // separate shared chunk cost 100 bytes on the core and 20 on /dom), and the
  // other entry points import the core from index rather than copying it.
  // Rollup makes a chunk (`chunks/`) of two non-base entry points' shared code
  // on its own.
  const base = entries.find((entry) => entry.name === "index");
  const ownDirs = entries
    .filter((entry) => entry !== base)
    .map((entry) => entry.input.replace(/\/index\.ts$/, "/").replace(/^\.\//, ""));
  const manualChunks =
    base === undefined
      ? undefined
      : (id) => {
          const rel = id.replaceAll("\\", "/");
          const srcAt = rel.lastIndexOf("/src/");
          if (srcAt === -1) return undefined;
          const local = rel.slice(srcAt + 1);
          // `src/shared/` is code shared by two non-base entry points (/live
          // and /tools, /words and /intl): it belongs neither to the base nor
          // to either of them — rollup makes a shared chunk of it, so the base
          // does not grow from it (the size check), and neither consumer gets the
          // other's own code (the treeshake check).
          if (local.startsWith("src/shared/")) return undefined;
          return ownDirs.some((dir) => local.startsWith(dir)) ? undefined : "index";
        };

  const modularBuilds = split
    ? [
        {
          input: Object.fromEntries(entries.map((entry) => [entry.name, entry.input])),
          external: [],
          // The entry points' signature is STRICT: an entry point exports
          // exactly its public surface, nothing more. If another entry point
          // uses internal code from the core (/dom uses formatNumber), rollup
          // puts the core's code in a `chunks/index` chunk, and index.mjs only
          // re-exports. `allow-extension` would save that boundary, but it
          // would put internal names in the core's namespace — when the entry
          // points were split, ESM exposed an `f` and CJS `formatNumber`, and
          // the entries check (ESM = CJS = UMD) failed on it.
          output: [
            { ...modular("es", "mjs"), manualChunks },
            { ...modular("cjs", "cjs"), manualChunks },
          ],
          plugins: [ts()],
        },
      ]
    : entries.map((entry) => ({
        input: { [entry.name]: entry.input },
        external: [],
        output: [modular("es", "mjs"), modular("cjs", "cjs")],
        plugins: [ts()],
      }));

  return [...modularBuilds, ...entries.map(umd)];
}
