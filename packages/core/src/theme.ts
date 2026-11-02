/**
 * Theme: every colour the timeline draws with, as CSS custom properties.
 *
 * The renderer never puts a colour in the markup. Items carry classes, and
 * the classes resolve to `var(--tl-*)`, which has two consequences worth
 * stating. A host restyles the whole timeline with CSS alone, without a
 * rebuild and without a theme object. And dark mode is not a second render:
 * the same scene reads different tokens.
 *
 * Dark mode follows the platform by default (`prefers-color-scheme`) and can
 * be pinned per instance. The pinned form is what a host with its own theme
 * switch needs, and it is also what makes a visual fixture reproducible —
 * "auto" would render the same bytes for both themes.
 *
 * Every token pair that carries text is contrast-checked in the tests against
 * WCAG AA (4.5:1 for text, 3:1 for the lines and the now marker). A theme that
 * looks right and fails the ratio is a theme that excludes readers.
 */

import type { DensityMetrics } from "./density.js";
import type { Orientation } from "./types.js";

/** The tokens a theme has to define. Named, so a custom theme is type-checked. */
export type ThemeTokenName =
  | "surface"
  | "surfaceAlt"
  | "text"
  | "textMuted"
  | "line"
  | "lineStrong"
  | "itemFill"
  | "itemStroke"
  | "itemText"
  | "accent"
  | "now"
  | "era"
  | "eraText"
  | "marker"
  | "focus";

/** A complete set of colours. */
export interface Theme {
  readonly name: string;
  readonly tokens: Readonly<Record<ThemeTokenName, string>>;
}

/** Which theme is active, or `auto` to follow the platform. */
export type ThemeSetting = "light" | "dark" | "auto" | Theme;

/** The default light theme. */
export const LIGHT_THEME: Theme = {
  name: "light",
  tokens: {
    surface: "#ffffff",
    surfaceAlt: "#f3f5f8",
    text: "#1a1d21",
    textMuted: "#5b6471",
    line: "#d8dce2",
    lineStrong: "#737b87",
    itemFill: "#dce9fd",
    itemStroke: "#5b8fd6",
    itemText: "#16222e",
    accent: "#2f6fd0",
    now: "#c62a4e",
    era: "#eceefb",
    eraText: "#3c3f66",
    marker: "#6f41ba",
    focus: "#1d4ed8",
  },
};

/** The default dark theme. */
export const DARK_THEME: Theme = {
  name: "dark",
  tokens: {
    surface: "#14171c",
    surfaceAlt: "#1b2027",
    text: "#e9edf2",
    textMuted: "#9aa4b2",
    line: "#2c323b",
    lineStrong: "#7b8494",
    itemFill: "#1e3350",
    itemStroke: "#4f82c8",
    itemText: "#e7f0fb",
    accent: "#79aef5",
    now: "#ff7a94",
    era: "#262237",
    eraText: "#c3c6e8",
    marker: "#b08ae8",
    focus: "#93b4ff",
  },
};

/** Both built-in themes, as the single source of truth for the visual matrix. */
export const THEMES: readonly Theme[] = [LIGHT_THEME, DARK_THEME];

/** The theme a setting selects, or `undefined` for `auto`. */
export function resolveTheme(setting: ThemeSetting): Theme | undefined {
  if (setting === "auto") {
    return undefined;
  }
  if (setting === "light") {
    return LIGHT_THEME;
  }
  if (setting === "dark") {
    return DARK_THEME;
  }
  return setting;
}

