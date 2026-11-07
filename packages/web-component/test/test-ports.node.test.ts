import { existsSync, readdirSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * The fixed ports of the test and benchmark servers sit below the operating
 * systems' ephemeral ranges (W2). Linux hands out 32768–60999 to outgoing
 * connections, macOS 49152–65535; a fixed port inside that range is sometimes
 * already taken by a connection the runner opened, and the suite's server does
 * not start (it happened once on GitHub CI, with 41738). Below 32768 the
 * operating system never picks the port itself.
 */

const EPHEMERAL_FLOOR = 32768;
const root = new URL("../../../", import.meta.url);

/** Every fixed port number a source names: a default, an env setting or a table entry. */
function fixedPorts(source: string): number[] {
  const patterns = [
    /PORT\w*\s*\?\?\s*(\d{4,5})\b/g, // Number(process.env.TL_X_PORT ?? 31737)
    /PORT\w*\s*=\s*(\d{4,5})\b/g, // const PAGE_PORT = 31739; TL_PAGES_PORT=31769 in a script line
    /PORT\w*["']?\s*:\s*["'](\d{4,5})["']/g, // env: { TL_PAGES_PORT: "31767" }
    /\bport:\s*(\d{4,5})\b/g, // { port: 31761 }
  ];
  const found = new Set<number>();
  for (const pattern of patterns) for (const match of source.matchAll(pattern)) found.add(Number(match[1]));
  return [...found];
}

function sources(): Array<{ path: string; text: string }> {
  const out: Array<{ path: string; text: string }> = [];
  const add = (dir: string, keep: (name: string) => boolean): void => {
    const url = new URL(dir, root);
    if (!existsSync(url)) return;
    for (const name of readdirSync(url)) if (keep(name)) out.push({ path: dir + name, text: readFileSync(new URL(name, url), "utf8") });
  };
  add("packages/docs/", (name) => /^playwright.*\.config\.ts$/.test(name) || name === "package.json");
  add("packages/docs/e2e/", (name) => name.endsWith(".mjs"));
  add("scripts/", (name) => /^sdk_.*\.mjs$/.test(name));
  return out;
}

describe("the fixed test ports (W2)", () => {
  it("are all below the ephemeral ranges, so the operating system never hands one out first", () => {
    const all = sources().flatMap(({ path, text }) => fixedPorts(text).map((port) => ({ path, port })));
    // Not vacuous: the docs suites and the benchmark scripts name well over a dozen.
    expect(all.length).toBeGreaterThan(12);
    const inside = all.filter(({ port }) => port >= EPHEMERAL_FLOOR || port < 1024);
    expect(inside).toEqual([]);
  });

  it("are found by the scan in every form they are written (negative control)", () => {
    const sample = [
      "const PORT = Number(process.env.TL_E2E_PORT ?? 41737);",
      "const PAGE_PORT = 41739;",
      'env: { TL_PAGES_PORT: "41767" },',
      '"test:e2e:print": "TL_PAGES_PORT=41769 playwright test"',
      "next: { deps: {}, port: 41761 },",
    ].join("\n");
    expect(fixedPorts(sample).sort()).toEqual([41737, 41739, 41761, 41767, 41769]);
  });
});
