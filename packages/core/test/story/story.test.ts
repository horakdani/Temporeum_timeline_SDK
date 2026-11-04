/**
 * G-STORY (core half): a TimelineJS story — its JSON and its Google Sheets
 * template — becomes items, lanes and eras with the dates TimelineJS means,
 * every slide's content in `data.story`, and a warning for what does not
 * carry over; a media link is sorted by its address; a slide's date is
 * written to its precision.
 */
import { describe, expect, it } from "vitest";

import {
  fromTimelineJS,
  fromTimelineSheet,
  parseCsv,
  readTimelineSheet,
  sheetCsvUrl,
  storyDateText,
  storyMedia,
  storyPlainText,
} from "../../src/story/index.js";
import type { TimelineJSData } from "../../src/story/index.js";
import { layoutItems } from "../../src/layout.js";
import type { Item } from "../../src/types.js";

function utc(year: number, month = 1, day = 1, hour = 0, minute = 0, second = 0, ms = 0): number {
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, ms);
  return date.getTime();
}

const APOLLO: TimelineJSData = {
  title: { text: { headline: "Apollo 11", text: "<p>Eight days in July</p>" }, media: { url: "https://upload.wikimedia.org/a.jpg", caption: "The crew", credit: "NASA" } },
  events: [
    { start_date: { year: 1969, month: 7, day: 16, hour: 13, minute: 32 }, text: { headline: "Launch", text: "<p>From <b>Pad 39A</b></p>" }, group: "Flight", unique_id: "launch" },
    { start_date: { year: "1969", month: "7", day: "20", hour: "20", minute: "17" }, text: { headline: "<i>Eagle</i> lands" }, group: "Flight" },
    { start_date: { year: 1969, month: 7, day: 16 }, end_date: { year: 1969, month: 7, day: 24 }, text: { headline: "The mission" }, group: "Mission", display_date: "16–24 July" },
    { start_date: { year: 1969 }, text: { headline: "The year" }, media: { url: "https://www.youtube.com/watch?v=abcdefghijk", thumbnail: "t.jpg", alt: "Footage", title: "Film", link: "https://nasa.gov" }, background: { color: "#123456" } },
  ],
  eras: [{ start_date: { year: 1961 }, end_date: { year: 1972 }, text: { headline: "Project <b>Apollo</b>" } }],
};

