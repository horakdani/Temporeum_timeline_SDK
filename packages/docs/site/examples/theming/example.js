import { createTimeline } from "@temporeum/timeline-element";

const DAY = 86_400_000;
const t = Date.UTC(2026, 5, 1);
const timeline = createTimeline(document.querySelector("#timeline"), {
  items: [
    { id: "a", label: "Draft", start: t, end: t + 5 * DAY },
    { id: "b", label: "Legal review", start: t + 4 * DAY, end: t + 9 * DAY, className: "urgent" },
    { id: "c", label: "Translate", start: t + 6 * DAY, end: t + 12 * DAY },
    { id: "d", label: "Publish", start: t + 13 * DAY },
  ],
  ariaLabel: "Publishing",
  theme: "light",
});

// A theme is a setting, not a second render: the same nodes read other tokens.
let dark = false;
document.querySelector("#theme").addEventListener("click", (event) => {
  dark = !dark;
  timeline.update({ theme: dark ? "dark" : "light" });
  event.currentTarget.textContent = dark ? "Switch to light" : "Switch to dark";
});
