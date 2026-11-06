/**
 * TimelineJS's Google Sheets template, read from its CSV.
 *
 * The template is how most TimelineJS stories are written: one row per
 * slide, with the columns Year, Month, Day, Time, End Year, End Month, End
 * Day, End Time, Display Date, Headline, Text, Media, Media Credit, Media
 * Caption, Media Thumbnail, Type, Group and Background. A sheet published
 * to the web as CSV (File → Share → Publish to web → CSV) is read here into
 * TimelineJS's JSON, so the same {@link fromTimelineJS} takes it from there.
 * The columns are found by their headings, in any order and case; a
 * heading the template does not have is ignored.
 *
 * Nothing is fetched: the host fetches the CSV (its address from
 * {@link sheetCsvUrl}) and hands the text over.
 */

import { fromTimelineJS } from "./timelinejs.js";
import type { FromTimelineJSOptions, StoryConversion, StoryWarning, TimelineJSDate, TimelineJSEra, TimelineJSData, TimelineJSSlide } from "./timelinejs.js";

/** RFC 4180 CSV: rows of fields, quotes doubled inside quoted fields, line breaks inside them kept. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let quoted = false;
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (quoted) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          value += '"';
          i += 1;
        } else quoted = false;
      } else value += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(value);
      value = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[i + 1] === "\n") i += 1;
      row.push(value);
      rows.push(row);
      row = [];
      value = "";
    } else value += char;
  }
  if (value !== "" || row.length > 0) {
    row.push(value);
    rows.push(row);
  }
  return rows;
}

const COLUMNS = {
  year: "year",
  month: "month",
  day: "day",
  time: "time",
  endYear: "end year",
  endMonth: "end month",
  endDay: "end day",
  endTime: "end time",
  display: "display date",
  headline: "headline",
  text: "text",
  media: "media",
  credit: "media credit",
  caption: "media caption",
  thumbnail: "media thumbnail",
  alt: "media alt",
  type: "type",
  group: "group",
  background: "background",
} as const;

type Column = keyof typeof COLUMNS;

/** `13:05`, `1:05:30.250`, `1:05 PM`: hours, minutes, seconds and milliseconds, as strings. `undefined` for an empty cell, `null` for one that is not a time. */
function readTime(cell: string): Pick<TimelineJSDate, "hour" | "minute" | "second" | "millisecond"> | null | undefined {
  const text = cell.trim();
  if (text === "") return undefined;
  const match = /^(\d{1,2})(?::(\d{2}))?(?::(\d{2}))?(?:\.(\d{1,3}))?\s*([ap]\.?m\.?)?$/i.exec(text);
  if (match === null) return null;
  let hour = Number(match[1]);
  const half = match[5]?.replace(/\./g, "").toLowerCase();
  if (half !== undefined) {
    if (hour < 1 || hour > 12) return null;
    hour = (hour % 12) + (half === "pm" ? 12 : 0);
  }
  if (hour > 23) return null;
  return {
    hour,
    ...(match[2] === undefined ? {} : { minute: Number(match[2]) }),
    ...(match[3] === undefined ? {} : { second: Number(match[3]) }),
    ...(match[4] === undefined ? {} : { millisecond: Number(match[4].padEnd(3, "0")) }),
  };
}

/** A sheet read: TimelineJS's JSON, and what could not be read of it. */
export interface TimelineSheet {
  readonly data: TimelineJSData;
  readonly warnings: StoryWarning[];
}

/**
 * The template's CSV as TimelineJS's JSON. A row whose Type is `title` is
 * the title slide (the first one); `era` an era; anything else an event.
 * An empty row is skipped.
 */
