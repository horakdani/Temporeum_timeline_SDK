/**
 * A TimelineJS story as items, lanes and eras.
 *
 * TimelineJS's JSON (the format of its `new TL.Timeline(id, data)` and of
 * the file its Google Sheets template publishes to) is a title slide, the
 * events and the eras. Each event becomes an item whose `data.story` is its
 * slide; a `group` becomes a lane, in the order the groups first appear; an
 * era becomes an `era` decoration. What does not carry over is said in
 * `warnings`, never dropped quietly.
 *
 * The dates. A TimelineJS date is a year and, optionally, a month, a day and
 * a time, in UTC unless the host says otherwise. The precision it is given
 * in is the item's `granularity`: a year alone covers its year, as a day
 * covers its day. A year is the year TimelineJS gives the browser's `Date` —
 * the astronomical one, so its `-500` is the axis's 501 BC; a `display_date`
 * keeps the story's own wording. An end date's unit is part of the span,
 * as it is for every item with a granularity: 1914 to 1918 runs to the end
 * of 1918. Two dates known to different precisions give the item the finer
 * unit, and each end keeps its own: 1914 to 11 November 1918 ends with that
 * day. An era has no granularity, so its end is the instant after.
 */

import { fromCalendarParts, toCalendarParts } from "../calendar.js";
import { decodeEntities } from "../shared/entities.js";
import { storyDateText } from "./date.js";
import { storyMedia } from "./media.js";
import type { EraDecoration } from "../decorations.js";
import type { Granularity, Item, Lane, TimeMs } from "../types.js";

/** A TimelineJS date: a year and as much more as is known. Numbers or strings, as the sheet gives them. */
export interface TimelineJSDate {
  readonly year?: number | string;
  readonly month?: number | string;
  readonly day?: number | string;
  readonly hour?: number | string;
  readonly minute?: number | string;
  readonly second?: number | string;
  readonly millisecond?: number | string;
  readonly display_date?: string;
}

/** A TimelineJS media object. */
export interface TimelineJSMedia {
  readonly url?: string;
  readonly caption?: string;
  readonly credit?: string;
  readonly thumbnail?: string;
  readonly alt?: string;
  readonly title?: string;
  readonly link?: string;
}

/** A TimelineJS slide: the title, or an event. */
export interface TimelineJSSlide {
  readonly start_date?: TimelineJSDate;
  readonly end_date?: TimelineJSDate;
  readonly text?: { readonly headline?: string; readonly text?: string };
  readonly media?: TimelineJSMedia;
  readonly group?: string;
  readonly display_date?: string;
  readonly background?: { readonly url?: string; readonly color?: string; readonly alt?: string };
  readonly unique_id?: string;
}

/** A TimelineJS era. */
export interface TimelineJSEra {
  readonly start_date?: TimelineJSDate;
  readonly end_date?: TimelineJSDate;
  readonly text?: { readonly headline?: string; readonly text?: string };
}

/** TimelineJS's JSON. */
export interface TimelineJSData {
  readonly title?: TimelineJSSlide;
  readonly events?: readonly TimelineJSSlide[];
  readonly eras?: readonly TimelineJSEra[];
  readonly scale?: string;
}

/** A slide's media, as the story panel shows it. */
export interface StoryMedia {
  readonly url: string;
  /** HTML, as TimelineJS allows; the panel keeps only the safe part of it. */
  readonly caption?: string;
  readonly credit?: string;
  /** The text alternative of an image, or the name of a player. */
  readonly alt?: string;
  readonly title?: string;
  /** A picture shown in place of a player until it is asked to load. */
  readonly thumbnail?: string;
  /** Where the media leads when clicked. */
  readonly link?: string;
}

/** A slide: what the story panel shows for an item, or for the title. */
export interface StorySlide {
  readonly headline?: string;
  /** HTML, as TimelineJS allows; the panel keeps only the safe part of it. */
  readonly text?: string;
  /** The date as the story says it ("Summer 1969"); the item's own date, written out, when there is none. */
  readonly date?: string;
  readonly media?: StoryMedia;
  /** The slide's background colour, any CSS colour. */
  readonly background?: string;
  /**
   * The unit each end was given in, when the two differ ("1914" to
   * "11 November 1918"): the item's `granularity` is the finer one, and
   * `storyDateText` says each end to its own.
   */
  readonly precision?: readonly [start: Granularity, end: Granularity];
}

/** What an item made from a story carries. */
export interface StoryData {
  readonly story: StorySlide;
}

