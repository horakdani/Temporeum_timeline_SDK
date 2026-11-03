# Time tools

The time tools are the parts of a timeline that are about time itself rather than about the items: stretches the axis leaves out, lines the reader can move, a strip that shows the whole, a range the reader picks, and data that changes while it is on screen. Each is one option of `createTimeline`, and each works with a pointer, a finger and the keyboard alike.

```js excerpt:example/time-tools
  // Working hours only: nights and weekends take no room on the axis.
  hiddenDates: [
    { start: at(0, 17), end: at(1, 8), repeat: "daily" },
    { start: at(-2), end: at(0, 8), repeat: "weekly" },
  ],
```

::: example time-tools

## The plugin

```js excerpt:example/time-tools
import { createTimeline, registerPlugin } from "@temporeum/timeline-element";
import { toolsPlugin } from "@temporeum/timeline-element/tools";

// The time tools are a plugin: registered once, before the first timeline.
registerPlugin(toolsPlugin);
```

The time tools are a plugin on their own entry point, `@temporeum/timeline-element/tools`, which imports the core's `@temporeum/timeline-core/tools`: a page that uses none of them does not download them. The plugin is what `hiddenDates` and `timeBars` (when not empty), `rolling`, `zoomPresets`, `minimap`, `rangeSelect`, `laneHeaders` and `tooltip` (when not `false`) need; without it, a configuration with any of them throws a `TypeError` where the timeline is created, updated or rendered on a server — `The tooltip option needs the tools plugin: import { toolsPlugin } from "@temporeum/timeline-element/tools" and call registerPlugin(toolsPlugin) before the timeline draws` — and the instance is left as it was. Live data is not a tool: `addItems` and its kin need no plugin. `registerPlugin` is the page's, so once is enough for every timeline on it, and the `<script>`-tag build registers every plugin on load.

## Hidden dates

`hiddenDates` takes ranges the axis does not draw. A range is `{ start, end }`; with `repeat` — `"daily"`, `"weekly"`, `"monthly"`, `"yearly"` — it is the first occurrence of a pattern that repeats both ways without end, on the calendar of `timeZone`: a nightly `17:00–08:00` stays `17:00–08:00` local time across a change of daylight saving.

- **Hidden time takes no room.** The axis runs in *shown* time: a night is a seam, not a gap. An item across a hidden stretch is drawn without it.
- **Pans and zooms are in shown time too.** A pan of the whole view moves it by one view of working time, and a zoom holds the instant under the pointer across a seam, exactly as it does anywhere else.
- **A tick on a seam names what follows it.** The ticks a stretch swallows become one, at the seam — with nights hidden, a day's label sits where its morning begins.
- **What a host computes, it computes in real time.** Items, events and `domain` stay instants; the core takes hidden dates as a `TimeWarp`, two functions between real and shown time, which `createHiddenDates` in `@temporeum/timeline-core/tools` builds.

With hidden dates a frame is drawn exactly — the scene space, which assumes linear time, is not used.

## Time bars

```js excerpt:example/time-tools
  // A line of the host's own, which the reader can move.
  timeBars: [{ id: "cutoff", time: at(3, 12), label: "Cut-off" }],
  timeBarOptions: { snapMs: hour },
```

A time bar is a line of the host's across every lane — a cut-off, a what-if "now". Each is a slider: drag it, or `Tab` to its grip and press an arrow along the axis to move it a step, `PageUp` and `PageDown` for ten, `Home` and `End` for the view's ends. Either way it lands on `snapMs`, the instance keeps it there (`timeline.timeBars`), and it says so once:

```js excerpt:example/time-tools
timeline.on("timeBarMoved", ({ time }) => {
  log.textContent = `Cut-off moved to ${format.format(time)}.`;
});
```

`movable: false` draws a bar that cannot be moved. A key's step is `timeBarOptions.stepMs`, a hundredth of the view by default.

## Selecting a range

`rangeSelect` turns a drag along the axis band into a selection of time instead of a pan. From the keyboard, with the timeline focused, `r` starts a range at the middle of the view, an arrow along the axis moves its end a `stepMs`, `Enter` selects it and `Escape` lets it go. Both end on the same grid and give the same event:

```js excerpt:example/time-tools
timeline.on("rangeSelected", ({ start, end }) => {
  log.textContent = `Selected ${format.format(start)} – ${format.format(end)}.`;
});
```

## The overview strip, zoom presets and lane headers

- **`minimap: true`** draws the whole extent — the items and the view — in a strip along the far edge, with the view as a window on it. Drag the window, press beside it to go there, or `Tab` to it and press an arrow: each is a pan of the view by what the distance stands for. The strip is part of the drawing, so the server draws it too.
- **`zoomPresets: true`** adds buttons for a day, a week, a month and a year around the middle of the view; an array of `{ id, label, unit, count }` names your own, and `timeline.zoomToPreset(id)` is the same zoom from code.
- **`laneHeaders: true`** holds each lane's name at the start of the view, and at the top of what is left of a lane scrolled half out of sight.

## Tooltips

`tooltip: true` shows an item's label and dates — or what a function of the item returns — when a mouse rests on it, when the keyboard's focus is on it, and on a long press. It meets WCAG 1.4.13: the pointer can move onto it without it going, it stays until the pointer or the focus leaves, and `Escape` dismisses it without moving either.

## Following the clock

`rolling: true` keeps the view's span and keeps now in its middle — `rolling: { offset: 0.8 }` four fifths of the way along — and reads the clock every second (`intervalMs`). When the reader pans or zooms, the view stops following; `timeline.follow()` picks it up again.

## Live data

```js excerpt:example/time-tools
  timeline.addItems([{ id: `delivery-${String(deliveries)}`, label: `Delivery ${String(deliveries)}`, start, end: start + 5 * hour, laneId: "dock" }]);
```

`addItems`, `updateItems` (by id; `undefined` takes a field away), `removeItems` and `changeItems` (one batch of all three) change the items without reloading them. They need no plugin: the element takes them from the core's small `@temporeum/timeline-core/live` entry point (`applyItemChanges`, `relayout` — the same functions `/tools` exports). Only the lanes a change touches are packed again; the others keep their rows and only move across if a lane before them grew — and the frame is the one `setItems` with the whole array would draw. An add with an id already there, or an update of one that is not, throws. With a fetched source the items are the source's, and these throw too.
