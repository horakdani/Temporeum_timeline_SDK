import { defaultTickLabel } from "@temporeum/timeline-core";
import { createTimeline, registerPlugin } from "@temporeum/timeline-element";
import { exportPlugin } from "@temporeum/timeline-element/export";
import { itemsPlugin } from "@temporeum/timeline-element/items";
import { mountStory } from "@temporeum/timeline-element/story";
import { toolsPlugin } from "@temporeum/timeline-element/tools";

// Points and item content (/items), lane names, the overview strip and tooltips (/tools), PNG, PDF and print (/export).
registerPlugin(itemsPlugin, toolsPlugin, exportPlugin);

// --- time -----------------------------------------------------------------------

// Date.UTC reads years 0–99 as 1900–1999; set the year explicitly instead.
function year(y) {
  const date = new Date(0);
  date.setUTCFullYear(y, 0, 1);
  return date.getTime();
}
const YEAR = 365.2425 * 86_400_000;
const HOUR = 3_600_000;
// The dates are given as historians write them, a minus for BC: -44 is 44 BC.
const era = (y) => (y < 0 ? `${String(-y)} BC` : `AD ${String(Math.max(1, y))}`);
const yearOf = (time) => new Date(time).getUTCFullYear();
const utc = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
const days = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

/** "2686 – 2181 BC", "AD 476 – 1453", "16–24 July 1969": an item's dates, the way a caption gives them. */
function years(item) {
  if (item.granularity === "minute") {
    if (item.end === undefined) return `${utc.format(item.start)} UTC`;
    return item.end - item.start > 86_400_000 ? days.formatRange(item.start, item.end) : `${utc.formatRange(item.start, item.end)} UTC`;
  }
  const from = yearOf(item.start);
  if (item.end === undefined) return era(from);
  const to = yearOf(item.end);
  if (to < 0) return `${String(-from)} – ${String(-to)} BC`;
  if (from < 0) return `${String(-from)} BC – AD ${String(to)}`;
  return from < 1000 ? `AD ${String(from)} – ${String(to)}` : `${String(from)} – ${String(to)}`;
}

// The axis in BC and AD, the way the dates are given; "Jul 1969" and "16 Jul" closer in, and the engine's hours.
const YEARS = new Set(["year", "decade", "century", "millennium"]);
const MONTH = new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });
const DAY = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
function formatTick(tick, timeZone) {
  // The label held at the start of the axis says what the ticks leave out: the month of a view of days, the day of a view of hours.
  if (tick.context) {
    if (tick.granularity === "day" || tick.granularity === "week") return MONTH.format(tick.time);
    return YEARS.has(tick.granularity) || tick.granularity === "month" ? "" : days.format(tick.time);
  }
  if (YEARS.has(tick.granularity)) return era(yearOf(tick.time));
  if (tick.granularity === "month") return MONTH.format(tick.time);
  if (tick.granularity === "day" || tick.granularity === "week") return DAY.format(tick.time);
  return defaultTickLabel(tick, timeZone);
}

// --- the regions, and the pictures the page draws for them ------------------------------

const lanes = [
  { id: "neareast", label: "Egypt & the Near East", color: "#ef9a62" },
  { id: "med", label: "Mediterranean", color: "#6fb0f0" },
  { id: "asia", label: "East Asia", color: "#4fd1a5" },
  { id: "americas", label: "The Americas", color: "#f2c94c" },
  { id: "europe", label: "Europe", color: "#f08bb0" },
  { id: "science", label: "Science", color: "#a98bff" },
  { id: "space", label: "Apollo 11", color: "#d7deea" },
];
const colorOf = Object.fromEntries(lanes.map((lane) => [lane.id, lane.color]));

