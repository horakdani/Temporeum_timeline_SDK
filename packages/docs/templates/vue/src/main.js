import { registerPlugin } from "@temporeum/timeline-element";
import { itemsPlugin } from "@temporeum/timeline-element/items";
import { createApp } from "vue";

import App from "./App.vue";

// Once, before the first timeline: the items plugin draws the boxes the #item slot fills.
registerPlugin(itemsPlugin);

createApp(App).mount("#app");