/** Something of the story that did not carry over, or not as it was. */
export interface StoryWarning {
  readonly code: "no-date" | "out-of-range" | "end-before-start" | "duplicate-id" | "cosmological" | "background-image" | "media";
  /** The event's or the era's index in its list; absent for the story as a whole. */
  readonly index?: number;
  readonly list?: "events" | "eras" | "title";
  readonly message: string;
}

/** How a story becomes items. */
export interface FromTimelineJSOptions {
  /** The lane of the events without a group, when others have one. "Other" by default. */
  readonly ungroupedLabel?: string;
  /** Prefix of the lane ids made from groups. "group-" by default. */
  readonly lanePrefix?: string;
  /**
   * The zone the story's dates are wall-clock times in: give the timeline's
   * `timeZone`, and "1969" is drawn as 1969 there, not as the last hours of
   * 1968 that 1969 in UTC is in New York. UTC by default, as TimelineJS reads them.
   */
  readonly timeZone?: string;
}

/** A story, converted. */
export interface StoryConversion {
  readonly items: Item<StoryData>[];
  /**
   * One lane per group, in the order the groups first appear, and one for
   * the events without a group; a single lane when no event has one. Always
   * there, so a configuration takes it as it is.
   */
  readonly lanes: Lane[];
  /** The eras, as `era` decorations. */
  readonly decorations: EraDecoration[];
  /** The title slide, when the story has one. */
  readonly title?: StorySlide;
  readonly warnings: StoryWarning[];
}

/** Text without its tags and with its character references read: TimelineJS headlines may be HTML. */
export function storyPlainText(html: string): string {
  return decodeEntities(
    html
      .replace(/<br\s*\/?>/gi, " ")
      // A tag does not hold a `<`: an unclosed one is text, read once.
      .replace(/<[^<>]*>/g, ""),
  )
    .replace(/\s+/g, " ")
    .trim();
}

const MAX_YEAR = 275_000;

/** A number field of a date: a whole number, or `undefined` when it is not given. `NaN` when it is given and is not one. */
function field(value: number | string | undefined): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") {
    const text = value.trim();
    if (text === "") return undefined;
    return /^[-+]?\d+$/.test(text) ? Number(text) : Number.NaN;
  }
  return Number.isInteger(value) ? value : Number.NaN;
}

const NEXT: Readonly<Record<string, (date: Date) => void>> = {
  year: (d) => d.setUTCFullYear(d.getUTCFullYear() + 1),
  month: (d) => d.setUTCMonth(d.getUTCMonth() + 1),
  day: (d) => d.setUTCDate(d.getUTCDate() + 1),
  hour: (d) => d.setUTCHours(d.getUTCHours() + 1),
  minute: (d) => d.setUTCMinutes(d.getUTCMinutes() + 1),
  second: (d) => d.setUTCSeconds(d.getUTCSeconds() + 1),
  millisecond: (d) => d.setUTCMilliseconds(d.getUTCMilliseconds() + 1),
};

/** A date read: its instant, the precision it was given in, and the instant just after that unit. */
interface ReadDate {
  readonly time: TimeMs;
  readonly granularity: Granularity;
  readonly after: TimeMs;
}

/** `undefined`: no year. `null`: a year, but a date that cannot be one. */
/** The units a TimelineJS date is known to, coarsest first. */
const UNITS: readonly Granularity[] = ["year", "month", "day", "hour", "minute", "second", "millisecond"];

function readDate(date: TimelineJSDate | undefined, zone?: string): ReadDate | null | undefined {
  if (date === undefined) return undefined;
  const year = field(date.year);
  if (year === undefined) return undefined;
  const parts = [field(date.month), field(date.day), field(date.hour), field(date.minute), field(date.second), field(date.millisecond)];
  if (Number.isNaN(year) || Math.abs(year) > MAX_YEAR || parts.some((part) => part !== undefined && Number.isNaN(part))) return null;
  let given = 0;
  // The precision is the last field given in order: a day without a month is not a day.
  while (given < parts.length && parts[given] !== undefined) given += 1;
  const [month = 1, day = 1, hour = 0, minute = 0, second = 0, ms = 0] = parts.slice(0, given) as number[];
  const at = new Date(0);
  at.setUTCFullYear(year, month - 1, day);
  at.setUTCHours(hour, minute, second, ms);
  const time = at.getTime();
  if (!Number.isFinite(time)) return null;
  const granularity = UNITS[given] ?? "millisecond";
  NEXT[granularity]?.(at);
  // The fields were set as UTC: read them again as the zone's wall clock.
  const wall = (t: TimeMs): TimeMs => (zone === undefined ? t : fromCalendarParts(toCalendarParts(t), zone));
  return { time: wall(time), granularity, after: wall(at.getTime()) };
}

