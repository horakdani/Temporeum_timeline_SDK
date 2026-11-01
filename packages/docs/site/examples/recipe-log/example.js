import { createTimeline } from "@temporeum/timeline-element";

const SECOND = 1000;
const HOUR = 3_600_000;
const T0 = Date.UTC(2026, 9, 27, 8);
const LEVELS = ["info", "info", "info", "info", "warn", "info", "info", "error"];

// A stand-in for your server: the same events for the same window, every time.
// A real host would `fetch(`/api/log?from=${from}&to=${to}`, { signal })`.
function hash(n) {
  let x = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  x ^= x >>> 13;
  return Math.imul(x, 0xc2b2ae35) >>> 0;
}
let requests = 0;
const requestsLine = document.querySelector("#requests");
function queryLog([from, to], signal) {
  requests += 1;
  requestsLine.dataset.count = String(requests);
  requestsLine.textContent = `${String(requests)} window request(s) so far — zoom with ctrl + wheel or +/-, then pan`;
  const events = [];
  for (let slot = Math.ceil(from / (20 * SECOND)); slot * 20 * SECOND < to; slot += 1) {
    const h = hash(slot);
    if (h % 3 !== 0) continue;
    const level = LEVELS[h % LEVELS.length];
    events.push({
      id: `e${String(slot)}`,
      start: slot * 20 * SECOND + (h % 20) * SECOND,
      granularity: "second",
      laneId: level,
      label: `${level} #${String(slot % 10_000)}`,
      className: `level-${level}`,
    });
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(events), 120);
    // The timeline aborts a window the view has left: stop the work.
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(signal.reason);
    });
  });
}

createTimeline(document.querySelector("#timeline"), {
  items: queryLog,
  lanes: [
    { id: "error", label: "Error", pinned: true },
    { id: "warn", label: "Warning" },
    { id: "info", label: "Info" },
  ],
  theme: "light",
  ariaLabel: "Service log",
  domain: [T0, T0 + 2 * HOUR],
  // A log is read, not edited; keep the zoom between a minute and two days.
  limits: { minSpanMs: 60 * SECOND, maxSpanMs: 48 * HOUR },
  // Events too close to tell apart become one marker with their count.
  cluster: true,
});
