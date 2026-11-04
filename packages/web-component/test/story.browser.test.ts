import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";

import type { Item } from "@temporeum/timeline-core";
import { fromTimelineJS } from "@temporeum/timeline-core/story";
import type { StoryData } from "@temporeum/timeline-core/story";

import { createTimeline, registerPlugin } from "../src/index.js";
import { itemsPlugin } from "../src/items.js";
import type { Timeline } from "../src/index.js";
import { mountStory, storyCss, storyHtml, STORY_STRINGS } from "../src/story.js";
import type { StoryChange } from "../src/story.js";

// Background items, in the last test, are the items plugin's.
registerPlugin(itemsPlugin);

/**
 * Storytelling through the live instance, in a real Chromium: the story panel tells
 * the items' slides in time order and moves the timeline with it; the
 * timeline's selection opens a slide; the keys page; the address names the
 * slide and is followed; a provider's player loads only when asked and
 * keeps playing through live data; TimelineJS's HTML keeps its text and
 * loses everything that runs.
 */

const DAY = 86_400_000;
const T0 = Date.UTC(1969, 6, 16);

const story = fromTimelineJS({
  title: { text: { headline: "Apollo 11", text: "<p>Eight days</p>" } },
  events: [
    { start_date: { year: 1969, month: 7, day: 20, hour: 20, minute: 17 }, unique_id: "eagle", group: "Flight", text: { headline: "<i>Eagle</i> lands", text: '<p onclick="x()">Tranquillity <b>Base</b><script>window.__bad = 1</script><img src="x" onerror="window.__bad = 2"></p>' } },
    { start_date: { year: 1969, month: 7, day: 16, hour: 13, minute: 32 }, unique_id: "launch", group: "Flight", text: { headline: "Launch" }, media: { url: "https://www.youtube.com/watch?v=abcdefghijk", title: "The launch, filmed" } },
    { start_date: { year: 1969, month: 7, day: 24 }, unique_id: "splash", group: "Ocean", text: { headline: "Splashdown", text: '<a href="javascript:alert(1)">bad</a> <a href="https://nasa.gov">good</a>' }, media: { url: "https://upload.example.org/pacific.jpg", alt: "The Pacific", caption: "<b>Hornet</b>", credit: "NASA" }, background: { color: "#123456" } },
  ],
});

afterEach(() => {
  document.body.replaceChildren();
  history.replaceState(null, "", location.pathname + location.search);
});

async function mount(items: Item<StoryData>[] = story.items): Promise<{ timeline: Timeline<StoryData>; panel: HTMLDivElement }> {
  const panel = document.createElement("div");
  panel.style.cssText = "width:900px;height:320px";
  const element = document.createElement("div");
  element.style.cssText = "width:900px;height:200px;position:relative";
  document.body.append(panel, element);
  const timeline = createTimeline<StoryData>(element, { items, lanes: story.lanes, domain: [T0 - 30 * DAY, T0 + 30 * DAY], height: 200, timeZone: "UTC" });
  await vi.waitFor(() => {
    if (timeline.result === undefined || element.querySelector("svg [role=option]") === null) throw new Error("not drawn yet");
  });
  return { timeline, panel };
}

const headline = (panel: HTMLElement): string => panel.querySelector(".tl-story-headline")?.textContent ?? "";

