// ESM and CJS. Vue and the sibling packages are EXTERNAL: an application can
// have only one Vue, and reactivity falls apart with a second copy.
import typescript from "@rollup/plugin-typescript";

const banner = "/*! @temporeum/timeline-vue | MIT */";

export default {
  input: "src/index.ts",
  external: (id) => id === "vue" || id.startsWith("vue/") || id.startsWith("@vue/") || id.startsWith("@temporeum/"),
  output: [
    { file: "dist/index.mjs", format: "es", sourcemap: true, banner },
    { file: "dist/index.cjs", format: "cjs", sourcemap: true, exports: "named", banner },
  ],
  plugins: [
    typescript({
      tsconfig: "./tsconfig.build.json",
      compilerOptions: { declaration: false, declarationMap: false, sourceMap: true, outDir: undefined, rootDir: undefined },
    }),
  ],
};