export function readTimelineSheet(csv: string): TimelineSheet {
  const rows = parseCsv(csv);
  const warnings: StoryWarning[] = [];
  const head = rows[0] ?? [];
  const at = new Map<Column, number>();
  head.forEach((heading, index) => {
    const name = heading.trim().toLowerCase().replace(/\s+/g, " ");
    for (const [column, title] of Object.entries(COLUMNS) as [Column, string][]) if (title === name && !at.has(column)) at.set(column, index);
  });
  const events: TimelineJSSlide[] = [];
  const eras: TimelineJSEra[] = [];
  let title: TimelineJSSlide | undefined;
  for (let r = 1; r < rows.length; r += 1) {
    const row = rows[r] ?? [];
    if (row.every((cell) => cell.trim() === "")) continue;
    const cell = (column: Column): string => {
      const index = at.get(column);
      return index === undefined ? "" : (row[index] ?? "").trim();
    };
    const date = (year: Column, month: Column, day: Column, time: Column, display?: string): TimelineJSDate | undefined => {
      if (cell(year) === "") return undefined;
      const clock = readTime(cell(time));
      // Where fromTimelineJS's warnings point too: the list and the index in it (X22); the message names the row.
      if (clock === null) warnings.push({ code: "out-of-range", ...(index === undefined ? {} : { index }), list, message: `Row ${String(r + 1)}: "${cell(time)}" is not a time; the date is kept without it.` });
      return {
        year: cell(year),
        ...(cell(month) === "" ? {} : { month: cell(month) }),
        ...(cell(day) === "" ? {} : { day: cell(day) }),
        ...(clock === null || clock === undefined ? {} : clock),
        ...(display === undefined || display === "" ? {} : { display_date: display }),
      };
    };
    const type = cell("type").toLowerCase();
    const list = type === "title" ? "title" : type === "era" ? "eras" : "events";
    const index = list === "events" ? events.length : list === "eras" ? eras.length : undefined;
    const background = cell("background");
    const media = cell("media");
    const start = date("year", "month", "day", "time");
    const end = date("endYear", "endMonth", "endDay", "endTime");
    const slide: TimelineJSSlide = {
      ...(start === undefined ? {} : { start_date: start }),
      ...(end === undefined ? {} : { end_date: end }),
      ...(cell("display") === "" ? {} : { display_date: cell("display") }),
      text: { headline: cell("headline"), text: cell("text") },
      ...(media === ""
        ? {}
        : { media: { url: media, credit: cell("credit"), caption: cell("caption"), thumbnail: cell("thumbnail"), alt: cell("alt") } }),
      ...(cell("group") === "" ? {} : { group: cell("group") }),
      ...(background === "" ? {} : /^(?:https?:)?\/\//i.test(background) ? { background: { url: background } } : { background: { color: background } }),
    };
    if (type === "title") {
      if (title === undefined) title = slide;
    } else if (type === "era") eras.push({ ...(slide.start_date ? { start_date: slide.start_date } : {}), ...(slide.end_date ? { end_date: slide.end_date } : {}), ...(slide.text ? { text: slide.text } : {}) });
    else events.push(slide);
  }
  return { data: { ...(title === undefined ? {} : { title }), events, eras }, warnings };
}

/** The template's CSV straight to a timeline: {@link readTimelineSheet}, then {@link fromTimelineJS}, with both warnings. */
export function fromTimelineSheet(csv: string, options?: FromTimelineJSOptions): StoryConversion {
  const sheet = readTimelineSheet(csv);
  const story = fromTimelineJS(sheet.data, options);
  return { ...story, warnings: [...sheet.warnings, ...story.warnings] };
}

/**
 * The address of a Google Sheet's CSV, from the address it is shared or
 * published at: `…/spreadsheets/d/<id>/edit…` becomes its export, a
 * `…/d/e/<key>/pubhtml` its published CSV; an address that already asks for
 * CSV stays. `undefined` for an address that is not a sheet. The sheet must
 * be published, or shared with anyone with the link, for a page to read it.
 */
export function sheetCsvUrl(address: string): string | undefined {
  let url: URL;
  try {
    url = new URL(address.trim());
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:" || url.hostname !== "docs.google.com") return undefined;
  // A sheet's gid is a number; anything else, decoded, could be a parameter of its own.
  const given = url.searchParams.get("gid") ?? /gid=(\d+)/.exec(url.hash)?.[1];
  const gid = given !== undefined && given !== null && /^\d+$/.test(given) ? `&gid=${given}` : "";
  const published = /^\/spreadsheets\/d\/e\/([\w-]+)\//.exec(url.pathname);
  if (published !== null) return `https://docs.google.com/spreadsheets/d/e/${published[1] ?? ""}/pub?output=csv${gid}`;
  const shared = /^\/spreadsheets\/d\/([\w-]+)/.exec(url.pathname);
  if (shared !== null) return `https://docs.google.com/spreadsheets/d/${shared[1] ?? ""}/export?format=csv${gid}`;
  return undefined;
}
