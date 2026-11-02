# Showcase

Five timelines the way an app would use them, each live. The [home page](index.md) has a sixth, a chronicle restyled entirely from outside, with a story, a camera and an editable history; these are the other shapes a timeline takes. Open **The code** under any of them to read and edit it.

## A product launch of 313 tasks

::: example showcase-gantt

A product launch of 313 tasks in twelve streams, drawn as a Gantt chart: dependencies, baselines, progress and milestones from the [Gantt plugin](guides/gantt.md), the critical path and the reschedule from [the scheduler](guides/scheduling.md), the team's load from [the resource view](guides/resources.md). Every edit is a command, so Undo is exact. On a phone it turns vertical.

## A chronology across five thousand years

::: example showcase-chronology

One timeline from the unification of Egypt to the Moon landing, zoomable from five millennia down to the minutes of Apollo 11. The axis switches from millennia to minutes on the way, in BC and AD through `formatTick`; eras are [decorations](guides/items-and-lanes.md), and the eight days of Apollo 11 become one marker with a count while you look at the whole span ([clustering](guides/clustering.md)). The dates before 1500 are approximate or traditional.

## A live log of 100 000 entries

::: example showcase-log

A day of a made-up service's log: 100 000 entries in five lanes, and a new one about every second through `addItems` — no reload, and the layout repacks only the lane an entry lands in ([async and live data](guides/async-data.md)). Zoom out to the whole day: entries too close to tell apart cluster. The levels are filtered by the page, which hands the timeline what to draw.

## An editable roadmap, by keyboard

::: example showcase-roadmap

A product's year in four teams. Drag a bar to move it, across teams too, or drag its end; the tour beside it does the same with keys only, and ticks each step off by what the timeline reports. Every edit is one command whose `inverse` is the undo ([editing](guides/editing.md), [accessibility](guides/accessibility.md)). On a phone the roadmap turns vertical and the tour goes under it ([responsive](guides/responsive.md)).

## A story, slide by slide

::: example showcase-story

The race to the Moon in nineteen moments, written in TimelineJS's own JSON and loaded as it is (`fromTimelineJS`): a slide at a time above, the timeline under it, in a lane per country and three eras. Previous and Next — or ← and → — move the timeline to the slide; picking an event on the timeline opens its slide. Zoom in on July 1969 and the landing is at its minute ([storytelling](guides/storytelling.md), [migrating from TimelineJS](guides/migrating-from-timelinejs.md)).
