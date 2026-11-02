// Deletes dist before a build — without this, the .d.ts of a deleted source
// file stays behind, and the exports map can point at a type that no longer exists.
import { rmSync } from "node:fs";
rmSync(new URL("../dist", import.meta.url), { recursive: true, force: true });
