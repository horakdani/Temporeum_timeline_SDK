import { defaultTickLabel } from "@temporeum/timeline-core";
import { createTimeline, registerPlugin } from "@temporeum/timeline-element";
import { toolsPlugin } from "@temporeum/timeline-element/tools";

// The lanes' names, held at the start of the view, are one of the time tools.
registerPlugin(toolsPlugin);

// Date.UTC reads years 0–99 as 1900–1999; set the year explicitly instead.
function year(y) {
  const date = new Date(0);
  date.setUTCFullYear(y, 0, 1);
  return date.getTime();
}
// Known to the year (most dates before 1500 are approximate or traditional): an instant covers its year.
/** @returns {import("@temporeum/timeline-core").Item} */
const known = (id, label, laneId, from, to) => ({
  id,
  label,
  laneId,
  start: year(from),
  ...(to === undefined ? {} : { end: year(to) }),
  granularity: "year",
});
// Known to the minute, in UTC.
/** @returns {import("@temporeum/timeline-core").Item} */
const minute = (id, label, iso, endIso) => ({
  id,
  label,
  laneId: "space",
  start: Date.parse(iso),
  ...(endIso === undefined ? {} : { end: Date.parse(endIso) }),
  granularity: "minute",
});

const items = [
  known("egypt-unified", "Egypt unified", "neareast", -3100),
  known("old-kingdom", "Old Kingdom", "neareast", -2686, -2181),
  known("pyramid", "Great Pyramid of Giza", "neareast", -2560),
  known("middle-kingdom", "Middle Kingdom", "neareast", -2055, -1650),
  known("hammurabi", "Code of Hammurabi", "neareast", -1754),
  known("new-kingdom", "New Kingdom", "neareast", -1550, -1069),
  known("ramesses", "Ramesses II", "neareast", -1279, -1213),
  known("babylon", "Cyrus takes Babylon", "neareast", -539),
  known("olympics", "First Olympic Games", "med", -776),
  known("rome", "Rome founded", "med", -753),
  known("republic", "Roman Republic", "med", -509, -27),
  known("athens", "Classical Athens", "med", -480, -323),
  known("alexander", "Alexander the Great", "med", -336, -323),
  known("caesar", "Caesar assassinated", "med", -44),
  known("empire", "Roman Empire in the west", "med", -27, 476),
  known("pompeii", "Vesuvius buries Pompeii", "med", 79),
  known("constantinople", "Constantinople founded", "med", 330),
  known("byzantium", "Byzantine Empire", "med", 476, 1453),
  known("fall", "Fall of Constantinople", "med", 1453),
  known("shang", "Shang dynasty", "asia", -1600, -1046),
  known("confucius", "Confucius born", "asia", -551),
  known("qin", "Qin unifies China", "asia", -221),
  known("han", "Han dynasty", "asia", -202, 220),
  known("tang", "Tang dynasty", "asia", 618, 907),
  known("genghis", "Genghis Khan proclaimed", "asia", 1206),
  known("ming", "Ming dynasty", "asia", 1368, 1644),
  known("edo", "Edo period", "asia", 1603, 1868),
  known("meiji", "Meiji Restoration", "asia", 1868),
  known("olmec", "Olmec civilisation", "americas", -1200, -400),
  known("maya", "Classic Maya", "americas", 250, 900),
  known("tenochtitlan", "Tenochtitlan founded", "americas", 1325),
  known("inca", "Inca Empire", "americas", 1438, 1533),
  known("columbus", "Columbus reaches the Caribbean", "americas", 1492),
  known("independence", "US Declaration of Independence", "americas", 1776),
  known("charlemagne", "Charlemagne crowned", "europe", 800),
  known("hastings", "Battle of Hastings", "europe", 1066),
  known("magna-carta", "Magna Carta", "europe", 1215),
  known("black-death", "Black Death", "europe", 1347, 1351),
  known("press", "Printing press in Mainz", "europe", 1450),
  known("theses", "Luther's 95 theses", "europe", 1517),
  known("revolution", "French Revolution", "europe", 1789, 1799),
  known("wwi", "First World War", "europe", 1914, 1918),
  known("wwii", "Second World War", "europe", 1939, 1945),
  known("wall", "Berlin Wall falls", "europe", 1989),
  known("euclid", "Euclid's Elements", "science", -300),
  known("copernicus", "Copernicus: the Sun at the centre", "science", 1543),
  known("principia", "Newton's Principia", "science", 1687),
  known("origin", "On the Origin of Species", "science", 1859),
  known("relativity", "Special relativity", "science", 1905),
  known("dna", "DNA double helix", "science", 1953),
  known("sputnik", "Sputnik 1", "science", 1957),
  known("hubble", "Hubble launched", "science", 1990),
  known("web", "The World Wide Web", "science", 1991),
  minute("apollo", "Apollo 11", "1969-07-16T13:32Z", "1969-07-24T16:50Z"),
  minute("launch", "Launch from Florida", "1969-07-16T13:32Z"),
  minute("orbit", "Into lunar orbit", "1969-07-19T17:21Z"),
  minute("landing", "Eagle lands", "1969-07-20T20:17Z"),
  minute("step", "First step", "1969-07-21T02:56Z"),
  minute("eva", "Moonwalk", "1969-07-21T02:39Z", "1969-07-21T05:11Z"),
  minute("ascent", "Lift-off from the Moon", "1969-07-21T17:54Z"),
  minute("splashdown", "Splashdown", "1969-07-24T16:50Z"),
];

