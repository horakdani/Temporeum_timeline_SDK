import { createTimeline } from "@temporeum/timeline-element";

const DAY = 86_400_000;
const start = Date.UTC(2026, 4, 4);
const items = ["Kick-off", "Interviews", "Prototype", "Usability test", "Iteration", "Report"].map((label, index) => ({
  id: `s${String(index)}`,
  label,
  start: start + index * 3 * DAY,
  end: start + (index * 3 + 4) * DAY,
}));

const readout = document.querySelector("#orientation");
const timeline = createTimeline(document.querySelector("#timeline"), {
  items,
  ariaLabel: "Research sprint",
  // Both follow the container, not the window: horizontal from 640 px, vertical below.
  orientation: "auto",
  density: "auto",
});

timeline.subscribe(() => {
  const { orientation, density } = timeline.getSnapshot();
  readout.dataset.orientation = orientation;
  readout.textContent = `${orientation}, ${density}`;
});

for (const button of document.querySelectorAll("[data-width]")) {
  button.addEventListener("click", () => {
    document.querySelector("#box").style.width = button.dataset.width;
  });
}
