// A mag rollup-konfigurációjának gyára — a belépési pontokat az entries.json
// adja, nem ez a fájl.
//
// Miért gyár, és miért nem elég a rollup.config.mjs. A G-TREESHAKE
// (scripts/sdk_check_treeshake.mjs) egy kis mintacsomagot is EZZEL a gyárral
// épít, hogy a közös darabolást a kiadott build mechanizmusán bizonyítsa —
// akkor is, amikor a valódi belépési pontok épp nem osztanak meg kódot. Ha a
// minta saját konfigurációval épülne, a check a saját konfigurációját
// bizonyítaná, nem a miénket.
//
// Három kimenet:
//
//  - ESM és CJS EGY többbemenetes buildben, közös darabokkal (`chunks/`).
//    Egy belépési pont, amely a mag kódját használja, azt importálja, nem
//    másolja: két belépési pont együttes fogyasztója a közös kódot egyszer
//    kapja meg. A darabnevek hash nélküliek, hogy a dist determinisztikus
//    legyen (a fingerprint és a G-DEPS a fájlneveket olvassa).
//  - UMD belépési pontonként önállóan: egy <script> tag nem tud darabot
//    betölteni, ezért ott a duplikáció az ára az egyfájlos használatnak.
//
// Az `external` SZÁNDÉKOSAN üres: a magnak nulla futásidejű függősége van.
import typescript from "@rollup/plugin-typescript";

/**
 * @param {{
 *   entries: ReadonlyArray<{ name: string; input: string; umd: string }>;
 *   banner: string;
 *   tsconfig: string;
 *   split?: boolean;
 * }} options `split: false` a darabolás nélküli, belépési pontonként önálló
 *   ESM/CJS buildet adja — ez a G-TREESHAKE negatív kontrollja, nem kiadási mód.
 */
export function createConfig({ entries, banner, tsconfig, split = true }) {
  const ts = () =>
    typescript({
      tsconfig,
      // A .d.ts-eket a `build:types` lépés írja ki; a rollup csak kódot gyárt.
      compilerOptions: {
        declaration: false,
        declarationMap: false,
        sourceMap: true,
        outDir: undefined,
      },
    });

  // A megőrzött (`/*!`) licencfejléc csak az alap belépési pont fájljában áll;
  // a többi ESM/CJS fájl ugyanezt sima megjegyzésként kapja, amit a
  // minifikáló eldob. A minifikálók minden `/*!`-t megőriznek, amit a bundle
  // érint, így egy fogyasztó a fejlécet annyiszor fizetné meg, ahány fájlunkat
  // betölti — a /dom önálló mérésén ez 22 bájt volt a 4 kB-os kereten. A
  // licenc nem vész el: egy nem-alap belépési pont a magot az alapból
  // importálja, és az alap fejlécét a bundle megőrzi. Az önálló UMD-k a saját
  // fejlécüket tartják.
  const plainBanner = banner.replace(/^\/\*!/, "/*");
  const modular = (format, ext) => ({
    format,
    dir: "dist",
    entryFileNames: `[name].${ext}`,
    chunkFileNames: `chunks/[name].${ext}`,
    sourcemap: true,
    banner: (chunk) => (chunk.isEntry && chunk.name === "index" ? banner : plainBanner),
    ...(format === "cjs" ? { exports: "named" } : {}),
  });

  const umd = (entry) => ({
    input: entry.input,
    external: [],
    output: {
      file: `dist/${entry.name}.umd.js`,
      format: "umd",
      name: entry.umd,
      sourcemap: true,
      exports: "named",
      banner,
    },
    plugins: [ts()],
  });

  // Hová kerül egy modul. A szabály: egy nem-alap belépési pont SAJÁT kódja a
  // saját mappájában van (`src/<név>/`), minden más a mag, és a mag kódja az
  // alap belépési pont (`index`) fájljában marad. Így az alap önálló fogyasztója
  // ugyanazt az egy fájlt kapja, mint a darabolás előtt (egy külön közös darab
  // határa a magon 100, a /dom-on 20 bájtot vitt el), a többi belépési pont
  // pedig a magot az indexből importálja, nem másolja. Két nem-alap belépési
  // pont közös kódjából a rollup magától csinál darabot (`chunks/`).
  const base = entries.find((entry) => entry.name === "index");
  const ownDirs = entries
    .filter((entry) => entry !== base)
    .map((entry) => entry.input.replace(/\/index\.ts$/, "/").replace(/^\.\//, ""));
  const manualChunks =
    base === undefined
      ? undefined
      : (id) => {
          const rel = id.replaceAll("\\", "/");
          const srcAt = rel.lastIndexOf("/src/");
          if (srcAt === -1) return undefined;
          const local = rel.slice(srcAt + 1);
          // A `src/shared/` ket nem-alap belepesi pont kozos kodja (P32: a /live
          // es a /tools, a /words es az /intl): se nem az alape, se nem
          // egyikuk sajatja — a rollup kozos darabot csinal belole, igy az
          // alap nem hizik tole (G-SIZE), es egyik fogyasztoja sem kapja a
          // masik sajat kodjat (G-TREESHAKE).
          if (local.startsWith("src/shared/")) return undefined;
          return ownDirs.some((dir) => local.startsWith(dir)) ? undefined : "index";
        };

  const modularBuilds = split
    ? [
        {
          input: Object.fromEntries(entries.map((entry) => [entry.name, entry.input])),
          external: [],
          // A belépési pontok aláírása SZIGORÚ: egy belépési pont pontosan a
          // publikus felületét exportálja, semmi többet. Ha egy másik belépési
          // pont belső kódot használ a magból (a /dom a formatNumbert), a
          // rollup a mag kódját egy `chunks/index` darabba teszi, és az
          // index.mjs csak továbbexportál. Az `allow-extension` ezt a határt
          // megspórolná, de a mag névterébe belső neveket tenne — a P16-ban
          // az ESM egy `f`-et, a CJS a `formatNumber`-t tette ki, és a
          // G-ENTRIES (ESM = CJS = UMD) ezen bukott.
          output: [
            { ...modular("es", "mjs"), manualChunks },
            { ...modular("cjs", "cjs"), manualChunks },
          ],
          plugins: [ts()],
        },
      ]
    : entries.map((entry) => ({
        input: { [entry.name]: entry.input },
        external: [],
        output: [modular("es", "mjs"), modular("cjs", "cjs")],
        plugins: [ts()],
      }));

  return [...modularBuilds, ...entries.map(umd)];
}
