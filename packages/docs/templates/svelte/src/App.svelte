<script>
  import { Timeline, timelineState } from "@temporeum/timeline-svelte";

  const DAY = 86_400_000;
  const t = Date.UTC(2026, 2, 2);
  const items = [
    { id: "design", label: "Design", laneId: "work", start: t, end: t + 7 * DAY },
    { id: "build", label: "Build", laneId: "work", start: t + 5 * DAY, end: t + 19 * DAY },
    { id: "review", label: "Review", laneId: "ship", start: t + 21 * DAY },
    { id: "launch", label: "Launch", laneId: "ship", start: t + 25 * DAY, end: t + 32 * DAY },
  ];
  const lanes = [
    { id: "work", label: "Work" },
    { id: "ship", label: "Shipping" },
  ];

  let timeline = $state(null);
  const selected = $derived(timelineState(timeline, (state) => state.selectedIds));
  let log = $state("Drag an item.");
</script>

<main style="padding: 16px">
  <h1 style="font-size: 18px">Release plan</h1>
  <Timeline
    {items}
    {lanes}
    height={320}
    ariaLabel="Release plan"
    editing={{ enabled: true, snapMs: DAY }}
    onItemMoved={({ item, to }) => (log = `${item.label} moved to ${new Date(to.start ?? item.start).toDateString()}`)}
    bind:timeline
  />
  <p aria-live="polite">{log} {$selected?.length ?? 0} selected.</p>
</main>
