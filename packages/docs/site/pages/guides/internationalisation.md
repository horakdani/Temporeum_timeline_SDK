# Internationalisation

A timeline in another language is three things: the direction it reads in, the words it says, and the calendar its axis counts in. Each is one option of the element, and each works without the others.

```js excerpt:example/international
    locale,
    calendar,
    strings,
    direction: "rtl",
```

::: example international

## The plugin

```js excerpt:example/international
import { createTimeline, registerPlugin } from "@temporeum/timeline-element";
import { intlPlugin } from "@temporeum/timeline-element/intl";
import { toolsPlugin } from "@temporeum/timeline-element/tools";

// Other languages, directions and calendars are a plugin, and so are the
// tooltip and the zoom presets: registered once, before the first timeline.
registerPlugin(intlPlugin, toolsPlugin);
```

Other languages, directions and calendars are a plugin on their own entry point, `@temporeum/timeline-element/intl`, which imports the core's `@temporeum/timeline-core/intl`. Without it the timeline speaks English, reads left to right and counts on the Gregorian axis — the English words are the base's own, from the core's small `@temporeum/timeline-core/words`, and the Gantt chart, the resource view and the tools say them without this plugin. The plugin is what `strings`, `calendar`, `direction: "rtl"` and `direction: "auto"` need: `"auto"` asks for it up front, because it may turn out right to left when the page is drawn. Without it, a configuration with any of them throws a `TypeError` where the timeline is created, updated or rendered on a server — `The direction "auto" option needs the intl plugin: import { intlPlugin } from "@temporeum/timeline-element/intl" and call registerPlugin(intlPlugin) before the timeline draws` — and the instance is left as it was. `registerPlugin` is the page's: once is enough, and the `<script>`-tag build registers every plugin on load. The example registers the [time tools](time-tools.md) too, for its tooltip and zoom buttons.

## Right to left

`direction: "rtl"` mirrors the timeline. Horizontally, time flows from the right: the earliest item is rightmost, and a label sits on the left of its item. Vertically, time still runs down, and the lanes start at the right. Text is not mirrored — every label reads the right way, laid out right to left, and a label in a left-to-right script keeps its own order.

Everything you do follows the mirror:

- **A drag** pans the way your hand moves, as it does left to right; so does the trackpad's sideways scroll.
- **The arrow keys** point where they point on screen. Horizontally, ← goes to the next item, later in time, and → back; with `Alt` they move an item, with `Shift` its end. Vertically, ← and → go between lanes, the first of which is on the right.
- **The tools** — time bars, the overview strip, range selection, the zoom buttons, the tooltip and the group tree — are mirrored with the drawing, and their arrows follow the same rule.

`direction: "auto"` takes the element's own computed direction, so a page with `dir="rtl"` gets a right-to-left timeline. A server has no computed style and draws `"auto"` left to right; give it `"rtl"` when you know the page is, and the client takes the frame over unchanged. The element's attribute is `direction`.

An exported SVG and PNG are mirrored as the screen is. A PDF is too, but its built-in font covers Latin scripts only; Hebrew, Arabic and Persian text needs an embedded font, which the PDF writer does not do yet.

## Words

The library says few words of its own, but it says them: an accessible name ("Design, 2 Mar 2026 – 14 Mar 2026, Build"), a cluster's count ("23 items"), a Gantt task's links and slip ("after Design (finish-to-start); 2 d behind plan"), an overloaded resource, the zoom buttons, the overview strip, the label of a new item, the task grid's headers. Every one of them is a key of `DEFAULT_STRINGS`, and `strings` replaces any of them:

```js excerpt:example/international
    strings: { timeline: "خطة الربع", zoom: "تكبير", zoomDay: "يوم", zoomWeek: "أسبوع", zoomMonth: "شهر", zoomYear: "سنة", newItem: "عنصر جديد" },
```

A phrase names its values in braces — `"{count} items"`, `"{start} – {end}"` — and where a language changes its words with the number, a phrase is a set of plural forms chosen by `Intl.PluralRules` in your `locale`. Hebrew has a word for two:

```js excerpt:example/international
      cluster: { one: "פריט אחד", two: "שני פריטים", other: "{count} פריטים" } },
```

Dates and numbers are never in a phrase: they are written by `Intl` in `locale` — the dates of every name, the numbers in every phrase. Without `strings` the library says what it always said, in English, to the letter.

The task grid and the unscheduled tasks list are mounted on their own, so they take `strings` and `locale` themselves: `mountTaskGrid(container, timeline, { strings, locale, timeZone })` (from `/gantt`), `mountBacklog(container, timeline, { tasks, strings, locale })` (from `/resources`).

To find a word a translation missed, draw with `pseudoStrings()` from `@temporeum/timeline-core/intl`: every phrase comes out between ⟦ and ⟧, and any text that is neither marked, nor yours, nor a date is a word the dictionary did not reach. The library's own test does exactly that, in Japanese.

## Calendars

`calendar` takes any calendar `Intl` knows — `"hebrew"`, `"islamic-umalqura"`, `"persian"`, `"chinese"`, `"japanese"`, `"buddhist"`, `"indian"`, `"ethiopic"` and more. The axis then counts in it:

- **Months and years are the calendar's own.** A Hebrew month begins with the new moon, a Persian year at Nowruz, a Chinese year at the new year; a month tick is the first day of the calendar's month, and a year tick the first day of its year. A quarter is the calendar's own three months, whether its year has twelve or thirteen.
- **Longer steps fall on the calendar's own numbers**: a Hebrew decade starts in 5790, a Persian one in 1410. The Japanese calendar's years restart with each era, so its decades are the Gregorian ones.
- **Days and hours** are days and hours in every calendar; the first of the calendar's month is the major one.
- **Labels are `Intl`'s**, in `locale` and the calendar — the context label at the start of the axis too ("March 2026" over a view of days). `formatTick`, when you give one, still wins.

`"gregory"` keeps the Gregorian axis, labelled by `Intl` in your locale. Without `calendar` the axis is Gregorian, and its labels the library's own: the same on every machine, which is what a server-rendered frame needs. Hidden dates work with any calendar: a tick that falls in hidden time sits at the seam, as it always does.

## Without the element

The pieces are in `@temporeum/timeline-core/intl`, on their own entry point (4 kB): a timeline that is only ever shown in English, left to right, does not download them. The English dictionary — `DEFAULT_STRINGS`, `resolveStrings`, `sayIn`, `fill`, `formatAmount` — is also on `@temporeum/timeline-core/words` (2 kB), which `/intl` re-exports: the same objects, whichever you import.

- `mirrorScene(scene)` mirrors a frame; `attachInput(target, { direction: () => "rtl" })` in `/dom` mirrors what the pointer, the wheel and the arrows hand the input machine.
- `DEFAULT_STRINGS`, `resolveStrings`, `sayIn(strings, locale)` — the `say` that `ganttHooks`, `resourceHooks` and `withLoadLanes` take — and `describeHooks({ strings, locale })` for the names of items and clusters.
- `calendarTicks(calendar)` is a `ticks` source for `renderTimeline`; `calendarTickLabel(locale, calendar)` is a `formatTick`.
