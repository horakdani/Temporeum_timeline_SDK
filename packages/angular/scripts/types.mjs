// The declarations ngc wrote to build/, beside the bundle in dist/, and
// build/ gone: the package carries dist only.
import { cpSync, existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

for (const file of readdirSync("build")) {
  if (file.endsWith(".d.ts")) cpSync(join("build", file), join("dist", file));
}
if (!existsSync(join("dist", "index.d.ts"))) throw new Error("no index.d.ts from ngc");
rmSync("build", { recursive: true, force: true });
