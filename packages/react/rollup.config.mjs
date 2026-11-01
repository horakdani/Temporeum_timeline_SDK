// ESM és CJS. A React és a testvércsomagok KÜLSŐK: egy alkalmazásban
// egyetlen React lehet, és a horgok egy második példánnyal eltörnek.
//
// A "use client" a fájl élén marad: a Next App Routere ebből tudja, hogy a
// komponens a kliensen fut (a szerveren is renderelhető, de horgokat hív).
// A rollup a modul-szintű direktívákat kidobja, ezért bannerként kerül vissza.
import typescript from "@rollup/plugin-typescript";

const banner = '"use client";\n/*! @temporeum/timeline-react | MIT */';

export default {
  input: "src/index.ts",
  external: (id) => id === "react" || id.startsWith("react/") || id === "react-dom" || id.startsWith("react-dom/") || id.startsWith("@temporeum/"),
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
