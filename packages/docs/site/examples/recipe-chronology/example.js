import { defaultTickLabel } from "@temporeum/timeline-core";
import { createTimeline } from "@temporeum/timeline-element";

// Date.UTC reads years 0–99 as 1900–1999; set the year explicitly instead.
function year(y) {
  const date = new Date(0);
  date.setUTCFullYear(y, 0, 1);
  return date.getTime();
}
/** @returns {import("@temporeum/timeline-core").Item} */
const event = (id, label, laneId, from, to) => ({
  id,
  label,
  laneId,
  start: year(from),
  ...(to === undefined ? {} : { end: year(to) }),
  // Known to the year: an instant covers its whole year, so two events in one year do not overlap.
  granularity: "year",
});

// The axis in BC and AD. The engine's default writes ISO years: -0500 is 501 BC.
const YEARS = new Set(["year", "decade", "century", "millennium"]);
function formatTick(tick, timeZone) {
  if (!YEARS.has(tick.granularity)) return defaultTickLabel(tick, timeZone);
  const y = new Date(tick.time).getUTCFullYear();
  return y <= 0 ? `${String(1 - y)} BC` : `AD ${String(y)}`;
}

const items = [
  event("bronze-collapse", "Late Bronze Age collapse", "med", -1200, -1150),
  event("rome-founded", "Rome founded (traditional)", "med", -753),
  event("athens", "Classical Athens", "med", -480, -323),
  event("han", "Han dynasty", "asia", -202, 220),
  event("augustus", "Augustus", "med", -27, 14),
  event("hagia-sophia", "Hagia Sophia built", "med", 532, 537),
  event("tang", "Tang dynasty", "asia", 618, 907),
  event("gutenberg", "Printing press in Mainz", "eur", 1450),
  event("columbus", "Columbus reaches the Caribbean", "eur", 1492),
  event("industrial", "Industrial Revolution", "eur", 1760, 1840),
  event("moon", "Moon landing", "eur", 1969),
];

createTimeline(document.querySelector("#timeline"), {
  items,
  lanes: [
    { id: "med", label: "Mediterranean" },
    { id: "asia", label: "East Asia" },
    { id: "eur", label: "Europe and beyond" },
  ],
  ariaLabel: "Chronology",
  // Room for the labels: a chronology is read, not scanned for density.
  density: "comfortable",
  locale: "en-GB",
  formatTick,
  // Open on antiquity, where the labels have room; zoom out for all three thousand years.
  domain: [year(-850), year(650)],
  limits: { min: year(-1500), max: year(2100) },
  decorations: [
    { kind: "era", id: "antiquity", start: year(-800), end: year(500), label: "Antiquity" },
    { kind: "era", id: "middle-ages", start: year(500), end: year(1500), label: "Middle Ages" },
    { kind: "era", id: "modern", start: year(1500), end: year(2050), label: "Modern era" },
  ],
});
