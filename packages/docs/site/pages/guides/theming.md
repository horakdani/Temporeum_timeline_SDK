# Theming

No colour is in the markup. Items carry classes, the classes read CSS custom properties (`--tl-*`), and the stylesheet that maps them is generated with the frame. Restyle the whole timeline with CSS alone; dark mode is not a second render.

::: example theming

```html excerpt:example/theming
  #timeline .tl[data-tl-theme="light"] {
    --tl-item-fill: #fde7f3;
    --tl-item-stroke: #a3195b;
    --tl-accent: #a3195b;
    --tl-focus: #a3195b;
  }
  #timeline .tl[data-tl-theme="light"] .urgent { --tl-item-fill: #ffd6a5; }
```

## The tokens

| Token | Paints |
|---|---|
| `--tl-surface`, `--tl-surface-alt` | the background, and banding and pinned lanes |
| `--tl-text`, `--tl-text-muted` | labels outside items, and tick labels |
| `--tl-line`, `--tl-line-strong` | ticks, minor and major |
| `--tl-item-fill`, `--tl-item-stroke`, `--tl-item-text` | items and the labels drawn on them |
| `--tl-accent` | clusters and loading dashes |
| `--tl-now`, `--tl-marker`, `--tl-era`, `--tl-era-text` | decorations |
| `--tl-focus` | the focus ring and the selection |

The tokens are declared on the timeline's root element (`.tl`), so set yours there, with a selector at least as specific — `#timeline .tl` — or on a single item through its `className`: the item's own declaration is the one its fill reads.

## Light, dark, auto

`theme: "auto"` (the default) follows `prefers-color-scheme`; `"light"` and `"dark"` pin it, which is what a page with its own theme switch needs. Changing it with `update({ theme })` swaps the tokens; the items are the same nodes. Both built-in themes pass WCAG AA contrast for every text pair; a custom fill has to carry the text drawn on it — which is why the example scopes its pale fills to the light theme. A theme of your own is an object, `{ name, tokens }`, with every token named (`LIGHT_THEME` and `DARK_THEME` from `@temporeum/timeline-core` are two), and it is type-checked.

## Sizes and type

Colours are CSS; sizes are configuration. The layout packs rows of a height and places labels it measured in a type size and a font, so a size set in a stylesheet would draw text into room measured for other text. `metrics` sets them over the density's:

```json excerpt:example/theming-element
      "metrics": { "rowSize": 36, "fontSize": 14, "lineHeight": 18, "cornerRadius": 10, "fontFamily": "Georgia, 'Times New Roman', serif" }
```

| Key | Sets |
|---|---|
| `rowSize`, `rowGap`, `laneGap` | a row's height (a column's width, vertical), and the gaps between rows and lanes |
| `fontSize`, `lineHeight`, `labelPadding` | the items' labels |
| `tickFontSize`, `axisSize` | the axis' labels, and the band they are in |
| `cornerRadius` | the items' corners |
| `fontFamily` | the font stack everything is drawn and measured in |

A function sets each level apart, or a row and a column: `metrics: (base) => ({ rowSize: base.rowSize + 8 })` gets the density's own sizes. What `density: "auto"` decides with stays the level's, and so does the smallest drawn item. A web font has to be loaded before the timeline measures with it (`await document.fonts.ready`); a size nothing can be drawn at, or a font stack that is not one, throws where it is configured. `timeline.metrics` says what the last frame was drawn with, for a panel lined up beside it. Under the element, the engine takes the sizes as a function of the level (`RenderOptions.metrics`, `densityMetrics` by default).

## Inside the custom element

`<temporeum-timeline>` draws in its shadow root, where a page's selectors do not reach. The page reaches it two ways:

- **The tokens, set on the element.** Inside the shadow root they are declared on `:host`, and a page's rule for the element wins over those whatever its specificity: `temporeum-timeline { --tl-item-fill: … }`, or a class on one element.
- **`::part()`, for any node.** Every node the timeline draws carries its classes as its parts, read without the `tl-` prefix: an item is `item`, a selected one `item item-selected`, the root `timeline`, a major tick's label `tick-label tick-label-major`, a group header `group`. A class of your own — an item's `className` — is a part as it is: `temporeum-timeline::part(urgent)`.

::: example theming-element

```html excerpt:example/theming-element
  temporeum-timeline {
    --tl-item-fill: #e6f4ea;
    --tl-item-stroke: #1e7b45;
  }
  temporeum-timeline::part(urgent) {
    fill: #ffe1c2;
    stroke: #a14a00;
  }
```

A server-rendered element (`renderTimelineHtml`) carries the same parts and tokens, so the page's rules apply before the script runs. An exported SVG or PNG is drawn with the theme's own stylesheet: the page's rules are not in the file. Outside a shadow root nothing has a part — the page's stylesheet reaches the classes themselves.

## Your own content in items

A label is one line of text. For more, there are two ways, both inside the item's box, both leaving the item's label as its accessible name:

- **`template`**, HTML a function returns, sanitised (`/items`; see [item kinds and templates](groups-and-item-kinds.md)). It is drawn on the server too.
- **`slots`**, a box a framework renders into: the React component's `renderItem`, the Vue component's `#item` slot ([frameworks](../frameworks.md#item-content)). Each drawn item gets a host element of its own, the same element for as long as the item is drawn — through pans, zooms and live data — and `slotsChanged` says when the items drawn are others, in the frame that drew them. Only the items on screen have one: ten thousand items render the few hundred in view.

::: example item-slots

```js excerpt:example/item-slots
const timeline = createTimeline(document.querySelector("#timeline"), {
  items,
  slots: true,
  ariaLabel: "Product sprint",
});
timeline.on("slotsChanged", ({ slots }) => render(slots));
render(timeline.slots());
```

The content is a picture of the item: the pointer and the keyboard act on the item itself, so a drag, a click and a key go where they do without it. Both need the `/items` plugin.