/** A seeded random, so a picture is the same every time it is drawn. */
function seeded(text) {
  let s = 2166136261;
  for (const c of text) s = Math.imul(s ^ c.charCodeAt(0), 16777619) >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

// Silhouettes on a 480 × 270 stage with the horizon at 214: `d` is the dark mass, `l` the lit edge.
const MOTIFS = {
  nile: (d, l) => `<circle cx="300" cy="150" r="38" fill="${l}" opacity=".9"/><path d="M0 214 C120 200 200 232 300 214 S420 200 480 212 V270 H0Z" fill="${d}"/><path d="M40 270 C140 236 260 250 330 226 S440 214 480 220" stroke="${l}" stroke-opacity=".5" stroke-width="5" fill="none"/>${[70, 96, 118].map((x) => `<path d="M${String(x)} 214 V170 M${String(x)} 170 l-10 -14 M${String(x)} 170 l10 -14 M${String(x)} 170 v-18" stroke="${d}" stroke-width="3"/>`).join("")}`,
  pyramids: (d, l) => `<circle cx="372" cy="92" r="24" fill="${l}" opacity=".85"/><path d="M40 214 L160 96 L280 214Z" fill="${d}"/><path d="M160 96 L280 214 H196Z" fill="${l}" opacity=".35"/><path d="M240 214 L318 136 L396 214Z" fill="${d}"/><path d="M318 136 L396 214 H340Z" fill="${l}" opacity=".3"/><path d="M380 214 L414 180 L448 214Z" fill="${d}"/><path d="M0 214 C140 206 340 222 480 210 V270 H0Z" fill="${d}"/>`,
  stele: (d, l) => `<path d="M186 214 V84 Q240 30 294 84 V214Z" fill="${d}"/><path d="M200 84 Q240 48 280 84" stroke="${l}" stroke-width="3" fill="none" opacity=".7"/>${Array.from({ length: 9 }, (_, i) => `<path d="M204 ${String(104 + i * 11)} H276" stroke="${l}" stroke-width="3" stroke-dasharray="4 5" opacity=".55"/>`).join("")}<rect x="0" y="214" width="480" height="56" fill="${d}"/>`,
  ding: (d, l) => `<path d="M168 112 H312 Q306 182 240 186 Q174 182 168 112Z" fill="${d}"/><path d="M180 112 V88 h16 v24 M284 112 V88 h16 v24" stroke="${d}" stroke-width="7" fill="none"/><path d="M196 178 L186 214 M240 186 V214 M284 178 L294 214" stroke="${d}" stroke-width="9"/><path d="M182 130 H298" stroke="${l}" stroke-width="3" stroke-dasharray="8 6" opacity=".6"/><rect x="0" y="214" width="480" height="56" fill="${d}"/>`,
  wreath: (d, l) => `${Array.from({ length: 9 }, (_, i) => { const a = Math.PI * (0.58 + i * 0.1); return [-1, 1].map((side) => `<ellipse cx="${String(240 + side * Math.cos(a) * 70)}" cy="${String(132 - Math.sin(a) * -70)}" rx="14" ry="6" transform="rotate(${String(side * (i * 11 - 20))} ${String(240 + side * Math.cos(a) * 70)} ${String(132 - Math.sin(a) * -70)})" fill="${l}" opacity=".85"/>`).join(""); }).join("")}<rect x="0" y="232" width="480" height="38" fill="${d}"/>`,
  temple: (d, l) => `<path d="M104 104 L240 56 L376 104Z" fill="${d}"/><rect x="112" y="104" width="256" height="14" fill="${d}"/>${Array.from({ length: 6 }, (_, i) => `<rect x="${String(128 + i * 44)}" y="122" width="18" height="84" fill="${d}"/><rect x="${String(140 + i * 44)}" y="122" width="5" height="84" fill="${l}" opacity=".35"/>`).join("")}<rect x="104" y="204" width="272" height="10" fill="${d}"/><rect x="0" y="214" width="480" height="56" fill="${d}"/>`,
  wall: (d, l) => `<path d="M0 214 L60 176 L140 196 L230 150 L320 184 L400 158 L480 176 V270 H0Z" fill="${d}"/><path d="M0 196 L60 158 L140 178 L230 132 L320 166 L400 140 L480 158" stroke="${l}" stroke-width="10" fill="none" opacity=".55" stroke-dasharray="10 4"/><rect x="222" y="104" width="18" height="30" fill="${d}"/>`,
  volcano: (d, l) => `${[[236, 70, 34], [266, 52, 28], [210, 50, 24], [250, 28, 22]].map(([x, y, r]) => `<circle cx="${String(x)}" cy="${String(y)}" r="${String(r)}" fill="${l}" opacity=".28"/>`).join("")}<path d="M60 214 L210 104 H262 L420 214Z" fill="${d}"/><path d="M214 106 L236 128 L258 106" stroke="${l}" stroke-width="4" fill="none" opacity=".8"/><rect x="0" y="214" width="480" height="56" fill="${d}"/>`,
  stepped: (d, l) => `${Array.from({ length: 6 }, (_, i) => `<rect x="${String(120 + i * 20)}" y="${String(194 - i * 20)}" width="${String(240 - i * 40)}" height="20" fill="${d}"/>`).join("")}<rect x="208" y="54" width="64" height="40" fill="${d}"/><rect x="230" y="66" width="20" height="28" fill="${l}" opacity=".6"/><path d="M232 214 L240 94 L248 214Z" fill="${l}" opacity=".25"/><rect x="0" y="214" width="480" height="56" fill="${d}"/>`,
  pagoda: (d, l) => `<path d="M0 214 L90 150 L170 196 L300 120 L400 186 L480 150 V270 H0Z" fill="${l}" opacity=".18"/>${Array.from({ length: 5 }, (_, i) => { const y = 204 - i * 30; const w = 150 - i * 24; return `<rect x="${String(240 - w / 2 + 12)}" y="${String(y - 14)}" width="${String(w - 24)}" height="14" fill="${d}"/><path d="M${String(240 - w / 2 - 14)} ${String(y - 14)} Q240 ${String(y - 34)} ${String(240 + w / 2 + 14)} ${String(y - 14)} L${String(240 + w / 2 - 4)} ${String(y - 20)} H${String(240 - w / 2 + 4)}Z" fill="${d}"/>`; }).join("")}<path d="M240 66 V40" stroke="${d}" stroke-width="4"/><rect x="0" y="214" width="480" height="56" fill="${d}"/>`,
  scroll: (d, l) => `<rect x="150" y="70" width="180" height="130" fill="${l}" opacity=".85"/><rect x="138" y="60" width="18" height="150" rx="9" fill="${d}"/><rect x="324" y="60" width="18" height="150" rx="9" fill="${d}"/>${Array.from({ length: 8 }, (_, i) => `<path d="M170 ${String(88 + i * 13)} H${String(i === 7 ? 250 : 310)}" stroke="${d}" stroke-width="3" opacity=".55"/>`).join("")}<circle cx="290" cy="186" r="11" fill="#8b2a2a"/><rect x="0" y="226" width="480" height="44" fill="${d}"/>`,
  type: (d, l) => `${Array.from({ length: 40 }, (_, i) => `<rect x="${String(112 + (i % 10) * 26)}" y="${String(84 + Math.floor(i / 10) * 30)}" width="20" height="24" rx="2" fill="${i === 13 ? l : d}" opacity="${i === 13 ? "1" : ".9"}"/>`).join("")}<text x="191" y="137" font-family="Georgia,serif" font-size="20" text-anchor="middle" fill="${d}">A</text><rect x="0" y="214" width="480" height="56" fill="${d}"/>`,
  dome: (d, l) => `<path d="M150 214 V150 Q240 64 330 150 V214Z" fill="${d}"/><path d="M178 128 Q240 80 302 128" stroke="${l}" stroke-width="3" fill="none" opacity=".6"/>${[110, 370].map((x) => `<rect x="${String(x - 5)}" y="96" width="10" height="118" fill="${d}"/><path d="M${String(x - 6)} 98 L${String(x)} 66 L${String(x + 6)} 98Z" fill="${d}"/>`).join("")}<circle cx="372" cy="70" r="12" fill="${l}" opacity=".8"/><circle cx="378" cy="66" r="11" fill="#07090d" opacity=".9"/><rect x="0" y="214" width="480" height="56" fill="${d}"/>`,
  ship: (d, l) => `<path d="M150 186 H340 L316 214 H170Z" fill="${d}"/>${[[196, 100, 34], [246, 76, 42], [296, 104, 30]].map(([x, top, w]) => `<path d="M${String(x)} 186 V${String(top - 10)}" stroke="${d}" stroke-width="4"/><path d="M${String(x - w / 2)} ${String(top)} Q${String(x)} ${String(top + 12)} ${String(x + w / 2)} ${String(top)} L${String(x + w / 2 + 4)} ${String(top + 60)} Q${String(x)} ${String(top + 74)} ${String(x - w / 2 - 4)} ${String(top + 60)}Z" fill="${l}" opacity=".85"/>`).join("")}<path d="M0 214 Q30 206 60 214 T120 214 T180 214 T240 214 T300 214 T360 214 T420 214 T480 214 V270 H0Z" fill="${d}"/>`,
  orbits: (d, l) => `<circle cx="240" cy="132" r="26" fill="${l}"/>${[[96, 30, -14], [150, 46, 10], [196, 60, -4]].map(([rx, ry, rot], i) => `<ellipse cx="240" cy="132" rx="${String(rx)}" ry="${String(ry)}" transform="rotate(${String(rot)} 240 132)" fill="none" stroke="${l}" stroke-opacity=".45"/><circle cx="${String(240 + rx * Math.cos(i * 2.1))}" cy="${String(132 + ry * Math.sin(i * 2.1))}" r="${String(5 + i * 2)}" fill="${l}" opacity=".9"/>`).join("")}`,
  flag: (d, l) => `<path d="M150 214 V64" stroke="${d}" stroke-width="5"/>${["#2a4c8f", "#efe7d6", "#b23a3a"].map((fill, i) => `<path d="M${String(153 + i * 60)} 70 Q${String(183 + i * 60)} ${String(58 + (i % 2) * 10)} ${String(213 + i * 60)} 70 V150 Q${String(183 + i * 60)} ${String(138 + (i % 2) * 10)} ${String(153 + i * 60)} 150Z" fill="${fill}" opacity=".9"/>`).join("")}<rect x="0" y="214" width="480" height="56" fill="${d}"/>`,
  tree: (d, l) => {
    const random = seeded("tree");
    const out = [];
    const grow = (x, y, angle, length, depth) => {
      const x2 = x + Math.cos(angle) * length;
      const y2 = y - Math.sin(angle) * length;
      out.push(`<path d="M${x.toFixed(1)} ${y.toFixed(1)} L${x2.toFixed(1)} ${y2.toFixed(1)}" stroke="${depth > 3 ? d : l}" stroke-width="${String(Math.max(1, depth * 1.6))}" stroke-linecap="round"/>`);
      if (depth === 0) out.push(`<circle cx="${x2.toFixed(1)}" cy="${y2.toFixed(1)}" r="3" fill="${l}"/>`);
      else for (const turn of [-0.42, 0.42]) grow(x2, y2, angle + turn + (random() - 0.5) * 0.3, length * 0.74, depth - 1);
    };
    grow(240, 214, Math.PI / 2, 46, 6);
    return `${out.join("")}<rect x="0" y="214" width="480" height="56" fill="${d}"/>`;
  },
  moon: (d, l) => `<circle cx="368" cy="74" r="30" fill="#4f82c8"/><path d="M368 44 A30 30 0 0 1 368 104 A18 30 0 0 0 368 44Z" fill="#07090d" opacity=".55"/><path d="M0 200 C120 186 300 208 480 192 V270 H0Z" fill="${d}"/>${[[90, 232, 34], [300, 240, 22], [410, 222, 16]].map(([x, y, r]) => `<ellipse cx="${String(x)}" cy="${String(y)}" rx="${String(r)}" ry="${String(r / 4)}" fill="#07090d" opacity=".35"/>`).join("")}<path d="M190 190 L206 150 H254 L270 190" stroke="${l}" stroke-width="3" fill="none"/><path d="M208 150 L216 124 H244 L252 150Z" fill="${l}"/><rect x="220" y="110" width="20" height="14" fill="${l}" opacity=".8"/>`,
  footprint: (d, l) => `<circle cx="96" cy="70" r="22" fill="#4f82c8"/><path d="M0 120 C160 104 320 130 480 112 V270 H0Z" fill="${d}"/><g transform="rotate(-14 240 190)"><path d="M206 150 Q240 130 274 150 V180 Q240 190 206 180Z M210 196 Q240 188 270 196 V226 Q240 242 210 226Z" fill="${l}" opacity=".4"/>${Array.from({ length: 6 }, (_, i) => `<rect x="208" y="${String(156 + i * 13)}" width="64" height="5" fill="#07090d" opacity=".55"/>`).join("")}</g><path d="M372 120 V40" stroke="${l}" stroke-width="3"/><rect x="374" y="42" width="44" height="28" fill="${l}" opacity=".85"/>`,
  web: (d, l) => {
    const random = seeded("web");
    const nodes = Array.from({ length: 18 }, () => [100 + random() * 280, 40 + random() * 150]);
    const links = nodes.flatMap(([x, y], i) => nodes.slice(i + 1).filter(([u, v]) => Math.hypot(u - x, v - y) < 92).map(([u, v]) => `<path d="M${x.toFixed(0)} ${y.toFixed(0)} L${u.toFixed(0)} ${v.toFixed(0)}" stroke="${l}" stroke-opacity=".4"/>`));
    return `${links.join("")}${nodes.map(([x, y], i) => `<circle cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" r="${String(i % 5 === 0 ? 6 : 3)}" fill="${l}"/>`).join("")}<rect x="0" y="214" width="480" height="56" fill="${d}"/>`;
  },
  // Five thousand years in one skyline: a pyramid, a temple, a pagoda, a dome — and a rocket on its way to the Moon.
  title: (d, l) => `<circle cx="240" cy="214" r="150" fill="${l}" opacity=".1"/><circle cx="240" cy="214" r="84" fill="${l}" opacity=".14"/><path d="M444 92 Q470 40 424 40" stroke="${l}" stroke-width="1.5" stroke-dasharray="3 5" fill="none" opacity=".7"/><circle cx="410" cy="40" r="14" fill="#efe7d6" opacity=".9"/><circle cx="416" cy="36" r="12.5" fill="#07090d"/><path d="M20 214 L84 146 L148 214Z" fill="${d}"/><path d="M84 146 L148 214 H104Z" fill="${l}" opacity=".3"/><path d="M158 168 L204 148 L250 168Z" fill="${d}"/>${Array.from({ length: 4 }, (_, i) => `<rect x="${String(166 + i * 22)}" y="170" width="9" height="44" fill="${d}"/>`).join("")}${Array.from({ length: 3 }, (_, i) => { const y = 206 - i * 22; const w = 64 - i * 14; return `<rect x="${String(292 - w / 2 + 6)}" y="${String(y - 10)}" width="${String(w - 12)}" height="18" fill="${d}"/><path d="M${String(292 - w / 2 - 8)} ${String(y - 10)} Q292 ${String(y - 24)} ${String(292 + w / 2 + 8)} ${String(y - 10)}Z" fill="${d}"/>`; }).join("")}<path d="M292 128 V112" stroke="${d}" stroke-width="3"/><path d="M336 214 V184 Q364 146 392 184 V214Z" fill="${d}"/><rect x="398" y="150" width="6" height="64" fill="${d}"/><path d="M397 152 L401 134 L405 152Z" fill="${d}"/><rect x="438" y="110" width="12" height="104" fill="${d}"/><path d="M438 110 L444 90 L450 110Z" fill="${d}"/><path d="M438 196 L428 214 H438Z M450 196 L460 214 H450Z" fill="${d}"/><rect x="0" y="212" width="480" height="58" fill="${d}"/>`,
};

/** A picture of the page's own, so the story needs no image host: a night sky, a horizon, the motif. */
function picture(motif, color, alt) {
  const random = seeded(motif + color);
  const stars = Array.from({ length: 34 }, () => `<circle cx="${(random() * 480).toFixed(0)}" cy="${(random() * 150).toFixed(0)}" r="${(random() * 1.1 + 0.3).toFixed(2)}" fill="#fff" opacity="${(random() * 0.6 + 0.2).toFixed(2)}"/>`).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 270"><defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#07090d"/><stop offset=".75" stop-color="${color}" stop-opacity=".45"/><stop offset="1" stop-color="${color}" stop-opacity=".7"/></linearGradient></defs><rect width="480" height="270" fill="#07090d"/><rect width="480" height="270" fill="url(#sky)"/>${stars}${MOTIFS[motif]("#07090d", color)}</svg>`;
  return { url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`, alt };
}

