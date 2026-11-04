// ESM and CJS. React and the sibling packages are EXTERNAL: an application
// can have only one React, and hooks break with a second copy.
//
// "use client" stays at the top of the file: that is how the Next App Router
// knows the component runs on the client (it can render on the server too,
// but it calls hooks). Rollup drops module-level directives, so it goes back
// in as a banner.
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
      compilerOptions: { declaration: false, declarationMap: false, sourceMap: true, inlineSources: true, outDir: undefined, rootDir: undefined },
    }),
  ],
};