describe("the story panel", () => {
  it("tells the slides in time order after the title, and moves the timeline with them", async () => {
    const { timeline, panel } = await mount();
    const changes: StoryChange<StoryData>[] = [];
    const handle = mountStory(panel, timeline, { title: story.title, locale: "en-GB", onChange: (change) => changes.push(change) });
    await vi.waitFor(() => expect(headline(panel)).toBe("Apollo 11"));
    expect(handle.count).toBe(4);
    expect(handle.id).toBeNull();
    expect(panel.querySelector(".tl-story-position")?.textContent).toBe("Title");
    expect(panel.querySelector<HTMLButtonElement>(".tl-story-previous")?.disabled).toBe(true);
    // The title slide shows the whole story.
    const [low, high] = timeline.getSnapshot().domain;
    expect(low).toBeLessThanOrEqual(Date.UTC(1969, 6, 16, 13, 32));
    expect(high).toBeGreaterThanOrEqual(Date.UTC(1969, 6, 24));

    expect(handle.next()).toBe(true);
    expect(handle.id).toBe("launch");
    expect(headline(panel)).toBe("Launch");
    expect(panel.querySelector(".tl-story-date")?.textContent).toBe("16 July 1969 at 13:32");
    expect(panel.querySelector(".tl-story-position")?.textContent).toBe("1 of 3");
    timeline.flush();
    expect(timeline.getSnapshot().selectedIds).toEqual(["launch"]);
    expect(panel.querySelector(".tl-story-said")?.textContent).toBe("Slide 1 of 3: Launch, 16 July 1969 at 13:32");

    expect(handle.go("splash")).toBe(true);
    // The jump is animated, as the keyboard's is: it lands with the item in the middle.
    await vi.waitFor(() => {
      timeline.flush();
      const [from, to] = timeline.getSnapshot().domain;
      expect(Math.abs((from + to) / 2 - Date.UTC(1969, 6, 24))).toBeLessThan(60_000);
    });
    expect(panel.querySelector<HTMLButtonElement>(".tl-story-next")?.disabled).toBe(true);
    expect(handle.next()).toBe(false);
    expect(handle.go("nothing")).toBe(false);
    expect(handle.go(9)).toBe(false);
    expect(changes.map((change) => [change.index, change.id, change.source])).toEqual([
      [0, null, "panel"],
      [1, "launch", "panel"],
      [3, "splash", "panel"],
    ]);
    // The opening move is not said: nothing changed for the reader yet.
    handle.destroy();
    expect(panel.querySelector(".tl-story")).toBeNull();
    handle.destroy();
  });

  it("opens the slide of the item the timeline selects", async () => {
    const { timeline, panel } = await mount();
    const handle = mountStory(panel, timeline, { reveal: false });
    await vi.waitFor(() => expect(headline(panel)).toBe("Launch"));
    const before = timeline.getSnapshot().domain;
    timeline.select(["eagle"]);
    expect(handle.id).toBe("eagle");
    expect(headline(panel)).toBe("Eagle lands");
    expect(panel.querySelector(".tl-story-position")?.textContent).toBe("2 of 3");
    // Two at once, or none, is not a slide.
    timeline.select(["eagle", "splash"]);
    timeline.select([]);
    expect(handle.id).toBe("eagle");
    // reveal: false leaves the view where it is.
    handle.next();
    expect(timeline.getSnapshot().domain).toEqual(before);
    handle.destroy();
  });

  it("pages with the arrows, Home and End, and keeps the focus on a button that can still move", async () => {
    const { timeline, panel } = await mount();
    const handle = mountStory(panel, timeline, { title: story.title });
    await vi.waitFor(() => expect(headline(panel)).toBe("Apollo 11"));
    const next = panel.querySelector<HTMLButtonElement>(".tl-story-next");
    const previous = panel.querySelector<HTMLButtonElement>(".tl-story-previous");
    next?.focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(handle.index).toBe(1);
    await userEvent.keyboard("{End}");
    expect(handle.index).toBe(3);
    await userEvent.keyboard("{Home}");
    expect(handle.index).toBe(0);
    await userEvent.keyboard("{Home}");
    expect(handle.index).toBe(0);
    await userEvent.keyboard("{ArrowLeft}");
    expect(handle.index).toBe(0);
    await userEvent.click(next as HTMLButtonElement);
    // Chromium and Firefox focus a button on a click; Safari (WebKit) does
    // not, by design, and a click there leaves the focus on the page.
    const clickFocuses = document.activeElement === next;
    await userEvent.click(next as HTMLButtonElement);
    await userEvent.click(next as HTMLButtonElement);
    expect(handle.index).toBe(3);
    expect(document.activeElement).toBe(clickFocuses ? previous : document.body);
    previous?.focus();
    await userEvent.keyboard("{ArrowLeft}{ArrowLeft}{ArrowLeft}");
    expect(handle.index).toBe(0);
    expect(document.activeElement).toBe(next);
    // With a modifier the arrows are the page's.
    await userEvent.keyboard("{Alt>}{ArrowRight}{/Alt}");
    expect(handle.index).toBe(0);
    handle.destroy();
  });

  it("names the slide in the address, opens on it, and follows it", async () => {
    history.replaceState(null, "", "#tale-splash");
    const { timeline, panel } = await mount();
    const changes: string[] = [];
    const handle = mountStory(panel, timeline, { title: story.title, hash: "tale-", onChange: ({ id, source }) => changes.push(`${String(id)}:${source}`) });
    await vi.waitFor(() => expect(headline(panel)).toBe("Splashdown"));
    handle.go("launch");
    expect(location.hash).toBe("#tale-launch");
    location.hash = "#tale-eagle";
    await vi.waitFor(() => expect(handle.id).toBe("eagle"));
    // The story's own hashchange listener came first: once ours has run, it has too.
    const hashChanged = (): Promise<void> => new Promise((resolve) => addEventListener("hashchange", () => resolve(), { once: true }));
    let changed = hashChanged();
    location.hash = "#elsewhere";
    await changed;
    expect(handle.id).toBe("eagle");
    handle.go(0);
    expect(location.hash).toBe("");
    expect(changes).toEqual(["splash:hash", "launch:panel", "eagle:hash", "null:panel"]);
    handle.destroy();
    changed = hashChanged();
    location.hash = "#tale-splash";
    await changed;
    expect(changes).toHaveLength(4);
  });

  it("opens on the slide asked for, with the default prefix", async () => {
    history.replaceState(null, "", "#story-nothing");
    const { timeline, panel } = await mount();
    const handle = mountStory(panel, timeline, { hash: true, start: "eagle" });
    await vi.waitFor(() => expect(handle.id).toBe("eagle"));
    expect(location.hash).toBe("#story-eagle");
    history.replaceState(null, "", "#story-%E0%A4%A");
    const other = mountStory(document.body.appendChild(document.createElement("div")), timeline, { hash: true, start: 2 });
    expect(other.index).toBe(2);
    handle.destroy();
    other.destroy();
  });

  it("loads a provider's player only when asked, and keeps it through live data", async () => {
    const { timeline, panel } = await mount();
    const handle = mountStory(panel, timeline, { locale: "en-GB" });
    await vi.waitFor(() => expect(headline(panel)).toBe("Launch"));
    expect(panel.querySelector("iframe")).toBeNull();
    const load = panel.querySelector<HTMLButtonElement>(".tl-story-load");
    expect(load?.getAttribute("aria-label")).toBe("Load the YouTube player: The launch, filmed. It is loaded from youtube.com when you ask for it.");
    load?.click();
    const frame = panel.querySelector("iframe");
    expect(frame?.src).toBe("https://www.youtube-nocookie.com/embed/abcdefghijk");
    expect(frame?.title).toBe("The launch, filmed");
    // Sandboxed: the player plays and opens its own links, but cannot navigate the page or reach it.
    expect(frame?.sandbox.value.split(" ").sort()).toEqual(["allow-popups", "allow-popups-to-escape-sandbox", "allow-presentation", "allow-same-origin", "allow-scripts"]);
    expect(document.activeElement).toBe(frame);
    // Another item moves: the slide stays as drawn, the player with it.
    timeline.updateItems([{ id: "splash", start: Date.UTC(1969, 6, 25) }]);
    expect(panel.querySelector("iframe")).toBe(frame);
    // Its own item moves: the date changes, so the slide is drawn again.
    timeline.updateItems([{ id: "launch", start: Date.UTC(1969, 6, 15, 13, 32) }]);
    expect(panel.querySelector("iframe")).toBeNull();
    expect(panel.querySelector(".tl-story-date")?.textContent).toBe("15 July 1969 at 13:32");
    // The item goes: the panel stays where it was in the order.
    timeline.removeItems(["launch"]);
    expect(handle.count).toBe(2);
    expect(handle.id).toBe("eagle");
    handle.destroy();
  });

  it("loads players with the slide when told to, and shows images, links and edges", async () => {
    const { timeline, panel } = await mount();
    const handle = mountStory(panel, timeline, { media: "eager", locale: "en-GB" });
    await vi.waitFor(() => expect(panel.querySelector("iframe")).not.toBeNull());
    handle.go("splash");
    const image = panel.querySelector("img");
    expect(image?.alt).toBe("The Pacific");
    expect(image?.loading).toBe("lazy");
    expect(panel.querySelector(".tl-story-caption")?.innerHTML).toBe('<b>Hornet</b><span class="tl-story-credit">NASA</span>');
    const slide = panel.querySelector<HTMLElement>(".tl-story-slide");
    expect(slide?.style.getPropertyValue("--tl-s-slide")).toBe("#123456");
    expect(slide?.dataset.tlSlide).toBe("splash");
    expect([...(panel.querySelectorAll(".tl-story-text a") ?? [])].map((a) => a.getAttribute("href"))).toEqual(["https://nasa.gov/"]);
    handle.go("eagle");
    expect(slide?.style.getPropertyValue("--tl-s-slide")).toBe("");
    handle.destroy();
  });

  it("reads its slides from the host, words its own way, and is empty without any", async () => {
    const { timeline, panel } = await mount();
    const handle = mountStory(panel, timeline, {
      slide: (item) => (item.id === "splash" ? undefined : { headline: item.id, media: { url: "https://en.wikipedia.org/wiki/Apollo_11" } }),
      formatDate: (item) => `T${String(item.start)}`,
      strings: { next: "Weiter", position: "{index}/{count}", openMedia: "Auf {host}" },
      headingLevel: 4,
      theme: "dark",
    });
    await vi.waitFor(() => expect(panel.querySelector("h4")?.textContent).toBe("launch"));
    expect(handle.count).toBe(2);
    expect(panel.querySelector(".tl-story-next")?.textContent).toBe("Weiter →");
    expect(panel.querySelector(".tl-story-position")?.textContent).toBe("1/2");
    expect(panel.querySelector(".tl-story-date")?.textContent).toBe(`T${String(Date.UTC(1969, 6, 16, 13, 32))}`);
    expect(panel.querySelector(".tl-story-link")?.textContent).toBe("Auf en.wikipedia.org");
    expect(panel.querySelector<HTMLElement>(".tl-story")?.dataset.tlTheme).toBe("dark");
    handle.destroy();

    const none = mountStory(panel, timeline, { slide: () => undefined, theme: { name: "mine", tokens: { ...JSON.parse(JSON.stringify((await import("@temporeum/timeline-core")).LIGHT_THEME.tokens)), text: "#010203" } } });
    expect(none.count).toBe(0);
    expect(none.id).toBeNull();
    expect(panel.querySelector(".tl-story-slide")?.childElementCount).toBe(0);
    expect(panel.querySelector<HTMLElement>(".tl-story")?.style.getPropertyValue("--tl-s-text")).toBe("#010203");
    expect(none.next()).toBe(false);
    none.destroy();
  });

  it("takes an item's label for a missing headline, and leaves background items out", async () => {
    const items: Item<StoryData>[] = [
      { id: "a", label: "Labelled", laneId: "group-flight", start: T0, data: { story: { text: "x" } } },
      { id: "b", start: T0 + DAY, kind: "background", end: T0 + 2 * DAY, data: { story: { headline: "Never" } } },
      { id: "c", label: "Plain", laneId: "group-flight", start: T0 + 3 * DAY },
    ];
    const { timeline, panel } = await mount(items);
    const handle = mountStory(panel, timeline);
    await vi.waitFor(() => expect(headline(panel)).toBe("Labelled"));
    expect(handle.count).toBe(1);
    handle.destroy();
  });
});

