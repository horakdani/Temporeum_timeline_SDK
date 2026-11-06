# Storytelling

A story told one slide at a time — a picture or a player, a date, a headline and a few paragraphs — with the timeline under it showing where in time each slide is. Going to a slide moves the timeline to it; picking an event on the timeline opens its slide. It is the shape [TimelineJS](https://timeline.knightlab.com/) made familiar, and its stories load as they are ([migrating from TimelineJS](migrating-from-timelinejs.md)).

::: example story

## The panel

`mountStory(container, timeline, options)` from `@temporeum/timeline-element/story` puts the panel in an element of yours, which you place where the story should be — above the timeline here, beside it on a wide page. It is not a plugin: the timeline needs nothing registered, and a page that tells no story downloads none of it.

```js excerpt:example/story
import { createTimeline } from "@temporeum/timeline-element";
import { mountStory } from "@temporeum/timeline-element/story";
import { fromTimelineJS } from "@temporeum/timeline-core/story";
// …
const log = document.querySelector("#log");
const tale = mountStory(document.querySelector("#story"), timeline, {
  title: story.title,
  hash: true,
  headingLevel: 3,
  locale: "en-GB",
});
tale.on("slideChanged", ({ index, id, source }) => {
  log.textContent = `Slide ${String(index)}: ${id ?? "the title"}, moved by the ${source}.`;
});
```

The slides are the items', in time order: each item's `data.story`, which is what `fromTimelineJS` writes, or what your own `slide(item)` returns — `undefined` leaves an item out of the story. Background items are never slides.

| Option | What it does |
|---|---|
| `title` | A title slide, first. On it the timeline shows the whole story. |
| `slide(item)` | The item's slide; `item.data.story` by default, with the label as its headline. |
| `headingLevel` | The headline's level, 2 to 6, so the slide fits the page's outline. 2 by default. |
| `hash` | The address names the slide (`#story-launch`), so a link opens on it, and the panel follows the address when it changes. `true` for the `story-` prefix, or a prefix of your own. |
| `media` | `"click"` (default): a provider's player loads when the reader asks for it. `"eager"`: with the slide. |
| `reveal` | Move the timeline to the slide's item. On by default: an instant is scrolled to the middle, a span longer than the view is zoomed to. |
| `start` | The slide to open on, by id or index; the address's comes first with `hash`. |
| `formatDate`, `locale`, `timeZone` | The date line of a slide that does not say its own. By default the item's date to its precision: "1969", "July 1969", "20 July 1969 at 20:17"; a span by its ends, "16 – 24 July 1969", each to its own precision when the story gave them to different ones ("1914 – 11 November 1918"); a year before 1 AD with its era. |
| `strings`, `theme` | The panel's words (`STORY_STRINGS`) and colours. |

The handle it returns has `go(idOrIndex)`, `next()` and `previous()` (`false` when there is no such slide), `index`, `id`, `count`, `update(options)`, `on("slideChanged", handler)` and `destroy()`. `update` changes the options it is given — the words, the theme, the title slide, `slide`, `hash` — keeps the rest, and stays on the slide shown while it is still one. `slideChanged` comes after every change of slide, the opening one too: its index, the item's id (`null` on the title), the slide, and who moved — `panel`, `timeline` or `hash`. The timeline keeps doing everything it does: zoom, pan, clustering, live data. When items change, the panel reorders and stays on its slide.

## A slide

```text
interface StorySlide {
  headline?: string;   // HTML, inline: <i>The Eagle</i> has landed
  text?: string;       // HTML: paragraphs, lists, quotes, links, emphasis
  date?: string;       // the date as the story says it: "Summer 1969"
  media?: { url: string; caption?: string; credit?: string; alt?: string; title?: string; thumbnail?: string; link?: string };
  background?: string; // a CSS colour, drawn as the slide's edge
}
```

**HTML is kept, nothing that runs is.** The text, the headline, the caption and the credit may be HTML, as TimelineJS's are. The panel parses it in an inert template and builds its own nodes from it: text, emphasis, paragraphs, lists, quotes, abbreviations, times and links (`http`, `https` and `mailto`, opened in a new tab). Every attribute but a link's address is dropped; scripts, styles, frames, forms and images inside the text are dropped with their content. Nothing of the source is ever assigned to `innerHTML` in the page.

**The background is an edge, not a fill.** A slide's colour is drawn as a band along its side: the text keeps the panel's own colours, so its contrast does not depend on a colour chosen for a picture.

## Media

`storyMedia(url)` from `@temporeum/timeline-core/story` sorts a link by its address — nothing is fetched — and the panel shows it accordingly:

| The address | Shown as |
|---|---|
| an image (`.jpg`, `.png`, `.webp`, `.svg`, …, or a `data:image`) | the image, lazily loaded, with `alt` as its text alternative and `link` around it |
| a video or a sound file (`.mp4`, `.webm`, `.mp3`, `.ogg`, …) | the browser's own player |
| YouTube, Vimeo, SoundCloud, Spotify, a Google Maps embed | the provider's player: YouTube's without cookies (`youtube-nocookie.com`), Vimeo's without tracking (`dnt=1`), a start time kept |
| anything else (a Wikipedia article, a post) | a link, named by `title` or by its host |

**A player loads when it is asked for.** Until then the slide shows a button that names the provider and the host it loads from ("Load the YouTube player — it is loaded from youtube.com when you ask for it"), over the `thumbnail` if there is one. A story with forty videos does not open forty connections on its first slide, and the reader decides when a third party is contacted. `media: "eager"` loads the player with the slide. The player's frame is sandboxed: it runs, goes full screen and opens its own links in a new tab, but cannot navigate your page or open dialogs over it.

## The keyboard and the screen reader

Previous and Next are buttons. ← and → page through the slides wherever the focus is in the panel, and Home and End go to the first and the last — except inside a player or a field, which keep their arrows. When a button can go no further, the focus moves to the other one rather than being lost.

The panel is a named region, each slide a group named by its position ("3 of 12"). A change of slide is said once, politely: "Slide 3 of 12: Launch, 16 July 1969". On the timeline the keyboard works as everywhere: the arrows walk the items, and the item they land on opens its slide.

## What it does not do yet

- **Writing without code.** TimelineJS has a page that turns a Google Sheet into an embed code; here the sheet is read by your page ([migrating from TimelineJS](migrating-from-timelinejs.md)).
- **Background images.** A slide's `background.url` is not drawn (see above); its colour is.
- **Wikipedia and social posts as cards.** TimelineJS fetches a summary for some providers; here they are links.
- **Billions of years.** The axis is the calendar's, within 275 000 years of now; TimelineJS's cosmological scale does not carry over.
