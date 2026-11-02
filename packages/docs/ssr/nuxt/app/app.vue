<script setup>
// On Nuxt's server (Nitro, Node) the Vue adapter draws by itself: in Vue's
// SSR context the component writes renderTimelineSvg's drawing into the
// markup, and on the client the instance takes it over by hydration — with
// no client plugin and no isCustomElement.
import { Timeline, useTimelineState } from "@temporeum/timeline-vue";
import { shallowRef } from "vue";

import { config, WIDTH } from "~~/shared/data.mjs";

const timeline = shallowRef(null);
const selected = useTimelineState(timeline, (snapshot) => snapshot.selectedIds);
const onReady = (instance) => {
  timeline.value = instance;
  // This is how the test knows the client has taken over the drawing.
  window.__tl = instance;
};
</script>

<template>
  <main style="width: 960px">
    <h1 style="font-size: 16px">Nuxt smoke</h1>
    <Timeline v-bind="config" :ssr-width="WIDTH" @ready="onReady" />
    <output id="selected">{{ (selected ?? []).join(",") }}</output>
  </main>
</template>