describe("the story panel's edges", () => {
  it("shows video, sound, linked images, thumbnails and links, and nothing for an address that is not media", async () => {
    const at = (day: number): number => T0 + day * DAY;
    const items: Item<StoryData>[] = [
      { id: "v", start: at(0), laneId: "l", data: { story: { headline: "Video", date: "Some day", media: { url: "https://cdn.example.org/clip.mp4", alt: "The clip" } } } },
      { id: "s", start: at(1), laneId: "l", data: { story: { media: { url: "https://cdn.example.org/talk.mp3" } } } },
      { id: "i", start: at(2), laneId: "l", data: { story: { headline: "Linked", media: { url: "https://cdn.example.org/a.png", link: "https://example.org/a", credit: "Someone" } } } },
      { id: "t", start: at(3), laneId: "l", data: { story: { headline: "Thumb", media: { url: "https://vimeo.com/76979871", thumbnail: "https://cdn.example.org/t.jpg", alt: "A film" } } } },
      { id: "k", start: at(4), laneId: "l", data: { story: { headline: "Link", media: { url: "page.html" } } } },
      { id: "n", start: at(4), laneId: "l", data: { story: { headline: "Not media", media: { url: "javascript:alert(1)" } } } },
      { id: "w", start: at(5), end: at(60), laneId: "l", data: { story: { headline: "A long span" } } },
    ];
    const panel = document.createElement("div");
    panel.style.cssText = "width:900px;height:320px";
    const element = document.createElement("div");
    element.style.cssText = "width:900px;height:200px;position:relative";
    document.body.append(panel, element);
    const timeline = createTimeline<StoryData>(element, { items, lanes: [{ id: "l" }], domain: [T0 - 10 * DAY, T0 + 10 * DAY], height: 200, timeZone: "UTC" });
    // Mounted before the timeline's first frame: the opening move waits for it.
    const handle = mountStory(panel, timeline, { locale: "en-GB", timeZone: "Europe/Budapest" });
    await vi.waitFor(() => expect(panel.querySelector("video")).not.toBeNull());
    expect(panel.querySelector("video")?.getAttribute("aria-label")).toBe("The clip");
    expect(panel.querySelector(".tl-story-date")?.textContent).toBe("Some day");
    // A key inside a player is the player's.
    panel.querySelector("video")?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(handle.index).toBe(0);
    // A key the panel does not use is left alone.
    const other = new KeyboardEvent("keydown", { key: "x", bubbles: true, cancelable: true });
    panel.querySelector(".tl-story-next")?.dispatchEvent(other);
    expect(other.defaultPrevented).toBe(false);
    handle.next();
    expect(panel.querySelector("audio")?.getAttribute("aria-label")).toBe("");
    expect(panel.querySelector(".tl-story-headline")).toBeNull();
    // `hour: "numeric"` is the engine's to pad: en-GB is "1:00" in Chromium and WebKit, "01:00" in Firefox.
    expect(panel.querySelector(".tl-story-date")?.textContent?.replace(/\b0(\d):/u, "$1:")).toBe("17 July 1969 at 1:00");
    handle.next();
    expect(panel.querySelector(".tl-story-media a")?.getAttribute("href")).toBe("https://example.org/a");
    expect(panel.querySelector(".tl-story-media img")?.getAttribute("alt")).toBe("");
    expect(panel.querySelector(".tl-story-caption")?.textContent).toBe("Someone");
    handle.next();
    expect(panel.querySelector<HTMLElement>(".tl-story-load")?.style.backgroundImage).toContain("t.jpg");
    handle.next();
    expect(panel.querySelector(".tl-story-link")?.textContent).toBe("Open on page.html");
    handle.next();
    expect(panel.querySelector(".tl-story-media")).toBeNull();
    // Longer than the view: the view zooms out to it.
    handle.next();
    await vi.waitFor(() => {
      timeline.flush();
      const [from, to] = timeline.getSnapshot().domain;
      expect(from).toBeLessThanOrEqual(T0 + 5 * DAY);
      expect(to).toBeGreaterThanOrEqual(T0 + 60 * DAY);
    });
    handle.destroy();
  });

  it("says the title slide by its headline, or by its name alone, and keeps it through live data", async () => {
    const { timeline, panel } = await mount();
    const handle = mountStory(panel, timeline, { title: { text: "No headline" }, strings: { position: "{index}/{count}/{missing}" } });
    await vi.waitFor(() => expect(panel.querySelector(".tl-story-text")?.textContent).toBe("No headline"));
    handle.next();
    expect(panel.querySelector(".tl-story-position")?.textContent).toBe("1/3/{missing}");
    handle.previous();
    expect(panel.querySelector(".tl-story-said")?.textContent).toBe("Title");
    timeline.updateItems([{ id: "eagle", start: Date.UTC(1969, 6, 21) }]);
    expect(handle.index).toBe(0);
    expect(panel.querySelector(".tl-story-text")?.textContent).toBe("No headline");
    handle.destroy();
    const titled = mountStory(panel, timeline, { title: story.title, reveal: true });
    titled.go(2);
    titled.go(0);
    expect(panel.querySelector(".tl-story-said")?.textContent).toBe("Title: Apollo 11");
    titled.destroy();
  });

  it("keeps two items of one time in their order, and goes nowhere with a title and no items", async () => {
    const { timeline, panel } = await mount([
      { id: "second", label: "B", laneId: "group-flight", start: T0, data: { story: {} } },
      { id: "first", label: "A", laneId: "group-flight", start: T0, data: { story: {} } },
    ]);
    const handle = mountStory(panel, timeline);
    await vi.waitFor(() => expect(handle.id).toBe("second"));
    handle.next();
    expect(handle.id).toBe("first");
    handle.destroy();
    timeline.setItems([]);
    const lone = mountStory(panel, timeline, { title: { headline: "Alone" } });
    expect(lone.count).toBe(1);
    lone.go(0);
    expect(panel.querySelector(".tl-story-headline")?.textContent).toBe("Alone");
    lone.destroy();
  });

  it("stops before its first move when destroyed first", async () => {
    const panel = document.createElement("div");
    const element = document.createElement("div");
    element.style.cssText = "width:600px;height:200px;position:relative";
    document.body.append(panel, element);
    const timeline = createTimeline<StoryData>(element, { items: story.items, lanes: story.lanes, domain: [T0, T0 + 10 * DAY], height: 200 });
    const changes: string[] = [];
    const handle = mountStory(panel, timeline, { onChange: ({ id }) => changes.push(String(id)) });
    handle.destroy();
    await vi.waitFor(() => {
      if (timeline.result === undefined) throw new Error("not drawn yet");
    });
    expect(changes).toEqual([]);
  });
});

