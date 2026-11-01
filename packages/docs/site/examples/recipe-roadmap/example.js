import { createTimeline } from "@temporeum/timeline-element";

const quarter = (y, q) => Date.UTC(y, (q - 1) * 3, 1);
const TODAY = Date.UTC(2026, 7, 14);

const items = [
  { id: "sso", label: "Single sign-on", laneId: "platform", start: quarter(2026, 1), end: quarter(2026, 2), className: "status-done", data: "Shipped in March." },
  { id: "audit", label: "Audit log", laneId: "platform", start: quarter(2026, 2), end: quarter(2026, 4), className: "status-now", data: "In beta with three customers." },
  { id: "regions", label: "EU data region", laneId: "platform", start: quarter(2026, 4), end: quarter(2027, 2), className: "status-later", data: "Planned." },
  { id: "mobile", label: "Mobile app", laneId: "product", start: quarter(2026, 1), end: quarter(2026, 3), className: "status-done", data: "On both stores." },
  { id: "offline", label: "Offline mode", laneId: "product", start: quarter(2026, 3), end: quarter(2027, 1), className: "status-now", data: "Sync engine in review." },
  // Ongoing, with no end anyone would promise: open intervals reach past the view.
  { id: "perf", label: "Performance work", laneId: "product", start: quarter(2026, 2), open: true, className: "status-now", data: "Never done." },
  { id: "partners", label: "Partner API", laneId: "growth", start: quarter(2026, 3), end: quarter(2026, 4), className: "status-now", data: "Two partners signed." },
];

/** @type {import("@temporeum/timeline-core").Decoration[]} */
const quarters = [];
for (let q = 1; q <= 4; q += 1) quarters.push({ kind: "era", id: `q${String(q)}`, start: quarter(2026, q), end: q === 4 ? quarter(2027, 1) : quarter(2026, q + 1), label: `Q${String(q)} 2026` });

const detail = document.querySelector("#detail");
const timeline = createTimeline(document.querySelector("#timeline"), {
  items,
  lanes: [
    { id: "platform", label: "Platform" },
    { id: "product", label: "Product" },
    { id: "growth", label: "Growth" },
  ],
  theme: "light",
  ariaLabel: "Roadmap 2026",
  domain: [quarter(2025, 4) + 45 * 86_400_000, quarter(2027, 2)],
  decorations: [...quarters, { kind: "now", time: TODAY, label: "Today" }],
});

timeline.on("selectionChanged", ({ ids }) => {
  const item = items.find((candidate) => candidate.id === ids[0]);
  detail.textContent = item === undefined ? "Select an item to read about it." : `${item.label}: ${item.data}`;
});
