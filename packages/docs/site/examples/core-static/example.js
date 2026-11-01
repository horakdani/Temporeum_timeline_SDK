import { createTimeScale, generateTicks, itemRect, layoutItems, renderTimeline, renderToSvgString } from "@temporeum/timeline-core";

/** @type {import("@temporeum/timeline-core").Domain} */
const domain = [Date.UTC(2025, 5, 1), Date.UTC(2025, 5, 22)];
/** @type {import("@temporeum/timeline-core").Item[]} */
const items = [
  { id: "trip", start: Date.UTC(2025, 5, 2), end: Date.UTC(2025, 5, 14), laneId: "travel", label: "Trip" },
  { id: "launch", start: Date.UTC(2025, 5, 3), granularity: "day", laneId: "work", label: "Launch" },
  { id: "ongoing", start: Date.UTC(2025, 5, 10), open: true, laneId: "work", label: "Support" },
];
const lines = [];

// Layout packs in time, not pixels: the rows survive a zoom.
const scale = createTimeScale(domain, 960);
const layout = layoutItems(items);
for (const placed of layout.items) {
  lines.push(`${placed.item.id}: row ${String(placed.row)}, x ${itemRect(placed, scale).main.toFixed(0)}`);
}

// Round ticks, in the reader's own zone.
const ticks = generateTicks(domain, 960, { timeZone: "Europe/Budapest" });
lines.push(`${String(ticks.length)} ticks, the first at ${new Date(ticks[0].time).toISOString()} (${ticks[0].granularity})`);

// A frame is plain objects; the serialiser writes it out. The same call runs on a server.
const frame = renderTimeline({
  items,
  lanes: [{ id: "work", label: "Work", pinned: true }, { id: "travel", label: "Travel" }],
  domain,
  width: 960,
  height: 220,
  theme: "light",
  timeZone: "Europe/Budapest",
  decorations: [{ kind: "banding" }, { kind: "marker", id: "ship", time: Date.UTC(2025, 5, 3), label: "release" }],
});
document.querySelector("#picture").innerHTML = renderToSvgString(frame.scene);
lines.push(`labels dropped: ${String(frame.labels.dropped.length)}; content needs ${String(frame.contentCrossSize)} px across`);
document.querySelector("#out").textContent = lines.join("\n");
