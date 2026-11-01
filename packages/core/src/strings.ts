/**
 * The English words of the entry points that speak, one record each.
 *
 * Here rather than in `src/gantt/` and `src/resources/`: the dictionary in
 * `/intl` gathers them, and one entry point never ships another's own code.
 * The entry points themselves carry only the types: without a dictionary
 * they say the same English from their own code, and the `/intl` tests hold
 * the two to the same words.
 */

import type { Phrase } from "./text.js";

/**
 * What the Gantt hooks say, in English: every phrase of a task's accessible
 * name — the words the hooks say without a dictionary, here as the
 * dictionary's. A host replaces any of them in `DEFAULT_STRINGS` (`/intl`),
 * whose `sayIn` the hooks take as `say`. Values in braces are filled in;
 * numbers are the locale's.
 */
export const GANTT_STRINGS = {
  /** The four dependency types, by their abbreviation. */
  FS: "finish-to-start",
  SS: "start-to-start",
  FF: "finish-to-finish",
  SF: "start-to-finish",
  /** A link: "Design (finish-to-start)". */
  dependency: "{name} ({type})",
  dependencyLag: "{name} ({type}, lag {amount})",
  dependencyLead: "{name} ({type}, lead {amount})",
  /** A lag of whole or part days, and one under a day. */
  days: "{count} d",
  hours: "{count} h",
  predecessors: "after {list}",
  successors: "before {list}",
  onPlan: "on plan",
  behindPlan: "{count} d behind plan",
  aheadOfPlan: "{count} d ahead of plan",
  milestone: "milestone",
  progress: "{percent}% done",
  /** Between the parts of a name, and between the links of one list. */
  listSeparator: ", ",
  /** Between the predecessors and the successors. */
  groupSeparator: "; ",
} as const satisfies Readonly<Record<string, Phrase>>;

/** The Gantt hooks' words: {@link GANTT_STRINGS}, or a host's. */
export type GanttStrings = { readonly [K in keyof typeof GANTT_STRINGS]: Phrase };

/**
 * What the resource view says, in English: the words its hooks and load lanes
 * say without a dictionary. A host replaces any of them in `DEFAULT_STRINGS`
 * (`/intl`), whose `sayIn` the hooks take as `say`.
 */
export const RESOURCE_STRINGS = {
  /** A load lane's name. */
  loadLane: "{lane} load",
  overbooked: "overbooked, {percent}% of capacity",
  overbookedNoCapacity: "overbooked, no capacity",
  listSeparator: ", ",
} as const satisfies Readonly<Record<string, Phrase>>;

/** The resource view's words: {@link RESOURCE_STRINGS}, or a host's. */
export type ResourceStrings = { readonly [K in keyof typeof RESOURCE_STRINGS]: Phrase };

/**
 * What the week and day views say, in English: the names of the view and of
 * its events (`calendarScene` of `/calendar`), and the element's buttons. A
 * host replaces any of them in `DEFAULT_STRINGS` (`/intl`), or gives the
 * view `strings`.
 */
export const CALENDAR_STRINGS = {
  /** The view's accessible name: a week, and a day. */
  weekView: "Week of {date}",
  dayView: "{date}",
  /** The all-day row. */
  allDay: "All day",
  /** An event's accessible name: its title and its time. */
  event: "{name}, {range}",
  allDayEvent: "{name}, all day, {range}",
  /** An event without a title. */
  untitled: "Untitled event",
  /** The element's period buttons. */
  previousPeriod: "Previous",
  nextPeriod: "Next",
  today: "Today",
} as const satisfies Readonly<Record<string, Phrase>>;

/** The calendar views' words: {@link CALENDAR_STRINGS}, or a host's. */
export type CalendarStrings = { readonly [K in keyof typeof CALENDAR_STRINGS]: Phrase };
