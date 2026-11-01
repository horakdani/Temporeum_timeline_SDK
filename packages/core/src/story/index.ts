/**
 * `@temporeum/timeline-core/story` — stories told slide by slide, and
 * TimelineJS's stories brought over.
 *
 * - {@link fromTimelineJS}: TimelineJS's JSON as items, lanes and eras,
 *   each item's slide in `data.story`;
 * - {@link fromTimelineSheet} and {@link readTimelineSheet}: its Google
 *   Sheets template, from the CSV the sheet publishes;
 *   {@link sheetCsvUrl}: that CSV's address from the sheet's;
 * - {@link storyMedia}: what a media link is — an image, a video, a player
 *   of a known provider, or a link — and the player's address;
 * - {@link storyDateText}: a slide's date written out to its precision.
 *
 * Pure functions, Node or browser; nothing is fetched. The panel that shows
 * the slides beside a timeline is `mountStory` of
 * `@temporeum/timeline-element/story`.
 */
export { fromTimelineJS, storyPlainText } from "./timelinejs.js";
export type {
  FromTimelineJSOptions,
  StoryConversion,
  StoryData,
  StoryMedia,
  StorySlide,
  StoryWarning,
  TimelineJSData,
  TimelineJSDate,
  TimelineJSEra,
  TimelineJSMedia,
  TimelineJSSlide,
} from "./timelinejs.js";
export { fromTimelineSheet, parseCsv, readTimelineSheet, sheetCsvUrl } from "./sheet.js";
export type { TimelineSheet } from "./sheet.js";
export { storyMedia } from "./media.js";
export type { StoryMediaKind, StoryMediaSource } from "./media.js";
export { storyDateText } from "./date.js";
export type { StoryDateOptions } from "./date.js";