describe("fromTimelineJS", () => {
  const story = fromTimelineJS(APOLLO);

  it("places every event at the time TimelineJS means, to the precision it is given in", () => {
    expect(story.items.map((item) => [item.id, item.start, item.end, item.granularity])).toEqual([
      ["launch", utc(1969, 7, 16, 13, 32), undefined, "minute"],
      ["slide-2", utc(1969, 7, 20, 20, 17), undefined, "minute"],
      // The end is its day; the layout runs the span to the end of it.
      ["slide-3", utc(1969, 7, 16), utc(1969, 7, 24), "day"],
      ["slide-4", utc(1969), undefined, "year"],
    ]);
  });

  it("runs a span to the end of its end's own unit when the two dates are known to different precisions (M5)", () => {
    const mixed = fromTimelineJS({
      events: [
        { start_date: { year: 1914 }, end_date: { year: 1918, month: 11, day: 11 } },
        { start_date: { year: 1969, month: 7, day: 16 }, end_date: { year: 1972 } },
        { start_date: { year: 1914 }, end_date: { year: 1918 } },
      ],
    });
    const spans = layoutItems(mixed.items)
      .items.map((placed) => [placed.item.id, placed.span.start, placed.span.end])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
    expect(spans).toEqual([
      ["slide-1", utc(1914), utc(1918, 11, 12)],
      ["slide-2", utc(1969, 7, 16), utc(1973)],
      ["slide-3", utc(1914), utc(1919)],
    ]);
    // The finer of the two units is the item's: the span is exact in it.
    expect(mixed.items.map((item) => item.granularity)).toEqual(["day", "day", "year"]);
    expect(storyDateText(mixed.items[1] as Item, { locale: "en-GB" }).replace(/\s+/gu, " ")).toBe("16 July 1969 – 31 December 1972");
    expect(storyDateText(mixed.items[2] as Item, { locale: "en-GB" }).replace(/\s+/gu, " ")).toBe("1914 – 1918");
  });

  it("keeps each slide in data.story, and the headline as plain text in the label", () => {
    expect(story.items[0]?.data?.story).toEqual({ headline: "Launch", text: "<p>From <b>Pad 39A</b></p>" });
    expect(story.items[1]?.label).toBe("Eagle lands");
    expect(story.items[2]?.data?.story.date).toBe("16–24 July");
    expect(story.items[3]?.data?.story).toEqual({
      headline: "The year",
      media: { url: "https://www.youtube.com/watch?v=abcdefghijk", thumbnail: "t.jpg", alt: "Footage", title: "Film", link: "https://nasa.gov" },
      background: "#123456",
    });
    expect(story.title).toEqual({ headline: "Apollo 11", text: "<p>Eight days in July</p>", media: { url: "https://upload.wikimedia.org/a.jpg", caption: "The crew", credit: "NASA" } });
  });

  it("makes a lane of each group in order of appearance, and one for the rest", () => {
    expect(story.lanes).toEqual([
      { id: "group-flight", label: "Flight" },
      { id: "group-mission", label: "Mission" },
      { id: "group-other", label: "Other" },
    ]);
    expect(story.items.map((item) => item.laneId)).toEqual(["group-flight", "group-flight", "group-mission", "group-other"]);
    const named = fromTimelineJS({ events: [{ start_date: { year: 1 }, group: "A" }, { start_date: { year: 2 } }] }, { ungroupedLabel: "Elsewhere", lanePrefix: "g:" });
    expect(named.lanes).toEqual([
      { id: "g:a", label: "A" },
      { id: "g:other", label: "Elsewhere" },
    ]);
  });

  it("keeps two groups apart whose names make the same id", () => {
    const two = fromTimelineJS({ events: [{ start_date: { year: 1 }, group: "Á" }, { start_date: { year: 2 }, group: "a" }, { start_date: { year: 3 }, group: "!!" }] });
    expect(two.lanes?.map((lane) => lane.id)).toEqual(["group-a", "group-a-2", "group-group"]);
  });

  it("makes one lane when no event has a group", () => {
    const flat = fromTimelineJS({ events: [{ start_date: { year: 2000 } }] });
    expect(flat.lanes).toEqual([{ id: "group-all" }]);
    expect(flat.items[0]?.laneId).toBe("group-all");
    const taken = fromTimelineJS({ events: [{ start_date: { year: 1 }, group: "Other" }, { start_date: { year: 2 } }] });
    expect(taken.lanes).toEqual([
      { id: "group-other", label: "Other" },
      { id: "group-other-", label: "Other" },
    ]);
    expect(flat.title).toBeUndefined();
    expect(fromTimelineJS({}).items).toEqual([]);
  });

  it("turns the eras into era decorations that cover their end year", () => {
    expect(story.decorations).toEqual([{ kind: "era", id: "era-1", start: utc(1961), end: utc(1973), label: "Project Apollo" }]);
  });

  it("reads years before 1 AD and below 100 as the years they are", () => {
    const old = fromTimelineJS({ events: [{ start_date: { year: -753 } }, { start_date: { year: 79, month: 8, day: 24 } }] });
    expect(old.items.map((item) => item.start)).toEqual([utc(-753), utc(79, 8, 24)]);
  });

  it("names what does not carry over", () => {
    const odd = fromTimelineJS({
      scale: "cosmological",
      events: [
        { text: { headline: "No date" } },
        { start_date: { year: "about 1500" } },
        { start_date: { year: 1_000_000 } },
        { start_date: { year: 2000, month: 1.5 } },
        { start_date: { year: 2000 }, end_date: { year: 1999 } },
        { start_date: { year: 2000 }, end_date: { year: "late" } },
        { start_date: { year: 2000 }, unique_id: "x" },
        { start_date: { year: 2001 }, unique_id: "x" },
        { start_date: { year: 2002 }, unique_id: "x" },
        { start_date: { year: 2003 }, background: { url: "https://a.b/c.jpg" } },
      ],
      eras: [{ start_date: { year: 1 } }, { start_date: { year: 5 }, end_date: { year: 2 } }, { start_date: { year: "x" }, end_date: { year: 2 } }, { start_date: { year: 1 }, end_date: { year: 2 } }],
    });
    expect(odd.warnings.map((warning) => [warning.code, warning.list, warning.index])).toEqual([
      ["cosmological", undefined, undefined],
      ["no-date", "events", 0],
      ["out-of-range", "events", 1],
      ["out-of-range", "events", 2],
      ["out-of-range", "events", 3],
      ["end-before-start", "events", 4],
      ["out-of-range", "events", 5],
      ["duplicate-id", "events", 7],
      ["duplicate-id", "events", 8],
      ["background-image", "events", 9],
      ["no-date", "eras", 0],
      ["end-before-start", "eras", 1],
      ["out-of-range", "eras", 2],
    ]);
    expect(odd.items.map((item) => item.id)).toEqual(["slide-5", "slide-6", "x", "x-2", "x-3", "slide-10"]);
    expect(odd.items[0]?.end).toBeUndefined();
    expect(odd.decorations.map((era) => era.label)).toEqual([undefined]);
  });

  it("joins a start and an end display date, and prefers the slide's own", () => {
    const shown = fromTimelineJS({
      events: [
        { start_date: { year: 1914, display_date: "Summer 1914" }, end_date: { year: 1918, display_date: "November 1918" } },
        { start_date: { year: 1914, display_date: "1914" }, end_date: { year: 1918 }, display_date: "The war" },
        { start_date: { year: 1914, display_date: "1914" } },
      ],
    });
    expect(shown.items.map((item) => item.data?.story.date)).toEqual(["Summer 1914 – November 1918", "The war", "1914"]);
  });

  it("ends an event at the instant its end date names, to any precision", () => {
    const fine = fromTimelineJS({
      events: [
        { start_date: { year: 1969, month: 7, day: 20, hour: 20 }, end_date: { year: 1969, month: 7, day: 20, hour: 21 } },
        { start_date: { year: 1969, month: 7, day: 20, hour: 20, minute: 17, second: 40 }, end_date: { year: 1969, month: 7, day: 20, hour: 20, minute: 17, second: 58 } },
        { start_date: { year: 1969, month: 7, day: 20, hour: 20, minute: 17, second: 40, millisecond: 0 }, end_date: { year: 1969, month: 7, day: 20, hour: 20, minute: 17, second: 40, millisecond: 9 } },
      ],
    });
    expect(fine.items.map((item) => [item.granularity, item.end])).toEqual([
      ["hour", utc(1969, 7, 20, 21)],
      ["second", utc(1969, 7, 20, 20, 17, 58)],
      ["millisecond", utc(1969, 7, 20, 20, 17, 40, 9)],
    ]);
  });

  it("does not take an empty field for a value", () => {
    const empty = fromTimelineJS({ events: [{ start_date: { year: " 1990 ", month: "" }, text: { headline: "", text: "" }, media: { url: " " }, background: { color: " " } }] });
    expect(empty.items[0]).toEqual({ id: "slide-1", start: utc(1990), granularity: "year", laneId: "group-all", data: { story: {} } });
  });
});

