# Migrating from TimelineJS

A TimelineJS story moves over as it is: its JSON, or the Google Sheet it was written in. `fromTimelineJS` and `fromTimelineSheet` from `@temporeum/timeline-core/story` turn it into items, lanes and eras, every slide's content in its item's `data.story`, and `mountStory` from `@temporeum/timeline-element/story` tells it slide by slide beside the timeline ([storytelling](storytelling.md)). What does not carry over is listed in `warnings`, never dropped quietly.

::: example migration-timelinejs

## From the Google Sheet

Most TimelineJS stories are written in its Google Sheets template. Publish the sheet (File → Share → Publish to web → CSV), fetch the CSV and hand it over:

```js excerpt:example/migration-timelinejs
import { createTimeline } from "@temporeum/timeline-element";
import { mountStory } from "@temporeum/timeline-element/story";
import { fromTimelineSheet } from "@temporeum/timeline-core/story";

// TimelineJS's Google Sheets template, as File → Share → Publish to web → CSV gives it.
// A page would fetch it: `await (await fetch(sheetCsvUrl(address))).text()`.
// …
const story = fromTimelineSheet(csv);
const timeline = createTimeline(document.querySelector("#timeline"), {
  items: story.items,
  lanes: story.lanes,
  decorations: story.decorations,
  // …
});
mountStory(document.querySelector("#story"), timeline, { title: story.title, locale: "en-US" });
```

`sheetCsvUrl(address)` gives the CSV's address from the one you share or publish the sheet at (`…/edit#gid=0`, `…/pubhtml`). The columns are found by their headings, in any order: Year, Month, Day, Time, End Year, End Month, End Day, End Time, Display Date, Headline, Text, Media, Media Credit, Media Caption, Media Thumbnail, Media Alt, Type, Group, Background. A row of Type `title` is the title slide, `era` an era; a time is `13:05`, `1:05:30.250` or `1:05 PM`. `readTimelineSheet(csv)` stops halfway, at TimelineJS's JSON.

## From the JSON

```js excerpt:example/story
// TimelineJS's JSON: a title slide, events with a headline, HTML text and media, and groups.
const story = fromTimelineJS({
  title: { text: { headline: "A product's first year", text: "<p>From the first sketch to the launch.</p>" } },
  events: [
    // …
  ],
});
```

## What maps to what

| TimelineJS | Here |
|---|---|
| `events[]` | items, in `items`; the slide in `item.data.story` |
| `start_date`, `end_date` (`year`, `month`, `day`, `hour`, `minute`, `second`, `millisecond`) | `start`, `end`, and `granularity` from the precision given: a year alone covers its year. The end's unit is part of the span: 1914 to 1918 runs to the end of 1918. Two ends known to different units (1914 to 11 November 1918) make the finer one the item's, and the slide keeps each end's own in `story.precision`, so its date line says "1914 – 11 November 1918". Read in UTC, as TimelineJS reads them — or, with `fromTimelineJS(data, { timeZone })`, as the wall clock of the zone the timeline draws in: give the timeline's `timeZone`, and a year is drawn as that year there. |
| a negative `year` | the year before Christ TimelineJS writes on its slide: `-44` ("44 BCE" there) is the axis's 44 BC, `-500` its 500 BC. `0` is 1 BC. A `display_date` keeps the story's wording on the slide. |
| `display_date` (the slide's, or the dates') | the slide's date line; without one, the item's date to its precision |
| `text.headline`, `text.text` | the slide's headline and text, HTML kept as far as it is safe; the headline as plain text is the item's `label` |
| `media` (`url`, `caption`, `credit`, `thumbnail`, `alt`, `title`, `link`) | the slide's media, shown by its address ([media](storytelling.md#media)) |
| `group` | a lane per group, in the order they first appear; the events without one in a lane of their own, "Other" (`ungroupedLabel`); one lane when no event has a group, so `lanes` is always there to pass on |
| `unique_id` | the item's `id` (`slide-1`, `slide-2`, … without one); a taken id gets `-2` and a warning. With `hash`, the address names it: `#story-<id>`. |
| `eras[]` | `era` decorations, in `decorations` |
| `title` | `story.title`, the panel's `title` slide |
| `background.color` | the slide's coloured edge |
| `hash_bookmark` | `mountStory`'s `hash` |
| `start_at_slide`, `start_at_end` | `mountStory`'s `start` (an index, or an id) |
| `language` | `locale` for the dates, `strings` for the panel's words |
| `timenav_position`, `timenav_height` | where you put the two elements, and how tall: they are yours |

## What does not carry over

Each is a warning with a `code`, the list it is in, and the index:

- **`background-image`.** A slide's `background.url` is not drawn: the panel keeps its own colours, so the text stays readable. The colour is kept.
- **`cosmological`.** The scale of billions of years. The axis is the calendar's, within 275 000 years of now; an event outside it is `out-of-range` and left out.
- **`no-date`, `out-of-range`, `end-before-start`.** An event without a start year, or with one that is not a date, is left out; an end that is before the start, or not a date, makes the event an instant.
- **`duplicate-id`.** Two events with one `unique_id`: the second gets a suffix.
- **`media`.** Media the panel does not show as media: an address it cannot open (anything but http, https, or an image as `data:`) is left out, and a kind it does not embed — TimelineJS's cards for Wikipedia, X and other sites, a PDF, any page — is a link.

And without a warning, because they are not data: TimelineJS's `autolink` (links in the text are links as written) and its embed generator (your page reads the sheet).

## What else the timeline does

- **Thousands of events.** The timeline under the story clusters, windows and draws 10 000 items in well under a second ([benchmark](../benchmark.md)); a long story does not slow down.
- **Time down to the minute and back.** One zoom from millennia to minutes, with the axis in BC and AD ([the showcase's chronology](../showcase.md)).
- **The keyboard and the screen reader.** Both the panel and the timeline work without a pointer, and every change of slide is said ([accessibility](accessibility.md)).
- **No third party until it is asked for.** Players load when the reader asks; YouTube's without cookies.
- **Your stack.** The same timeline in React, Vue, Svelte and Angular ([frameworks](../frameworks.md)), on a phone vertical, and editable if you want it to be.
