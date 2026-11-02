# Recipe: a chronology

Three thousand years in three regions, with eras behind the events. It opens on antiquity; zoom out (`ctrl` + wheel, or `-`) for the whole range, in and the axis steps from centuries to decades to years, without a date library.

::: example recipe-chronology

## How it is made

- **Regions are lanes**, events are items; an event with an `end` is a span, one without is an instant.
- **Years before 1 and before 100.** Times are epoch milliseconds, which reach far enough either way. `Date.UTC(50, 0, 1)` means 1950, so the recipe sets the year explicitly:

```js excerpt:example/recipe-chronology
function year(y) {
  const date = new Date(0);
  date.setUTCFullYear(y, 0, 1);
  return date.getTime();
}
```

- **Known to the year.** `granularity: "year"` makes an instant cover its whole year, so two events in one year do not overlap, and the accessible name says the year rather than a midnight.
- **Eras** are decorations: named stretches behind the items, which never take part in the packing.
- **Limits** keep the view between 1500 BC and AD 2100, so a reader cannot get lost in an empty millennium.

## What to know

- **Labels give way.** A label is drawn where it fits — on the item, or after it until the next item in its row — and shortened where it does not: "Rome founded (traditional date)" shows as much as there is room for before "Classical Athens", which is shortened itself; zoom in and they read whole. Past a thousand items in a viewport's width only whole labels are drawn (`labelOverflow`). The full text stays in the item's tooltip and accessible name, and `timeline.result.labels.dropped` lists what is given up, with the reason.
- **The axis says BC and AD.** The engine's default writes astronomical years — `-0500` is 501 BC, `0000` is 1 BC — because a default that went through the platform's locale data would draw differently on two machines. `formatTick` writes any format; this one keeps the default below a year:

```js excerpt:example/recipe-chronology
const YEARS = new Set(["year", "decade", "century", "millennium"]);
function formatTick(tick, timeZone) {
  if (!YEARS.has(tick.granularity)) return defaultTickLabel(tick, timeZone);
  // A year label is the whole date: no context label at the start of the axis.
  if (tick.context) return "";
  const y = new Date(tick.time).getUTCFullYear();
  return y <= 0 ? `${String(1 - y)} BC` : `AD ${String(y)}`;
}
```
- `orientation: "vertical"` would run time down the page on the same code path; at this width a chronology reads better across.
