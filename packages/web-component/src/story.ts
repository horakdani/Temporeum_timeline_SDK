/**
 * `@temporeum/timeline-element/story` — a story told slide by slide, beside
 * the timeline it happens on.
 *
 * {@link mountStory} puts a panel in an element of the host's: one slide at
 * a time — its media, its date, its headline and its text — with Previous
 * and Next. The panel and the timeline move together: going to a slide
 * selects its item and brings it into view, and selecting an item on the
 * timeline (a click, a tap, the keyboard) shows its slide. A title slide,
 * when there is one, comes first and shows the whole story.
 *
 *     import { createTimeline } from "@temporeum/timeline-element";
 *     import { mountStory } from "@temporeum/timeline-element/story";
 *     import { fromTimelineJS } from "@temporeum/timeline-core/story";
 *
 *     const story = fromTimelineJS(json);
 *     const timeline = createTimeline(el, { items: story.items, lanes: story.lanes, decorations: story.decorations });
 *     mountStory(panel, timeline, { title: story.title, hash: true });
 *
 * The slides are read from the items: `data.story` by default, which is
 * what `fromTimelineJS` writes, or the host's own `slide` function. Their
 * text and captions may be HTML, as TimelineJS's are; the panel keeps the
 * text, the emphasis, the lists and the links, and nothing that runs —
 * the HTML is parsed in an inert template and rebuilt, never assigned.
 *
 * Media. An image, a video or a sound file is the browser's own element. A
 * provider's player (YouTube without cookies, Vimeo without tracking,
 * SoundCloud, Spotify, a Google Maps embed) is loaded when it is asked
 * for, by a button that names where it comes from: a story with forty
 * videos does not open forty connections, and a reader decides when a
 * third party is contacted. `media: "eager"` loads them with the slide.
 * Anything else is a link.
 *
 * The keyboard: Previous and Next are buttons; ← and → (and Home and End)
 * page through the slides wherever the focus is in the panel, except in a
 * player that takes the arrows itself. Each change is said once, politely:
 * "Slide 3 of 12: Launch, 16 July 1969". Nothing is saved; with `hash` the
 * address names the slide, so a link opens on it.
 */

import { DARK_THEME, LIGHT_THEME, resolveTheme, toTimeMs } from "@temporeum/timeline-core";
import type { Item, Theme, ThemeSetting } from "@temporeum/timeline-core";
import { storyDateText, storyMedia } from "@temporeum/timeline-core/story";
import type { StoryData, StoryMedia, StoryMediaSource, StorySlide } from "@temporeum/timeline-core/story";

import type { Timeline } from "./timeline.js";

/** The panel's words. `{index}`, `{count}`, `{provider}` and `{host}` are filled in. */
export interface StoryStrings {
  /** The panel's accessible name. */
  readonly story: string;
  readonly previous: string;
  readonly next: string;
  /** The position, shown and said: "3 of 12". */
  readonly position: string;
  /** The title slide's position. */
  readonly titlePosition: string;
  /** What is said when the slide changes: "Slide 3 of 12: Launch, 16 July 1969". `{slide}` is the headline and the date. */
  readonly changed: string;
  /** The button that loads a player. */
  readonly loadPlayer: string;
  /** The line under it. */
  readonly playerFrom: string;
  /** A link to media that is not shown. */
  readonly openMedia: string;
}

/** The panel's English words. */
export const STORY_STRINGS: StoryStrings = {
  story: "Story",
  previous: "Previous",
  next: "Next",
  position: "{index} of {count}",
  titlePosition: "Title",
  changed: "Slide {index} of {count}: {slide}",
  loadPlayer: "Load the {provider} player",
  playerFrom: "It is loaded from {host} when you ask for it.",
  openMedia: "Open on {host}",
};

