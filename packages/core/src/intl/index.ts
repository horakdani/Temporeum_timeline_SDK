/**
 * `@temporeum/timeline-core/intl` — the timeline in other languages,
 * directions and calendars.
 *
 * - **Right to left**: {@link mirrorScene} mirrors a frame, its text still
 *   readable; the input half is `attachInput`'s `direction` in `/dom`.
 * - **Words**: {@link DEFAULT_STRINGS} is every word the library says, and
 *   {@link describeHooks} names items and clusters in a dictionary's words.
 *   {@link pseudoStrings} marks every phrase, to find one a translation missed.
 * - **Calendars**: {@link calendarTicks} puts the axis's months and years
 *   where a calendar's own begin; {@link calendarTickLabel} writes ticks in
 *   a locale, from `Intl`.
 *
 * Its own entry point: the base timeline's 31 kB budget does not pay for
 * languages it is not shown in.
 */
export { describeHooks } from "./describe.js";
export type { DescribeOptions } from "./describe.js";
export { MIRROR_CLASS, mirrorCss, mirrorScene, mirrorTextNodes } from "./mirror.js";
export type { Direction, MirrorOptions } from "./mirror.js";
export { DEFAULT_STRINGS, PSEUDO_CLOSE, PSEUDO_OPEN, pseudoStrings, resolveStrings, sayIn } from "./strings.js";
export type { Strings } from "./strings.js";
export { calendarFields, calendarTickLabel, calendarTicks } from "./calendars.js";
export type { CalendarFields, CalendarTickOptions } from "./calendars.js";
export { fill, formatAmount } from "../text.js";
export type { AmountOptions } from "../text.js";
export type { Phrase } from "../text.js";
