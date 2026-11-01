/**
 * The field benchmark's page blocks (P28): every number on benchmark-field.md
 * comes from site/benchmark/field/results.json, written by
 * scripts/sdk_bench_rivals.mjs, and so does the list of where Temporeum loses.
 *
 *   {{bench:field}}         the results, one table per workload and browser, and the bytes
 *   {{bench:field-method}}  how and where it was measured, from the file's settings
 *   {{bench:field-losses}}  every comparison a rival wins by more than the noise
 *   {{bench:field-tradeoff}} the trade-off on the largest workload: the bytes, and what
 *                           they buy — first render, elements, missed frames in a pan (P32)
 *
 * `scripts/sdk_check_bench_field.mjs` recomputes the list with its own code
 * and reads every cell back from the built page; `scripts/sdk_check_bench_tradeoff.mjs`
 * does the same for the trade-off.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Lower is better for every compared metric. A rival wins when it is better by more than both bars. */
export const LOSS_RULE = {
  relative: 0.1,
  absolute: { ms: 10, "%": 1, MB: 0.5, elements: 0, kB: 1 },
  metrics: ["first-render", "dom-elements-after-load", "pan-missed-frames", "pan-p95-frame", "zoom-missed-frames", "zoom-p95-frame", "heap-after-load", "heap-after-pan", "js-min-gz"],
};
export const FRAME_MS_BAR = 2;

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
const nameOf = (data, library) => `${data.libraries?.[library]?.name ?? library} ${data.libraries?.[library]?.version ?? ""}`.trim();

function load(docsDir) {
  const path = fieldPath(docsDir);
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
}

const NOT_MEASURED = `<p class="bench-pending"><strong>Not measured yet.</strong> This page is generated from site/benchmark/field/results.json, which <code>npm run bench:field -w @temporeum/timeline-docs</code> writes; until it has run, there are no numbers to show, and none are written by hand.</p>`;

/** Where a rival is better than Temporeum by more than the noise: one entry per comparison. */
export function fieldLosses(data) {
  const losses = [];
  const ours = new Map(data.results.filter((row) => row.library === "temporeum").map((row) => [keyOf(row), row]));
  for (const row of data.results) {
    if (row.library === "temporeum" || row.library === "react (baseline)" || !LOSS_RULE.metrics.includes(row.metric)) continue;
    const mine = ours.get(keyOf({ ...row, library: "temporeum" }));
    if (mine === undefined) continue;
    const bar = row.metric.endsWith("-p95-frame") ? FRAME_MS_BAR : (LOSS_RULE.absolute[row.unit] ?? 0);
    const margin = mine.median - row.median;
    if (margin > bar && margin > LOSS_RULE.relative * mine.median) {
      losses.push({ key: keyOf(row), library: row.library, workload: row.workload, browser: row.browser, n: row.n, metric: row.metric, unit: row.unit, theirs: row.median, ours: mine.median });
    }
  }
  return losses.sort((a, b) => a.key.localeCompare(b.key));
}

