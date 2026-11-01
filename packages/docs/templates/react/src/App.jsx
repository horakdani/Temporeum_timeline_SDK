import { Timeline, useTimelineState } from "@temporeum/timeline-react";
import { useState } from "react";

const DAY = 86_400_000;
const t = Date.UTC(2026, 2, 2);
const items = [
  { id: "design", label: "Design", laneId: "work", start: t, end: t + 7 * DAY, data: { owner: "Ana" } },
  { id: "build", label: "Build", laneId: "work", start: t + 5 * DAY, end: t + 19 * DAY, data: { owner: "Ben" } },
  { id: "review", label: "Review", laneId: "ship", start: t + 21 * DAY, data: { owner: "Cleo" } },
  { id: "launch", label: "Launch", laneId: "ship", start: t + 25 * DAY, end: t + 32 * DAY, data: { owner: "Dev" } },
];
const lanes = [
  { id: "work", label: "Work" },
  { id: "ship", label: "Shipping" },
];

// An item's content as a component: a picture of the item, its label still its name.
function ItemCard({ item }) {
  return (
    <span>
      <b>{item.label}</b> · {item.data.owner}
    </span>
  );
}

export default function App() {
  const [timeline, setTimeline] = useState(null);
  const selected = useTimelineState(timeline, (state) => state.selectedIds);
  const [log, setLog] = useState("Drag an item.");
  return (
    <main style={{ padding: 16 }}>
      <h1 style={{ fontSize: 18 }}>Release plan</h1>
      <Timeline
        items={items}
        lanes={lanes}
        height={320}
        ariaLabel="Release plan"
        editing={{ enabled: true, snapMs: DAY }}
        renderItem={(item) => <ItemCard item={item} />}
        onItemMoved={({ item, to }) => setLog(`${item.label} moved to ${new Date(to.start).toDateString()}`)}
        timelineRef={setTimeline}
      />
      <p aria-live="polite">
        {log} {selected?.length ?? 0} selected.
      </p>
    </main>
  );
}
