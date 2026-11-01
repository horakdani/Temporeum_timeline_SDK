<script>
  // A SvelteKit szerverén a Svelte-adapter maga rajzol ({@html}); a kliens
  // hidratáláskor a szerver csomópontjait veszi át, és a példány azokat (P23).
  import { Timeline, timelineState } from "@temporeum/timeline-svelte";

  import { config, WIDTH } from "../../shared/data.mjs";

  let timeline = $state(null);
  const selected = $derived(timelineState(timeline, (snapshot) => snapshot.selectedIds));
  $effect(() => {
    // A teszt innen tudja, hogy a kliens átvette a rajzot.
    if (timeline !== null) window.__tl = timeline;
  });
</script>

<main style="width: 960px">
  <h1 style="font-size: 16px">SvelteKit smoke</h1>
  <Timeline {...config} ssrWidth={WIDTH} bind:timeline />
  <output id="selected">{($selected ?? []).join(",")}</output>
</main>