describe("storyHtml", () => {
  it("keeps the text, the emphasis, the lists and safe links, and nothing that runs", () => {
    const fragment = storyHtml(
      document,
      '<p class="x" style="color:red">One <strong>two</strong> <a href="/rel" title="t">three</a> <a href="mailto:a@b.c">mail</a> <a>none</a></p><ul><li>four</li></ul><script>window.__bad=1</script><div><abbr title="National">NASA</abbr> <time datetime="1969-07-20">then</time> <font>kept</font></div><iframe src="https://evil"></iframe>',
    );
    const box = document.createElement("div");
    box.append(fragment);
    expect(box.innerHTML).toBe(
      `<p>One <strong>two</strong> <a href="${new URL("/rel", document.baseURI).href}" rel="noopener noreferrer" target="_blank">three</a> <a href="mailto:a@b.c" rel="noopener noreferrer" target="_blank">mail</a> none</p><ul><li>four</li></ul><abbr title="National">NASA</abbr> <time datetime="1969-07-20">then</time> kept`,
    );
    expect((window as unknown as { __bad?: number }).__bad).toBeUndefined();
  });

  it("keeps a heading's inline part only", () => {
    const box = document.createElement("div");
    box.append(storyHtml(document, "<p><i>The</i> Eagle</p><p>has landed</p><!-- note -->", { inline: true }));
    expect(box.innerHTML).toBe("<i>The</i> Eagle has landed ");
  });

  it("ships its stylesheet and its words", () => {
    expect(storyCss()).toContain(".tl-story-slide");
    expect(STORY_STRINGS.next).toBe("Next");
  });
});
