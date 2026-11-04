import { flushSync, hydrate, mount, unmount } from "svelte";
import { afterAll, expect, it, vi } from "vitest";
import { commands } from "vitest/browser";

import type { Item } from "@temporeum/timeline-core";

import { Timeline } from "../src/index.js";
import type { TimelineInstance } from "../src/index.js";
import { reactiveProps } from "./props.svelte.js";

/**
 * The component under Trusted Types (C4). The server's drawing reaches the
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

afterAll(() => {
  for (const each of mounted) unmount(each);
});

function host(): HTMLElement {
  const element = document.createElement("div");
  element.style.width = "800px";
  document.body.append(element);
  return element;
}

it("hydrates the server's drawing, and mounts on the client alone, without an HTML sink", async () => {
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
