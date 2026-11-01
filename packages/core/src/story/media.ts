/**
 * What a slide's media link is, and how it is shown.
 *
 * A URL is sorted by its address alone — nothing is fetched. An image, a
 * video or a sound file is drawn by the browser's own element; YouTube,
 * Vimeo, SoundCloud, Spotify and a Google Maps embed by the provider's
 * player, at an address of the provider's own embed host (YouTube's without
 * cookies, Vimeo's without tracking). Anything else is a link: an iframe of
 * an arbitrary page is not something a story should open on its own.
 */

/** How a slide's media is shown. */
export type StoryMediaKind = "image" | "video" | "audio" | "youtube" | "vimeo" | "soundcloud" | "spotify" | "map" | "link";

/** A media link, sorted. */
export interface StoryMediaSource {
  readonly kind: StoryMediaKind;
  /** The address as given. */
  readonly url: string;
  /** The player's address, for the kinds drawn in an iframe. */
  readonly embed?: string;
  /** The host the media comes from, as people read it ("youtube.com"); empty for a relative or `data:` address. */
  readonly host: string;
}

const IMAGE = /\.(?:jpe?g|png|gif|webp|avif|svg|bmp)$/i;
const VIDEO = /\.(?:mp4|webm|ogv|mov|m4v)$/i;
const AUDIO = /\.(?:mp3|ogg|oga|wav|m4a|aac|flac|opus)$/i;
const DATA_IMAGE = /^data:image\/(?:png|jpeg|gif|webp|avif|svg\+xml)[;,]/i;
const RELATIVE = "https://relative.invalid/";

/** A YouTube start time in seconds: `90`, `90s`, `1m30s`, `1h2m3s`. */
function seconds(value: string | null): number | undefined {
  if (value === null || value === "") return undefined;
  if (/^\d+$/.test(value)) return Number(value);
  const match = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(value);
  if (match === null || match[0] === "") return undefined;
  return Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0);
}

function youtube(url: URL, host: string): string | undefined {
  let id: string | undefined;
  if (host === "youtu.be") id = url.pathname.slice(1).split("/")[0];
  else if (url.pathname === "/watch") id = url.searchParams.get("v") ?? undefined;
  else {
    const match = /^\/(?:embed|shorts|live|v)\/([^/?#]+)/.exec(url.pathname);
    id = match?.[1];
  }
  if (id === undefined || !/^[\w-]{6,20}$/.test(id)) return undefined;
  const start = seconds(url.searchParams.get("t") ?? url.searchParams.get("start"));
  return `https://www.youtube-nocookie.com/embed/${id}${start === undefined ? "" : `?start=${String(start)}`}`;
}

function vimeo(url: URL): string | undefined {
  const match = /^\/(?:video\/)?(\d+)(?:\/([\da-f]+))?\/?$/i.exec(url.pathname);
  if (match === null) return undefined;
  const hash = match[2] === undefined ? "" : `&h=${match[2]}`;
  return `https://player.vimeo.com/video/${match[1] ?? ""}?dnt=1${hash}`;
}

/**
 * Sort a media link: what it is, and the player's address for the kinds
 * that have one. `undefined` for an address that is not media at all — a
 * `javascript:` link, an empty string.
 */
export function storyMedia(url: string): StoryMediaSource | undefined {
  const given = url.trim();
  if (given === "") return undefined;
  if (DATA_IMAGE.test(given)) return { kind: "image", url: given, host: "" };
  let parsed: URL;
  try {
    parsed = new URL(given, RELATIVE);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return undefined;
  const relative = parsed.origin === new URL(RELATIVE).origin;
  const host = relative ? "" : parsed.hostname.replace(/^(?:www|m)\./, "");
  const path = parsed.pathname;
  if (IMAGE.test(path)) return { kind: "image", url: given, host };
  if (VIDEO.test(path)) return { kind: "video", url: given, host };
  if (AUDIO.test(path)) return { kind: "audio", url: given, host };
  if (host === "youtube.com" || host === "youtu.be" || host === "youtube-nocookie.com" || host === "music.youtube.com") {
    const embed = youtube(parsed, host);
    if (embed !== undefined) return { kind: "youtube", url: given, embed, host: "youtube.com" };
  }
  if (host === "vimeo.com" || host === "player.vimeo.com") {
    const embed = vimeo(parsed);
    if (embed !== undefined) return { kind: "vimeo", url: given, embed, host: "vimeo.com" };
  }
  if (host === "soundcloud.com" && path.split("/").filter(Boolean).length >= 2) {
    return { kind: "soundcloud", url: given, embed: `https://w.soundcloud.com/player/?url=${encodeURIComponent(given)}`, host };
  }
  if (host === "open.spotify.com") {
    const match = /^\/(?:embed\/)?(track|album|playlist|episode|show|artist)\/([A-Za-z0-9]+)/.exec(path);
    if (match !== null) return { kind: "spotify", url: given, embed: `https://open.spotify.com/embed/${match[1] ?? ""}/${match[2] ?? ""}`, host };
  }
  if ((host === "google.com" || host === "maps.google.com") && path.startsWith("/maps/embed")) {
    return { kind: "map", url: given, embed: parsed.href, host: "google.com" };
  }
  return { kind: "link", url: given, host };
}
