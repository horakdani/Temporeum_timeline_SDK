import { createTimeline } from "@temporeum/timeline-element";
import { mountStory } from "@temporeum/timeline-element/story";
import { fromTimelineSheet } from "@temporeum/timeline-core/story";

// TimelineJS's Google Sheets template, as File → Share → Publish to web → CSV gives it.
// A page would fetch it: `await (await fetch(sheetCsvUrl(address))).text()`.
const csv = `Year,Month,Day,Time,End Year,End Month,End Day,End Time,Display Date,Headline,Text,Media,Media Credit,Media Caption,Media Thumbnail,Type,Group,Background
,,,,,,,,,The Wright brothers,"<p>Four years from a kite to a flight.</p>",,,,,title,,
1899,8,,,,,,,,The kite,"<p>A biplane kite tests <b>wing warping</b>.</p>",,,,,,Gliders,
1900,10,,,1902,10,,,Autumns 1900–1902,Kitty Hawk gliders,"<p>Three gliders on the dunes of North Carolina.</p>",,,,,,Gliders,#c8a96a
1901,10,,,1901,12,,,,The wind tunnel,"<p>Two hundred wing shapes, measured.</p>",,,,,,Research,
1903,12,17,10:35 AM,,,,,,The first flight,"<p>Twelve seconds, 120 feet.</p>",https://en.wikipedia.org/wiki/Wright_Flyer,,,,,Flights,
1903,12,17,,1905,10,,,,The Flyers,,,,,,era,,`;

const story = fromTimelineSheet(csv);
const timeline = createTimeline(document.querySelector("#timeline"), {
  items: story.items,
  lanes: story.lanes,
  decorations: story.decorations,
  density: "compact",
  locale: "en-US",
  domain: [Date.UTC(1899, 0, 1), Date.UTC(1906, 0, 1)],
});
mountStory(document.querySelector("#story"), timeline, { title: story.title, locale: "en-US" });

// What did not carry over is said, not dropped: here, nothing.
document.querySelector("#log").textContent = `${String(story.items.length)} events, ${String(story.decorations.length)} era, ${String(story.lanes.length)} lanes; ${String(story.warnings.length)} warnings`;
