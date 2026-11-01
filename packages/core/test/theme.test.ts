import { describe, expect, it } from "vitest";

import { densityMetrics } from "../src/density.js";
import {
  DARK_THEME,
  LIGHT_THEME,
  THEMES,
  resolveTheme,
  timelineStyleCss,
} from "../src/theme.js";
import type { Theme, ThemeTokenName } from "../src/theme.js";

/** WCAG relative luminance. */
function luminance(hex: string): number {
  const channel = (value: number): number => {
    const s = value / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return (
    0.2126 * channel(Number.parseInt(hex.slice(1, 3), 16)) +
    0.7152 * channel(Number.parseInt(hex.slice(3, 5), 16)) +
    0.0722 * channel(Number.parseInt(hex.slice(5, 7), 16))
  );
}

function contrastRatio(a: string, b: string): number {
  const first = luminance(a);
  const second = luminance(b);
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * The pairs that have to hold for the theme to be usable, with the WCAG
 * minimum for each: 4.5:1 wherever text sits on a surface, 3:1 for the
 * graphical marks that carry meaning on their own.
 */
const CONTRAST_PAIRS: readonly [ThemeTokenName, ThemeTokenName, number][] = [
  ["text", "surface", 4.5],
  ["textMuted", "surface", 4.5],
  // A banded row is still a row somebody reads.
  ["text", "surfaceAlt", 4.5],
  ["textMuted", "surfaceAlt", 4.5],
  ["itemText", "itemFill", 4.5],
  ["eraText", "era", 4.5],
  ["now", "surface", 3],
  ["lineStrong", "surface", 3],
  ["marker", "surface", 3],
  ["accent", "surface", 3],
  ["focus", "surface", 3],
];

describe("the built-in themes", () => {
  it("offers exactly light and dark, as the visual matrix's source of truth", () => {
    expect(THEMES.map((theme) => theme.name)).toEqual(["light", "dark"]);
  });

  it("defines every token in both themes", () => {
    const lightKeys = Object.keys(LIGHT_THEME.tokens).sort();
    const darkKeys = Object.keys(DARK_THEME.tokens).sort();
    expect(darkKeys).toEqual(lightKeys);
    expect(lightKeys.length).toBeGreaterThanOrEqual(15);
  });

  it("uses six-digit hex everywhere, which is what the contrast check assumes", () => {
    for (const theme of THEMES) {
      for (const [token, value] of Object.entries(theme.tokens)) {
        expect(value, `${theme.name}.${token}`).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
  });

  it.each(THEMES.map((theme) => [theme.name, theme] as const))(
    "meets WCAG AA in %s",
    (_name, theme: Theme) => {
      for (const [front, back, minimum] of CONTRAST_PAIRS) {
        const ratio = contrastRatio(theme.tokens[front], theme.tokens[back]);
        expect(ratio, `${front} on ${back}`).toBeGreaterThanOrEqual(minimum);
      }
    },
  );

  it("differs from light to dark in every token", () => {
    for (const token of Object.keys(LIGHT_THEME.tokens) as ThemeTokenName[]) {
      expect(DARK_THEME.tokens[token], token).not.toBe(LIGHT_THEME.tokens[token]);
    }
  });
});

describe("resolveTheme", () => {
  it("maps the names to the built-in themes", () => {
    expect(resolveTheme("light")).toBe(LIGHT_THEME);
    expect(resolveTheme("dark")).toBe(DARK_THEME);
  });

  it("returns nothing for auto, because the platform decides", () => {
    expect(resolveTheme("auto")).toBeUndefined();
  });

  it("passes a custom theme through", () => {
    const custom: Theme = { name: "brand", tokens: { ...LIGHT_THEME.tokens, accent: "#123456" } };
    expect(resolveTheme(custom)).toBe(custom);
  });
});

describe("timelineStyleCss", () => {
  const metrics = densityMetrics("compact", "horizontal");

  it("names tokens as kebab-cased custom properties", () => {
    const css = timelineStyleCss({ theme: "light", metrics });
    expect(css).toContain("--tl-surface-alt:#f3f5f8");
    expect(css).toContain("--tl-item-fill:");
    expect(css).not.toContain("--tl-surfaceAlt");
  });

  it("follows the platform under auto, and can still be pinned to light", () => {
    const css = timelineStyleCss({ metrics });
    expect(css).toContain("@media (prefers-color-scheme:dark)");
    expect(css).toContain('.tl:not([data-tl-theme="light"])');
    expect(css).toContain('.tl[data-tl-theme="dark"]');
  });

  it("emits one theme only when pinned, so a fixture differs between them", () => {
    const light = timelineStyleCss({ theme: "light", metrics });
    const dark = timelineStyleCss({ theme: "dark", metrics });
    expect(light).not.toContain("prefers-color-scheme");
    expect(dark).not.toContain("prefers-color-scheme");
    expect(light).not.toBe(dark);
    expect(dark).toContain(DARK_THEME.tokens.surface);
    expect(light).not.toContain(DARK_THEME.tokens.surface);
  });

  it("carries the type sizes the label geometry was measured with", () => {
    const css = timelineStyleCss({ theme: "light", metrics });
    expect(css).toContain(`font-size:${String(metrics.fontSize)}px`);
    expect(css).toContain(`font-size:${String(metrics.tickFontSize)}px`);
    expect(css).toContain(metrics.fontFamily);
  });

  it("gives every density its own sizes", () => {
    const dense = timelineStyleCss({
      theme: "light",
      metrics: densityMetrics("dense", "horizontal"),
    });
    expect(dense).not.toBe(timelineStyleCss({ theme: "light", metrics }));
  });

  it("styles focus visibly, which is the keyboard half of decision 7", () => {
    expect(timelineStyleCss({ metrics })).toContain(":focus-visible");
  });
});

describe("scoping the stylesheet to one instance", () => {
  const metrics = densityMetrics("compact", "horizontal");

  it("lands on .tl when nothing is scoped", () => {
    expect(timelineStyleCss({ theme: "light", metrics })).toContain(".tl{--tl-surface:");
  });

  it("prefixes every rule with the instance, tokens and classes alike", () => {
    const css = timelineStyleCss({ theme: "light", metrics, scope: "a1" });
    expect(css).toContain('.tl[data-tl-instance="a1"]{--tl-surface:');
    expect(css).toContain('.tl[data-tl-instance="a1"] .tl-item{');
    expect(css).not.toContain("}.tl-item{");
  });

  it("scopes the dark-mode query too, so two instances cannot fight over it", () => {
    const css = timelineStyleCss({ metrics, scope: "a1" });
    expect(css).toContain(
      '@media (prefers-color-scheme:dark){.tl[data-tl-instance="a1"]:not([data-tl-theme="light"]){',
    );
  });

  it("refuses an id that would break out of the selector", () => {
    expect(() => timelineStyleCss({ metrics, scope: 'a"] , * {color:red} .x[b="' })).toThrow(
      RangeError,
    );
  });
});

describe("sharing touch gestures with the page", () => {
  const metrics = densityMetrics("comfortable", "horizontal");

  it("claims every touch by default", () => {
    const css = timelineStyleCss({ metrics });
    expect(css).toContain("touch-action:none");
    // The other three defaults a mobile browser hands you and a
    // gesture-driven widget has to undo.
    expect(css).toContain("overscroll-behavior:contain");
    expect(css).toContain("user-select:none");
    expect(css).toContain("-webkit-tap-highlight-color:transparent");
  });

  it("hands the other axis back to the page when asked", () => {
    // A horizontal timeline in an article: dragging across pans time, and a
    // vertical swipe still scrolls the article instead of trapping the thumb.
    expect(
      timelineStyleCss({ metrics, touchAction: "cooperative", orientation: "horizontal" }),
    ).toContain("touch-action:pan-y");
    expect(
      timelineStyleCss({ metrics, touchAction: "cooperative", orientation: "vertical" }),
    ).toContain("touch-action:pan-x");
    // Orientation defaults to horizontal rather than throwing.
    expect(timelineStyleCss({ metrics, touchAction: "cooperative" })).toContain(
      "touch-action:pan-y",
    );
    // Neither mode ever leaves the browser's own pinch-zoom in play: the
    // widget zooms time, and both zooms at once reads as broken.
    expect(timelineStyleCss({ metrics, touchAction: "cooperative" })).not.toContain("pinch-zoom");
  });

  it("shows the grab cursor while a gesture runs", () => {
    const css = timelineStyleCss({ metrics });
    expect(css).toContain("cursor:grab");
    expect(css).toContain('[data-tl-gesture="pan"]');
    expect(css).toContain('[data-tl-gesture="pinch"]');
    expect(css).toContain("cursor:grabbing");
  });

  it("shows a resize cursor along the time axis, whichever way it runs", () => {
    const horizontal = timelineStyleCss({ metrics });
    expect(horizontal).toContain('[data-tl-edit="move"]{cursor:grabbing}');
    expect(horizontal).toContain("cursor:ew-resize");
    // A vertical timeline resizes up and down: the one place the stylesheet
    // has to know which way the axis runs.
    const vertical = timelineStyleCss({ metrics: densityMetrics("comfortable", "vertical") });
    expect(vertical).toContain("cursor:ns-resize");
    expect(vertical).not.toContain("ew-resize");
  });
});
