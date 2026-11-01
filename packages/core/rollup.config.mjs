// A mag buildje. A belépési pontok az entries.json-ban vannak, a konfiguráció
// a scripts/build-config.mjs gyárából jön: ESM + CJS egy többbemenetes
// buildben, közös darabokkal; UMD belépési pontonként önállóan.
//
// A `dom` azért külön belépési pont, mert a mag DOM-mentessége bizonyítható
// állítás: ami a böngészőhöz nyúl, az nem a barrelből jön, és egy
// szerveroldali import nem is tölti be. A `dom` csak TÍPUSOKAT importál a
// magból, ezért nincs közös darabja.
import { readFileSync } from "node:fs";
import { createConfig } from "./scripts/build-config.mjs";

const { entries } = JSON.parse(readFileSync(new URL("./entries.json", import.meta.url), "utf8"));

export default createConfig({
  entries,
  banner: "/*! @temporeum/timeline-core | MIT */",
  tsconfig: "./tsconfig.build.json",
});
