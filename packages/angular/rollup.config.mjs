// One ES module, from ngc's partial output (build/): the Angular Package
// Format's flat bundle. Angular and the sibling packages stay external —
// one Angular per application.
const banner = "/*! @temporeum/timeline-angular | MIT */";

export default {
  input: "build/index.js",
  external: (id) => id.startsWith("@angular/") || id.startsWith("@temporeum/") || id === "tslib" || id === "rxjs" || id.startsWith("rxjs/"),
  output: [{ file: "dist/index.mjs", format: "es", sourcemap: false, banner }],
};
