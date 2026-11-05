import { flushSync, hydrate, mount, unmount } from "svelte";
import { VERSION } from "svelte/compiler";
import { afterAll, expect, it, vi } from "vitest";
import { commands } from "vitest/browser";

import type { Item } from "@temporeum/timeline-core";

import { Timeline } from "../src/index.js";
import type { TimelineInstance } from "../src/index.js";
import { reactiveProps } from "./props.svelte.js";

/**
 * The component under Trusted Types. The server's drawing reaches the
 * page through `{@html}`, as markup; on the client Svelte takes the
 * server's nodes for it while hydrating, and a client-only mount writes no
 * HTML at all — so neither hands a string to `innerHTML`, which this page's
 * policy would refuse. The policy is this file's frame's alone.
 */

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 5);
const items: Item[] = [
  { id: "a", start: T0 + DAY, end: T0 + 3 * DAY, label: "Alpha" },
  { id: "b", start: T0 + 4 * DAY, end: T0 + 6 * DAY, label: "Beta" },
];
const domain: [number, number] = [T0, T0 + 10 * DAY];
const mounted: Record<string, unknown>[] = [];

afterAll(async () => {
  for (const each of mounted) await unmount(each);
});

function host(): HTMLElement {
  const element = document.createElement("div");
  element.style.width = "800px";
  document.body.append(element);
  return element;
}

/**
 * Svelte's own runtime builds its templates through Trusted Types since 5.51
 * (TrustedHTML in `{@html}` since 5.52, `<select>` since 5.53, its changelog
 * says): below that the framework itself writes a string into innerHTML,
 * which no component can prevent. The lowest-peers job runs the rest of the
 * suite there; this runs from 5.53.
 */
const svelteTrustsTypes = ((major, minor) => major > 5 || (major === 5 && minor >= 53))(...VERSION.split(".").map(Number) as [number, number]);

it.runIf(svelteTrustsTypes)("hydrates the server's drawing, and mounts on the client alone, without an HTML sink", async () => {
  const base = { items, defaultDomain: domain, height: 200, ssrWidth: 800 };
  const container = host();
  // The server's markup, before the policy: as a page would deliver it.
  container.innerHTML = await commands.ssr({ ...base, instanceId: "served" });
  const violations: string[] = [];
  document.addEventListener("securitypolicyviolation", (event) => violations.push(`${event.violatedDirective}: ${event.sample}`));
  const meta = document.createElement("meta");
  meta.httpEquiv = "Content-Security-Policy";
  meta.content = "require-trusted-types-for 'script'";
  document.head.append(meta);
  expect(() => {
    document.createElement("div").innerHTML = "<b>x</b>";
  }).toThrow(/TrustedHTML/);
  const errors: unknown[] = [];
  const onError = (event: ErrorEvent): void => {
    errors.push(event.error);
  };
  window.addEventListener("error", onError);
  const svg = container.querySelector("svg");
  const served = reactiveProps<Record<string, unknown>>({ ...base, instanceId: "served", timeline: null });
  mounted.push(hydrate(Timeline, { target: container, props: served }));
  const client = reactiveProps<Record<string, unknown>>({ ...base, instanceId: "client", timeline: null });
  mounted.push(mount(Timeline, { target: host(), props: client }));
  flushSync();
  await vi.waitFor(() => expect((served.timeline as TimelineInstance | null)?.result && (client.timeline as TimelineInstance | null)?.result).toBeDefined());
  expect(container.querySelector("svg")).toBe(svg);
  expect(document.querySelectorAll('[data-tl-id="a"]')).toHaveLength(2);
  window.removeEventListener("error", onError);
  expect(errors).toEqual([]);
  // The check above is the one HTML sink; it is reported in a task of its own.
  expect(violations.filter((each) => !each.endsWith("|<b>x</b>"))).toEqual([]);
});

it.runIf(svelteTrustsTypes)("a client mount with the instanceId of a drawing on the page does not take it for its own (R80)", async () => {
  // The policy of the test above is still in force in this frame. A
  // page-wide look-up for the instance scope said \"hydrating\" to a client
  // mount whose instanceId a served drawing already carries, and handed
  // {@html} a string, which the policy refuses.
  expect(() => {
    document.createElement("div").innerHTML = "<b>x</b>";
  }).toThrow(/TrustedHTML/);
  expect(document.querySelector('svg[data-tl-instance="served"]')).not.toBeNull();
  const errors: unknown[] = [];
  const onError = (event: ErrorEvent): void => {
    errors.push(event.error);
  };
  window.addEventListener("error", onError);
  const target = host();
  const twin = reactiveProps<Record<string, unknown>>({ items, defaultDomain: domain, height: 200, instanceId: "served", timeline: null });
  let thrown: unknown;
  try {
    mounted.push(mount(Timeline, { target, props: twin }));
    flushSync();
  } catch (error: unknown) {
    thrown = error;
  }
  expect(thrown).toBeUndefined();
  await vi.waitFor(() => expect((twin.timeline as TimelineInstance | null)?.result).toBeDefined());
  expect(target.querySelectorAll("svg")).toHaveLength(1);
  window.removeEventListener("error", onError);
  expect(errors).toEqual([]);
});
