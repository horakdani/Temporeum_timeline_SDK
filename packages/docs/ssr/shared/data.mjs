// Az öt smoke-alkalmazás közös adata: ugyanaz az idővonal Next-ben,
// Nuxtban, Astróban, SvelteKitben és Angularban, hogy a mérés ugyanazt
// kérdezze mindegyiktől.
import { registerPlugin } from "@temporeum/timeline-element";
import { ganttPlugin } from "@temporeum/timeline-element/gantt";
import { groupsPlugin } from "@temporeum/timeline-element/groups";
import { intlPlugin } from "@temporeum/timeline-element/intl";
import { itemsPlugin } from "@temporeum/timeline-element/items";
import { resourcesPlugin } from "@temporeum/timeline-element/resources";
import { toolsPlugin } from "@temporeum/timeline-element/tools";

// A P29 óta a Gantt és az erőforrás-nézet plugin, a P30 óta a csoportfa, az
// elemtípusok, az idő-eszközök és a szótár is: az adat mellett
// regisztrálódnak, így a szerver és a kliens is ugyanazzal rajzol, bárhol
// importálja a konfigurációt.
registerPlugin(ganttPlugin, resourcesPlugin, groupsPlugin, itemsPlugin, toolsPlugin, intlPlugin);

const DAY = 86_400_000;
const START = Date.UTC(2026, 0, 1);

// A P19 óta csoportfával, pont- és háttérelemmel: a G-SSR proof-ja szerint
// a szerveren rajzolt csoportfejléceket is a kliens veszi át. (A HTML-sablon
// függvény, a JSON-konfigurációval nem utazik; azt a Next-út méri, ahol a
// React-komponens a szerveren és a kliensen ugyanazt a függvényt kapja.)
export const config = {
  items: [
    { id: "a", start: START + 2 * DAY, end: START + 6 * DAY, label: "Tervezés", laneId: "l1", progress: 1 },
    { id: "b", start: START + 8 * DAY, end: START + 13 * DAY, label: "Építés", laneId: "l1", progress: 0.4, baseline: { start: START + 7 * DAY, end: START + 11 * DAY } },
    { id: "c", start: START + 16 * DAY, end: START + 20 * DAY, label: "Átadás", laneId: "l2" },
    { id: "d", kind: "point", start: START + 11 * DAY, label: "Mérföldkő", laneId: "l2" },
    { id: "s", kind: "background", start: START + 1 * DAY, end: START + 9 * DAY, label: "1. sprint" },
  ],
  groups: [
    { id: "proj", label: "Projekt" },
    { id: "l1", label: "Munka", parentId: "proj" },
    { id: "l2", label: "Szállítás", parentId: "proj" },
  ],
  // A P20 óta Gantt-nyilakkal, haladással és alapvonallal: a G-SSR proof-ja
  // szerint a szerveren rajzolt nyilakat is a kliens veszi át.
  gantt: {
    dependencies: [
      { from: "a", to: "b" },
      { from: "b", to: "c" },
      { from: "a", to: "c", type: "SS", lagMs: DAY },
    ],
  },
  // A P22 óta erőforrás-nézettel: a két csoport-sáv erőforrás, alattuk
  // terhelési sávval; a „Munka” fél kapacitású, így a két feladata
  // túlfoglalt. A G-SSR proof-ja szerint a szerveren rajzolt terhelést is a
  // kliens veszi át, ugyanazzal a képkockával.
  resources: [
    { id: "l1", label: "Munka", capacity: 0.5 },
    { id: "l2", label: "Szállítás" },
  ],
  // A P24 óta rejtett hétvégékkel, áttekintő sávval és ragadó
  // sávfejlécekkel: a G-SSR proof-ja szerint ezekkel is ugyanazzal a
  // képkockával hidratálódik. 2026. január 3. szombat; az „Tervezés” átnyúlik
  // az első hétvégén, és nélküle rajzolódik.
  hiddenDates: [{ start: START + 2 * DAY, end: START + 4 * DAY, repeat: "weekly" }],
  minimap: true,
  laneHeaders: true,
  // A P26 óta jobbról balra, a könyvtár szavaival magyarul: a G-SSR proof-ja
  // szerint RTL-ben és más nyelven is ugyanazzal a képkockával hidratálódik.
  // A dátumok az Intl-éi (hu); a szótár a nevek, a Gantt és a terhelés szavai.
  direction: "rtl",
  strings: {
    listSeparator: ", ",
    FS: "befejezés–kezdés",
    SS: "kezdés–kezdés",
    dependency: "{name} ({type})",
    dependencyLag: "{name} ({type}, {amount} késleltetés)",
    days: "{count} nap",
    predecessors: "{list} után",
    successors: "{list} előtt",
    onPlan: "a terv szerint",
    behindPlan: "{count} nap csúszás",
    aheadOfPlan: "{count} nappal a terv előtt",
    progress: "{percent}% kész",
    overbooked: "túlfoglalt, a kapacitás {percent}%-a",
    loadLane: "{lane} terhelése",
    groups: "Csoportok",
    overview: "Áttekintés",
  },
  domain: [START, START + 24 * DAY],
  height: 300,
  locale: "hu",
  timeZone: "UTC",
  ariaLabel: "Projekt idővonal",
};

/** The width the pages are laid out at, so the server draws the real size. */
export const WIDTH = 960;

/** Az elemek HTML-sablonja — a Next-út hidratálja (függvény, JSON-nal nem utazik). */
export const template = (item) => `<strong>${item.label ?? ""}</strong>`;