// --- the items, and the twenty-one that tell the story ----------------------------------------

/** @typedef {import("@temporeum/timeline-core").Item<any> & { start: number; end?: number }} Moment */
/** @returns {Moment} */
const known = (id, label, laneId, from, to) => ({ id, label, laneId, start: year(from), ...(to === undefined ? {} : { end: year(to) }), granularity: "year" });
/** @returns {Moment} */
const minute = (id, label, iso, endIso) => ({ id, label, laneId: "space", start: Date.parse(iso), ...(endIso === undefined ? {} : { end: Date.parse(endIso) }), granularity: "minute" });

const events = [
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

// The story: a slide for twenty-one of the items, a picture and a view for each — how much time
// the camera shows around it, in years, or in hours for Apollo 11.
const STORY = {
  "egypt-unified": { motif: "nile", view: 1400, date: "c. 3100 BC", text: "<p>Upper and Lower Egypt become one kingdom under one king — Narmer, by tradition. The Nile's summer flood feeds the first nation-state, and hieroglyphs are already being written.</p>" },
  pyramid: { motif: "pyramids", view: 1400, date: "c. 2560 BC", text: "<p>Built for the pharaoh Khufu from some 2.3 million blocks. At 146 metres it stayed the tallest thing people had built for more than three and a half thousand years — the only one of the Seven Wonders still standing.</p>" },
  hammurabi: { motif: "stele", view: 1400, date: "c. 1754 BC", text: "<p>Babylon's king has 282 laws carved into a basalt stele: <em>an eye for an eye</em>, but also wages, loans and what a builder owes if a house falls down. Found in 1901, the stele is in the Louvre.</p>" },
  shang: { motif: "ding", view: 1500, text: "<p>The first Chinese dynasty known from its own writing: questions to the ancestors, scratched on turtle shells and ox bones and cracked with heat. Its foundries cast ritual vessels in bronze, the largest over 800 kg.</p>" },
  olympics: { motif: "wreath", view: 900, date: "776 BC, by tradition", text: "<p>The first Games at Olympia: a single footrace, the <em>stadion</em>, about 192 metres. The Greeks went on to count their years in Olympiads.</p>" },
  athens: { motif: "temple", view: 900, text: "<p>From the victory at Salamis to the death of Alexander: democracy in the assembly, the Parthenon on the Acropolis, the plays of Sophocles and the questions of Socrates.</p>" },
  qin: { motif: "wall", view: 900, text: "<p>Ying Zheng conquers the last of the warring states and names himself Qin Shi Huang, the First Emperor. One script, one coinage, one set of weights — and an army of terracotta soldiers to guard his tomb.</p>" },
  caesar: { motif: "wreath", view: 600, date: "15 March 44 BC", text: "<p>On the Ides of March, senators stab the dictator Julius Caesar. The Republic they meant to save does not outlive him: seventeen years later his heir Octavian becomes Augustus.</p>" },
  pompeii: { motif: "volcano", view: 600, date: "AD 79", text: "<p>Vesuvius erupts and buries Pompeii and Herculaneum under ash and pumice. Kept as it fell, the town is the clearest picture of everyday Roman life there is.</p>" },
  maya: { motif: "stepped", view: 1400, text: "<p>The city-states of the lowlands — Tikal, Calakmul, Palenque, Copán — raise temple-pyramids, follow Venus across the sky, and write their kings' histories in glyphs, dated in a calendar of interlocking cycles.</p>" },
  tang: { motif: "pagoda", view: 900, text: "<p>Chang'an, at the eastern end of the Silk Road, is perhaps the largest city in the world. The age of the poets Li Bai and Du Fu — and of the oldest dated printed book, the Diamond Sutra of 868.</p>" },
  "magna-carta": { motif: "scroll", view: 500, date: "June 1215", text: "<p>At Runnymede, King John's barons make him seal a charter: no free man to be imprisoned except by the lawful judgement of his peers, or by the law of the land. Annulled within months, reissued for centuries.</p>" },
  press: { motif: "type", view: 400, date: "c. 1450", text: "<p>In Mainz, Johannes Gutenberg brings together movable metal type, an oil-based ink and a press. His Bible follows a few years later; by 1500, presses are at work in more than 250 European towns.</p>" },
  fall: { motif: "dome", view: 400, date: "29 May 1453", text: "<p>After a siege of fifty-three days, the Ottoman sultan Mehmed II takes Constantinople. The last of the Roman Empire ends, and Hagia Sophia becomes a mosque.</p>" },
  columbus: { motif: "ship", view: 400, date: "12 October 1492", text: "<p>Sailing west for Asia with three ships, Christopher Columbus lands in the Bahamas. The exchange that follows — of crops, animals and diseases — changes both worlds, and devastates the peoples who were already there.</p>" },
  principia: { motif: "orbits", view: 250, text: "<p>Isaac Newton's <i>Philosophiæ Naturalis Principia Mathematica</i>: three laws of motion and one of gravitation, the same for a falling apple and for the Moon.</p>" },
  revolution: { motif: "flag", view: 120, text: "<p>From the storming of the Bastille to Napoleon's coup: the end of an absolute monarchy, the Declaration of the Rights of Man and of the Citizen, the Terror — and the metric system.</p>" },
  origin: { motif: "tree", view: 160, date: "24 November 1859", text: "<p>Charles Darwin publishes <i>On the Origin of Species</i>: the variety of life explained by descent with modification, through natural selection.</p>" },
  landing: { motif: "moon", hours: 10, headline: "<i>The Eagle has landed</i>", text: "<p>Neil Armstrong flies the lunar module past a field of boulders and sets it down in the Sea of Tranquillity, with less than a minute of fuel to spare. The axis is in hours now — the same timeline, the same zoom.</p>" },
  step: { motif: "footprint", hours: 4, headline: "One small step", text: "<p>Six and a half hours after the landing, Armstrong steps onto the Moon: <em>“That's one small step for man, one giant leap for mankind.”</em> Some 600 million people are watching.</p>" },
  web: { motif: "web", view: 120, text: "<p>Tim Berners-Lee's World Wide Web, written at CERN, is opened to everyone: pages, links and addresses. The page you are reading is one of them.</p>" },
};

/** @type {Moment[]} */
const items = events.map((item) => {
  const told = STORY[item.id];
  const className = `lane-${item.laneId}${told === undefined ? "" : " has-slide"}`;
  // An instant is a point on its stem; a span is a bar.
  const kind = item.end === undefined ? "point" : "range";
  if (told === undefined) return { ...item, kind, className };
  const media = picture(told.motif, colorOf[item.laneId], `Illustration: ${item.label}`);
  const slide = { headline: told.headline ?? item.label, text: told.text, media, background: colorOf[item.laneId], ...(told.date === undefined ? {} : { date: told.date }) };
  // The year, set large behind the slide.
  const numeral = item.granularity === "minute" ? "1969" : era(yearOf(item.start)).replace("AD ", "");
  return { ...item, kind, className, data: { story: slide, numeral, view: told.view === undefined ? told.hours * HOUR : told.view * YEAR } };
});


// --- the timeline -----------------------------------------------------------------

// A theme is an object with every token named: the night sky, ivory type, gold for what matters.
const CHRONICLE = {
  name: "chronicle",
  tokens: {
    surface: "#07090d",
    surfaceAlt: "#0c0f15",
    text: "#f2ede4",
    textMuted: "#8f8a80",
    line: "#151a23",
    lineStrong: "#3a3a36",
    itemFill: "#171c26",
    itemStroke: "#e8c27a",
    itemText: "#f2ede4",
    accent: "#e8c27a",
    now: "#ff8a6b",
    era: "#0a0d13",
    eraText: "#bba679",
    marker: "#e8c27a",
    focus: "#f5d99c",
  },
};

// The same sky on paper: ivory stock, ink type, the gold turned to bronze so it still reads.
const PAPER = {
  name: "chronicle-paper",
  tokens: {
    surface: "#fbf8f1",
    surfaceAlt: "#f3eee2",
    text: "#1b1812",
    textMuted: "#6f685a",
    line: "#e6dfce",
    lineStrong: "#b9ae93",
    itemFill: "#efe6d0",
    itemStroke: "#9a7424",
    itemText: "#1b1812",
    accent: "#9a7424",
    now: "#c2442a",
    era: "#f0e9d8",
    eraText: "#7a6a3c",
    marker: "#9a7424",
    focus: "#7a5a14",
  },
};

// The ages, drawn as bands behind the items and as the overview's sections, which fly to them.
const ERAS = [
  { id: "bronze", label: "Bronze Age", start: year(-3300), end: year(-1200), view: [year(-3250), year(-1150)] },
  { id: "antiquity", label: "Antiquity", start: year(-1200), end: year(476), view: [year(-900), year(600)] },
  { id: "medieval", label: "Middle Ages", start: year(476), end: year(1492), view: [year(420), year(1540)] },
  { id: "modern", label: "Modern", start: year(1492), end: year(2060), view: [year(1440), year(2030)] },
];
/** @type {[number, number]} */
const WHOLE = [year(-3300), year(2060)];
/** @type {[number, number]} */
const APOLLO = [Date.parse("1969-07-15T18:00Z"), Date.parse("1969-07-25T12:00Z")];

// The labels are measured in the font they are drawn in, so the font is loaded first.
const SANS = "Geist, system-ui, sans-serif";
await Promise.all(["400 13px Geist", "500 13px Geist", "500 11px 'Geist Mono'", "400 40px 'Instrument Serif'", "italic 400 40px 'Instrument Serif'"].map((font) => document.fonts.load(font)));

// A bar shows its name and years inside only when they fit; a narrow one is labelled beside itself.
const measure = document.createElement("canvas").getContext("2d");
measure.font = `500 13px ${SANS}`;
const host = document.querySelector("#timeline");
let timeline;
function roomy(item) {
  if (item.end === undefined) return false;
  const [from, to] = timeline?.getSnapshot().domain ?? WHOLE;
  return ((item.end - item.start) / (to - from)) * host.clientWidth >= measure.measureText(item.label).width + 30;
}

// What the timeline is, whatever it is drawn on: the screen, or a sheet of paper (below).
/** @satisfies {Partial<import("@temporeum/timeline-element").TimelineConfig<any>>} */
const SETTINGS = {
  lanes: lanes.map(({ id, label }) => ({ id, label })),
  ariaLabel: "Five thousand years of history, from Egypt to the Moon",
  // Sizes are configuration: rows with air between them, round corners, the labels in Geist.
  metrics: { rowSize: 30, rowGap: 10, laneGap: 26, fontSize: 13, lineHeight: 16, labelPadding: 8, cornerRadius: 8, tickFontSize: 11, axisSize: 40, fontFamily: SANS },
  // Under a story the timeline stays a strip across, on a phone too.
  orientation: "horizontal",
  locale: "en-GB",
  formatTick,
  limits: { min: year(-3500), max: year(2100), minSpanMs: 10 * 60_000 },
  cluster: true,
  laneHeaders: true,
  decorations: /** @type {import("@temporeum/timeline-core").Decoration[]} */ ([...ERAS.map(({ id, label, start, end }) => ({ kind: "era", id, label, start, end, className: `era-${id}` })), { kind: "now", time: Date.now(), label: "Today" }]),
};

timeline = createTimeline(host, {
  ...SETTINGS,
  items,
  theme: CHRONICLE,
  domain: WHOLE,
  tooltip: (item) => `${item.label}\n${years(item)}`,
  slots: roomy,
});

// The timeline's snapshot is the frame drawn last, so a zoom can leave a bar with the wrong choice:
// when the view settles, a bar that should now be the other way round redraws the items.
timeline.on("viewportChanged", () => {
  const [from, to] = timeline.getSnapshot().domain;
  const drawn = timeline.slots;
  const stale = items.some((item) => item.end !== undefined && item.end > from && item.start < to && roomy(item) !== drawn.has(item.id));
  if (stale) timeline.update({ slots: (item) => roomy(item) });
});

// Each bar's content, in HTML of the page's own: its name, and its years.
function render(slots) {
  for (const { element, item } of slots.values()) {
    const when = years(item);
    if (element.firstChild !== null && element.dataset.when === when) continue;
    element.dataset.when = when;
    const bar = document.createElement("span");
    bar.className = `bar lane-${item.laneId}`;
    const name = document.createElement("b");
    name.textContent = item.label;
    const caption = document.createElement("small");
    // The item's name already says its dates, in full: this caption is drawn by CSS, for the eye only.
    caption.dataset.when = when;
    bar.append(name, caption);
    element.replaceChildren(bar);
  }
}
timeline.on("slotsChanged", ({ slots }) => render(slots));
render(timeline.slots);

// The bars' fills are gradients of the region's colour, which the page's CSS points to.
const defs = document.querySelector("#paints defs");
for (const lane of lanes) {
  defs.insertAdjacentHTML("beforeend", `<linearGradient id="fill-${lane.id}" x1="0" x2="1"><stop offset="0" stop-color="${lane.color}" stop-opacity=".46"/><stop offset=".55" stop-color="${lane.color}" stop-opacity=".2"/><stop offset="1" stop-color="${lane.color}" stop-opacity=".1"/></linearGradient>`);
}

// --- the camera: a smooth zoom-and-pan between two views ------------------------------------

// van Wijk and Nuij's optimal path: far jumps rise to see both ends, then come down.
function path(from, to) {
  const rho = Math.SQRT2;
  const [u0, w0] = [(from[0] + from[1]) / 2, from[1] - from[0]];
  const [u1, w1] = [(to[0] + to[1]) / 2, to[1] - to[0]];
  const d = Math.abs(u1 - u0);
  if (d < w0 * 1e-6) {
    const S = Math.log(w1 / w0) / rho;
    return { S: Math.abs(S), at: (t) => [u0, w0 * Math.exp(rho * t * S)] };
  }
  const b0 = (w1 * w1 - w0 * w0 + rho ** 4 * d * d) / (2 * w0 * rho ** 2 * d);
  const b1 = (w1 * w1 - w0 * w0 - rho ** 4 * d * d) / (2 * w1 * rho ** 2 * d);
  const r0 = Math.log(Math.sqrt(b0 * b0 + 1) - b0);
  const r1 = Math.log(Math.sqrt(b1 * b1 + 1) - b1);
  const S = (r1 - r0) / rho;
  return {
    S,
    at: (t) => {
      const s = t * S;
      const u = (w0 / (rho ** 2 * d)) * (Math.cosh(r0) * Math.tanh(rho * s + r0) - Math.sinh(r0));
      return [u0 + Math.sign(u1 - u0) * u * d, (w0 * Math.cosh(r0)) / Math.cosh(rho * s + r0)];
    },
  };
}

const still = matchMedia("(prefers-reduced-motion: reduce)");
let flight = 0;
function fly(to) {
  cancelAnimationFrame(flight);
  if (still.matches) return timeline.zoomTo(to);
  const route = path(timeline.getSnapshot().domain, to);
  const ms = Math.min(2600, Math.max(700, route.S * 380));
  const begun = performance.now();
  const frame = (now) => {
    const t = Math.min(1, (now - begun) / ms);
    const eased = t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;
    const [center, width] = t === 1 ? [(to[0] + to[1]) / 2, to[1] - to[0]] : route.at(eased);
    timeline.zoomTo([center - width / 2, center + width / 2]);
    if (t < 1) flight = requestAnimationFrame(frame);
  };
  flight = requestAnimationFrame(frame);
}

/** The view a slide is told in: its span with room around it, or its moment in the middle. */
function viewOf(item) {
  const end = item.end ?? item.start;
  const width = Math.max(item.data.view, (end - item.start) * 1.6);
  const middle = (item.start + end) / 2;
  return [middle - width / 2, middle + width / 2];
}

// --- the story ---------------------------------------------------------------------

const log = document.querySelector("#log");
const play = document.querySelector("#play");
const progress = document.querySelector("#progress");
const numeral = document.querySelector("#numeral");
const stage = document.querySelector("#stage");
const DWELL = 6500;
let playing = false;
let timer = 0;
const slides = items.filter((item) => item.data !== undefined);
log.dataset.items = String(items.length);
log.dataset.slides = String(slides.length + 1);

const story = mountStory(document.querySelector("#story"), timeline, {
  title: {
    headline: "Five thousand years",
    text: "<p>From the first pharaohs to the first footsteps on the Moon: twenty-one moments on one timeline that zooms from millennia down to minutes. Press <em>Play the tour</em>, page with ← and →, or pick any event below.</p>",
    media: picture("title", "#e8c27a", "Illustration: a pyramid, a temple, a pagoda, a dome and a rocket on one horizon"),
  },
  locale: "en-GB",
  formatDate: years,
  theme: CHRONICLE,
  // The page flies the camera itself, rather than the panel's plain scroll.
  reveal: false,
  strings: { previous: "Earlier", next: "Later" },
  onChange: ({ index, item, source }) => {
    progress.style.width = `${String((index / slides.length) * 100)}%`;
    // Drawn from an attribute by CSS: a decoration, not text for a reader.
    numeral.dataset.year = item === undefined ? "5000" : item.data.numeral;
    // The slide comes in: the page restarts its own animation.
    stage.classList.remove("turn");
    void stage.offsetWidth;
    stage.classList.add("turn");
    if (source !== "timeline") fly(item === undefined ? WHOLE : viewOf(item));
    if (item !== undefined) timeline.revealLane(item.laneId);
    for (const dot of moments.children) dot.classList.toggle("current", dot.dataset.id === item?.id);
    log.textContent = item === undefined ? "The title: the whole five thousand years." : `${String(index)} of ${String(slides.length)} · ${item.label} · ${years(item)}`;
    if (playing) schedule();
  },
});

// A slide taller than its panel (on a phone) scrolls, and a scrolling region must take the keyboard too.
const panel = document.querySelector("#story");
const reachable = () => {
  const slide = panel.querySelector(".tl-story-slide");
  if (slide !== null) slide.toggleAttribute("tabindex", slide.scrollHeight > slide.clientHeight);
  if (slide?.hasAttribute("tabindex")) slide.setAttribute("tabindex", "0");
};
new MutationObserver(reachable).observe(panel, { childList: true, subtree: true });
new ResizeObserver(reachable).observe(panel);

// --- the tour: a slide every few seconds, until the reader takes the controls or it ends -----------

function schedule() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    if (story.index >= story.count - 1) return setPlaying(false);
    story.next();
  }, DWELL);
}
function setPlaying(on) {
  playing = on;
  play.toggleAttribute("data-playing", on);
  play.querySelector("span").textContent = on ? "Pause" : story.index >= story.count - 1 ? "Play again" : "Play the tour";
  clearTimeout(timer);
  if (!on) return;
  if (story.index >= story.count - 1) story.go(0);
  else story.next();
}
play.addEventListener("click", () => setPlaying(!playing));
// On a desktop the wheel zooms, around the pointer. The SDK reads ctrl + wheel as a zoom (that is what a pinch is), so a plain
// wheel step is handed back to it as one; a sideways swipe and shift + wheel stay a pan.
let relaying = false;
host.addEventListener(
  "wheel",
  (event) => {
    if (event.altKey && !relaying) {
      // Alt + wheel zooms down the lanes: the rows grow or shrink, and the overview's lens follows.
      event.preventDefault();
      event.stopImmediatePropagation();
      return setRows(rows * Math.exp(-Math.sign(event.deltaY) * 0.12));
    }
    if (relaying || event.ctrlKey || event.shiftKey || event.metaKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const unit = event.deltaMode === 1 ? 33 : event.deltaMode === 2 ? 400 : 1;
    relaying = true;
    try {
      event.target.dispatchEvent(
        new WheelEvent("wheel", { bubbles: true, cancelable: true, composed: true, clientX: event.clientX, clientY: event.clientY, deltaY: event.deltaY * unit, deltaMode: 0, ctrlKey: true }),
      );
    } finally {
      relaying = false;
    }
  },
  { capture: true, passive: false },
);
// The reader takes the controls: the camera lets go, and the tour stops.
for (const type of ["pointerdown", "wheel", "keydown"]) {
  host.addEventListener(
    type,
    () => {
      cancelAnimationFrame(flight);
      if (playing) setPlaying(false);
    },
    { passive: true },
  );
}

// --- the overview: five thousand years in one strip, and the view as a lens on it ------------------

const overview = document.querySelector("#overview");
const marks = document.querySelector("#marks");
const moments = document.querySelector("#moments");
const lens = document.querySelector("#lens");
const at = (time) => ((time - WHOLE[0]) / (WHOLE[1] - WHOLE[0])) * 100;
const timeAt = (fraction) => WHOLE[0] + fraction * (WHOLE[1] - WHOLE[0]);

// Every event, in its region's row and colour; ranges as bars, moments as hairlines.
const svg = "http://www.w3.org/2000/svg";
const dots = new Map();
function drawOverview() {
  const now = timeline.items;
  marks.replaceChildren();
  lanes.forEach((lane, row) => {
    for (const item of now.filter((each) => each.laneId === lane.id)) {
      const mark = document.createElementNS(svg, "rect");
      const width = item.end === undefined ? 0.18 : Math.max(((at(item.end) - at(item.start)) / 100) * 1000, 1.2);
      for (const [name, value] of Object.entries({ x: (at(item.start) / 100) * 1000, y: row * 8 + 1, width, height: 5, rx: 1.5, fill: lane.color, opacity: item.end === undefined ? 0.95 : 0.7 })) mark.setAttribute(name, String(value));
      marks.append(mark);
    }
  });
  // The story's moments follow their events when one is moved.
  for (const item of now) if (dots.has(item.id)) dots.get(item.id).style.left = `${String(at(item.start))}%`;
}
// The story's moments: a dot each, which opens its slide.
for (const item of slides) {
  const dot = Object.assign(document.createElement("span"), { className: "moment", title: item.label });
  dot.dataset.id = item.id;
  dot.style.setProperty("--c", colorOf[item.laneId]);
  dot.addEventListener("click", () => story.go(item.id));
  dots.set(item.id, dot);
  moments.append(dot);
}
drawOverview();
// A scale of millennia under the strip.
for (const y of [-3000, -2000, -1000, 1, 1000, 2000]) {
  const tick = Object.assign(document.createElement("span"), { textContent: era(y) });
  tick.style.left = `${String(at(year(y)))}%`;
  document.querySelector("#scale").append(tick);
}
// The ages, as buttons that fly to them; the one in view lights up.
const sections = document.querySelector("#sections");
for (const age of ERAS) {
  const button = Object.assign(document.createElement("button"), { type: "button", className: "section", textContent: age.label });
  button.dataset.era = age.id;
  button.style.left = `${String(at(age.start))}%`;
  button.style.width = `${String(at(age.end) - at(age.start))}%`;
  button.addEventListener("click", () => fly(age.view));
  sections.append(button);
}
document.querySelector("#whole").addEventListener("click", () => fly(WHOLE));
document.querySelector("#apollo").addEventListener("click", () => {
  fly(APOLLO);
  timeline.revealLane("space");
});

// The lens follows the view; outside it the strip is shaded.
const view = (domain) => {
  const left = Math.max(0, at(domain[0]));
  const right = Math.min(100, at(domain[1]));
  overview.style.setProperty("--from", `${String(left)}%`);
  overview.style.setProperty("--to", `${String(right)}%`);
  lens.setAttribute("aria-valuetext", `${years({ start: domain[0], end: domain[1], granularity: domain[1] - domain[0] < 3 * YEAR ? "minute" : "year" })} in view`);
  const middle = (domain[0] + domain[1]) / 2;
  const span = domain[1] - domain[0];
  const current = span > 2500 * YEAR ? undefined : ERAS.find(({ start, end }) => middle >= start && middle < end)?.id;
  for (const button of sections.children) button.setAttribute("aria-current", String(button.dataset.era === current));
};
timeline.on("viewportChanged", ({ viewport: { domain } }) => view(domain));
view(timeline.getSnapshot().domain);

// The lens frames the view down the strip too: the lanes scroll across, and the rows in sight are the part of the strip it holds.
const AXIS = 40; // the timeline's metrics.axisSize: the lanes scroll under the axis
const STRIP = 46; // the strip's height in pixels (#marks)
/** Where a position across the lanes falls on the strip, 0 to 1: a lane is a row of the strip, and its sublanes divide that row. */
function down(layout, position) {
  let row = 0;
  layout.lanes.forEach((each, index) => {
    if (each.cross <= position) row = index;
  });
  const lane = layout.lanes[row];
  return (row + Math.min(1, Math.max(0, (position - lane.cross) / lane.crossSize))) / layout.lanes.length;
}
function frameDown() {
  const layout = timeline.layout;
  const { viewport, crossOffset } = timeline.getSnapshot();
  const room = viewport === undefined ? 0 : viewport.crossSize - AXIS;
  const scrolls = layout !== undefined && room > 0 && layout.crossSize > room + 1;
  const top = scrolls ? down(layout, crossOffset) : 0;
  const bottom = scrolls ? down(layout, crossOffset + room) : 1;
  overview.style.setProperty("--vt", `${String(top * STRIP)}px`);
  overview.style.setProperty("--vh", `${String(Math.max(bottom - top, 0.06) * STRIP)}px`);
  overview.toggleAttribute("data-scrolls", scrolls);
}
// A scroll across the lanes changes no domain, so it is the snapshot that says so, not "viewportChanged".
timeline.subscribe(frameDown);
timeline.on("slotsChanged", frameDown);
frameDown();
// The first frame comes after this runs, and a resize changes how much of the lanes is in sight.
new ResizeObserver(frameDown).observe(host);
requestAnimationFrame(() => requestAnimationFrame(frameDown));

// Zoom down the lanes: the rows are sizes in `metrics`, so the lanes' scale is a number the page keeps and hands back.
// The lens has a handle on each edge: the edge opposite the one pulled stays where it is.
const track = document.querySelector("#track");
const BASE = SETTINGS.metrics;
const ROWS_MAX = 1.6;
let rows = 1;
const sized = (scale) => ({ ...BASE, rowSize: BASE.rowSize * scale, rowGap: BASE.rowGap * scale, laneGap: BASE.laneGap * scale });
function setRows(want, keepBottom = false) {
  // Zooming out stops where every lane is in view, however small the rows get by then.
  const layout = timeline.layout;
  const { viewport, crossOffset: offset } = timeline.getSnapshot();
  const room = viewport === undefined ? 0 : viewport.crossSize - AXIS;
  const fit = layout === undefined ? 0.6 : (room / (layout.crossSize / rows)) * 0.99;
  let next = Math.min(Math.max(want, Math.min(fit, 1)), ROWS_MAX);
  if (Math.abs(next - rows) < 0.002) return;
  timeline.update({ metrics: sized(next) });
  // A lane is not all rows (headers, padding), so the size the lanes came to settles the last of it.
  if (next <= (fit / 0.99) * 1.001) {
    for (let pass = 0; pass < 3; pass += 1) {
      const now = timeline.layout;
      if (now === undefined || now.crossSize <= room) break;
      next *= (room / now.crossSize) * 0.995;
      timeline.update({ metrics: sized(next) });
    }
  }
  // Rows scale about the top of the view, or about its bottom when that is the edge that stays.
  timeline.scrollLanes(keepBottom ? ((offset + room) * next) / rows - room - offset : (offset * next) / rows - offset);
  rows = next;
  frameDown();
}
const grips = { down: lens.querySelector(".grip"), up: lens.querySelector(".grip-t"), right: lens.querySelector(".grip-x"), left: lens.querySelector(".grip-l") };
// Two presses on the bottom handle put the rows back. (The drag captures the pointer, so a "dblclick" would land on the strip, not here.)
let pressed = 0;
/** Pointer moves, while a handle is held, are handed to `move`. */
function hold(event, move) {
  track.setPointerCapture(event.pointerId);
  const end = () => {
    track.removeEventListener("pointermove", move);
    track.removeEventListener("pointerup", end);
    track.removeEventListener("pointercancel", end);
  };
  track.addEventListener("pointermove", move);
  track.addEventListener("pointerup", end);
  track.addEventListener("pointercancel", end);
}
// Drag the lens's top or bottom edge: how much of the lanes is in the lens decides how large their rows are.
function dragRows(event, edge) {
  const layout = timeline.layout;
  const { viewport } = timeline.getSnapshot();
  if (layout === undefined || viewport === undefined) return;
  const room = viewport.crossSize - AXIS;
  const whole = layout.crossSize / rows;
  const top = Number.parseFloat(overview.style.getPropertyValue("--vt")) / STRIP;
  const bottom = top + Number.parseFloat(overview.style.getPropertyValue("--vh")) / STRIP;
  const start = event.clientY;
  hold(event, (next) => {
    const moved = (next.clientY - start) / STRIP;
    const share = Math.min(Math.max(edge === "down" ? bottom + moved - top : bottom - (top + moved), 0.1), 1);
    setRows(room / (share * whole), edge === "up");
  });
}
// Drag the lens's left or right edge: the opposite edge of the view stays, and how much time the lens holds is the zoom across.
function dragSpan(event, edge) {
  const box = track.getBoundingClientRect();
  const [from, to] = timeline.getSnapshot().domain;
  const least = 10 * 60_000;
  hold(event, (next) => {
    const at = timeAt(Math.min(Math.max((next.clientX - box.left) / box.width, 0), 1));
    timeline.zoomTo(edge === "right" ? [from, Math.max(at, from + least)] : [Math.min(at, to - least), to]);
  });
}
// The same wheel gesture over the overview itself.
track.addEventListener(
  "wheel",
  (event) => {
    if (!event.altKey) return;
    event.preventDefault();
    setRows(rows * Math.exp(-Math.sign(event.deltaY) * 0.12));
  },
  { passive: false },
);

// Drag the lens to pan; press anywhere else on the strip to fly there.
track.addEventListener("pointerdown", (event) => {
  cancelAnimationFrame(flight);
  if (playing) setPlaying(false);
  if (event.target === grips.right || event.target === grips.left) return dragSpan(event, event.target === grips.right ? "right" : "left");
  if (event.target === grips.up) return dragRows(event, "up");
  if (event.target === grips.down) {
    if (event.timeStamp - pressed < 350) return setRows(1);
    pressed = event.timeStamp;
    return dragRows(event, "down");
  }
  const box = track.getBoundingClientRect();
  const [from, to] = timeline.getSnapshot().domain;
  if (event.target !== lens) {
    const middle = timeAt((event.clientX - box.left) / box.width);
    const span = Math.min(to - from, 1200 * YEAR);
    return fly([middle - span / 2, middle + span / 2]);
  }
  track.setPointerCapture(event.pointerId);
  const grab = event.clientX;
  const grabY = event.clientY;
  const lanesAt = timeline.getSnapshot().crossOffset;
  let asked = lanesAt;
  const move = (next) => {
    const shift = ((next.clientX - grab) / box.width) * (WHOLE[1] - WHOLE[0]);
    timeline.zoomTo([from + shift, to + shift]);
    // Down the strip the lens scrolls the lanes: its height is the strip's share of the lanes' length.
    // (The snapshot catches up a frame later, so the offset asked for last is kept here.)
    const layout = timeline.layout;
    const { viewport } = timeline.getSnapshot();
    if (layout !== undefined && viewport !== undefined && overview.hasAttribute("data-scrolls")) {
      const target = Math.min(Math.max(lanesAt + ((next.clientY - grabY) / STRIP) * layout.crossSize, 0), layout.crossSize - (viewport.crossSize - AXIS));
      timeline.scrollLanes(target - asked);
      asked = target;
    }
  };
  const end = () => {
    track.removeEventListener("pointermove", move);
    track.removeEventListener("pointerup", end);
    track.removeEventListener("pointercancel", end);
  };
  track.addEventListener("pointermove", move);
  track.addEventListener("pointerup", end);
  track.addEventListener("pointercancel", end);
});
// From the keyboard the lens is a slider: the arrows pan a tenth of the view, + and - zoom.
lens.addEventListener("keydown", (event) => {
  const [from, to] = timeline.getSnapshot().domain;
  const span = to - from;
  const middle = (from + to) / 2;
  if (event.shiftKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
    setRows(rows * (event.key === "ArrowUp" ? 1.15 : 1 / 1.15));
    return event.preventDefault();
  }
  if (event.key === "ArrowUp" || event.key === "ArrowDown") {
    timeline.scrollLanes(event.key === "ArrowUp" ? -60 : 60);
    return event.preventDefault();
  }
  const by = { ArrowLeft: -0.1, ArrowRight: 0.1, PageUp: -1, PageDown: 1 }[event.key];
  const zoom = { "+": 0.5, "=": 0.5, "-": 2 }[event.key];
  if (by !== undefined) timeline.zoomTo([from + by * span, to + by * span]);
  else if (zoom !== undefined) fly([middle - (span * zoom) / 2, middle + (span * zoom) / 2]);
  else if (event.key === "Home" || event.key === "End") fly(event.key === "Home" ? ERAS[0].view : ERAS[3].view);
  else return;
  event.preventDefault();
});

// --- the legend: a spotlight on one region -------------------------------------------------------

const legend = document.querySelector("#legend");
// A spotlight is the page's CSS alone: items carry their region as a class, labels their item's id.
const spotlight = document.head.appendChild(document.createElement("style"));
for (const lane of lanes) {
  const chip = Object.assign(document.createElement("button"), { type: "button", className: "chip" });
  chip.setAttribute("aria-pressed", "false");
  chip.style.setProperty("--c", lane.color);
  chip.append(document.createElement("i"), lane.label);
  chip.addEventListener("click", () => {
    const on = chip.getAttribute("aria-pressed") !== "true";
    for (const other of legend.children) other.setAttribute("aria-pressed", String(on && other === chip));
    const ids = items.filter((item) => item.laneId === lane.id).map((item) => `[data-tl-label="${item.id}"]`);
    spotlight.textContent = on
      ? `#timeline .tl-item:not(.lane-${lane.id}), #timeline .tl-slot:not(:has(.lane-${lane.id})), #timeline .tl-label:not(.tl-slot):not(${ids.join(",")}) { opacity: 0.12; } #marks rect:not([fill="${lane.color}"]) { opacity: 0.12; }`
      : "";
    if (on) timeline.revealLane(lane.id);
  });
  legend.append(chip);
}

// --- rewrite history: the same timeline, editable, with an exact undo -----------------------------

const chronicle = document.querySelector("#chronicle");
const editButton = document.querySelector("#edit");
const undoButton = document.querySelector("#undo");
const restoreButton = document.querySelector("#restore");
const done = [];

const buttons = () => {
  undoButton.disabled = done.length === 0;
  restoreButton.disabled = done.length === 0;
};
editButton.addEventListener("click", () => {
  const on = editButton.getAttribute("aria-pressed") !== "true";
  editButton.setAttribute("aria-pressed", String(on));
  chronicle.toggleAttribute("data-editing", on);
  // Editing is an option like any other: a drag moves an event, a drag on its edge resizes it, and the keys do both.
  timeline.update({ editing: { enabled: on } });
  if (on) {
    if (playing) setPlaying(false);
    log.textContent = "Rewrite history: drag an event or the edge of an era — or select one and press Alt + ← →. Undo takes every edit back.";
  }
});
// Every edit is one command, and its inverse is the undo.
timeline.on("command", ({ command }) => {
  done.push(command);
  buttons();
  drawOverview();
  const [patch] = command.after;
  const item = timeline.items.find((each) => each.id === patch?.id);
  if (item !== undefined) log.textContent = `${item.label}: now ${years(item)}. ${String(done.length)} edit${done.length === 1 ? "" : "s"} to undo.`;
});
undoButton.addEventListener("click", () => {
  const command = done.pop();
  if (command === undefined) return;
  timeline.applyCommand(command.inverse);
  buttons();
  drawOverview();
  log.textContent = done.length === 0 ? "History is back as it was." : `Undone. ${String(done.length)} more to go.`;
});
restoreButton.addEventListener("click", () => {
  while (done.length > 0) timeline.applyCommand(done.pop().inverse);
  buttons();
  drawOverview();
  log.textContent = "History is back as it was.";
});

// --- take it with you ---------------------------------------------------------------

/** Hand a file to the reader: no server involved. */
function save(name, blob) {
  const url = URL.createObjectURL(blob);
  Object.assign(document.createElement("a"), { href: url, download: name }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * An export is the timeline drawn again, by the timeline itself — not by the page's CSS. So it is drawn on a
 * second instance, off screen: the same settings and the history as it now stands (edits and all), the bars'
 * names as the timeline's own labels, a point as a small bar, and the lane names given room at the left.
 * The page never shows the swap, and the reader's view is not touched.
 */
/** A span with a fifth more to its left: the lane names sit over the first bars, and want a margin. */
/** @type {(domain: [number, number]) => [number, number]} */
const marginal = ([from, to]) => [to - (to - from) / 0.8, to];

async function offscreen(theme, domain, width, height, job) {
  const sheet = Object.assign(document.createElement("div"), { inert: true });
  sheet.style.cssText = `position: fixed; left: -${String(width + 100)}px; top: 0; width: ${String(width)}px; height: ${String(height)}px`;
  document.body.append(sheet);
  const copy = createTimeline(sheet, { ...SETTINGS, theme, domain: marginal(domain), items: timeline.items.map((item) => ({ ...item, kind: "range" })) });
  try {
    // A frame is drawn on the next one.
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return await job(copy);
  } finally {
    copy.destroy();
    sheet.remove();
  }
}

const TITLE = "Five thousand years, from the Nile to the Moon";
document.querySelector("#png").addEventListener("click", async () => {
  // What is on screen — the view you have flown to — as a picture at twice the pixels, with a margin for the lane names.
  save("chronicle.png", await offscreen(CHRONICLE, timeline.getSnapshot().domain, 1600, 900, (copy) => copy.exportPng({ scale: 2 })));
  log.textContent = "chronicle.png: the view as it is now, at twice the pixels.";
});
document.querySelector("#pdf").addEventListener("click", async () => {
  // The whole five thousand years, cut between rows onto as many pages as it needs.
  const pdf = await offscreen(PAPER, WHOLE, 1100, 700, (copy) => copy.exportPdf({ size: "a4", orientation: "landscape", title: TITLE, range: marginal(WHOLE) }));
  const pages = /\/Count (\d+)/.exec(new TextDecoder("latin1").decode(pdf))?.[1];
  save("chronicle.pdf", new Blob([pdf], { type: "application/pdf" }));
  log.textContent = `chronicle.pdf: all of it, ${pages} ${pages === "1" ? "page" : "pages"}, A4 landscape, on paper.`;
});
document.querySelector("#print").addEventListener("click", () => offscreen(PAPER, WHOLE, 1100, 700, (copy) => copy.print({ size: "a4", title: TITLE, range: marginal(WHOLE) })));
