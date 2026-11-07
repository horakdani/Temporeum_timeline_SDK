/**
 * The field benchmark's page blocks: every number on benchmark-field.md
 * comes from site/benchmark/field/results.json, written by
 * scripts/sdk_bench_browsers.mjs, and so does the list of what goes over the
 * frame budget.
 *
 *   {{bench:field}}         the results, one table per workload and browser, and the bytes
 *   {{bench:field-method}}  how and where it was measured, from the file's settings
 *   {{bench:field-budget}}  every pan and zoom that misses more frames than the budget
 *
 * `scripts/sdk_check_bench_field.mjs` recomputes the list with its own code
 * and reads every cell back from the built page.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** The missed-frame budget the performance guide sets, in percent; a pan or a zoom over it is listed. */
export const FRAME_BUDGET = { percent: 5, metrics: ["pan-missed-frames", "zoom-missed-frames"] };

const LABELS = {
  "first-render": "First render",
  "dom-elements-after-load": "Elements after load",
  "item-nodes-after-load": "Item nodes after load",
  "visible-items-after-load": "Items visible after load",
  "pan-missed-frames": "Pan: missed frames",
  "pan-p95-frame": "Pan: 95th percentile frame",
  "zoom-missed-frames": "Zoom: missed frames",
  "zoom-p95-frame": "Zoom: 95th percentile frame",
  "zoom-peak-factor": "Zoom: peak reached",
  "heap-after-load": "Heap after load",
  "heap-after-pan": "Heap after the pan",
  "js-min": "JavaScript, minified",
  "js-min-gz": "JavaScript, minified and gzipped",
};
const ORDER = Object.keys(LABELS);
const BROWSERS = ["chromium", "firefox", "webkit"];
const WORKLOAD = { timeline: "Timeline", gantt: "Gantt chart" };

export const fieldPath = (docsDir) => join(docsDir, "site", "benchmark", "field", "results.json");

/** The number as the page writes it. The check formats the same way. */
export function fmt(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  return abs >= 100 ? value.toFixed(0) : abs >= 10 ? value.toFixed(1) : value.toFixed(2);
}

const escapeHtml = (text) => String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const wrap = (table) => `<div class="table-wrap" tabindex="0" role="region" aria-label="Table, scrolls sideways on a narrow screen">${table}</div>`;
const keyOf = (row) => [row.library, row.workload ?? "", row.browser ?? "", String(row.n ?? ""), row.metric].join("|");

function load(docsDir) {
  const path = fieldPath(docsDir);
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
}

const NOT_MEASURED = `<p class="bench-pending"><strong>Not measured yet.</strong> This page is generated from site/benchmark/field/results.json, which <code>npm run bench:field -w @temporeum/timeline-docs</code> writes; until it has run, there are no numbers to show, and none are written by hand.</p>`;

