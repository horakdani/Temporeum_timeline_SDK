import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // A mag Node-ban fut, DOM nélkül — ez a P1 G-NODOM kapujának az alapja.
    environment: "node",
    include: ["test/**/*.test.ts"],
    // Egy teszt időkorlátja, nem teljesítmény-küszöb (azt a G-PERF méri).
    // A vitest alapértelmezése 5 s, és az a GÉP terhelésének mértéke: a P10
    // [claim:contiguous] property-je magában 1,4 s, a párhuzamos coverage-
    // futásban 3,9–5,4 s, és a P11 kapujában 5,36 s-nál kiakadt. Ugyanígy a
    // render-cache, a mount és a room property-je is korlát nélkül, 2–4 s-on
    // fut. A legnehezebbek (conservation, no-stale) eddig is maguk adtak meg
    // 120–240 s-ot; ez a többiek közös felső határa. Egy valódi akadás
    // továbbra is bukik — 30 s-nál, nem a szomszéd tesztek terhelésétől.
    testTimeout: 30_000,
    typecheck: {
      // A típusteszt ugyanannyira teszt, mint a futásidejű: a publikus API
      // alakja a termék része.
      enabled: true,
      include: ["test/**/*.test-d.ts"],
      tsconfig: "./tsconfig.json",
    },
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      // A típusdeklarációkban nincs futtatható sor; a lefedettségi számot
      // hígítanák.
      exclude: ["src/types.ts"],
      reporter: ["text", "json-summary"],
      thresholds: {
        // Fájlonként, nem összesítve. Az összesített küszöb átengedte, hogy a
        // ticks.ts teljes tesztkészlete eltűnjön: a modult más tesztek
        // közvetve még futtatták, így a sorai "lefedettek" maradtak, miközben
        // semmi nem állított róluk semmit — 94.7%-os összesített értékkel.
        // A fájlonkénti küszöb ezt a csendet nem engedi.
        perFile: true,
        lines: 90,
        functions: 90,
        branches: 90,
        statements: 90,
      },
    },
  },
});