function hasYear(date: TimelineJSDate | undefined): boolean {
  return date !== undefined && field(date.year) !== undefined;
}

/** A slide; `startText` writes its start when only the end has a `display_date`, so that one is not lost (V14). */
function slideOf(slide: TimelineJSSlide, index: number, list: NonNullable<StoryWarning["list"]>, warnings: StoryWarning[], startText?: () => string): StorySlide {
  const media = slide.media;
  const end = slide.end_date?.display_date;
  const display = slide.display_date ?? slide.start_date?.display_date ?? (end ? startText?.() : undefined);
  const colour = slide.background?.color?.trim();
  if (slide.background?.url !== undefined && slide.background.url.trim() !== "") {
    warnings.push({ code: "background-image", index, list, message: "A background image is not drawn: the panel keeps its own colours, so the text stays readable. The colour is kept." });
  }
  // What the panel will make of the media, said now rather than found missing on the slide.
  const url = media?.url?.trim() ?? "";
  const sorted = url === "" ? null : storyMedia(url);
  if (sorted === undefined) warnings.push({ code: "media", index, list, message: "The media address is not one the panel opens (http, https, or an image as data:); the media is left out." });
  else if (sorted?.kind === "link") warnings.push({ code: "media", index, list, message: "The media is not a kind the panel shows (an image, a video, audio, YouTube, Vimeo, SoundCloud, Spotify or a Google map); it is a link." });
  return {
    ...(slide.text?.headline === undefined || slide.text.headline === "" ? {} : { headline: slide.text.headline }),
    ...(slide.text?.text === undefined || slide.text.text === "" ? {} : { text: slide.text.text }),
    ...(display === undefined || display === "" ? {} : { date: end === undefined || end === "" || slide.display_date !== undefined ? display : `${display} – ${end}` }),
    ...(media === undefined || sorted === null || sorted === undefined
      ? {}
      : {
          media: {
            url,
            ...(media.caption ? { caption: media.caption } : {}),
            ...(media.credit ? { credit: media.credit } : {}),
            ...(media.alt ? { alt: media.alt } : {}),
            ...(media.title ? { title: media.title } : {}),
            ...(media.thumbnail ? { thumbnail: media.thumbnail } : {}),
            ...(media.link ? { link: media.link } : {}),
          },
        }),
    ...(colour === undefined || colour === "" ? {} : { background: colour }),
  };
}

function slug(text: string): string {
  const out = text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return out === "" ? "group" : out;
}

/**
 * A TimelineJS story as a timeline: the events as items with their slides
 * in `data.story`, the groups as lanes, the eras as decorations, the title
 * slide apart. Give the items, lanes and decorations to `createTimeline`
 * and the timeline to `mountStory` (`@temporeum/timeline-element/story`).
 */
