import { createTimeline } from "@temporeum/timeline-element";
import { mountStory } from "@temporeum/timeline-element/story";
import { fromTimelineJS } from "@temporeum/timeline-core/story";

// A picture of the page's own; any image address works the same.
const picture = (text, colour) => ({
  url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180"><rect width="320" height="180" fill="${colour}"/><text x="160" y="100" fill="#fff" font-family="system-ui" font-size="24" text-anchor="middle">${text}</text></svg>`)}`,
  alt: `A card saying ${text}`,
});

// TimelineJS's JSON: a title slide, events with a headline, HTML text and media, and groups.
const story = fromTimelineJS({
  title: { text: { headline: "A product's first year", text: "<p>From the first sketch to the launch.</p>" } },
  events: [
    { start_date: { year: 2026, month: 1, day: 12 }, group: "Product", unique_id: "sketch", text: { headline: "The first sketch", text: "<p>Two people and a <b>whiteboard</b>.</p>" }, media: { ...picture("Sketch", "#2f5d8a"), caption: "Drawn by the page" } },
    { start_date: { year: 2026, month: 3 }, end_date: { year: 2026, month: 5 }, group: "Product", unique_id: "beta", text: { headline: "Private beta", text: "<p>Three months, forty teams.</p>" } },
    { start_date: { year: 2026, month: 4, day: 2 }, group: "Company", unique_id: "seed", text: { headline: "Seed round", text: "<p>The first money from outside.</p>" } },
    { start_date: { year: 2026, month: 9, day: 15, hour: 9, minute: 0 }, group: "Product", unique_id: "launch", text: { headline: "Launch", text: '<p>Read <a href="https://example.com/launch">the announcement</a>.</p>' }, media: picture("Launch", "#8a3b2f") },
  ],
});

const timeline = createTimeline(document.querySelector("#timeline"), {
  items: story.items,
  lanes: story.lanes,
  density: "compact",
  locale: "en-GB",
  domain: [Date.UTC(2025, 11, 1), Date.UTC(2026, 10, 1)],
});

// The panel and the timeline move together; with `hash`, the address names the slide.
const log = document.querySelector("#log");
mountStory(document.querySelector("#story"), timeline, {
  title: story.title,
  hash: true,
  headingLevel: 3,
  locale: "en-GB",
  onChange: ({ index, id, source }) => {
    log.textContent = `Slide ${String(index)}: ${id ?? "the title"}, moved by the ${source}.`;
  },
});