describe("storyPlainText", () => {
  it("drops the tags and reads the character references", () => {
    expect(storyPlainText("<b>Tom</b> &amp; Jerry<br/>&#8211;&#x2014;&nbsp;&lt;3&unknown;  ")).toBe("Tom & Jerry –— <3&unknown;".replace(/\s+/g, " ").trim());
  });
});

describe("a character reference to no character (M10, S7)", () => {
  it("is the replacement character, as in HTML, and the import goes on", () => {
    expect(storyPlainText("a&#x110000;b&#0;c&#xD800;d&#99999999999;e&#x1F600;")).toBe("a�b�c�d�e\u{1F600}");
    const story = fromTimelineJS({ events: [{ start_date: { year: 2000 }, text: { headline: "Bad &#x110000; ref" } }, { start_date: { year: 2001 }, text: { headline: "Fine" } }] });
    expect(story.items.map((item) => item.label)).toEqual(["Bad � ref", "Fine"]);
  });
});

describe("the Google Sheets template", () => {
  const csv = [
    "﻿Year,Month,Day,Time,End Year,End Month,End Day,End Time,Display Date,Headline,Text,Media,Media Credit,Media Caption,Media Thumbnail,Type,Group,Background,Extra",
    ',,,,,,,,,"Apollo 11","<p>Eight days</p>",,,,,title,,,',
    ',,,,,,,,,"A second title",,,,,,Title,,,',
    '1969,7,16,9:32 AM,,,,,,Launch,"From ""Pad 39A""",https://youtu.be/abcdefghijk?t=1m30s,NASA,"A, quoted caption",,,Flight,#0b3d91,',
    "1969,7,20,20:17:40.5,,,,,,Landing,\"Two lines\r\nof text\",,,,,,Flight,https://a.b/bg.jpg,",
    "1969,7,16,,1969,7,24,,16–24 July,The mission,,,,,,,Mission,,",
    "1961,,,,1972,,,,,Project Apollo,,,,,,era,,,",
    "1969,7,21,25:00,,,,,,Bad clock,,,,,,,,,",
    "1969,7,21,13 PM,,,,,,Bad half,,,,,,,,,",
    ",,,,,,,,,,,,,,,,,,",
    "1969,7,24,12:00 p.m.,,,,,,Splashdown,,,,,,,,,",
  ].join("\n");

  it("reads the rows into TimelineJS's JSON: the title, the events, the eras", () => {
    const sheet = readTimelineSheet(csv);
    expect(sheet.data.title?.text?.headline).toBe("Apollo 11");
    expect(sheet.data.events?.map((event) => event.text?.headline)).toEqual(["Launch", "Landing", "The mission", "Bad clock", "Bad half", "Splashdown"]);
    expect(sheet.data.events?.[0]).toEqual({
      start_date: { year: "1969", month: "7", day: "16", hour: 9, minute: 32 },
      text: { headline: "Launch", text: 'From "Pad 39A"' },
      media: { url: "https://youtu.be/abcdefghijk?t=1m30s", credit: "NASA", caption: "A, quoted caption", thumbnail: "", alt: "" },
      group: "Flight",
      background: { color: "#0b3d91" },
    });
    expect(sheet.data.events?.[1]?.start_date).toEqual({ year: "1969", month: "7", day: "20", hour: 20, minute: 17, second: 40, millisecond: 500 });
    expect(sheet.data.events?.[1]?.background).toEqual({ url: "https://a.b/bg.jpg" });
    expect(sheet.data.events?.[2]?.display_date).toBe("16–24 July");
    expect(sheet.data.events?.[5]?.start_date).toEqual({ year: "1969", month: "7", day: "24", hour: 12, minute: 0 });
    expect(sheet.data.eras).toEqual([{ start_date: { year: "1961" }, end_date: { year: "1972" }, text: { headline: "Project Apollo", text: "" } }]);
    expect(sheet.warnings.map((warning) => warning.index)).toEqual([7, 8]);
  });

  it("goes straight to a timeline, with both lists of warnings", () => {
    const story = fromTimelineSheet(csv);
    expect(story.items[0]?.start).toBe(utc(1969, 7, 16, 9, 32));
    expect(story.items[0]?.data?.story.media?.caption).toBe("A, quoted caption");
    expect(story.decorations).toHaveLength(1);
    expect(story.warnings.map((warning) => warning.code)).toEqual(["out-of-range", "out-of-range", "background-image"]);
  });

  it("finds the columns by their headings, in any order and case", () => {
    const sheet = readTimelineSheet("headline,YEAR,  media   alt ,media\nHello,2001,A cat,https://a.b/cat.png\n");
    expect(sheet.data.events).toEqual([{ start_date: { year: "2001" }, text: { headline: "Hello", text: "" }, media: { url: "https://a.b/cat.png", credit: "", caption: "", thumbnail: "", alt: "A cat" } }]);
    expect(readTimelineSheet("").data).toEqual({ events: [], eras: [] });
    expect(readTimelineSheet("Headline\nNo year\n").data.events).toEqual([{ text: { headline: "No year", text: "" } }]);
  });

  it("parses RFC 4180 CSV", () => {
    expect(parseCsv('a,"b,c","d""e"\r\n"f\ng",,h')).toEqual([
      ["a", "b,c", 'd"e'],
      ["f\ng", "", "h"],
    ]);
    expect(parseCsv("a,b\n")).toEqual([["a", "b"]]);
    expect(parseCsv("a,\n")).toEqual([["a", ""]]);
    expect(parseCsv("")).toEqual([]);
  });

  it("finds a sheet's CSV from the address it is shared or published at", () => {
    expect(sheetCsvUrl("https://docs.google.com/spreadsheets/d/1AbC-d_E/edit#gid=42")).toBe("https://docs.google.com/spreadsheets/d/1AbC-d_E/export?format=csv&gid=42");
    expect(sheetCsvUrl("https://docs.google.com/spreadsheets/d/1AbC/edit?usp=sharing")).toBe("https://docs.google.com/spreadsheets/d/1AbC/export?format=csv");
    expect(sheetCsvUrl(" https://docs.google.com/spreadsheets/d/e/2PACX-1v/pubhtml?gid=7 ")).toBe("https://docs.google.com/spreadsheets/d/e/2PACX-1v/pub?output=csv&gid=7");
    expect(sheetCsvUrl("https://docs.google.com/spreadsheets/d/e/2PACX/pub?output=csv")).toBe("https://docs.google.com/spreadsheets/d/e/2PACX/pub?output=csv");
    expect(sheetCsvUrl("https://docs.google.com/document/d/1/edit")).toBeUndefined();
    expect(sheetCsvUrl("http://docs.google.com/spreadsheets/d/1/edit")).toBeUndefined();
    expect(sheetCsvUrl("https://example.com/spreadsheets/d/1/edit")).toBeUndefined();
    expect(sheetCsvUrl("not a url")).toBeUndefined();
  });

  it("keeps a gid only when it is a sheet's number, and adds nothing else to the address (S14)", () => {
    // `%26output%3Dhtml` decodes to `&output=html`: appended as it was, it would be a second parameter.
    expect(sheetCsvUrl("https://docs.google.com/spreadsheets/d/1AbC/edit?gid=1%26output%3Dhtml")).toBe("https://docs.google.com/spreadsheets/d/1AbC/export?format=csv");
    expect(sheetCsvUrl("https://docs.google.com/spreadsheets/d/e/2PACX/pubhtml?gid=7%23x")).toBe("https://docs.google.com/spreadsheets/d/e/2PACX/pub?output=csv");
    expect(sheetCsvUrl("https://docs.google.com/spreadsheets/d/1AbC/edit?gid=0")).toBe("https://docs.google.com/spreadsheets/d/1AbC/export?format=csv&gid=0");
  });
});