export function fromTimelineJS(data: TimelineJSData, options: FromTimelineJSOptions = {}): StoryConversion {
  const warnings: StoryWarning[] = [];
  if (data.scale !== undefined && data.scale.toLowerCase() === "cosmological") {
    warnings.push({
      code: "cosmological",
      message: "The cosmological scale is read as years of the calendar: a date further than 275 000 years from now is left out. Billions of years need a time axis of their own.",
    });
  }
  const prefix = options.lanePrefix ?? "group-";
  const laneIds = new Map<string, string>();
  const ids = new Set<string>();
  const laneNames = new Set<string>();
  // The next free suffix of a taken id or lane name: a file of 20 000 events
  // sharing one id does not look for it from -2 again each time.
  const suffixes = new Map<Set<string>, Map<string, number>>();
  const free = (taken: Set<string>, base: string): string => {
    const next = suffixes.get(taken) ?? new Map<string, number>();
    suffixes.set(taken, next);
    let n = next.get(base) ?? 2;
    while (taken.has(`${base}-${String(n)}`)) n += 1;
    next.set(base, n + 1);
    return `${base}-${String(n)}`;
  };
  const items: Item<StoryData>[] = [];
  let ungrouped = false;

  (data.events ?? []).forEach((event, index) => {
    const start = readDate(event.start_date, options.timeZone);
    if (start === undefined || start === null) {
      warnings.push(
        start === undefined
          ? { code: "no-date", index, list: "events", message: "An event without a start year is not on a timeline; it is left out." }
          : { code: "out-of-range", index, list: "events", message: "The start date is not a calendar date this timeline can place (a year within 275 000 of now, whole numbers); the event is left out." },
      );
      return;
    }
    // The end's own unit is in the span by the item's granularity: the end is
    // the instant its date names. Known to different precisions, the finer
    // unit is the item's, and the end the last instant of its own unit — so
    // 1914 to 11 November 1918 ends that day, 16 July 1969 to 1972 with 1972.
    let end: TimeMs | undefined;
    let granularity = start.granularity;
    let precision: readonly [Granularity, Granularity] | undefined;
    if (hasYear(event.end_date)) {
      const read = readDate(event.end_date, options.timeZone);
      if (read === null || read === undefined) warnings.push({ code: "out-of-range", index, list: "events", message: "The end date cannot be placed; the event is an instant." });
      else if (read.after <= start.time) warnings.push({ code: "end-before-start", index, list: "events", message: "The end is before the start; the event is an instant." });
      else if (read.granularity === granularity) end = read.time;
      else {
        end = UNITS.indexOf(read.granularity) > UNITS.indexOf(granularity) ? read.time : read.after - 1;
        precision = [granularity, read.granularity];
        granularity = UNITS[Math.max(UNITS.indexOf(read.granularity), UNITS.indexOf(granularity))] as Granularity;
      }
    }
    let id = event.unique_id?.trim() || `slide-${String(index + 1)}`;
    if (ids.has(id)) {
      const base = id;
      id = free(ids, base);
      warnings.push({ code: "duplicate-id", index, list: "events", message: `The id "${base}" is taken; this event is "${id}".` });
    }
    ids.add(id);
    const group = event.group?.trim();
    let laneId: string | undefined;
    if (group === undefined || group === "") ungrouped = true;
    else {
      laneId = laneIds.get(group);
      if (laneId === undefined) {
        const base = `${prefix}${slug(group)}`;
        laneId = laneNames.has(base) ? free(laneNames, base) : base;
        laneNames.add(laneId);
        laneIds.set(group, laneId);
      }
    }
    const story: StorySlide = {
      ...slideOf(event, index, "events", warnings, () => storyDateText({ start: start.time, granularity: start.granularity }, options.timeZone === undefined ? {} : { timeZone: options.timeZone })),
      ...(precision === undefined ? {} : { precision }),
    };
    const label = story.headline === undefined ? undefined : storyPlainText(story.headline);
    items.push({
      id,
      start: start.time,
      ...(end === undefined ? {} : { end }),
      granularity,
      ...(label === undefined || label === "" ? {} : { label }),
      ...(laneId === undefined ? {} : { laneId }),
      data: { story },
    });
  });

  const lanes: Lane[] = [...laneIds].map(([label, id]) => ({ id, label }));
  if (ungrouped || lanes.length === 0) {
    let other = `${prefix}${lanes.length === 0 ? "all" : "other"}`;
    while (lanes.some((lane) => lane.id === other)) other = `${other}-`;
    lanes.push(lanes.length === 0 ? { id: other } : { id: other, label: options.ungroupedLabel ?? "Other" });
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i];
      if (item !== undefined && item.laneId === undefined) items[i] = { ...item, laneId: other };
    }
  }

  const decorations: EraDecoration[] = [];
  (data.eras ?? []).forEach((era, index) => {
    const start = readDate(era.start_date, options.timeZone);
    const end = readDate(era.end_date, options.timeZone);
    if (start === undefined || start === null || end === undefined || end === null) {
      warnings.push({ code: start === undefined || end === undefined ? "no-date" : "out-of-range", index, list: "eras", message: "An era needs a start and an end it can place; this one is left out." });
      return;
    }
    if (end.after <= start.time) {
      warnings.push({ code: "end-before-start", index, list: "eras", message: "The era ends before it starts; it is left out." });
      return;
    }
    const label = era.text?.headline === undefined ? "" : storyPlainText(era.text.headline);
    decorations.push({ kind: "era", id: `era-${String(index + 1)}`, start: start.time, end: end.after, ...(label === "" ? {} : { label }) });
  });

  const title = data.title === undefined ? undefined : slideOf(data.title, 0, "title", warnings);
  return { items, lanes, decorations, ...(title === undefined ? {} : { title }), warnings };
}
