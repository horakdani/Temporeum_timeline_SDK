// The core's build. The entry points are in entries.json, the configuration
// comes from the scripts/build-config.mjs factory: ESM + CJS in one
// multi-input build, with shared chunks; UMD standalone per entry point.
//
// `dom` is a separate entry point because the core being DOM-free is a
// provable claim: whatever touches the browser does not come from the barrel,
// and a server-side import does not even load it. `dom` imports only TYPES
// from the core, so it has no shared chunk.
import { readFileSync } from "node:fs";
import { createConfig } from "./scripts/build-config.mjs";

const { entries } = JSON.parse(readFileSync(new URL("./entries.json", import.meta.url), "utf8"));

export default createConfig({
  entries,
  banner: "/*! @temporeum/timeline-core | MIT */",
  tsconfig: "./tsconfig.build.json",
});