export function fieldTablesHtml(docsDir) {
  const data = load(docsDir);
  if (data === null) return NOT_MEASURED;
  const parts = [];
  for (const [workload, libraries] of Object.entries(data.workloads)) {
    for (const browser of BROWSERS) {
      const rows = data.results.filter((row) => row.workload === workload && row.browser === browser);
      if (rows.length === 0) continue;
      const lines = [];
      for (const n of data.settings.ns[workload]) {
        for (const metric of ORDER) {
          const cells = libraries.map((library) => rows.find((row) => row.library === library && row.n === n && row.metric === metric));
          if (cells.every((cell) => cell === undefined)) continue;
          const unit = cells.find(Boolean).unit;
          const tds = cells
            .map((cell) => (cell === undefined ? `<td>—</td>` : `<td data-field="${escapeHtml(keyOf(cell))}"><span class="median">${fmt(cell.median)}</span><span class="range"> (${fmt(cell.min)}–${fmt(cell.max)})</span></td>`))
            .join("");
          lines.push(`<tr><th scope="row">${escapeHtml(LABELS[metric] ?? metric)}</th><td>${escapeHtml(String(n))}</td><td>${escapeHtml(unit)}</td>${tds}</tr>`);
        }
      }
      const head = libraries.map((library) => `<th scope="col">${escapeHtml(nameOf(data, library))}</th>`).join("");
      parts.push(`<h3>${escapeHtml(workload === "timeline" ? "Timeline" : "Gantt")} — ${escapeHtml(browser)} ${escapeHtml(data.browsers?.[browser] ?? "")}</h3>`);
      parts.push(wrap(`<table class="bench"><caption>Median of every repetition, with the range in brackets. Generated from site/benchmark/field/results.json.</caption><thead><tr><th scope="col">Metric</th><th scope="col">Items</th><th scope="col">Unit</th>${head}</tr></thead><tbody>${lines.join("")}</tbody></table>`));
    }
  }
  const bytes = data.results.filter((row) => row.browser === null);
  const byteRows = bytes
    .map((row) => `<tr><th scope="row">${escapeHtml(nameOf(data, row.library))}</th><td>${escapeHtml(row.workload ?? "—")}</td><td>${escapeHtml(LABELS[row.metric] ?? row.metric)}</td><td data-field="${escapeHtml(keyOf(row))}"><span class="median">${fmt(row.median)}</span> ${escapeHtml(row.unit)}</td></tr>`)
    .join("");
  parts.push(`<h3>Bytes</h3>`);
  parts.push(wrap(`<table class="bench"><caption>The JavaScript each page loaded for its library; the React libraries' bundles include React, whose own share is the baseline row. Generated from site/benchmark/field/results.json.</caption><thead><tr><th scope="col">Library</th><th scope="col">Workload</th><th scope="col">Metric</th><th scope="col">Size</th></tr></thead><tbody>${byteRows}</tbody></table>`));
  return parts.join("\n");
}

export function fieldMethodHtml(docsDir) {
  const data = load(docsDir);
  if (data === null) return NOT_MEASURED;
  const s = data.settings;
  const facts = [
    ["Measured", data.generatedAt],
    ["CPU", `${data.machine.cpu}, ${String(data.machine.cores)} cores, ${String(data.machine.memoryGB)} GB`],
    ["OS", data.machine.os],
    ["Browsers", Object.entries(data.browsers).map(([name, version]) => `${name} ${version}`).join(", ")],
    ["CPU slowdown", s.throttle === null ? "none, in every browser" : `${String(s.throttle)}×`],
    ["Viewport", `${String(s.viewport.width)} × ${String(s.viewport.height)} CSS pixels, device pixel ratio 1`],
    ["Repetitions", `${String(s.repetitions)} fresh pages per library, size, scenario and browser`],
    ["Sizes", Object.entries(s.ns).map(([workload, ns]) => `${workload}: ${ns.join(" and ")}`).join("; ")],
    ["First render", s.readyDefinition],
    ["Pan", `${String(s.pan.strokes)} strokes of ${String(s.pan.distancePx)} px, ${String(s.pan.forward)} towards later time and back, each ${String(s.pan.durationMs)} ms with ${String(s.pan.gapMs)} ms between; ${s.pan.input}. How each library pans: ${Object.entries(data.capabilities).map(([library, caps]) => `${library} ${caps.pan}`).join(", ")}.`],
    ["Zoom", `${String(s.zoom.notches)} notches in and ${String(s.zoom.notches)} out, ${String(s.zoom.intervalMs)} ms apart; ${s.zoom.input}. Without wheel zoom: ${Object.entries(data.capabilities).filter(([, caps]) => caps.wheelZoom === false).map(([library]) => library).join(", ") || "none"}.`],
    ["Missed frame", s.missedFrameDefinition],
    ["Heap", s.heap],
    ["Where it loses", `A rival wins a comparison when its median is lower than Temporeum's by more than ${String(LOSS_RULE.relative * 100)}% and by more than ${Object.entries(LOSS_RULE.absolute).map(([unit, bar]) => `${String(bar)} ${unit}`).join(", ")} (${String(FRAME_MS_BAR)} ms for a frame time).`],
    ["Run", `${String(s.runSeconds)} s, commit ${String(data.libraries.temporeum.commit)}`],
  ];
  const ignored = Object.entries(data.ignoredPageErrors?.counts ?? {});
  if (ignored.length > 0) facts.push(["Let through", `${ignored.map(([where, count]) => `${where}: ${String(count)}`).join(", ")} page errors matching ${data.ignoredPageErrors.pattern}`]);
  const rows = facts.map(([key, value]) => `<tr><th scope="row">${escapeHtml(key)}</th><td>${escapeHtml(String(value))}</td></tr>`).join("");
  return wrap(`<table class="bench-machine"><caption>Where and how it was measured. Generated from site/benchmark/field/results.json.</caption><tbody>${rows}</tbody></table>`);
}

