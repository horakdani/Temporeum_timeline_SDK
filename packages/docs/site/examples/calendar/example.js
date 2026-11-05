import { createTimeline } from "@temporeum/timeline-element";
import { mountCalendarView } from "@temporeum/timeline-element/calendar";
import { formatICal, parseICal, recurringSource } from "@temporeum/timeline-core/calendar";

// A calendar file, as Google or Outlook would export it: a weekday stand-up
// in Budapest time — one day off, one moved — a monthly review on the
// last Friday of the month, and a two-day trip.
const file = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "X-WR-CALNAME:Team",
  "X-WR-TIMEZONE:Europe/Budapest",
  "BEGIN:VEVENT",
  "UID:standup@example.com",
  "DTSTART;TZID=Europe/Budapest:20261019T093000",
  "DTEND;TZID=Europe/Budapest:20261019T094500",
  "RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",
  "EXDATE;TZID=Europe/Budapest:20261023T093000",
  "SUMMARY:Stand-up",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:standup@example.com",
  "RECURRENCE-ID;TZID=Europe/Budapest:20261028T093000",
  "DTSTART;TZID=Europe/Budapest:20261028T110000",
  "DTEND;TZID=Europe/Budapest:20261028T113000",
  "SUMMARY:Stand-up (moved)",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:review@example.com",
  "DTSTART;TZID=Europe/Budapest:20261030T100000",
  "DTEND;TZID=Europe/Budapest:20261030T120000",
  "RRULE:FREQ=MONTHLY;BYDAY=-1FR",
  "SUMMARY:Monthly review",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:planning@example.com",
  "DTSTART;TZID=Europe/Budapest:20261028T100000",
  "DTEND;TZID=Europe/Budapest:20261028T113000",
  "SUMMARY:Planning",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:trip@example.com",
  "DTSTART;VALUE=DATE:20261029",
  "DTEND;VALUE=DATE:20261031",
  "SUMMARY:Trip to Vienna",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

const { events, name } = parseICal(file);
const log = document.querySelector("#log");

// The week: overlapping events side by side, the arrows walk them, Enter
// or a click chooses one.
const week = mountCalendarView(document.querySelector("#week"), {
  events,
  date: Date.UTC(2026, 9, 28),
  timeZone: "Europe/Budapest",
  dayStartHour: 8,
  dayEndHour: 18,
  height: 420,
});
week.on("itemSelect", ({ item, via }) => {
  log.textContent = `${item.label} (${via})`;
});

// The same events on a timeline: a rule that repeats forever is expanded
// only as far as the view goes.
createTimeline(document.querySelector("#timeline"), {
  items: recurringSource(events),
  domain: [Date.UTC(2026, 9, 19), Date.UTC(2026, 10, 9)],
  timeZone: "Europe/Budapest",
});

// And back to a file: the same events, the zone's rules included.
document.querySelector("#export").addEventListener("click", () => {
  document.querySelector("#ics").textContent = formatICal(events, { name });
});
document.querySelector("#ics").textContent = formatICal(events, { name }).split("\r\n").slice(0, 12).join("\n");
