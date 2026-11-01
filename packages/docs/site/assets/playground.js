/**
 * The live examples: an editable source and a sandboxed frame that runs it.
 *
 * The frame is `sandbox="allow-scripts"` without `allow-same-origin`: the
 * code a reader types runs in an opaque origin and cannot reach this page.
 * It imports the library through an import map that points at the shipped
 * bundles in /lib — so the host serving the site has to allow cross-origin
 * reads of /lib (`Access-Control-Allow-Origin: *`), which GitHub Pages does.
 *
 * Each run gets a token. The frame reports back by `postMessage` — every
 * uncaught error, every rejected promise, every `console.error`, and "ran"
 * when its module has been evaluated — and a message with
 * an old token is ignored, so a slow error from the previous run cannot mark
 * the new one. The section's `data-state` (running, ok, error) and
 * `data-errors` are what the example suite reads.
 */

const root = new URL("../", import.meta.url);
const imports = JSON.parse(document.getElementById("import-map-data").textContent);
const importMap = { imports: Object.fromEntries(Object.entries(imports).map(([name, path]) => [name, new URL(path, root).href])) };

const FRAME_STYLE = [
  "html,body{margin:0;height:100%;background:#fff;color:#1b1f24;font:14px/1.5 system-ui,sans-serif}",
  "#timeline,temporeum-timeline{display:block;height:100%}",
  "button{font:inherit}",
  ".log{margin:0;padding:6px 10px;font:12px/1.4 ui-monospace,Menlo,monospace;border-top:1px solid #d5d9de;max-height:5.6em;overflow:auto}",
].join("");

/** `</script` inside the user's code would close the frame's script element early. */
const guard = (code) => code.replace(/<\/(script)/gi, "<\\/$1");

function srcdoc(example, code, token) {
  const report = `(${String((token) => {
    const send = (type, message) => parent.postMessage({ source: "tl-example", token, type, message: String(message) }, "*");
    addEventListener("error", (event) => send("error", event.error?.message ?? event.message ?? `failed to load ${event.target?.src ?? "a resource"}`), true);
    addEventListener("unhandledrejection", (event) => send("error", event.reason?.message ?? event.reason));
    const original = console.error;
    console.error = (...args) => {
      send("error", args.join(" "));
      original.apply(console, args);
    };
    // Not requestAnimationFrame: a cross-origin frame outside the viewport
    // gets none, and "ran" would never come for an example below the fold.
    window.__ran = () => setTimeout(() => send("ran", ""), 50);
  })})(${JSON.stringify(token)});`;
  return [
    "<!doctype html>",
    '<html lang="en"><head><meta charset="utf-8">',
    `<title>${example.title.replace(/</g, "&lt;")}</title>`,
    `<script type="importmap">${JSON.stringify(importMap)}</script>`,
    `<script>${report}</script>`,
    `<style>${FRAME_STYLE}</style>`,
    "</head><body>",
    example.html,
    `<script type="module">${guard(code)}\n</script>`,
    "<script type=\"module\">window.__ran();</script>",
    "</body></html>",
  ].join("\n");
}

let counter = 0;
const live = new Map();

addEventListener("message", (event) => {
  const data = event.data;
  if (data === null || typeof data !== "object" || data.source !== "tl-example") return;
  const section = live.get(data.token);
  if (section === undefined) return;
  const status = section.querySelector(".example-status");
  if (data.type === "error") {
    const errors = Number(section.dataset.errors ?? "0") + 1;
    section.dataset.errors = String(errors);
    section.dataset.state = "error";
    status.textContent = `Error: ${data.message}`;
  } else if (data.type === "ran" && section.dataset.state !== "error") {
    section.dataset.state = "ok";
    status.textContent = "Ran without errors.";
  }
});

function run(section, example, code) {
  for (const [token, owner] of live) if (owner === section) live.delete(token);
  counter += 1;
  const token = `${example.id}:${String(counter)}`;
  live.set(token, section);
  section.dataset.state = "running";
  section.dataset.errors = "0";
  // Per section: a page with two examples counts each one's runs on its own.
  section.dataset.run = String(Number(section.dataset.run ?? "0") + 1);
  section.querySelector(".example-status").textContent = "Running…";
  section.querySelector("iframe").srcdoc = srcdoc(example, code, token);
}

for (const section of document.querySelectorAll("section.example")) {
  const example = JSON.parse(section.querySelector(".example-data").textContent);
  const textarea = section.querySelector("textarea");
  const original = textarea.value;
  section.querySelector('[data-action="run"]').addEventListener("click", () => run(section, example, textarea.value));
  section.querySelector('[data-action="reset"]').addEventListener("click", () => {
    textarea.value = original;
    run(section, example, original);
  });
  textarea.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      run(section, example, textarea.value);
    }
  });
  run(section, example, original);
}
