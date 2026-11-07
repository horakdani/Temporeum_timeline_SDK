# Temporeum Timeline

An editable, responsive timeline for the web — from millennia down to seconds, with collision-free lanes, a keyboard equivalent for every gesture, server rendering, and **zero runtime dependencies** in the engine.

::: example showcase-chronicle

Five thousand years in one timeline, from the first pharaohs to the Moon landing, zoomable down to the minutes of Apollo 11 — and none of it the library's own look. The colours, the fonts, the overview strip, the bars' content and the story panel are the page's: a theme, `metrics`, `slots`, `className`s and a little CSS ([theming](guides/theming.md)). Twenty-one moments are a [story](guides/storytelling.md) told by a camera that flies the view; press **Play the tour**. Switch on **Rewrite history** and the same timeline is editable: drag an event, resize an era, take it back with **Undo** — every edit is a command with an exact inverse ([editing](guides/editing.md)). The overview strip is a lens you can pull on every edge to zoom across and down the lanes, the mouse wheel zooms around the pointer, **PNG** saves the view as it is, **PDF** and **Print** take the whole chronicle on paper ([export](guides/export.md)). It works with the keyboard alone, and on a phone. The code is under the demo; more demos — a Gantt chart of 313 tasks among them — are on the [showcase](showcase.md).

The smallest timeline is this:

::: example quick-start

That is the whole of it: a container, items, named rows, and an event when someone edits. Every example on this site is live — change the code and press **Run** — and it runs the same bundles you install.

## What it is for

It is built to have five properties at the same time:

- **Editable.** Drag and resize, with reversible commands: every edit comes out as a command whose `inverse` is the undo.
- **Genuinely responsive.** A vertical phone layout is the same code path as the horizontal desktop one, chosen by the container's width, not a separate build.
- **Accessible.** Every gesture has a keyboard twin, the timeline is a listbox a screen reader can walk, and axe finds 0 WCAG 2.2 AA violations on every page of this site and every state of the demo pages.
- **Light.** The engine has no dependencies: its scale and tick maths are its own. What a page does not use — the Gantt chart, the time tools, nested groups, other languages — is a plugin it never downloads: a plain timeline's page loads 58.38 kB of JavaScript minified and gzipped, a Gantt chart's 66.29 kB (as the [field benchmark](benchmark-field.md) measures). The `<script>` tag's UMD file is the exception: it carries every plugin, nearly twice a plain timeline's page, so a page that minds its bytes imports the modules.
- **Typed.** No `any` on the public surface, enforced in CI.

It tells stories too: one slide at a time with images and video, beside the timeline, and [TimelineJS](https://timeline.knightlab.com/)'s stories — its JSON and its Google Sheet — load as they are ([storytelling](guides/storytelling.md)). There is no page here that turns a sheet into an embed code: your page reads the sheet. The core of this library is a lot of editable data in lanes.

## Packages

| Package | For |
|---|---|
| `@temporeum/timeline-element` | `createTimeline` — the live timeline — and `<temporeum-timeline>`, the custom element. Server rendering. The parts a plain timeline does not need are plugins on its [entry points](reference/entry-points.md#the-elements-entry-points). Start here. |
| `@temporeum/timeline-react` | `<Timeline>` and `useTimelineState` for React 18 and 19. |
| `@temporeum/timeline-vue` | `<Timeline>` and `useTimelineState` for Vue 3. |
| `@temporeum/timeline-svelte` | `<Timeline>` and `timelineState` for Svelte 5. |
| `@temporeum/timeline-angular` | `<tl-timeline>` and `timelineState` for Angular, standalone and zoneless. |
| `@temporeum/timeline-core` | The engine: geometry, layout, rendering, input, keyboard, loading, clustering — DOM-free, for building your own shell. |

## Where to go next

- [Getting started](getting-started.md): install, and the three ways in.
- [Recipes](recipes/gantt.md): a Gantt plan, an event log, a chronology, a roadmap.
- [Frameworks](frameworks.md): starter projects for plain JavaScript, React, Next, Vue, Nuxt, Svelte, Angular and Astro.
- [The benchmark](benchmark.md), including where it falls short.
- [Stability](stability.md): what 1.0 promises, and what it does not.
