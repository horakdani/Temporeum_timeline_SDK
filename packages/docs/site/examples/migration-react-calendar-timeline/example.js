import { createTimeline } from "@temporeum/timeline-element";

// Groups and items in react-calendar-timeline's shape, as an existing app has them.
const DAY = 86_400_000;
const at = (day) => Date.UTC(2026, 2, day);
const rctGroups = [
  { id: 1, title: "Anna" },
  { id: 2, title: "Bence" },
  { id: 3, title: "Chen" },
];
const rctItems = [
  { id: 1, group: 1, title: "Onboarding", start_time: at(2), end_time: at(4) },
  { id: 2, group: 1, title: "Support rota", start_time: at(5), end_time: at(12), canMove: false },
  { id: 3, group: 2, title: "Migration", start_time: at(3), end_time: at(11) },
  { id: 4, group: 2, title: "Review", start_time: at(9), end_time: at(10) },
  { id: 5, group: 3, title: "Holiday", start_time: at(6), end_time: at(13), itemProps: { className: "away" } },
];

// Ids are strings, `group` is `laneId`, `title` is `label`; times stay epoch ms.
const lanes = rctGroups.map((group) => ({ id: String(group.id), label: group.title }));
const items = rctItems.map((item) => ({
  id: String(item.id),
  laneId: String(item.group),
  label: item.title,
  start: item.start_time,
  end: item.end_time,
  ...(item.canMove === false ? { movable: false } : {}),
  ...(item.itemProps?.className ? { className: item.itemProps.className } : {}),
}));

// <Timeline defaultTimeStart defaultTimeEnd dragSnap={DAY} canChangeGroup stackItems />
// In React: <Timeline {...theseProps} onItemMoved={…} /> from @temporeum/timeline-react.
const timeline = createTimeline(document.querySelector("#timeline"), {
  items,
  lanes,
  domain: [at(1), at(15)],
  editing: { enabled: true, crossLane: true, snapMs: DAY },
  decorations: [{ kind: "now", time: at(8), label: "Today" }],
  ariaLabel: "Team schedule, converted from react-calendar-timeline",
});

// onItemMove(itemId, dragTime, newGroupOrder)
timeline.on("itemMoved", ({ item, to }) => {
  const lane = lanes.find((each) => each.id === (to.laneId ?? item.laneId));
  document.querySelector("#log").textContent = `${item.label} → ${lane?.label ?? ""}, ${new Date(to.start ?? item.start).toDateString()}`;
});
