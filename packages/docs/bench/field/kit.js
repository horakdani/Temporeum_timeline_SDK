/*
 * The field benchmark's shared page kit (scripts/sdk_bench_browsers.mjs).
 * Every page — one per workload — builds its data with
 * the generator below, puts the chart into the same 1440 x 900 box, and
 * answers the harness through one contract:
 *
 *   window.benchField = {
 *     marker, library, workload, n,
 *     ready,               Promise<{ readyMs }>: item nodes in the box and visible, then two rAFs with no mutation
 *     frames.start/stop(), rAF intervals (ms) between start and stop
 *     counts(),            { itemNodes, visibleItems, elements }
 *     offsetPx(),          how far the view has moved along time since load, in px (later is positive)
 *     zoomFactor(),        how far it is zoomed in since load (2 = twice as close), or null without zoom
 *     pan,                 { mode: "drag" | "wheel-x", x, y }: the chart's own way to move along time, and where
 *     zoom,                { supported, stepIn, stepOut }: ctrl + wheel, and the |deltaY| of one notch in and out
 *     edits(),             item edits the page has seen (a pan or a zoom must make none)
 *   }
 */

export const DAY = 86_400_000;
export const START = Date.UTC(2026, 0, 1);
export const VIEWPORT = { width: 1440, height: 900 };

/** The timeline workload: 60 interleaved streams, an 8-day item every 10 days in each, in 20 groups. */
export function timelineData(n) {
  const STREAMS = 60;
  const PERIOD = 10 * DAY;
  const LENGTH = 8 * DAY;
  const groups = [];
  for (let index = 0; index < 20; index += 1) groups.push({ id: `g${index}`, label: `Group ${index}` });
  const items = [];
  for (let index = 0; index < n; index += 1) {
    const stream = index % STREAMS;
    const round = Math.floor(index / STREAMS);
    const start = START + round * PERIOD + (stream * PERIOD) / STREAMS;
    items.push({ id: `e${index}`, start, end: start + LENGTH, label: `Item ${index}`, group: `g${stream % 20}` });
  }
  const total = items[items.length - 1].end - START;
  return { items, groups, view: [START + total * 0.2, START + total * 0.4] };
}

/** The Gantt workload: one task per row, 3 to 6 days long, chained finish-to-start in runs of ten. */
export function ganttData(n) {
  const tasks = [];
  const links = [];
  let at = START;
  for (let index = 0; index < n; index += 1) {
    const length = (3 + ((index * 7) % 4)) * DAY;
    if (index % 10 === 0) at = START + (index % 40) * DAY;
    tasks.push({ id: `t${index}`, start: at, end: at + length, label: `Task ${index}`, progress: (index % 10) / 10 });
    if (index % 10 !== 0) links.push({ id: `l${index}`, from: `t${index - 1}`, to: `t${index}` });
    at += length + DAY;
  }
  return { tasks, links, view: [START, START + 60 * DAY] };
}

/** Puts `window.benchField` on the page. */
export function installBench(spec) {
  const frame = spec.frame;
  const recorder = { times: [], on: false };
  const record = (time) => {
    if (!recorder.on) return;
    recorder.times.push(time);
    requestAnimationFrame(record);
  };
  let mutated = false;
  new MutationObserver(() => {
    mutated = true;
  }).observe(frame, { subtree: true, childList: true, attributes: true, characterData: true });
  const shown = (node) => (typeof node.checkVisibility === "function" ? node.checkVisibility({ visibilityProperty: true, opacityProperty: true }) : node.getClientRects().length > 0);
  const ready = new Promise((resolve) => {
    let quiet = 0;
    const check = () => {
      const first = frame.querySelector(spec.itemSelector);
      const present = first !== null && shown(first);
      if (present && !mutated) quiet += 1;
      else quiet = 0;
      mutated = false;
      if (quiet >= 2) resolve({ readyMs: performance.now() });
      else requestAnimationFrame(check);
    };
    requestAnimationFrame(check);
  });
  window.benchField = {
    marker: "temporeum-bench-field",
    library: spec.library,
    workload: spec.workload,
    n: spec.n,
    ready,
    frames: {
      start() {
        recorder.times = [];
        recorder.on = true;
        requestAnimationFrame(record);
      },
      stop() {
        recorder.on = false;
        const t = recorder.times;
        return t.slice(1).map((time, index) => time - t[index]);
      },
    },
    counts() {
      const box = frame.getBoundingClientRect();
      const nodes = frame.querySelectorAll(spec.itemSelector);
      let visibleItems = 0;
      for (const node of nodes) {
        const r = node.getBoundingClientRect();
        if (r.width > 0 && r.right > box.left && r.left < box.right && r.bottom > box.top && r.top < box.bottom) visibleItems += 1;
      }
      return { itemNodes: nodes.length, visibleItems, elements: frame.getElementsByTagName("*").length };
    },
    offsetPx: spec.offsetPx,
    zoomFactor: spec.zoomFactor ?? (() => null),
    get pan() {
      return spec.pan();
    },
    zoom: spec.zoom,
    edits: spec.edits ?? (() => 0),
  };
}

/** offsetPx and zoomFactor from the window the timeline reports as times. */
export function timeWindow(getRange, width = VIEWPORT.width) {
  let first = null;
  const initial = () => (first ??= getRange());
  return {
    offsetPx() {
      const r0 = initial();
      const r = getRange();
      return (r.start - r0.start) / ((r0.end - r0.start) / width);
    },
    zoomFactor() {
      const r0 = initial();
      const r = getRange();
      return (r0.end - r0.start) / (r.end - r.start);
    },
    mark: initial,
  };
}
