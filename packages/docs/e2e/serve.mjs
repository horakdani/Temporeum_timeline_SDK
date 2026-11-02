/**
 * A dokumentacios csomag statikus szervere — nulla fuggosegbol.
 *
 * Azert sajat, es nem egy kesz static-server csomag, mert a kampany
 * fuggoseg-politikaja a dev-fuggosegekre is all: ez huszon ket sor, egy
 * csomag pedig egy tovabbi tranzitiv fa a CI-ban. Ket dolgot szolgal ki:
 *
 *   /            -> packages/docs/public
 *   /core/...    -> packages/core/dist   (a SHIPPELT bundle, nem a forras)
 *   /element/... -> packages/web-component/dist (a G-PERF-PUBLIC ezt meri)
 *   /site/...    -> packages/docs/dist   (a felepitett dokumentacios oldal)
 *
 * A `/core/` szandekosan a dist-re nez: a bongeszoben az fut, amit publikalunk.
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
// A playwright.config.ts ugyanezt a kornyezeti valtozot adja; a 41737
// szandekosan nem a Vite preview alapertelmezese (4173).
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
  // Konyvtarbol kiszokes nincs: a feloldott utnak a negy gyoker alatt kell lennie.
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
    // Az oldal elo peldai sandboxolt (opaque origin) iframe-ben futnak, es
    // onnan importaljak a /site/lib bundle-oket: CORS nelkul nem toltenenek.
    "access-control-allow-origin": "*",
  });
  createReadStream(safe).pipe(response);
});

// A foglalt port NEM "majd jo lesz": ha mar ul rajta valami, az a valami
// nem mi vagyunk, es amit a bongeszo merne, az nem a mi lapunk. Hangosan
// elhasalunk, hogy a kapu kimenete megmondja, mi tortent.
server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(
      `A ${String(port)} port foglalt. Mas ul rajta — NEM indulok el, mert a ` +
        "bongeszos keszlet idegen lapot mérne. Nezd meg: lsof -nP -iTCP:" +
        String(port),
    );
    process.exit(1);
  }
  throw error;
});

server.listen(port);
