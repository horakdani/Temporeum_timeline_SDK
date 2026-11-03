import { createTimeline, registerPlugin } from "@temporeum/timeline-element";
import { itemsPlugin } from "@temporeum/timeline-element/items";

registerPlugin(itemsPlugin);

const DAY = 86_400_000;
const t = Date.UTC(2026, 5, 1);
const items = [
  { id: "a", label: "Research", start: t, end: t + 6 * DAY, data: { done: 1 } },
  { id: "b", label: "Prototype", start: t + 4 * DAY, end: t + 12 * DAY, data: { done: 0.7 } },
  { id: "c", label: "User tests", start: t + 10 * DAY, end: t + 16 * DAY, data: { done: 0.3 } },
  { id: "d", label: "Polish", start: t + 15 * DAY, end: t + 22 * DAY, data: { done: 0 } },
  { id: "e", label: "Release", start: t + 22 * DAY, end: t + 25 * DAY, data: { done: 0 } },
];

// What a framework does with `renderItem` or an `#item` slot, by hand: every
// drawn item gets a host of its own in the box over it, and the instance
// says when the items drawn are others. A host stays the same element for
// as long as its item is drawn, so what is rendered into it is kept.
function render(slots) {
  for (const { element, item } of slots.values()) {
    if (element.firstChild !== null && element.dataset.done === String(item.data.done)) continue;
    element.dataset.done = String(item.data.done);
    const card = document.createElement("span");
    card.className = "card";
    const name = document.createElement("b");
    name.textContent = item.label;
    const bar = document.createElement("progress");
    bar.max = 1;
    bar.value = item.data.done;
    card.append(name, bar);
    element.replaceChildren(card);
  }
}

const timeline = createTimeline(document.querySelector("#timeline"), {
  items,
  slots: true,
  ariaLabel: "Product sprint",
});
timeline.on("slotsChanged", ({ slots }) => render(slots));
render(timeline.slots);