/** `surfaceAlt` to `--tl-surface-alt`. */
function cssVarName(token: string): string {
  return `--tl-${token.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
}

/** The tokens in forced colours: system colours only. */
const FORCED_TOKENS =
  "--tl-surface:Canvas;--tl-surface-alt:Canvas;--tl-text:CanvasText;--tl-text-muted:CanvasText;" +
  "--tl-line:GrayText;--tl-line-strong:CanvasText;--tl-item-fill:Canvas;--tl-item-stroke:CanvasText;" +
  "--tl-item-text:CanvasText;--tl-accent:CanvasText;--tl-now:CanvasText;--tl-era:Canvas;" +
  "--tl-era-text:CanvasText;--tl-marker:CanvasText;--tl-focus:Highlight";

function tokenBlock(theme: Theme): string {
  return Object.entries(theme.tokens)
    .map(([token, value]) => `${cssVarName(token)}:${value}`)
    .join(";");
}

/** What the generated stylesheet needs to know. */
export interface StyleOptions {
  readonly theme?: ThemeSetting;
  readonly metrics: DensityMetrics;
  /**
   * Scope every rule to one instance.
   *
   * Without it the rules land on `.tl`, which is the smallest output and
   * right for one timeline per document. Two timelines in one document would
   * then share one stylesheet and the last one rendered would decide the
   * theme and the type sizes for both — so a page with more than one passes
   * each its own id. Inside a shadow root (the web component, P11) the scope
   * is the root itself and this is not needed.
   */
  readonly scope?: string;
  /**
   * How the timeline shares touch gestures with the page.
   *
   * `own` (the default) takes every touch: the widget pans and pinches, and
   * the page under it does not scroll. That is right for a timeline that
   * fills the screen and wrong for one sitting in the middle of an article,
   * where it traps the reader's thumb. `cooperative` keeps the gesture along
   * the time axis and hands the other direction back to the page, so a
   * horizontal timeline still scrolls the article vertically.
   */
  readonly touchAction?: TouchActionMode;
  /** Which way time runs; `cooperative` needs it to know what to hand back. */
  readonly orientation?: Orientation;
}

/** Whether the widget claims every touch or shares one axis with the page. */
export type TouchActionMode = "own" | "cooperative";

const SAFE_SCOPE = /^[A-Za-z0-9_-]+$/;

/**
 * The `touch-action` the root gets.
 *
 * Cooperative mode keeps the axis time runs along and releases the other, so
 * the browser scrolls the page with the gesture the widget does not use.
 * `pinch-zoom` is deliberately absent from both: the widget zooms time, and
 * letting the browser zoom the page on top of that is the one combination
 * users read as broken.
 */
function touchActionValue(options: StyleOptions): string {
  if ((options.touchAction ?? "own") === "own") {
    return "none";
  }
  return (options.orientation ?? "horizontal") === "horizontal" ? "pan-y" : "pan-x";
}

/**
 * The default stylesheet for one render.
 *
 * Generated rather than shipped as a static file because the type sizes come
 * from the density metrics, and the label geometry was measured with exactly
 * those sizes. A stylesheet that disagreed with the measurement would place
 * text that does not fit the box the renderer reserved for it.
 */
export function timelineStyleCss(options: StyleOptions): string {
  const metrics = options.metrics;
  const setting = options.theme ?? "auto";
  const resolved = resolveTheme(setting);
  if (options.scope !== undefined && !SAFE_SCOPE.test(options.scope)) {
    throw new RangeError(
      `instanceId must be letters, digits, dash or underscore, got ${JSON.stringify(options.scope)}`,
    );
  }
  const root = options.scope === undefined ? ".tl" : `.tl[data-tl-instance="${options.scope}"]`;

  const tokens =
    resolved === undefined
      ? [
          `${root}{${tokenBlock(LIGHT_THEME)}}`,
          // The guard lets a host pin light inside a dark platform without a
          // specificity fight.
          `@media (prefers-color-scheme:dark){${root}:not([data-tl-theme="light"]){${tokenBlock(DARK_THEME)}}}`,
          `${root}[data-tl-theme="dark"]{${tokenBlock(DARK_THEME)}}`,
        ].join("")
      : `${root}{${tokenBlock(resolved)}}`;

  const structure = [
    `${root}{font-family:${metrics.fontFamily}}`,
    `${root} .tl-surface{fill:var(--tl-surface)}`,
    `${root} .tl-band{fill:var(--tl-surface-alt)}`,
    `${root} .tl-lane{fill:none}`,
    `${root} .tl-lane--pinned{fill:var(--tl-surface-alt)}`,
    `${root} .tl-tick{stroke:var(--tl-line);stroke-width:1}`,
    `${root} .tl-tick--major{stroke:var(--tl-line-strong)}`,
    `${root} .tl-tick-label{fill:var(--tl-text-muted);font-size:${metrics.tickFontSize}px}`,
    `${root} .tl-tick-label--major{fill:var(--tl-text)}`,
    `${root} .tl-axis-context{fill:var(--tl-surface)}`,
    `${root} .tl-item{fill:var(--tl-item-fill);stroke:var(--tl-item-stroke);stroke-width:1}`,
    `${root} .tl-item--open{stroke-dasharray:4 3}`,
    `${root} .tl-item--selected{stroke:var(--tl-focus);stroke-width:2}`,
    // An item's label is a line of HTML in a `foreignObject` (P17): it takes
    // `color`, and `fill` still for a host's own `<text>` label.
    `${root} .tl-label{fill:var(--tl-item-text);color:var(--tl-item-text);font-size:${metrics.fontSize}px;pointer-events:none}`,
    // The box was fitted to the text as measured. A reader's own spacing
    // (WCAG 1.4.12: wider letters, words and lines, `!important`) widens the
    // text past it: it is shortened with an ellipsis then, not cut through a
    // letter, and a taller line stays centred in the box.
    `${root} .tl-label>div{white-space:pre;margin:0;padding:0 0 0 ${String(metrics.labelPadding)}px;line-height:${String(metrics.lineHeight)}px;` +
      `height:100%;align-content:unsafe center;overflow:hidden;text-overflow:ellipsis}`,
    `${root} .tl-label--after{fill:var(--tl-text);color:var(--tl-text)}`,
    // A cluster is the accent with its count in the surface colour: a solid
    // badge, unlike any item, and the cursor says what a click does.
    `${root} .tl-cluster{fill:var(--tl-accent);stroke:var(--tl-surface);stroke-width:1;cursor:zoom-in}`,
    `${root} .tl-cluster--selected{stroke:var(--tl-focus);stroke-width:2}`,
    `${root} .tl-cluster-count{fill:var(--tl-surface);color:var(--tl-surface);font-weight:600}`,
    `${root} .tl-label--after.tl-cluster-count{fill:var(--tl-text);color:var(--tl-text)}`,
    `${root} .tl-era{fill:var(--tl-era)}`,
    `${root} .tl-era-label{fill:var(--tl-era-text);font-size:${metrics.tickFontSize}px}`,
    `${root} .tl-now{stroke:var(--tl-now);stroke-width:2}`,
    `${root} .tl-now-label{fill:var(--tl-now);font-size:${metrics.tickFontSize}px}`,
    `${root} .tl-marker{fill:var(--tl-marker)}`,
    `${root} .tl-marker-label{fill:var(--tl-marker);font-size:${metrics.tickFontSize}px}`,
    `${root} .tl-accent{fill:var(--tl-accent)}`,
    // Decision 7's visual half: focus has to be visible without a pointer —
    // on the timeline itself, which is the one focus stop, and on the item
    // the keyboard is on. The ring is its own shape, outside the item, so it
    // never reads as the selection; `non-scaling-stroke` keeps it two pixels
    // wide while a gesture stretches the layer it sits in; and it shows only
    // while the timeline has focus, as a focus indicator should.
    // The timeline's own ring is drawn inside its box: a host that clips
    // its container (`overflow: hidden`, a card, a scroll panel) would cut
    // a ring drawn outside it, and a focus indicator that is cut is not one.
    `${root}:focus-visible{outline:2px solid var(--tl-focus);outline-offset:-2px}`,
    `${root} :focus-visible{outline:2px solid var(--tl-focus);outline-offset:1px}`,
    `${root} .tl-focus-ring{fill:none;stroke:var(--tl-focus);stroke-width:2;vector-effect:non-scaling-stroke;pointer-events:none}`,
    `${root}:not(:focus) .tl-focus-ring{display:none}`,
    // What is still loading, on the axis. Told apart by shape as well as
    // colour (1.4.1): long dashes that move while a request runs, short still
    // dots where it failed. The motion is the dash offset, not the opacity,
    // so the mark keeps its contrast at every moment, and it stops for a
    // reader who asked for less motion.
    `${root} .tl-loading{stroke:var(--tl-accent);stroke-width:3;stroke-dasharray:10 5;` +
      `vector-effect:non-scaling-stroke;pointer-events:none;animation:tl-loading 0.9s linear infinite}`,
    `${root} .tl-loading--failed{stroke:var(--tl-now);stroke-dasharray:2 4;animation:none}`,
    `@keyframes tl-loading{to{stroke-dashoffset:-15}}`,
    `@media (prefers-reduced-motion:reduce){${root} .tl-loading{animation:none}}`,
    // Forced colours (Windows High Contrast and its kin): the reader's
    // palette, not the theme's. The browser does not repaint SVG, so the
    // tokens become system colours — and with them every shape that paints
    // from a token, the plugins' too. What is selected or focused is the
    // highlight, and wider as well.
    `@media (forced-colors:active){${root},${root}:not([data-tl-theme="light"]),${root}[data-tl-theme]{${FORCED_TOKENS}}` +
      `${root} .tl-item--selected,${root} .tl-cluster--selected,${root} .tl-focus-ring{stroke-width:3}}`,
    // The input layer's half of the stylesheet. Each of these is a default a
    // mobile browser hands you and a gesture-driven widget has to undo: the
    // browser's own pan and double-tap zoom fighting the widget's
    // (`touch-action`), a gesture at the edge scrolling the page instead
    // (`overscroll-behavior`), a drag selecting the labels it passes over
    // (`user-select`), and iOS flashing a grey box over every tap
    // (`tap-highlight-color`).
    `${root}{touch-action:${touchActionValue(options)};overscroll-behavior:contain;` +
      `-webkit-user-select:none;user-select:none;` +
      `-webkit-tap-highlight-color:transparent;cursor:grab}`,
    `${root}[data-tl-gesture="pan"],${root}[data-tl-gesture="pinch"]{cursor:grabbing}`,
    // A drag with no cursor change reads as a page that stopped responding.
    // The resize cursors are the main axis of the *screen*, so they differ by
    // orientation — the one place the stylesheet has to know which way the
    // timeline runs.
    `${root}[data-tl-edit="move"]{cursor:grabbing}`,
    `${root}[data-tl-edit="resize-start"],${root}[data-tl-edit="resize-end"]` +
      `{cursor:${metrics.orientation === "vertical" ? "ns-resize" : "ew-resize"}}`,
  ].join("");

  return `${tokens}${structure}`;
}
