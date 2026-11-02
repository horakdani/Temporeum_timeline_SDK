<script>
  // On SvelteKit's server the Svelte adapter draws by itself ({@html}); on
  // hydration the client takes over the server's nodes, and the instance takes those.
  import { Timeline, timelineState } from "@temporeum/timeline-svelte";

  import { config, WIDTH } from "../../shared/data.mjs";

  let timeline = $state(null);
  const selected = $derived(timelineState(timeline, (snapshot) => snapshot.selectedIds));
  $effect(() => {
    // This is how the test knows the client has taken over the drawing.
    if (timeline !== null) window.__tl = timeline;
  });
</script>

<main style="width: 960px">
  <h1 style="font-size: 16px">SvelteKit smoke</h1>
  <Timeline {...config} ssrWidth={WIDTH} bind:timeline />
  <output id="selected">{($selected ?? []).join(",")}</output>
</main>
