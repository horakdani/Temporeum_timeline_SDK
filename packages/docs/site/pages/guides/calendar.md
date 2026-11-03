# Calendar

Recurring events, a week and a day view, and iCalendar files in and out. All of it is on its own entry point, `@temporeum/timeline-core/calendar` — a timeline that never shows a calendar does not download it — and the week and day views are the element's `@temporeum/timeline-element/calendar`.

::: example calendar

## Reading a calendar file

`parseICal(text)` reads the `VEVENT`s of an iCalendar file into events: a start, an end, a title, a rule, the dates the rule leaves out (`EXDATE`) and adds (`RDATE`), and the occurrences a file moves (`RECURRENCE-ID`). The library never reads the file itself — you hand it the text — and nothing is saved.

```js excerpt:example/calendar
const { events, name } = parseICal(file);
```

Times are read the way the file writes them:

- **A time with a `TZID`** is a time in that zone. A `TZID` that is not an IANA name — Outlook writes `Eastern Standard Time`, some tools a vendor prefix — is found by its last `Area/City` part, by the file's `X-LIC-LOCATION`, or by the file's own `VTIMEZONE` rules, matched against the zones the platform knows. Only a zone none of these finds is read as UTC, and `warnings` says so.
- **A date** (`VALUE=DATE`) is an all-day event, and a **floating time** (no zone) is read in the `timeZone` you give, else the file's `X-WR-TIMEZONE`, else UTC.
- **A cancelled occurrence** (`STATUS:CANCELLED` with a `RECURRENCE-ID`) leaves its series as an `EXDATE`.

`formatICal(events)` writes them back: CRLF line ends, lines folded at 75 octets without splitting a character, text escaped, and a `VTIMEZONE` for every zone used, with that zone's real changes over the years the events reach. Read a file and write it, and you get the same events — the library's tests do that with files in the shapes Google, Outlook and Apple write, and with hundreds of generated calendars.

```js excerpt:example/calendar
  document.querySelector("#ics").textContent = formatICal(events, { name });
```

## Recurrence

The rules are RFC 5545's, in the library's own code — `FREQ` from `YEARLY` to `SECONDLY`, `INTERVAL`, `COUNT`, `UNTIL` and every `BY` part, `WKST` and `BYSETPOS`. `occurrences({ start, timeZone, rule }, { from, to })` gives the starts in a range; `parseRRule` and `formatRRule` read and write a rule's text.

A rule is read on the wall clock of its zone, as a calendar is: a meeting at 9:30 is at 9:30 after the clocks change. A time the clocks skip is read with the offset before the gap (2:30 on the spring-forward night is 3:30), and a time that happens twice is the first of the two — both as the RFC says. Every example of the RFC, and several hundred vectors generated with an independent implementation (python-dateutil, across clock changes in nine zones), give exactly the same instants.

The start is always the first occurrence, and a rule with neither `COUNT` nor `UNTIL` repeats forever — so asking for its occurrences needs a range end or a `limit`.

## On a timeline

`expandEvents(events, from, to)` turns events into items, one per occurrence: an occurrence's id is its event's and its start (`standup@example.com@20261019T073000Z`), and it keeps its event's length — the same elapsed time, or, all day, the same number of days. `recurringSource(events)` is that as a timeline's `items`, so the timeline asks for the window it draws and a rule that repeats forever is expanded only as far as the view goes:

```js excerpt:example/calendar
createTimeline(document.querySelector("#timeline"), {
  items: recurringSource(events),
// …
});
```

A file is untrusted input, and a rule can repeat every second: both take `limit`, at most that many occurrences of one event in the window (10 000 by default; the rest are left out), and `onLimit(eventId, limit)`, called when an event had more. A `VTIMEZONE` rule that repeats more often than daily is ignored, with a warning in `warnings`.

## The week and the day

`mountCalendarView(container, options)` shows a week (or, with `view: "day"`, a day): a column per day, the hours down it, the all-day events in a band across the top.

```js excerpt:example/calendar
const week = mountCalendarView(document.querySelector("#week"), {
  events,
  date: Date.UTC(2026, 9, 28),
  timeZone: "Europe/Budapest",
  dayStartHour: 8,
  dayEndHour: 18,
  height: 420,
});
```

- **Events that overlap go side by side.** Each goes into the first column free where it starts and reaches over the columns nothing it overlaps is in. No event covers another: an event is drawn at least 15 minutes tall (`minDurationMs`), and that is what overlap is measured on.
- **The hours are the wall clock's**, on the days the clocks change too, so nine o'clock is on one line across the week.
- **The keyboard reaches every event.** The view is one focus stop, a listbox: ↓ and ↑ walk the events in reading order — a day's all-day events, then its events from the top — across the days; → and ← go to the nearest event of the next and the previous day that has one; `Home` and `End` to the first and last of the day, with `Ctrl` of the week. `Enter` or `Space` chooses the event, the same as a click, and the view says `select`.
- **The period** pages with the toolbar's buttons, with `PageDown` and `PageUp`, and `t` goes to today; the view says `rangeChange`, and the toolbar's range is read out.
- **Right to left** (`direction: "rtl"`), the first day is on the right and the arrows move the way they point. Every word is a key of `DEFAULT_STRINGS` (`weekView`, `allDay`, `event`, `previousPeriod`…), and `strings` and `locale` work as for the timeline.

```js excerpt:example/calendar
week.on("select", ({ item, via }) => {
  log.textContent = `${item.label} (${via})`;
});
```

Without the element, the parts are pure functions on `/calendar`: `layoutDays` places the items, `calendarScene` draws them as a scene (so a server and the export draw them too), `resolveCalendarKey` and `calendarKeyStep` say what a key does, `calendarHit` what a click is on.

## Calendar or calendar system

Two things share a word. The timeline's `calendar` option (see [internationalisation](internationalisation.md); it needs `intlPlugin`) is a calendar *system* — `"hebrew"`, `"persian"` — that the axis counts in. Everything on this page is a calendar of *events*. The view takes no `calendar` option; its weeks are Gregorian weeks, and its dates are written by `Intl` in your `locale`.
