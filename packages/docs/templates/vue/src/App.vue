<script setup>
import { Timeline, useTimelineState } from "@temporeum/timeline-vue";
import { ref, shallowRef } from "vue";

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

const timeline = shallowRef(null);
const selected = useTimelineState(timeline, (state) => state.selectedIds);
const log = ref("Drag an item.");
const onMoved = ({ item, to }) => {
  log.value = `${item.label} moved to ${new Date(to.start).toDateString()}`;
};
</script>

<template>
  <main style="padding: 16px">
    <h1 style="font-size: 18px">Release plan</h1>
    <Timeline
      :items="items"
      :lanes="lanes"
      :height="320"
      aria-label="Release plan"
      :editing="{ enabled: true, snapMs: DAY }"
      @item-moved="onMoved"
      @ready="timeline = $event"
    >
      <!-- An item's content as Vue: a picture of the item, its label still its name. -->
      <template #item="{ item }">
        <b>{{ item.label }}</b> · {{ item.data.owner }}
      </template>
    </Timeline>
    <p aria-live="polite">{{ log }} {{ selected?.length ?? 0 }} selected.</p>
  </main>
</template>
