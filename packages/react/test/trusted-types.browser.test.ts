import { createElement } from "react";
import type { ReactElement } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterAll, expect, it, vi } from "vitest";

import type { Item } from "@temporeum/timeline-core";

import { Timeline } from "../src/index.js";
import type { TimelineInstance } from "../src/index.js";

/**
 * The adapter under Trusted Types (C4). The server's drawing reaches the
 * page as markup; on the client React compares nothing against it while
 * hydrating, and a client-only render writes no HTML at all — so neither
 * hands a string to `innerHTML`, which this page's policy would refuse.
 * The policy is this file's frame's alone: it cannot be taken back.
 */

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 5);
const items: Item[] = [
  { id: "a", start: T0 + DAY, end: T0 + 3 * DAY, label: "Alpha" },
  { id: "b", start: T0 + 4 * DAY, end: T0 + 6 * DAY, label: "Beta" },
];
const domain: [number, number] = [T0, T0 + 10 * DAY];
const roots: Root[] = [];

afterAll(() => {
  for (const root of roots) root.unmount();
});

function host(): HTMLElement {
  const element = document.createElement("div");
  element.style.width = "800px";
  document.body.append(element);
  return element;
}

it("hydrates the server's drawing, and renders on the client alone, without an HTML sink", async () => {
  const server = { current: null as TimelineInstance | null };
  const client = { current: null as TimelineInstance | null };
  const element = (ref: { current: TimelineInstance | null }, instanceId: string): ReactElement =>
    createElement(Timeline, { items, defaultDomain: domain, height: 200, ssrWidth: 800, instanceId, timelineRef: ref });
  const container = host();
  // The server's markup, before the policy: as a page would deliver it.
  container.innerHTML = renderToString(element(server, "served"));
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
  roots.push(hydrateRoot(container, element(server, "served"), { onRecoverableError: (error) => errors.push(error) }));
  roots.push(createRoot(host()));
  (roots[1] as Root).render(element(client, "client"));
  await vi.waitFor(() => expect(server.current?.result && client.current?.result).toBeDefined());
  expect(container.querySelector("svg")).toBe(svg);
  expect(document.querySelectorAll('[data-tl-id="a"]')).toHaveLength(2);
  window.removeEventListener("error", onError);
  expect(errors).toEqual([]);
  // The check above is the one HTML sink; it is reported in a task of its own.
  expect(violations.filter((each) => !each.endsWith("|<b>x</b>"))).toEqual([]);
});