describe("storyMedia", () => {
  it.each([
    ["https://upload.wikimedia.org/x/Aldrin.JPG", "image", undefined, "upload.wikimedia.org"],
    ["images/aldrin.png?v=2", "image", undefined, ""],
    ["data:image/png;base64,AAAA", "image", undefined, ""],
    ["https://cdn.example.org/clip.webm", "video", undefined, "cdn.example.org"],
    ["https://cdn.example.org/speech.mp3", "audio", undefined, "cdn.example.org"],
    ["https://www.youtube.com/watch?v=abcdefghijk&t=90", "youtube", "https://www.youtube-nocookie.com/embed/abcdefghijk?start=90", "youtube.com"],
    ["https://youtu.be/abcdefghijk?t=1h2m3s", "youtube", "https://www.youtube-nocookie.com/embed/abcdefghijk?start=3723", "youtube.com"],
    ["https://m.youtube.com/shorts/abcdefghijk", "youtube", "https://www.youtube-nocookie.com/embed/abcdefghijk", "youtube.com"],
    ["https://www.youtube-nocookie.com/embed/abcdefghijk?start=5", "youtube", "https://www.youtube-nocookie.com/embed/abcdefghijk?start=5", "youtube.com"],
    ["https://www.youtube.com/watch?v=abcdefghijk&t=soon", "youtube", "https://www.youtube-nocookie.com/embed/abcdefghijk", "youtube.com"],
    ["https://www.youtube.com/watch?v=abcdefghijk&t=", "youtube", "https://www.youtube-nocookie.com/embed/abcdefghijk", "youtube.com"],
    ["https://www.youtube.com/channel/UCxyz", "link", undefined, "youtube.com"],
    ["https://vimeo.com/76979871", "vimeo", "https://player.vimeo.com/video/76979871?dnt=1", "vimeo.com"],
    ["https://vimeo.com/76979871/af12b3", "vimeo", "https://player.vimeo.com/video/76979871?dnt=1&h=af12b3", "vimeo.com"],
    ["https://player.vimeo.com/video/123", "vimeo", "https://player.vimeo.com/video/123?dnt=1", "vimeo.com"],
    ["https://vimeo.com/channels/staff", "link", undefined, "vimeo.com"],
    ["https://soundcloud.com/nasa/apollo-11", "soundcloud", "https://w.soundcloud.com/player/?url=https%3A%2F%2Fsoundcloud.com%2Fnasa%2Fapollo-11", "soundcloud.com"],
    ["https://soundcloud.com/nasa", "link", undefined, "soundcloud.com"],
    ["https://open.spotify.com/episode/4rOoJ6Egrf8K2IrywzwOMk", "spotify", "https://open.spotify.com/embed/episode/4rOoJ6Egrf8K2IrywzwOMk", "open.spotify.com"],
    ["https://open.spotify.com/user/x", "link", undefined, "open.spotify.com"],
    ["https://www.google.com/maps/embed?pb=!1m18", "map", "https://www.google.com/maps/embed?pb=!1m18", "google.com"],
    ["https://www.google.com/maps/place/Houston", "link", undefined, "google.com"],
    ["https://en.wikipedia.org/wiki/Apollo_11", "link", undefined, "en.wikipedia.org"],
  ])("%s is %s", (url, kind, embed, host) => {
    const media = storyMedia(url);
    expect(media?.kind).toBe(kind);
    expect(media?.embed).toBe(embed);
    expect(media?.host).toBe(host);
    expect(media?.url).toBe(url);
  });

  it("is nothing for an address that is not media", () => {
    expect(storyMedia("javascript:alert(1)")).toBeUndefined();
    expect(storyMedia("  ")).toBeUndefined();
    expect(storyMedia("https://[bad")).toBeUndefined();
    expect(storyMedia("ftp://a.b/c.png")).toBeUndefined();
  });
});

