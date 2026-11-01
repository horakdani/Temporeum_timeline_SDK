import { createTimeline, registerPlugin } from "@temporeum/timeline-element";
import { exportPlugin } from "@temporeum/timeline-element/export";
import { ganttPlugin } from "@temporeum/timeline-element/gantt";

// PNG, PDF and print are a plugin, and so is the Gantt chart this page prints.
registerPlugin(exportPlugin, ganttPlugin);

const day = 86_400_000;
// Monday 2026-01-05, 00:00 UTC.
const start = Date.UTC(2026, 0, 5);

const lanes = Array.from({ length: 8 }, (_, at) => ({ id: `crew-${String(at + 1)}`, label: `Crew ${String(at + 1)}` }));
const items = Array.from({ length: 96 }, (_, at) => {
  const from = start + ((at * 11) % 80) * day;
  return { id: `task-${String(at)}`, label: `Task ${String(at + 1)}`, start: from, end: from + (3 + (at % 5)) * day, laneId: lanes[at % 8].id };
});

const element = document.querySelector("#timeline");
const timeline = createTimeline(element, {
  items,
  lanes,
  domain: [start, start + 14 * day],
  timeZone: "UTC",
  ariaLabel: "Quarter plan",
  gantt: { dependencies: Array.from({ length: 11 }, (_, at) => ({ id: `dep-${String(at)}`, from: items[at * 8].id, to: items[at * 8 + 8].id })) },
});

const log = document.querySelector("#log");

/** Hand a file to the reader: no server involved. */
function download(name, blob) {
  const url = URL.createObjectURL(blob);
  const link = Object.assign(document.createElement("a"), { href: url, download: name });
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const exports = {
  // The view on screen, as a standalone file.
  svg: () => download("plan.svg", new Blob([timeline.exportSVG()], { type: "image/svg+xml" })),
  png: async () => download("plan.png", await timeline.exportPNG({ scale: 2 })),
  // The whole quarter: every lane, cut between rows onto as many pages as it needs.
  pdf: () => {
    const pdf = timeline.exportPDF({ size: "a4", orientation: "landscape" });
    const pages = /\/Count (\d+)/.exec(new TextDecoder("latin1").decode(pdf))?.[1];
    download("plan.pdf", new Blob([pdf], { type: "application/pdf" }));
    log.textContent = `plan.pdf: ${pages} ${pages === "1" ? "page" : "pages"}, A4 landscape.`;
  },
  print: () => timeline.print({ size: "a4" }),
};

for (const button of document.querySelectorAll("button[data-export]")) {
  button.addEventListener("click", () => exports[button.dataset.export]());
}
