import { renderTimelineHtml } from "@temporeum/timeline-element";

const DAY = 86_400_000;
const t = Date.UTC(2026, 8, 1);
const config = {
  items: [
    { id: "a", label: "Call for papers", start: t, end: t + 20 * DAY },
    { id: "b", label: "Review", start: t + 21 * DAY, end: t + 35 * DAY },
    { id: "c", label: "Programme", start: t + 38 * DAY },
  ],
  height: 280,
  ariaLabel: "Conference",
};

// On a server this string is the response; here it is written into the page
// the way a browser parses a response: with its declarative shadow root.
const html = renderTimelineHtml(config, { width: 960 });
const server = document.querySelector("#server");
server.setHTMLUnsafe(html);
const drawn = server.querySelector("temporeum-timeline").shadowRoot.querySelector("svg");

// Defining the element is what the client bundle does. It takes the server's
// nodes over instead of drawing a second timeline.
await import("@temporeum/timeline-element/define");
await customElements.whenDefined("temporeum-timeline");
requestAnimationFrame(() => {
  const now = server.querySelector("temporeum-timeline").shadowRoot.querySelector("svg");
  const result = document.querySelector("#result");
  result.dataset.sameSvg = String(now === drawn);
  result.textContent = now === drawn ? "Hydrated: the element kept the server's <svg>." : "The element drew a new <svg>.";
});
