/**
 * `@temporeum/timeline-element/define` — import for the side effect.
 *
 * `import "@temporeum/timeline-element/define"` registers
 * `<temporeum-timeline>`. Kept apart from the main entry so that importing
 * the element's class, types or server helpers never registers anything —
 * the main entry is side-effect free and tree-shakes.
 */
import { defineTimelineElement } from "./element.js";

defineTimelineElement();