describe("storyDateText", () => {
  const en = { locale: "en-GB" };
  // ICU's spaces around a range's dash differ by version (thin, narrow no-break); the words do not.
  const say = (...args: Parameters<typeof storyDateText>) => storyDateText(...args).replace(/\s+/gu, " ");
  it("writes a date to its precision", () => {
    expect(say({ start: utc(1969), granularity: "year" }, en)).toBe("1969");
    expect(say({ start: utc(1969, 7), granularity: "month" }, en)).toBe("July 1969");
    expect(say({ start: utc(1969, 7, 20), granularity: "day" }, en)).toBe("20 July 1969");
    expect(say({ start: utc(1969, 7, 20, 20, 17), granularity: "minute" }, en)).toBe("20 July 1969 at 20:17");
    expect(say({ start: utc(1969, 7, 20, 20, 17, 40) }, { locale: "en-GB", timeZone: "Europe/Budapest" })).toBe("20 July 1969 at 21:17");
  });

  it("says a span by its ends, with the end's own unit", () => {
    expect(say({ start: utc(1914), end: utc(1918), granularity: "year" }, en)).toBe("1914 – 1918");
    expect(say({ start: utc(1969, 7, 16), end: utc(1969, 7, 24), granularity: "day" }, en)).toBe("16 – 24 July 1969");
    expect(say({ start: utc(1969, 7, 16), end: utc(1969, 7, 16), granularity: "day" }, en)).toBe("16 July 1969");
    // Without a granularity the end is not part of the span.
    expect(say({ start: utc(1969, 7, 16), end: utc(1969, 7, 17) }, { locale: "en-GB" })).toBe("16 July 1969, 00:00–23:59");
  });

  it("gives a year before 1 AD its era", () => {
    expect(say({ start: utc(-752), granularity: "year" }, en)).toBe("753 BC");
    expect(say({ start: utc(-26), end: utc(476), granularity: "year" }, en)).toBe("27 BC – 476 AD");
    expect(say({ start: utc(-3099), granularity: "millennium" }, en)).toBe("3100 BC");
  });
});