/** How a story panel is set up. */
export interface StoryOptions<T = unknown> {
  /** The title slide, first, before the items' slides. `undefined` is none, so a converted story's `title` goes in as it is. */
  readonly title?: StorySlide | undefined;
  /**
   * An item's slide, or `undefined` for an item that is not part of the
   * story. `item.data.story` by default, and the label as the headline for
   * an item without one; background items are never slides.
   */
  readonly slide?: (item: Item<T>) => StorySlide | undefined;
  /** The level of the slide's headline, so it fits the page's outline. 2 by default. */
  readonly headingLevel?: 2 | 3 | 4 | 5 | 6;
  /**
   * Name the slide in the address (`#story-launch`), so a link opens on
   * it, and follow the address when it changes. `true` for the `story-`
   * prefix, or the prefix to use. Off by default.
   */
  readonly hash?: boolean | string;
  /** When a provider's player loads: when it is asked for (default), or with the slide. */
  readonly media?: "click" | "eager";
  /** Move the timeline to the slide's item. On by default. */
  readonly reveal?: boolean;
  /** The slide to open on: an item's id or an index. The address's, with `hash`, else the first. */
  readonly start?: string | number;
  /** The date line of a slide that does not say its own. The item's date to its precision by default. */
  readonly formatDate?: (item: Item<T>) => string;
  /** A BCP 47 locale for the date line. */
  readonly locale?: string;
  /** The zone the date line is read in. UTC by default, as TimelineJS's dates are. */
  readonly timeZone?: string;
  readonly strings?: Partial<StoryStrings>;
  readonly theme?: ThemeSetting;
  /** Called after every change of slide, whoever made it. */
  readonly onChange?: (change: StoryChange<T>) => void;
}

/** A change of slide. */
export interface StoryChange<T = unknown> {
  readonly index: number;
  /** The item's id; `null` for the title slide. */
  readonly id: string | null;
  readonly item: Item<T> | undefined;
  readonly slide: StorySlide;
  /** Who moved: the panel's controls or `go`, the timeline's selection, or the address. */
  readonly source: "panel" | "timeline" | "hash";
}

/** A mounted story panel. */
export interface Story {
  /** The slide shown: 0 is the first, the title slide when there is one. */
  readonly index: number;
  /** The item shown; `null` on the title slide. */
  readonly id: string | null;
  readonly count: number;
  /** Go to a slide by its index or its item's id. `false` when there is no such slide. */
  go(target: number | string): boolean;
  next(): boolean;
  previous(): boolean;
  destroy(): void;
}

const PROVIDERS: Readonly<Partial<Record<StoryMediaSource["kind"], string>>> = {
  youtube: "YouTube",
  vimeo: "Vimeo",
  soundcloud: "SoundCloud",
  spotify: "Spotify",
  map: "Google Maps",
};

// --- safe HTML ------------------------------------------------------------