/** Every pan and zoom whose median misses more frames than the budget: one entry per workload, size and browser. */
export function overBudget(data) {
  return data.results
    .filter((row) => FRAME_BUDGET.metrics.includes(row.metric) && row.median > FRAME_BUDGET.percent)
    .map((row) => ({ key: keyOf(row), workload: row.workload, browser: row.browser, n: row.n, metric: row.metric, median: row.median }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

export function fieldTablesHtml(docsDir) {
  const data = load(docsDir);
  if (data === null) return NOT_MEASURED;
  const parts = [];
  for (const workload of Object.keys(data.workloads)) {
    const lines = [];
    for (const n of data.settings.ns[workload]) {
      for (const metric of ORDER) {
        const cells = BROWSERS.map((browser) => data.results.find((row) => row.workload === workload && row.browser === browser && row.n === n && row.metric === metric));
        if (cells.every((cell) => cell === undefined)) continue;
        const unit = cells.find(Boolean).unit;
        const tds = cells
          .map((cell) => (cell === undefined ? `<td>—</td>` : `<td data-field="${escapeHtml(keyOf(cell))}"><span class="median">${fmt(cell.median)}</span><span class="range"> (${fmt(cell.min)}–${fmt(cell.max)})</span></td>`))
          .join("");
        lines.push(`<tr><th scope="row">${escapeHtml(LABELS[metric] ?? metric)}</th><td>${escapeHtml(String(n))}</td><td>${escapeHtml(unit)}</td>${tds}</tr>`);
      }
    }
    const head = BROWSERS.map((browser) => `<th scope="col">${escapeHtml(browser)} ${escapeHtml(data.browsers?.[browser] ?? "")}</th>`).join("");
    parts.push(`<h3>${escapeHtml(WORKLOAD[workload] ?? workload)}</h3>`);
    parts.push(wrap(`<table class="bench"><caption>Median of every repetition, with the range in brackets. Generated from site/benchmark/field/results.json.</caption><thead><tr><th scope="col">Metric</th><th scope="col">Items</th><th scope="col">Unit</th>${head}</tr></thead><tbody>${lines.join("")}</tbody></table>`));
  }
  const bytes = data.results.filter((row) => row.browser === null);
  const byteRows = bytes
    .map((row) => `<tr><th scope="row">${escapeHtml(WORKLOAD[row.workload] ?? row.workload ?? "—")}</th><td>${escapeHtml(LABELS[row.metric] ?? row.metric)}</td><td data-field="${escapeHtml(keyOf(row))}"><span class="median">${fmt(row.median)}</span> ${escapeHtml(row.unit)}</td></tr>`)
    .join("");
  parts.push(`<h3>Bytes</h3>`);
  parts.push(wrap(`<table class="bench"><caption>The JavaScript each page loaded for the library. Generated from site/benchmark/field/results.json.</caption><thead><tr><th scope="col">Page</th><th scope="col">Metric</th><th scope="col">Size</th></tr></thead><tbody>${byteRows}</tbody></table>`));
  return parts.join("\n");
}

export function fieldMethodHtml(docsDir) {
  const data = load(docsDir);
  if (data === null) return NOT_MEASURED;
  const s = data.settings;
  const caps = Object.entries(data.capabilities ?? {});
  const facts = [
    ["Measured", data.generatedAt],
    ["CPU", `${data.machine.cpu}, ${String(data.machine.cores)} cores, ${String(data.machine.memoryGB)} GB`],
    ["OS", data.machine.os],
    ["Browsers", Object.entries(data.browsers).map(([name, version]) => `${name} ${version}`).join(", ")],
    ["CPU slowdown", s.throttle === null ? "none, in every browser" : `${String(s.throttle)}×`],
    ["Viewport", `${String(s.viewport.width)} × ${String(s.viewport.height)} CSS pixels, device pixel ratio 1`],
    ["Repetitions", `${String(s.repetitions)} fresh pages per workload, size, scenario and browser`],
    ["Sizes", Object.entries(s.ns).map(([workload, ns]) => `${workload}: ${ns.join(" and ")}`).join("; ")],
    ["First render", s.readyDefinition],
    ["Pan", `${String(s.pan.strokes)} strokes of ${String(s.pan.distancePx)} px, ${String(s.pan.forward)} towards later time and back, each ${String(s.pan.durationMs)} ms with ${String(s.pan.gapMs)} ms between; ${s.pan.input}. How each chart pans: ${caps.map(([workload, cap]) => `${workload} ${cap.pan}`).join(", ")}.`],
    ["Zoom", `${String(s.zoom.notches)} notches in and ${String(s.zoom.notches)} out, ${String(s.zoom.intervalMs)} ms apart; ${s.zoom.input}.`],
    ["Missed frame", s.missedFrameDefinition],
    ["Heap", s.heap],
    ["Over the budget", `A pan or a zoom whose median misses more than ${String(FRAME_BUDGET.percent)}% of its frames.`],
    ["Run", `${String(s.runSeconds)} s, Temporeum ${String(data.libraries.temporeum.version)}`],
  ];
  const ignored = Object.entries(data.ignoredPageErrors?.counts ?? {});
  if (ignored.length > 0) facts.push(["Let through", `${ignored.map(([where, count]) => `${where}: ${String(count)}`).join(", ")} page errors matching ${data.ignoredPageErrors.pattern}`]);
  const rows = facts.map(([key, value]) => `<tr><th scope="row">${escapeHtml(key)}</th><td>${escapeHtml(String(value))}</td></tr>`).join("");
  return wrap(`<table class="bench-machine"><caption>Where and how it was measured. Generated from site/benchmark/field/results.json.</caption><tbody>${rows}</tbody></table>`);
}

const where = (entry) => `${WORKLOAD[entry.workload] ?? entry.workload}, ${String(entry.n)} items, ${entry.browser}`;

export function fieldBudgetHtml(docsDir) {
  const data = load(docsDir);
  if (data === null) return NOT_MEASURED;
  const over = overBudget(data);
  const measured = data.results.filter((row) => FRAME_BUDGET.metrics.includes(row.metric)).length;
  if (over.length === 0) return `<p data-over="0">None of the ${String(measured)} pans and zooms misses more than ${String(FRAME_BUDGET.percent)}% of its frames.</p>`;
  const items = over.map((entry) => `<li data-over-item="${escapeHtml(entry.key)}"><strong>${escapeHtml(LABELS[entry.metric] ?? entry.metric)}</strong> — ${escapeHtml(where(entry))}: ${fmt(entry.median)}%.</li>`).join("");
  return `<p data-over="${String(over.length)}">Of ${String(measured)} pans and zooms, ${String(over.length)} miss more than ${String(FRAME_BUDGET.percent)}% of their frames:</p>\n<ul class="bench-losses">${items}</ul>`;
}

/** The same blocks as plain text, for llms-full.txt. */
export function fieldMarkdown(block, docsDir) {
  const data = load(docsDir);
  if (data === null) return "(Not measured yet: site/benchmark/field/results.json has not been written.)";
  if (block === "field-budget") {
    const over = overBudget(data);
    return over.length === 0 ? `No pan or zoom misses more than ${String(FRAME_BUDGET.percent)}% of its frames.` : over.map((entry) => `- ${LABELS[entry.metric] ?? entry.metric} — ${where(entry)}: ${fmt(entry.median)}%.`).join("\n");
  }
  return `(The ${block} table is generated on the page from site/benchmark/field/results.json.)`;
}
