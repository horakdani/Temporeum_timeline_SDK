import { createTimeline } from "@temporeum/timeline-element";

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const SERVICES = ["api", "auth", "billing", "search", "worker"];
const MESSAGES = {
  info: ["request served", "cache warmed", "job finished", "user signed in", "index refreshed"],
  warn: ["slow query", "retrying upstream", "queue backing up", "token near expiry"],
  error: ["upstream timeout", "payment declined", "worker crashed", "disk almost full"],
};

function hash(n) {
  let x = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  x ^= x >>> 13;
  return Math.imul(x, 0xc2b2ae35) >>> 0;
}
const levelOf = (h) => (h % 50 === 0 ? "error" : h % 9 === 0 ? "warn" : "info");
let serial = 0;
/** @returns {import("@temporeum/timeline-core").Item<{ level: string }> & { start: number }} */
function entry(time) {
  serial += 1;
  const h = hash(serial);
  const level = levelOf(h);
  const words = MESSAGES[level];
  return { id: `e${String(serial)}`, start: time, granularity: "second", laneId: SERVICES[h % SERVICES.length], label: words[h % words.length], className: `level-${level}`, data: { level } };
}

// A stand-in for your log server: 100 000 entries over the last day, in time order, and more arriving.
const now = Date.now();
const store = [];
for (let i = 0; i < 100_000; i += 1) {
  const t = i / 100_000;
  // Busier in the afternoon, as logs are; monotonic, so the store stays sorted.
  store.push(entry(Math.round(now - 24 * HOUR + (t - 0.05 * Math.sin(t * 2 * Math.PI)) * 24 * HOUR)));
}
const firstAt = (time) => {
  let lo = 0;
  let hi = store.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (store[mid].start < time) lo = mid + 1;
    else hi = mid;
  }
  return lo;
};

const shown = new Set(["error", "warn", "info"]);
const keep = (item) => shown.has(item.data.level);
// Live: the last hour, held by the page — new entries go in with addItems, nothing reloads.
const lastHour = () => store.slice(firstAt(Date.now() - HOUR)).filter(keep);
// The whole day: a fetched source. The timeline asks for the windows it shows and aborts the ones it leaves.
let requests = 0;
const fromServer = ([from, to], signal) =>
  new Promise((resolve, reject) => {
    requests += 1;
    const timer = setTimeout(() => resolve(store.slice(firstAt(from), firstAt(to)).filter(keep)), 80);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(signal.reason);
    });
  });

const timeline = createTimeline(document.querySelector("#timeline"), {
  items: lastHour(),
  lanes: SERVICES.map((id) => ({ id, label: id })),
  ariaLabel: "Service log",
  locale: "en-GB",
  domain: [now - 3 * MINUTE, now + 20 * SECOND],
  // A log is read, not edited; keep the zoom between ten seconds and two days.
  limits: { minSpanMs: 10 * SECOND, maxSpanMs: 48 * HOUR },
  // Entries too close to tell apart become one marker with their count.
  cluster: true,
});

let mode = "live";
let following = true;
const count = document.querySelector("#count");
const log = document.querySelector("#log");
function counted() {
  count.dataset.total = String(store.length);
  count.dataset.mode = mode;
  count.dataset.requests = String(requests);
  const inView = timeline.getSnapshot().visibleCount.toLocaleString("en-GB");
  count.textContent = mode === "live" ? `${timeline.items.length.toLocaleString("en-GB")} in the last hour · ${inView} in view` : `${store.length.toLocaleString("en-GB")} in the log · ${inView} in view · ${String(requests)} window requests`;
}
const say = {
  live: "The last hour, live: a new entry about every second goes in with addItems, and only the lane it lands in is packed again. Follow keeps the view on the newest.",
  day: "The whole day, 100 000 entries, loaded window by window as you zoom out and pan — a request the view has left is aborted. A fetched source belongs to the server: new entries show on the next load.",
};
log.textContent = say.live;

function load() {
  timeline.setItems(mode === "live" ? lastHour() : fromServer);
  counted();
}
for (const button of document.querySelectorAll("[data-mode]")) {
  button.addEventListener("click", () => {
    mode = button.dataset.mode;
    for (const other of document.querySelectorAll("[data-mode]")) other.setAttribute("aria-pressed", String(other === button));
    log.textContent = say[mode];
    load();
    if (mode === "day") timeline.zoomTo([Date.now() - 24 * HOUR, Date.now() + HOUR]);
  });
}
// Press a level to hide or show it: the page filters, the timeline draws what it is given.
for (const button of document.querySelectorAll("[data-level]")) {
  button.addEventListener("click", () => {
    const level = button.dataset.level;
    if (shown.has(level)) shown.delete(level);
    else shown.add(level);
    button.setAttribute("aria-pressed", String(shown.has(level)));
    load();
  });
}

// Follow: the view keeps its span and slides with the clock; a pan or a zoom by hand stops it.
const follow = document.querySelector("#follow");
follow.addEventListener("click", () => {
  following = !following;
  follow.setAttribute("aria-pressed", String(following));
});
timeline.on("viewportChanged", ({ reason }) => {
  if ((reason === "pan" || reason === "zoom") && following) {
    following = false;
    follow.setAttribute("aria-pressed", "false");
  }
});

// About one new entry a second.
setInterval(() => {
  const fresh = entry(Date.now());
  store.push(fresh);
  if (mode === "live") {
    if (keep(fresh)) timeline.addItems([fresh]);
    if (following) {
      const [from, to] = timeline.getSnapshot().domain;
      timeline.zoomTo([fresh.start - (to - from) * 0.9, fresh.start + (to - from) * 0.1]);
    }
  }
  counted();
}, SECOND);
counted();
