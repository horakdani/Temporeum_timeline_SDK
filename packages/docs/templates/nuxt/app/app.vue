<script setup>
import { Timeline } from "@temporeum/timeline-vue";

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
</script>

<template>
  <main>
    <h1 style="font-size: 18px; padding: 0 16px">Release plan</h1>
    <!-- Drawn on the server at 960 px; the client takes the drawing over and redraws at its width. -->
    <Timeline :items="items" :lanes="lanes" :height="320" aria-label="Release plan" :ssr-width="960" />
  </main>
</template>