// The axis in BC and AD for years; the engine's own labels for months, days and hours.
const YEARS = new Set(["year", "decade", "century", "millennium"]);
function formatTick(tick, timeZone) {
  if (!YEARS.has(tick.granularity)) return defaultTickLabel(tick, timeZone);
  const y = new Date(tick.time).getUTCFullYear();
  return y <= 0 ? `${String(1 - y)} BC` : `AD ${String(y)}`;
}

/** @type {Record<string, [number, number]>} */
const views = {
  all: [year(-3300), year(2050)],
  antiquity: [year(-900), year(600)],
  modern: [year(1440), year(2010)],
  apollo: [Date.parse("1969-07-15T12:00Z"), Date.parse("1969-07-25T12:00Z")],
  landing: [Date.parse("1969-07-20T18:00Z"), Date.parse("1969-07-21T06:00Z")],
};

const timeline = createTimeline(document.querySelector("#timeline"), {
  items,
  lanes: [
    { id: "neareast", label: "Egypt and the Near East" },
    { id: "med", label: "Mediterranean" },
    { id: "asia", label: "East Asia" },
    { id: "americas", label: "The Americas" },
    { id: "europe", label: "Europe" },
    { id: "science", label: "Science" },
    { id: "space", label: "Apollo 11" },
  ],
  ariaLabel: "Five thousand years of history",
  density: "comfortable",
  laneHeaders: true,
  locale: "en-GB",
  formatTick,
  domain: views.antiquity,
  // From the whole span down to a few minutes: one zoom, no second view.
  limits: { min: year(-3500), max: year(2100), minSpanMs: 10 * 60_000 },
  // Dense spans (the eight days of Apollo 11, seen from a millennium) become one marker with a count.
  cluster: true,
  decorations: [
    { kind: "era", id: "bronze", start: year(-3300), end: year(-1200), label: "Bronze Age" },
    { kind: "era", id: "antiquity", start: year(-1200), end: year(476), label: "Iron Age and antiquity" },
    { kind: "era", id: "middle-ages", start: year(476), end: year(1492), label: "Middle Ages" },
    { kind: "era", id: "modern", start: year(1492), end: year(2100), label: "Modern era" },
  ],
});

const log = document.querySelector("#log");
log.dataset.items = String(items.length);
const buttons = document.querySelectorAll("[data-zoom]");
for (const button of buttons) {
  button.addEventListener("click", () => {
    timeline.zoomTo(views[button.dataset.zoom]);
    for (const other of buttons) other.setAttribute("aria-pressed", String(other === button));
  });
}
timeline.on("viewportChanged", ({ viewport: { domain } }) => {
  const days = (domain[1] - domain[0]) / 86_400_000;
  log.textContent = days > 3650 ? `${Math.round(days / 365.25).toLocaleString("en-GB")} years in view` : days > 2 ? `${Math.round(days)} days in view` : `${Math.round(days * 24)} hours in view`;
});
