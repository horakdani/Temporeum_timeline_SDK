import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

/**
 * The suite-report checks read vitest's JSON report, and their package
 * scripts drop vitest's exit code so the check always gets to judge. A test
 * file that throws on import has no tests to fail: only the file's own status
 * says it did not run (R69).
 */

interface Spec {
  readonly file: string;
  readonly label: string;
  readonly minTests: number;
  readonly claims: readonly string[];
}
const script = new URL("../../../scripts/sdk_suite_report.mjs", import.meta.url).href;
const load = async (): Promise<(spec: Spec) => string[]> => ((await import(/* @vite-ignore */ script)) as { checkReport: (spec: Spec) => string[] }).checkReport;

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function report(testResults: unknown[]): string {
  const dir = mkdtempSync(join(tmpdir(), "suite-report-"));
  dirs.push(dir);
  const file = join(dir, "report.json");
  writeFileSync(file, JSON.stringify({ testResults }));
  return file;
}

const green = { name: "a.test.ts", status: "passed", assertionResults: [{ fullName: "a [claim:x]", status: "passed" }] };

describe("the suite-report check (R69)", () => {
  it("fails a test file that did not load, even when every test that ran is green", async () => {
    const checkReport = await load();
    const broken = { name: "b.test.ts", status: "failed", message: "SyntaxError: Unexpected token\n    at b.test.ts:1", assertionResults: [] };
    const failures = checkReport({ file: report([green, broken]), label: "demo", minTests: 1, claims: ["x"] });
    expect(failures).toEqual(["demo test file failed outside its tests: b.test.ts — SyntaxError: Unexpected token"]);
  });

  it("passes a report whose files all loaded and whose tests are green", async () => {
    const checkReport = await load();
    expect(checkReport({ file: report([green]), label: "demo", minTests: 1, claims: ["x"] })).toEqual([]);
  });

  it("says a failed test once, not again for its file", async () => {
    const checkReport = await load();
    const red = { name: "c.test.ts", status: "failed", message: "", assertionResults: [{ fullName: "c", status: "failed" }] };
    expect(checkReport({ file: report([green, red]), label: "demo", minTests: 1, claims: ["x"] })).toEqual(["demo test not green: c (failed)"]);
  });
});
