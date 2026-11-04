/**
 * `@temporeum/timeline-element/intl` — the timeline in other languages,
 * directions and calendars, as a plugin: `strings` (the accessible names of
 * items and clusters in a dictionary's words), `direction: "rtl"` and
 * `"auto"` (the frame mirrored), and `calendar` (the axis's months and years
 * a calendar's own).
 *
 *     import { registerPlugin } from "@temporeum/timeline-element";
 *     import { intlPlugin } from "@temporeum/timeline-element/intl";
 *     registerPlugin(intlPlugin);
 *
 * Its own entry point: these are the core's `/intl`, and a
 * timeline in English, left to right, on the Gregorian axis does not
 * download it. The English words themselves are not here — they are the
 * base's (`@temporeum/timeline-core/words`), and the Gantt chart, the
 * resource view and the tools speak them without this plugin.
 */

import { calendarTickLabel, calendarTicks, describeHooks, mirrorScene, mirrorTextNodes } from "@temporeum/timeline-core/intl";

import type { TimelinePlugin } from "./plugins.js";

/** Other languages, directions and calendars. Register them with `registerPlugin(intlPlugin)`. */
export const intlPlugin: TimelinePlugin = Object.freeze({
  name: "intl",
  feature: Object.freeze({ mirrorScene, mirrorTextNodes, describeHooks, calendarTicks, calendarTickLabel }),
});
