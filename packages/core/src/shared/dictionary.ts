/**
 * The library's words in English, and the filler that writes them — the
 * shared module behind `@temporeum/timeline-core/words` and `/intl`.
 *
 * The dictionary: every word the library says, in one replaceable record.
 * The English defaults are the words each part of the library has always
 * said. The Gantt hooks', the resource view's and the calendar views' are
 * their entry points' own records (`GANTT_STRINGS`, `RESOURCE_STRINGS`,
 * `CALENDAR_STRINGS`); the rest are here. A host translates one object, and
 * every key the library speaks is a key of it.
 *
 * A phrase is a template (`"{count} items"`) or a set of plural forms
 * (`{ one: "{count} item", other: "{count} items" }`); see `fill`. Dates and
 * numbers are never in a phrase: they are the locale's, from `Intl`.
 *
 * In `src/shared/` since P32: outside both entry points' own directories, so that neither
 * carries the other's own code (G-TREESHAKE): `/words` re-exports it, and so
 * does `/intl`, which adds what another language, direction or calendar
 * needs.
 */

import { CALENDAR_STRINGS, GANTT_STRINGS, RESOURCE_STRINGS } from "../strings.js";
import { fill } from "../text.js";
import type { Phrase } from "../text.js";

export { fill, formatAmount } from "../text.js";
export type { AmountOptions, Phrase } from "../text.js";

/** The core's, the tools' and the element's own words. */
const OWN_STRINGS = {
  /** The timeline's accessible name, when the host gives none. */
  timeline: "Timeline",
  /** A cluster marker's accessible name begins with its count. */
  cluster: "{count} items",
  /** A date range, and an open one. */
  range: "{start} – {end}",
  openRange: "{start} –",
  listSeparator: ", ",
  /** The label of an item added from the keyboard, a gesture or a drop. */
  newItem: "New item",
  /** The close button of a detail surface. */
  close: "Close",
  /** The zoom presets and their toolbar. */
  zoom: "Zoom",
  zoomDay: "Day",
  zoomWeek: "Week",
  zoomMonth: "Month",
  zoomYear: "Year",
  /** A time bar without a label of its own. */
  timeBar: "Time bar",
  /** The overview strip's window. */
  overview: "Overview",
  /** Said when a range selection starts from the keyboard. */
  rangeHelp: "Range: arrows move its end, Enter selects, Escape cancels",
  /** The group tree. */
  groups: "Groups",
  /** The task grid, and its default columns. */
  tasks: "Tasks",
  taskColumn: "Task",
  startColumn: "Start",
  endColumn: "End",
  progressColumn: "%",
  /** The unscheduled tasks list. */
  backlog: "Unscheduled tasks",
  backlogEmpty: "Nothing left to schedule",
  backlogTask: "{name}, {length}",
  durationDays: "{count} d",
  durationHours: "{count} h",
  durationMinutes: "{count} min",
} as const satisfies Readonly<Record<string, Phrase>>;

/**
 * Every word the library says, in English. Spread a translation over it, or
 * give the element `strings` with only the keys you change.
 */
export const DEFAULT_STRINGS = Object.freeze({ ...GANTT_STRINGS, ...RESOURCE_STRINGS, ...CALENDAR_STRINGS, ...OWN_STRINGS });

/** The dictionary: a phrase for every key of {@link DEFAULT_STRINGS}. */
export type Strings = { readonly [K in keyof typeof DEFAULT_STRINGS]: Phrase };

/** A host's dictionary over the defaults. */
export function resolveStrings(strings: Partial<Strings> = {}): Strings {
  return { ...DEFAULT_STRINGS, ...strings };
}

/**
 * A dictionary's phrases filled in, in a locale: the `say` of the Gantt and
 * resource hooks (`ganttHooks`, `resourceHooks`, `withLoadLanes`), and of
 * the element. Numbers in the values are written as the locale writes them.
 */
export function sayIn(strings: Strings, locale = "en"): (key: keyof Strings, values?: Readonly<Record<string, string | number>>) => string {
  return (key, values) => fill(strings[key], values, locale);
}
