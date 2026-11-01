const DAY = 86_400_000;
const t = Date.UTC(2026, 2, 2);

export const items = [
  { id: "design", label: "Design", laneId: "work", start: t, end: t + 7 * DAY },
  { id: "build", label: "Build", laneId: "work", start: t + 5 * DAY, end: t + 19 * DAY },
  { id: "review", label: "Review", laneId: "ship", start: t + 21 * DAY },
  { id: "launch", label: "Launch", laneId: "ship", start: t + 25 * DAY, end: t + 32 * DAY },
];
export const lanes = [
  { id: "work", label: "Work" },
  { id: "ship", label: "Shipping" },
];
