/**
 * `@temporeum/timeline-element/calendar` — the week and day views, mounted.
 *
 * Its own entry point, as in the core: the views import the core's
 * `/calendar` (RRULE, iCal, the days' layout), and a page that shows only a
 * timeline does not download any of it. The `<script>`-tag build carries it
 * with everything else.
 */
export { calendarViewCss, mountCalendarView } from "./calendar-view.js";
export type { CalendarRangePayload, CalendarSelectPayload, CalendarView, CalendarViewEventMap, CalendarViewOptions } from "./calendar-view.js";
