import { createTimeline, registerPlugin } from "@temporeum/timeline-element";
import { toolsPlugin } from "@temporeum/timeline-element/tools";
import { mountStory } from "@temporeum/timeline-element/story";
import { fromTimelineJS } from "@temporeum/timeline-core/story";

// The lanes' names, held at the start of the view, are one of the time tools.
registerPlugin(toolsPlugin);

// An illustration of the page's own, so the story needs no image host: an orbit, and the name under it.
function picture(name, hue) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180"><rect width="320" height="180" fill="hsl(${String(hue)} 45% 18%)"/><circle cx="160" cy="84" r="34" fill="hsl(${String(hue)} 55% 62%)"/><ellipse cx="160" cy="84" rx="92" ry="26" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="2"/><circle cx="246" cy="74" r="6" fill="#fff"/><text x="160" y="156" fill="#fff" font-family="system-ui,sans-serif" font-size="18" text-anchor="middle">${name}</text></svg>`;
  return { url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`, alt: `Illustration: ${name}` };
}
const on = (year, month, day, hour, minute) => ({ year, month, day, ...(hour === undefined ? {} : { hour, minute }) });

// TimelineJS's own format, as its Google Sheets template publishes it: the same JSON would load in TimelineJS.
const json = {
  title: {
    text: { headline: "The race to the Moon", text: "<p>From the first satellite to the last Apollo crew, 1957–1975: nineteen moments of a race between two countries.</p>" },
    media: { ...picture("1957 – 1975", 225), caption: "Illustrations drawn by the page." },
  },
  eras: [
    { start_date: { year: 1961 }, end_date: { year: 1963 }, text: { headline: "Vostok & Mercury" } },
    { start_date: { year: 1964 }, end_date: { year: 1966 }, text: { headline: "Voskhod & Gemini" } },
    { start_date: { year: 1967 }, end_date: { year: 1972 }, text: { headline: "Apollo" } },
  ],
  events: [
    { start_date: on(1957, 10, 4), group: "Soviet Union", unique_id: "sputnik", text: { headline: "Sputnik 1", text: "<p>The first artificial satellite: a polished sphere with four antennas, whose <em>beep</em> anyone with a radio could hear.</p>" }, media: picture("Sputnik 1", 0) },
    { start_date: on(1957, 11, 3), group: "Soviet Union", text: { headline: "Sputnik 2 carries Laika", text: "<p>The first animal in orbit. She did not survive the flight.</p>" } },
    { start_date: on(1958, 1, 31), group: "United States", unique_id: "explorer", text: { headline: "Explorer 1", text: "<p>The first American satellite finds the radiation belts named after James Van Allen.</p>" }, media: picture("Explorer 1", 210) },
    { start_date: on(1958, 10, 1), group: "United States", text: { headline: "NASA opens", text: "<p>A civilian agency takes over the country's space programme.</p>" } },
    { start_date: on(1961, 4, 12, 6, 7), group: "Soviet Union", unique_id: "gagarin", text: { headline: "Yuri Gagarin, Vostok 1", text: "<p>The first person in space: one orbit, 108 minutes from launch to landing.</p>" }, media: picture("Vostok 1", 10) },
    { start_date: on(1961, 5, 5), group: "United States", text: { headline: "Alan Shepard, Freedom 7", text: "<p>The first American in space, on a fifteen-minute flight up and down.</p>" } },
    { start_date: on(1961, 5, 25), group: "United States", unique_id: "kennedy", text: { headline: "“Before this decade is out”", text: "<p>President Kennedy asks Congress to land a man on the Moon and return him safely to the Earth.</p>" } },
    { start_date: on(1962, 2, 20), group: "United States", text: { headline: "John Glenn orbits the Earth", text: "<p>Three orbits in Friendship 7.</p>" } },
    { start_date: on(1963, 6, 16), group: "Soviet Union", unique_id: "tereshkova", text: { headline: "Valentina Tereshkova, Vostok 6", text: "<p>The first woman in space: three days and 48 orbits.</p>" }, media: picture("Vostok 6", 330) },
    { start_date: on(1965, 3, 18), group: "Soviet Union", text: { headline: "Alexei Leonov walks in space", text: "<p>Twelve minutes outside Voskhod 2; his suit swelled so much he barely got back in.</p>" } },
    { start_date: on(1966, 2, 3), group: "Soviet Union", text: { headline: "Luna 9 lands softly", text: "<p>The first spacecraft to land on the Moon intact, and the first pictures from its surface.</p>" } },
    { start_date: on(1967, 1, 27), group: "United States", text: { headline: "The Apollo 1 fire", text: "<p>Gus Grissom, Ed White and Roger Chaffee die in a fire during a test on the pad. The spacecraft is redesigned.</p>" } },
    { start_date: on(1968, 12, 21), end_date: on(1968, 12, 27), group: "United States", unique_id: "apollo-8", text: { headline: "Apollo 8 orbits the Moon", text: "<p>The first people to leave the Earth's orbit; on Christmas Eve they photograph the Earth rising over the Moon.</p>" }, media: picture("Apollo 8", 200) },
    { start_date: on(1969, 7, 16), end_date: on(1969, 7, 24), group: "United States", unique_id: "apollo-11", text: { headline: "Apollo 11", text: "<p>Neil Armstrong, Buzz Aldrin and Michael Collins: eight days, from the launch in Florida to the splashdown in the Pacific.</p>" }, media: { url: "https://en.wikipedia.org/wiki/Apollo_11", title: "Apollo 11 on Wikipedia" } },
    { start_date: on(1969, 7, 20, 20, 17), group: "United States", unique_id: "eagle", text: { headline: "<i>The Eagle has landed</i>", text: "<p>The lunar module touches down in the Sea of Tranquillity, with seconds of fuel to spare. Zoom in: the timeline knows the minute.</p>" }, media: picture("Tranquillity Base", 45) },
    { start_date: on(1970, 4, 11), end_date: on(1970, 4, 17), group: "United States", text: { headline: "Apollo 13", text: "<p>An oxygen tank bursts on the way out; the crew loops around the Moon and comes home in the lunar module.</p>" } },
    { start_date: on(1971, 4, 19), group: "Soviet Union", text: { headline: "Salyut 1", text: "<p>The first space station.</p>" } },
    { start_date: on(1972, 12, 7), end_date: on(1972, 12, 19), group: "United States", unique_id: "apollo-17", text: { headline: "Apollo 17, the last landing", text: "<p>Gene Cernan is, so far, the last person to have walked on the Moon.</p>" }, media: picture("Apollo 17", 30) },
    { start_date: on(1975, 7, 17), group: "Together", unique_id: "apollo-soyuz", text: { headline: "Apollo and Soyuz dock", text: "<p>A handshake in orbit ends the race.</p>" }, media: picture("Apollo–Soyuz", 160) },
  ],
};

const story = fromTimelineJS(json);
const timeline = createTimeline(document.querySelector("#timeline"), {
  items: story.items,
  lanes: story.lanes,
  decorations: story.decorations,
  density: "compact",
  // Under a story the timeline stays a strip across, on a phone too.
  orientation: "horizontal",
  laneHeaders: true,
  locale: "en-GB",
  ariaLabel: "The race to the Moon, 1957–1975",
  domain: [Date.UTC(1956, 6, 1), Date.UTC(1976, 6, 1)],
});

const status = document.querySelector("#status");
status.dataset.slides = String(story.items.length + 1);
status.dataset.warnings = String(story.warnings.length);
const tale = mountStory(document.querySelector("#story"), timeline, {
  title: story.title,
  locale: "en-GB",
  theme: "light",
});
tale.on("slideChanged", ({ index, id, source }) => {
  status.textContent = id === null ? "The title slide: the whole story on the timeline." : `Slide ${String(index)} of ${String(story.items.length)} (${id}), moved by the ${source}.`;
});
