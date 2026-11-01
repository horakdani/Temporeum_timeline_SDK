// A dist törlése build előtt — enélkül egy törölt forrásfájl .d.ts-e ott marad,
// és az exports map egy olyan típusra mutathat, ami már nem létezik.
import { rmSync } from "node:fs";
rmSync(new URL("../dist", import.meta.url), { recursive: true, force: true });
