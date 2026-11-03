/**
 * `@temporeum/timeline-core/calendar` — the calendar: recurring events, the
 * week and the day, iCalendar in and out.
 *
 * - {@link parseRRule}, {@link occurrences}: RFC 5545 recurrence rules in the
 *   library's own code, with time zones and daylight saving.
 * - {@link expandEvents}, {@link recurringSource}: events as a timeline's
 *   items, expanded only as far as the view goes.
 * - {@link parseICal}, {@link formatICal}: iCalendar text, both ways.
 * - {@link layoutDays}, {@link calendarScene}, {@link calendarKeyStep},
 *   {@link calendarHit}: the week and day views, side by side where events
 *   overlap, walked from the keyboard.
 *
 * Pure functions, Node or browser; nothing is saved and nothing is fetched.
 * The element mounts the views (`mountCalendarView`).
 */
export { formatRRule, instantOf, occurrences, parseDateValue, parseRRule, wallOf, WEEKDAYS } from "./rrule.js";
export type { Frequency, OccurrenceRange, Recurrence, RecurrenceRule, WallTime, Weekday, WeekdayNum } from "./rrule.js";
export { expandEvents, occurrenceId, recurringSource, utcStamp } from "./events.js";
export type { CalendarEvent, ExpandOptions, OccurrenceData } from "./events.js";
export { formatICal, parseICal } from "./ical.js";
export type { ICalCalendar, ICalFormatOptions, ICalParseOptions } from "./ical.js";
export { calendarDays, calendarGeometry, calendarHit, calendarKeyStep, calendarTimeAt, dayStartOf, layoutDays, resolveCalendarKey, weekStartOf } from "./view.js";
export type {
  AllDaySegment,
  CalendarDay,
  CalendarGeometry,
  CalendarKey,
  CalendarKeyAction,
  CalendarMetrics,
  CalendarRect,
  DaySegment,
  DaysLayout,
  DaysOptions,
} from "./view.js";
export { calendarCss, calendarDomId, calendarScene } from "./scene.js";
export type { CalendarSceneOptions } from "./scene.js";
export { CALENDAR_STRINGS } from "../strings.js";
export type { CalendarStrings } from "../strings.js";
