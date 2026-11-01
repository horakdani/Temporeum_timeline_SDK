<script setup>
// A Nuxt szerverén (Nitro, Node) a Vue-adapter maga rajzol: a komponens a
// Vue SSR-kontextusában a renderTimelineSvg rajzát írja a markupba, a
// kliensen pedig a példány hidratálással átveszi — kliens-plugin és
// isCustomElement nélkül (P23).
import { Timeline, useTimelineState } from "@temporeum/timeline-vue";
import { shallowRef } from "vue";

import { config, WIDTH } from "~~/shared/data.mjs";

const timeline = shallowRef(null);
const selected = useTimelineState(timeline, (snapshot) => snapshot.selectedIds);
const onReady = (instance) => {
  timeline.value = instance;
  // A teszt innen tudja, hogy a kliens átvette a rajzot.
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
