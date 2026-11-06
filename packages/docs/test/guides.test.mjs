import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// What the guides say against what the code does, where a sentence once said
// otherwise and only reading it again caught it.
const guide = (name) => readFileSync(new URL(`../site/pages/guides/${name}.md`, import.meta.url), "utf8");

test("the scheduling guide writes an end the scheduler reads, not a string it throws on (Y27)", () => {
  // `TimeInput` is epoch milliseconds or a Date: `end: "2026-03-03"` threw "Invalid time value".
  const text = guide("scheduling");
  assert.doesNotMatch(text, /\b(?:start|end): "\d{4}-\d{2}-\d{2}/);
  assert.match(text, /end: new Date\("2026-03-03"\)/);
});

test("the editing guide says the snap grid is on the zone's wall clock, not a multiple of the step (Y28)", () => {
  // Since X17 a sub-day grid is anchored at the zone's offset, a day grid on its midnights.
  const text = guide("editing");
  assert.doesNotMatch(text, /a multiple of the step/);
  assert.match(text, /`snapMs` snaps starts and ends to the step on the wall clock of `timeZone`/);
});

test("a wrapper README that shows an item's content says that it needs the items plugin (Y15)", () => {
  // The Vue README used the #item slot without the registration: copied on its own, it threw on mount.
  for (const name of ["react", "vue", "svelte", "angular"]) {
    const text = readFileSync(new URL(`../../${name}/README.md`, import.meta.url), "utf8");
    if (/#item\b|snippet item|renderItem|tlItem/.test(text)) assert.match(text, /itemsPlugin|`\/items` plugin/, `${name}/README.md`);
  }
});

test("the CSP guide says what the server's inline style attributes do under a strict policy (Y14)", () => {
  // Every attribute is a violation and a report until the client takes over; the guide only said they apply then.
  const text = guide("content-security-policy");
  assert.match(text, /one report per attribute on every page view/);
  assert.match(text, /style-src-attr 'unsafe-inline'/);
  assert.match(text, /default 300 px tall/);
});
