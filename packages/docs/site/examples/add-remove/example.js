import { createTimeline, registerPlugin } from "@temporeum/timeline-element";
import { itemsPlugin } from "@temporeum/timeline-element/items";

// Adding, removing and dropping items are a plugin: registered once, before the first timeline.
registerPlugin(itemsPlugin);

const day = 86_400_000;
const start = Date.UTC(2026, 5, 1);
const log = document.querySelector("#log");

const timeline = createTimeline(document.querySelector("#timeline"), {
  ariaLabel: "Editable plan",
  domain: [start - day, start + 20 * day],
  lanes: [{ id: "me", label: "Me" }, { id: "team", label: "Team" }],
  items: [
    { id: "plan", start: start, end: start + 4 * day, laneId: "me", label: "Plan" },
    { id: "ship", start: start + 9 * day, end: start + 12 * day, laneId: "team", label: "Ship" },
  ],
  // The template is sanitised: tags outside the allow-list and every handler are dropped.
  template: (item) => `<strong>${item.label ?? ""}</strong>`,
  editing: {
    enabled: true,
    add: true,
    remove: true,
    drop: true,
    snapMs: day,
    canRemove: (item) => item.id !== "ship",
  },
});

// The library never saves: every add and remove is a command with an inverse.
timeline.on("command", ({ command }) => {
  log.textContent = `${command.type}: ${command.after.map((patch) => patch.id).join(", ")}`;
});

for (const source of document.querySelectorAll("[data-task]")) {
  source.addEventListener("dragstart", (event) => {
    event.dataTransfer.setData("application/x-temporeum-item", source.dataset.task);
  });
  // The keyboard twin of the drag: the focused lane, the middle of the view.
  source.addEventListener("keydown", (event) => {
    if (event.key === "Enter") timeline.dropItem(JSON.parse(source.dataset.task));
  });
}
