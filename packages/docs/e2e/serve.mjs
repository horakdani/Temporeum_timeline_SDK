/**
 * The docs package's static server — with zero dependencies.
 *
 * Our own, and not a ready-made static-server package, because the
 * project's dependency policy applies to dev dependencies too: this is a few
 * dozen lines, and a package is one more transitive tree in CI. It serves:
 *
 *   /            -> packages/docs/public
 *   /core/...    -> packages/core/dist   (the SHIPPED bundle, not the source)
 *   /element/... -> packages/web-component/dist (the perf-public check measures this)
 *   /site/...    -> packages/docs/dist   (the built docs site)
 *
 * `/core/` points at dist on purpose: what runs in the browser is what we publish.
 */

import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = resolve(here, "..", "public");
const coreDist = resolve(here, "..", "..", "core", "dist");
const elementDist = resolve(here, "..", "..", "web-component", "dist");
const siteDist = resolve(here, "..", "dist");
// playwright.config.ts passes the same environment variable; 41737 is
// deliberately not Vite preview's default (4173).
const port = Number(process.env.TL_E2E_PORT ?? process.env.PORT ?? 41737);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".cjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", `http://localhost:${String(port)}`);
  let path = url.pathname === "/" ? "/index.html" : url.pathname;
  if (path === "/site" || path.endsWith("/site/") || (path.startsWith("/site/") && path.endsWith("/"))) path = `${path.replace(/\/?$/, "/")}index.html`;
  const target = path.startsWith("/core/")
    ? join(coreDist, path.slice("/core/".length))
    : path.startsWith("/element/")
      ? join(elementDist, path.slice("/element/".length))
      : path.startsWith("/site/")
      ? join(siteDist, path.slice("/site/".length))
      : join(publicDir, path);
  // No escaping the directories: the resolved path has to be under one of the four roots.
  const safe = resolve(target);
  if (!safe.startsWith(publicDir) && !safe.startsWith(coreDist) && !safe.startsWith(elementDist) && !safe.startsWith(siteDist)) {
    response.writeHead(403).end("forbidden");
    return;
  }
  if (!existsSync(safe) || !statSync(safe).isFile()) {
    response.writeHead(404).end(`not found: ${path}`);
    return;
  }
  response.writeHead(200, {
    "content-type": TYPES[extname(safe)] ?? "application/octet-stream",
    "cache-control": "no-store",
    // The site's live examples run in sandboxed (opaque-origin) iframes, and
    // import the /site/lib bundles from there: without CORS they would not load.
    "access-control-allow-origin": "*",
  });
  createReadStream(safe).pipe(response);
});

// A taken port is NOT "it'll be fine": if something already sits on it, that
// something is not us, and what the browser would measure is not our page.
// We fail loudly, so the check's output says what happened.
server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(
      `Port ${String(port)} is taken. Something else is on it — NOT starting, because the ` +
        "browser suite would measure a foreign page. Check: lsof -nP -iTCP:" +
        String(port),
    );
    process.exit(1);
  }
  throw error;
});

server.listen(port);