export function fieldLossesHtml(docsDir) {
  const data = load(docsDir);
  if (data === null) return NOT_MEASURED;
  const losses = fieldLosses(data);
  const compared = data.results.filter((row) => row.library !== "temporeum" && row.library !== "react (baseline)" && LOSS_RULE.metrics.includes(row.metric)).length;
  if (losses.length === 0) return `<p data-losses="0">In ${String(compared)} comparisons no rival wins by more than the noise.</p>`;
  const items = losses
    .map((loss) => {
      const where = loss.browser === null ? `${loss.workload}` : `${loss.workload}, ${String(loss.n)} items, ${loss.browser}`;
      return `<li data-loss="${escapeHtml(loss.key)}"><strong>${escapeHtml(LABELS[loss.metric] ?? loss.metric)}</strong> — ${escapeHtml(where)}: ${escapeHtml(nameOf(data, loss.library))} ${fmt(loss.theirs)} ${escapeHtml(loss.unit)}, Temporeum ${fmt(loss.ours)} ${escapeHtml(loss.unit)}.</li>`;
    })
    .join("");
  return `<p data-losses="${String(losses.length)}">Of ${String(compared)} comparisons, a rival wins ${String(losses.length)}:</p>\n<ul class="bench-losses">${items}</ul>`;
}

/** The trade-off's metrics, in the order the page shows them; the bytes have no browser. */
export const TRADEOFF_METRICS = ["js-min-gz", "first-render", "dom-elements-after-load", "pan-missed-frames"];
const TRADEOFF_WORDS = {
  "js-min-gz": { lower: "loads less JavaScript", higher: "loads more JavaScript", same: "loads about as much JavaScript" },
  "first-render": { lower: "draws first sooner", higher: "draws first later", same: "draws first about as soon" },
  "dom-elements-after-load": { lower: "keeps fewer elements on the page", higher: "keeps more elements on the page", same: "keeps about as many elements on the page" },
  "pan-missed-frames": { lower: "misses fewer frames in a pan", higher: "misses more frames in a pan", same: "misses about as many frames in a pan" },
};

/** Temporeum's median against a rival's, with the noise rule of the losses list: "lower", "higher" or "same". */
export function tradeoffVerdict(ours, theirs, unit) {
  const bar = LOSS_RULE.absolute[unit] ?? 0;
  const margin = Math.abs(ours - theirs);
  if (margin > bar && margin > LOSS_RULE.relative * Math.max(ours, theirs)) return ours < theirs ? "lower" : "higher";
  return "same";
}

/** The rows of the trade-off: per workload, its largest size, every browser. */
export function tradeoffRows(data) {
  const out = [];
  for (const [workload, libraries] of Object.entries(data.workloads)) {
    const n = Math.max(...data.settings.ns[workload]);
    for (const metric of TRADEOFF_METRICS) {
      for (const browser of metric === "js-min-gz" ? [null] : BROWSERS) {
        const cells = libraries.map((library) => data.results.find((row) => row.library === library && row.workload === workload && row.browser === browser && row.metric === metric && (browser === null || row.n === n)));
        if (cells.some((cell) => cell === undefined)) continue;
        out.push({ workload, n, metric, browser, cells });
      }
    }
  }
  return out;
}