const DROPPED = new Set(["SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "TEMPLATE", "NOSCRIPT", "SVG", "MATH", "TEXTAREA", "SELECT", "BUTTON", "INPUT", "FORM", "IMG", "VIDEO", "AUDIO", "CANVAS", "LINK", "META", "TITLE", "HEAD"]);
const INLINE = new Set(["B", "STRONG", "I", "EM", "U", "S", "SMALL", "SUB", "SUP", "CODE", "MARK", "Q", "ABBR", "CITE", "TIME", "SPAN", "A", "BR"]);
const BLOCK = new Set(["P", "UL", "OL", "LI", "BLOCKQUOTE", "HR"]);

/** A link the panel follows: http, https or mailto, absolute or relative to the page. */
function safeHref(href: string, base: string): string | undefined {
  try {
    const url = new URL(href, base);
    return url.protocol === "https:" || url.protocol === "http:" || url.protocol === "mailto:" ? url.href : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The safe part of TimelineJS's HTML, rebuilt in the page's document: the
 * text, the emphasis, paragraphs, lists, quotes and links, without one
 * attribute of the source but a link's address, an abbreviation's title
 * and a time's datetime. `inline` keeps only what goes in a heading.
 */
export function storyHtml(doc: Document, html: string, options: { readonly inline?: boolean | undefined } = {}): DocumentFragment {
  const inline = options.inline === true;
  const template = doc.createElement("template");
  template.innerHTML = html;
  const out = doc.createDocumentFragment();
  const copy = (from: Node, to: Node): void => {
    for (const node of from.childNodes) {
      if (node instanceof Text) {
        to.appendChild(doc.createTextNode(node.data));
        continue;
      }
      if (!(node instanceof Element)) continue;
      const tag = node.tagName.toUpperCase();
      if (DROPPED.has(tag)) continue;
      if (!INLINE.has(tag) && !(BLOCK.has(tag) && !inline)) {
        copy(node, to);
        if (inline && BLOCK.has(tag)) to.appendChild(doc.createTextNode(" "));
        continue;
      }
      const element = doc.createElement(tag.toLowerCase());
      if (tag === "A") {
        const given = node.getAttribute("href")?.trim() ?? "";
        const href = given === "" ? undefined : safeHref(given, doc.baseURI);
        if (href === undefined) {
          copy(node, to);
          continue;
        }
        element.setAttribute("href", href);
        element.setAttribute("rel", "noopener noreferrer");
        element.setAttribute("target", "_blank");
      }
      const kept = tag === "ABBR" ? "title" : tag === "TIME" ? "datetime" : undefined;
      const value = kept === undefined ? null : node.getAttribute(kept);
      if (kept !== undefined && value !== null) element.setAttribute(kept, value);
      copy(node, element);
      to.appendChild(element);
    }
  };
  copy(template.content, out);
  return out;
}

// --- the stylesheet -------------------------------------------------------

function tokens(theme: Theme): string {
  const used = ["text", "textMuted", "surface", "surfaceAlt", "line", "lineStrong", "accent", "focus"] as const;
  return used.map((name) => `--tl-s-${name}:${theme.tokens[name]}`).join(";");
}

/** The panel's stylesheet, with the theme's colours. */
export function storyCss(): string {
  return (
    `.tl-story{box-sizing:border-box;display:flex;flex-direction:column;gap:12px;height:100%;min-height:0;padding:16px;` +
    `font:15px/1.5 system-ui,sans-serif;color:var(--tl-s-text);background:var(--tl-s-surface);box-shadow:inset 0 0 0 1px var(--tl-s-line);${tokens(LIGHT_THEME)}}` +
    `@media (prefers-color-scheme:dark){.tl-story:not([data-tl-theme="light"]){${tokens(DARK_THEME)}}}` +
    `.tl-story[data-tl-theme="dark"]{${tokens(DARK_THEME)}}` +
    ".tl-story *:focus-visible{outline:2px solid var(--tl-s-focus);outline-offset:2px}" +
    // Side by side, the slide is as tall as the panel leaves it: the picture shrinks to fit, the text scrolls.
    ".tl-story-slide{flex:1 1 auto;min-height:0;overflow:auto;display:grid;grid-template-columns:minmax(0,3fr) minmax(0,2fr);grid-template-rows:minmax(0,1fr);gap:16px 24px;" +
    "border-inline-start:6px solid var(--tl-s-slide,transparent);padding-inline-start:12px}" +
    ".tl-story-slide>.tl-story-body{min-height:0;overflow:auto}" +
    ".tl-story-slide.tl-story-plain{grid-template-columns:minmax(0,1fr)}" +
    "@media (max-width:640px){.tl-story-slide{grid-template-columns:minmax(0,1fr);grid-template-rows:none;align-content:start}.tl-story-slide>.tl-story-body{overflow:visible}}" +
    ".tl-story-title .tl-story-headline{font-size:1.8em}" +
    ".tl-story-media{margin:0;min-width:0;min-height:0;display:flex;flex-direction:column}" +
    ".tl-story-media>a{display:contents}" +
    ".tl-story-media img,.tl-story-media video{display:block;flex:0 1 auto;min-height:0;max-width:100%;max-height:min(60vh,420px);object-fit:contain;margin:0 auto;border-radius:4px}" +
    ".tl-story-media audio{width:100%}" +
    ".tl-story-media iframe{display:block;width:100%;aspect-ratio:16/9;height:auto;border:0;border-radius:4px;background:var(--tl-s-surfaceAlt)}" +
    ".tl-story-media iframe[data-tl-kind=soundcloud]{aspect-ratio:auto;height:166px}" +
    ".tl-story-media iframe[data-tl-kind=spotify]{aspect-ratio:auto;height:152px}" +
    ".tl-story-media iframe[data-tl-kind=map]{aspect-ratio:4/3}" +
    ".tl-story-load{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;width:100%;aspect-ratio:16/9;padding:12px;box-sizing:border-box;" +
    "border:1px solid var(--tl-s-lineStrong);border-radius:4px;background:var(--tl-s-surfaceAlt) center/cover no-repeat;color:var(--tl-s-text);font:inherit;cursor:pointer}" +
    ".tl-story-load span{padding:6px 12px;border-radius:4px;background:var(--tl-s-surface);font-weight:600}" +
    ".tl-story-caption{margin-top:6px;font-size:.85em;color:var(--tl-s-textMuted)}" +
    ".tl-story-credit{display:block;font-size:.9em}" +
    ".tl-story-date{margin:0;font-size:.9em;color:var(--tl-s-textMuted)}" +
    ".tl-story-headline{margin:.1em 0 .4em;font-size:1.35em;line-height:1.25}" +
    ".tl-story-text>:first-child{margin-top:0}" +
    ".tl-story-text a,.tl-story-caption a,.tl-story-link{color:var(--tl-s-accent)}" +
    ".tl-story-nav{display:flex;align-items:center;gap:8px;flex:none}" +
    ".tl-story-nav button{min-height:36px;padding:4px 14px;border:1px solid var(--tl-s-lineStrong);border-radius:4px;background:var(--tl-s-surface);color:var(--tl-s-text);font:inherit;cursor:pointer}" +
    ".tl-story-nav button:disabled{cursor:default;opacity:.55}" +
    ".tl-story-position{flex:1;text-align:center;color:var(--tl-s-textMuted);font-variant-numeric:tabular-nums}" +
    ".tl-story-said{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}"
  );
}

let storyCount = 0;

function fill(text: string, values: Readonly<Record<string, string | number>>): string {
  return text.replace(/\{(\w+)\}/g, (whole, key: string) => (key in values ? String(values[key]) : whole));
}

function defaultSlide<T>(item: Item<T>): StorySlide | undefined {
  if (item.kind === "background") return undefined;
  const story = (item.data as Partial<StoryData> | undefined)?.story;
  if (story !== undefined && story !== null && typeof story === "object") return story.headline === undefined && item.label !== undefined ? { ...story, headline: item.label } : story;
  return undefined;
}

/**
 * Mount a story panel in `container`, telling the slides of `timeline`'s
 * items one at a time and moving the timeline with it.
 */
export function mountStory<T>(container: HTMLElement, timeline: Timeline<T>, options: StoryOptions<T> = {}): Story {
  const doc = container.ownerDocument;
  const win = doc.defaultView;
  const words: StoryStrings = { ...STORY_STRINGS, ...options.strings };
  const slideOf = options.slide ?? defaultSlide;
  const prefix = options.hash === undefined || options.hash === false ? undefined : options.hash === true ? "story-" : options.hash;
  const reveal = options.reveal !== false;
  const level = options.headingLevel ?? 2;
  const id = `tl-story-${String((storyCount += 1))}`;

  const box = doc.createElement("section");
  box.className = "tl-story";
  box.setAttribute("aria-roledescription", "story");
  box.setAttribute("aria-label", words.story);
  const resolved = options.theme === undefined ? undefined : resolveTheme(options.theme);
  if (resolved !== undefined) {
    const custom = resolved !== LIGHT_THEME && resolved !== DARK_THEME;
    box.dataset.tlTheme = custom ? "custom" : resolved.name;
    if (custom) box.style.cssText = tokens(resolved);
  }
  const style = doc.createElement("style");
  style.textContent = storyCss();
  const slideBox = doc.createElement("div");
  slideBox.className = "tl-story-slide";
  slideBox.setAttribute("role", "group");
  slideBox.setAttribute("aria-roledescription", "slide");
  slideBox.id = `${id}-slide`;
  const nav = doc.createElement("div");
  nav.className = "tl-story-nav";
  const previous = doc.createElement("button");
  previous.type = "button";
  previous.className = "tl-story-previous";
  previous.textContent = `← ${words.previous}`;
  previous.setAttribute("aria-controls", slideBox.id);
  const position = doc.createElement("span");
  position.className = "tl-story-position";
  position.setAttribute("aria-hidden", "true");
  const next = doc.createElement("button");
  next.type = "button";
  next.className = "tl-story-next";
  next.textContent = `${words.next} →`;
  next.setAttribute("aria-controls", slideBox.id);
  nav.append(previous, position, next);
  const said = doc.createElement("div");
  said.className = "tl-story-said";
  said.setAttribute("aria-live", "polite");
  box.append(style, slideBox, nav, said);
  container.append(box);

  interface Entry {
    readonly item: Item<T> | undefined;
    readonly slide: StorySlide;
  }
  let entries: Entry[] = [];
  let index = 0;
  let destroyed = false;
  let ignoreSelection = false;

  function order(): void {
    const slides: { item: Item<T>; slide: StorySlide; at: number; n: number }[] = [];
    timeline.items.forEach((item, n) => {
      const slide = slideOf(item);
      if (slide !== undefined) slides.push({ item, slide, at: toTimeMs(item.start), n });
    });
    slides.sort((a, b) => a.at - b.at || a.n - b.n);
    entries = [...(options.title === undefined ? [] : [{ item: undefined, slide: options.title }]), ...slides.map(({ item, slide }) => ({ item, slide }))];
  }

  /** A headline as plain text, for names and announcements. */
  function plainHeadline(slide: StorySlide): string {
    if (slide.headline === undefined) return "";
    const holder = doc.createElement("div");
    holder.append(storyHtml(doc, slide.headline, { inline: true }));
    return holder.textContent.trim();
  }

  function dateOf(entry: Entry): string | undefined {
    if (entry.slide.date !== undefined) return entry.slide.date;
    if (entry.item === undefined) return undefined;
    if (options.formatDate !== undefined) return options.formatDate(entry.item);
    return storyDateText(entry.item, { ...(options.locale === undefined ? {} : { locale: options.locale }), ...(options.timeZone === undefined ? {} : { timeZone: options.timeZone }) });
  }

  function iframe(source: StoryMediaSource, media: StoryMedia, name: string): HTMLIFrameElement {
    const frame = doc.createElement("iframe");
    frame.src = source.embed ?? source.url;
    frame.title = media.title ?? media.alt ?? name;
    frame.dataset.tlKind = source.kind;
    frame.setAttribute("allow", "fullscreen; picture-in-picture; encrypted-media; clipboard-write");
    frame.setAttribute("allowfullscreen", "");
    frame.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
    // A player plays, goes full screen and opens its own links in a tab; it cannot navigate the page or open dialogs over it.
    frame.setAttribute("sandbox", "allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-presentation");
    frame.loading = "lazy";
    return frame;
  }

  function mediaOf(media: StoryMedia, headline: string): HTMLElement | undefined {
    const source = storyMedia(media.url);
    if (source === undefined) return undefined;
    const figure = doc.createElement("figure");
    figure.className = "tl-story-media";
    figure.dataset.tlKind = source.kind;
    const provider = PROVIDERS[source.kind];
    const name = media.title ?? media.alt ?? headline;
    if (source.kind === "image") {
      const image = doc.createElement("img");
      image.src = source.url;
      image.alt = media.alt ?? "";
      image.loading = "lazy";
      image.decoding = "async";
      const link = media.link === undefined ? undefined : safeHref(media.link, doc.baseURI);
      if (link === undefined) figure.append(image);
      else {
        const anchor = doc.createElement("a");
        anchor.href = link;
        anchor.rel = "noopener noreferrer";
        anchor.target = "_blank";
        anchor.append(image);
        figure.append(anchor);
      }
    } else if (source.kind === "video" || source.kind === "audio") {
      const player = doc.createElement(source.kind);
      player.src = source.url;
      player.controls = true;
      player.preload = "metadata";
      player.setAttribute("aria-label", name);
      figure.append(player);
    } else if (provider !== undefined) {
      const host = source.host;
      if (options.media === "eager") figure.append(iframe(source, media, `${provider}: ${name}`));
      else {
        const load = doc.createElement("button");
        load.type = "button";
        load.className = "tl-story-load";
        const thumbnail = media.thumbnail === undefined ? undefined : storyMedia(media.thumbnail);
        if (thumbnail?.kind === "image") load.style.backgroundImage = `url(${JSON.stringify(thumbnail.url)})`;
        const label = doc.createElement("span");
        label.textContent = fill(words.loadPlayer, { provider });
        const from = doc.createElement("small");
        from.textContent = fill(words.playerFrom, { host });
        from.style.cssText = "padding:2px 8px;border-radius:4px;background:var(--tl-s-surface)";
        load.append(label, from);
        load.setAttribute("aria-label", `${label.textContent}: ${name}. ${from.textContent}`);
        load.addEventListener("click", () => {
          const frame = iframe(source, media, `${provider}: ${name}`);
          load.replaceWith(frame);
          frame.focus();
        });
        figure.append(load);
      }
    } else {
      const anchor = doc.createElement("a");
      anchor.className = "tl-story-link";
      anchor.href = safeHref(source.url, doc.baseURI) ?? "#";
      anchor.rel = "noopener noreferrer";
      anchor.target = "_blank";
      anchor.textContent = media.title ?? fill(words.openMedia, { host: source.host === "" ? source.url : source.host });
      figure.append(anchor);
    }
    if (media.caption !== undefined || media.credit !== undefined) {
      const caption = doc.createElement("figcaption");
      caption.className = "tl-story-caption";
      if (media.caption !== undefined) caption.append(storyHtml(doc, media.caption));
      if (media.credit !== undefined) {
        const credit = doc.createElement("span");
        credit.className = "tl-story-credit";
        credit.append(storyHtml(doc, media.credit, { inline: true }));
        caption.append(credit);
      }
      figure.append(caption);
    }
    return figure;
  }

  function positionText(at: number): string {
    const titled = options.title !== undefined;
    if (titled && at === 0) return words.titlePosition;
    const count = entries.length - (titled ? 1 : 0);
    return fill(words.position, { index: at + (titled ? 0 : 1), count });
  }

  function draw(): void {
    const entry = entries[index];
    previous.disabled = index <= 0;
    next.disabled = index >= entries.length - 1;
    position.textContent = entries.length === 0 ? "" : positionText(index);
    if (entry === undefined) {
      slideBox.replaceChildren();
      slideBox.removeAttribute("aria-label");
      delete slideBox.dataset.tlSlide;
      return;
    }
    const slide = entry.slide;
    const headlineText = plainHeadline(slide);
    const body = doc.createElement("div");
    body.className = "tl-story-body";
    const date = dateOf(entry);
    if (date !== undefined && date !== "") {
      const line = doc.createElement("p");
      line.className = "tl-story-date";
      line.textContent = date;
      body.append(line);
    }
    if (slide.headline !== undefined && slide.headline !== "") {
      const heading = doc.createElement(`h${String(level)}`);
      heading.className = "tl-story-headline";
      heading.append(storyHtml(doc, slide.headline, { inline: true }));
      body.append(heading);
    }
    if (slide.text !== undefined && slide.text !== "") {
      const text = doc.createElement("div");
      text.className = "tl-story-text";
      text.append(storyHtml(doc, slide.text));
      body.append(text);
    }
    const media = slide.media === undefined ? undefined : mediaOf(slide.media, headlineText);
    slideBox.replaceChildren(...(media === undefined ? [] : [media]), body);
    slideBox.classList.toggle("tl-story-plain", media === undefined);
    slideBox.classList.toggle("tl-story-title", entry.item === undefined);
    slideBox.setAttribute("aria-label", positionText(index));
    if (entry.item === undefined) delete slideBox.dataset.tlSlide;
    else slideBox.dataset.tlSlide = entry.item.id;
    const colour = slide.background?.trim();
    if (colour !== undefined && colour !== "" && (win?.CSS?.supports("color", colour) ?? false)) slideBox.style.setProperty("--tl-s-slide", colour);
    else slideBox.style.removeProperty("--tl-s-slide");
    slideBox.scrollTop = 0;
  }

  /** The story's whole span, for the title slide. */
  function extent(): readonly [number, number] | undefined {
    let low = Infinity;
    let high = -Infinity;
    for (const entry of entries) {
      if (entry.item === undefined) continue;
      const start = toTimeMs(entry.item.start);
      low = Math.min(low, start);
      high = Math.max(high, entry.item.end === undefined ? start : toTimeMs(entry.item.end));
    }
    return low <= high ? [low, high] : undefined;
  }

  function move(entry: Entry): void {
    if (!reveal) return;
    if (entry.item === undefined) {
      const span = extent();
      if (span !== undefined) {
        const pad = Math.max((span[1] - span[0]) * 0.05, 3_600_000);
        timeline.zoomTo([span[0] - pad, span[1] + pad]);
      }
      return;
    }
    const item = entry.item;
    const start = toTimeMs(item.start);
    const end = item.end === undefined ? start : toTimeMs(item.end);
    const [low, high] = timeline.getSnapshot().domain;
    const width = high - low;
    if (end - start > width * 0.8) {
      const pad = (end - start) * 0.15;
      timeline.zoomTo([start - pad, end + pad]);
    } else timeline.scrollTo((start + end) / 2);
    if (item.laneId !== undefined) timeline.revealLane(item.laneId);
  }

  function writeHash(entry: Entry): void {
    if (prefix === undefined || win === null) return;
    try {
      const url = new URL(win.location.href);
      url.hash = entry.item === undefined ? "" : `${prefix}${encodeURIComponent(entry.item.id)}`;
      if (url.href !== win.location.href) win.history.replaceState(win.history.state, "", url.href);
    } catch {
      // A sandboxed frame (an opaque origin, a srcdoc) has no address of its own to write.
    }
  }

  function show(at: number, source: StoryChange["source"], announce: boolean): boolean {
    const entry = entries[at];
    if (entry === undefined) return false;
    index = at;
    draw();
    if (source !== "timeline") {
      ignoreSelection = true;
      try {
        timeline.select(entry.item === undefined ? [] : [entry.item.id]);
      } finally {
        ignoreSelection = false;
      }
      move(entry);
    }
    writeHash(entry);
    if (announce) {
      const headline = plainHeadline(entry.slide);
      const date = dateOf(entry);
      const what = [headline, date].filter((part) => part !== undefined && part !== "").join(", ");
      const titled = options.title !== undefined;
      said.textContent = fill(words.changed, { index: at + (titled ? 0 : 1), count: entries.length - (titled ? 1 : 0), slide: what });
      if (titled && at === 0) said.textContent = what === "" ? words.titlePosition : `${words.titlePosition}: ${what}`;
    }
    options.onChange?.({ index: at, id: entry.item?.id ?? null, item: entry.item, slide: entry.slide, source });
    return true;
  }

  function indexOf(target: number | string): number {
    if (typeof target === "number") return Number.isInteger(target) && target >= 0 && target < entries.length ? target : -1;
    return entries.findIndex((entry) => entry.item?.id === target);
  }

  function fromHash(): number {
    if (prefix === undefined || win === null) return -1;
    const hash = win.location.hash.slice(1);
    if (!hash.startsWith(prefix)) return -1;
    let wanted: string;
    try {
      wanted = decodeURIComponent(hash.slice(prefix.length));
    } catch {
      return -1;
    }
    return indexOf(wanted);
  }

  /** Go to a slide from the panel. A button that can go no further gives the focus to the one that can. */
  function turn(target: number): boolean {
    if (target < 0 || target >= entries.length || target === index) return false;
    const had = doc.activeElement;
    show(target, "panel", true);
    if (had === previous && previous.disabled) next.focus();
    if (had === next && next.disabled) previous.focus();
    return true;
  }

  function step(by: number): boolean {
    return turn(index + by);
  }

  previous.addEventListener("click", () => step(-1));
  next.addEventListener("click", () => step(1));

  function onKey(event: KeyboardEvent): void {
    if (event.ctrlKey || event.metaKey || event.altKey || event.defaultPrevented) return;
    const target = event.target;
    if (target instanceof Element && target.closest("input,textarea,select,video,audio,iframe,[contenteditable=''],[contenteditable=true]") !== null) return;
    let moved: boolean;
    switch (event.key) {
      case "ArrowLeft":
        moved = step(-1);
        break;
      case "ArrowRight":
        moved = step(1);
        break;
      case "Home":
        moved = turn(0);
        break;
      case "End":
        moved = turn(entries.length - 1);
        break;
      default:
        return;
    }
    if (moved || event.key === "ArrowLeft" || event.key === "ArrowRight") event.preventDefault();
  }
  box.addEventListener("keydown", onKey);

  const stopSelection = timeline.on("selectionChanged", ({ ids }) => {
    if (ignoreSelection || ids.length !== 1) return;
    const at = entries.findIndex((entry) => entry.item !== undefined && entry.item.id === ids[0]);
    if (at >= 0 && at !== index) show(at, "timeline", true);
  });
  const stopItems = timeline.on("itemsChanged", () => {
    const was = entries[index];
    order();
    const at = was?.item === undefined ? (was === undefined ? -1 : 0) : indexOf(was.item.id);
    index = at >= 0 ? at : Math.min(index, Math.max(entries.length - 1, 0));
    const now = entries[index];
    // The same slide of the same item stays as it is drawn: a player that is playing keeps playing.
    const same = now !== undefined && was !== undefined && now.slide === was.slide && dateOf(now) === dateOf(was);
    if (same) {
      previous.disabled = index <= 0;
      next.disabled = index >= entries.length - 1;
      position.textContent = positionText(index);
      slideBox.setAttribute("aria-label", positionText(index));
    } else draw();
  });
  const onHash = (): void => {
    const at = fromHash();
    if (at >= 0 && at !== index) show(at, "hash", true);
  };
  if (prefix !== undefined) win?.addEventListener("hashchange", onHash);

  order();
  const opening = fromHash();
  const start = opening >= 0 ? opening : options.start === undefined ? 0 : Math.max(indexOf(options.start), 0);
  /** The wait for the timeline's first frame, until it comes or the story is destroyed first. */
  let stopWaiting: (() => void) | undefined;
  if (entries.length === 0) draw();
  else {
    // The first view waits for the timeline's first frame, so the move lands where the reader will look.
    const first = entries[start];
    index = start;
    draw();
    if (first !== undefined) {
      const opened = (): void => {
        if (!destroyed && index === start) show(start, opening >= 0 ? "hash" : "panel", false);
      };
      if (timeline.getSnapshot().viewport === undefined) {
        stopWaiting = timeline.on("layoutChanged", () => {
          stopWaiting?.();
          stopWaiting = undefined;
          opened();
        });
      } else opened();
    }
  }

  return {
    get index() {
      return index;
    },
    get id() {
      return entries[index]?.item?.id ?? null;
    },
    get count() {
      return entries.length;
    },
    go(target) {
      const at = indexOf(target);
      return at >= 0 && show(at, "panel", true);
    },
    next: () => step(1),
    previous: () => step(-1),
    destroy() {
      if (destroyed) return;
      destroyed = true;
      stopWaiting?.();
      stopSelection();
      stopItems();
      if (prefix !== undefined) win?.removeEventListener("hashchange", onHash);
      box.removeEventListener("keydown", onKey);
      box.remove();
    },
  };
}
