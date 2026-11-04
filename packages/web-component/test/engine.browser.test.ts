import { expect, it } from "vitest";

/**
 * Which engine the browser suite runs in, read from the browser itself and
 * written into the test's name: scripts/sdk_test_browsers.mjs reads it back
 * from the report, so a run that was asked for Firefox and ran in Chromium
 * cannot pass for a Firefox run.
 */
const agent = navigator.userAgent;
const engine = /Firefox\//.test(agent) ? "firefox" : /Chrome\//.test(agent) ? "chromium" : /AppleWebKit\//.test(agent) ? "webkit" : "unknown";

it(`runs in ${engine}`, () => {
  expect(engine).not.toBe("unknown");
});