export function fieldTradeoffHtml(docsDir) {
  const data = load(docsDir);
  if (data === null) return NOT_MEASURED;
  const num = (row) => `<span data-tradeoff="${escapeHtml(keyOf(row))}">${fmt(row.median)}</span>`;
  const rows = tradeoffRows(data);
  const parts = [];
  for (const [workload, libraries] of Object.entries(data.workloads)) {
    const mine = rows.filter((row) => row.workload === workload);
    if (mine.length === 0) continue;
    const n = mine[0].n;
    const noun = workload === "timeline" ? "items" : "tasks";
    parts.push(`<h3>${workload === "timeline" ? "Timeline" : "Gantt"}, <span data-tradeoff-n="${escapeHtml(workload)}">${escapeHtml(String(n))}</span> ${noun}</h3>`);
    // The sentences: Chromium, the first browser; the table has all three.
    const sentences = libraries.slice(1).map((library) => {
      const index = libraries.indexOf(library);
      const clauses = TRADEOFF_METRICS.map((metric) => {
        const row = mine.find((each) => each.metric === metric && (each.browser === null || each.browser === BROWSERS[0]));
        if (row === undefined) return null;
        const ours = row.cells[0];
        const theirs = row.cells[index];
        const verdict = tradeoffVerdict(ours.median, theirs.median, ours.unit);
        return `<span data-claim="${escapeHtml(`${keyOf(theirs)}|${verdict}`)}">${TRADEOFF_WORDS[metric][verdict]}</span> (${num(ours)} against ${num(theirs)} ${escapeHtml(ours.unit)})`;
      }).filter(Boolean);
      if (clauses.length === 0) return "";
      const [bytes, ...rest] = clauses;
      const tail = rest.length === 0 ? "" : `; in Chromium, it ${rest.length === 1 ? rest[0] : `${rest.slice(0, -1).join(", ")} and ${rest[rest.length - 1]}`}`;
      return `<li>Against <strong>${escapeHtml(nameOf(data, library))}</strong>, Temporeum ${bytes}${tail}.</li>`;
    });
    parts.push(`<ul class="bench-tradeoff">${sentences.join("")}</ul>`);
    const head = libraries.map((library) => `<th scope="col">${escapeHtml(nameOf(data, library))}</th>`).join("");
    const body = mine
      .map((row) => `<tr><th scope="row">${escapeHtml(LABELS[row.metric] ?? row.metric)}</th><td>${escapeHtml(row.browser ?? "—")}</td><td>${escapeHtml(row.cells[0].unit)}</td>${row.cells.map((cell) => `<td>${num(cell)}</td>`).join("")}</tr>`)
      .join("");
    parts.push(wrap(`<table class="bench"><caption>Medians, on the largest ${escapeHtml(workload)} workload. Generated from site/benchmark/field/results.json.</caption><thead><tr><th scope="col">Metric</th><th scope="col">Browser</th><th scope="col">Unit</th>${head}</tr></thead><tbody>${body}</tbody></table>`));
  }
  return `<div class="bench-tradeoff-block">${parts.join("\n")}</div>`;
}

/** The same blocks as plain text, for llms-full.txt. */
export function fieldMarkdown(block, docsDir) {
  const data = load(docsDir);
  if (data === null) return "(Not measured yet: site/benchmark/field/results.json has not been written.)";
  if (block === "field-losses") {
    const losses = fieldLosses(data);
    return losses.length === 0 ? "No rival wins by more than the noise." : losses.map((loss) => `- ${LABELS[loss.metric] ?? loss.metric} — ${loss.workload}${loss.browser === null ? "" : `, ${String(loss.n)} items, ${loss.browser}`}: ${nameOf(data, loss.library)} ${fmt(loss.theirs)} ${loss.unit}, Temporeum ${fmt(loss.ours)} ${loss.unit}.`).join("\n");
  }
  if (block === "field-tradeoff") {
    return tradeoffRows(data)
      .map((row) => `- ${LABELS[row.metric] ?? row.metric} — ${row.workload}${row.browser === null ? "" : `, ${String(row.n)} items, ${row.browser}`}: ${row.cells.map((cell) => `${nameOf(data, cell.library)} ${fmt(cell.median)} ${cell.unit}`).join(", ")}.`)
      .join("\n");
  }
  return `(The ${block} table is generated on the page from site/benchmark/field/results.json.)`;
}
