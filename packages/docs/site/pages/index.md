# Temporeum Timeline

An editable, responsive timeline for the web — from millennia down to seconds, with collision-free lanes, a keyboard equivalent for every gesture, server rendering, and **zero runtime dependencies** in the engine.

::: example showcase-gantt

A product launch of 313 tasks in twelve streams, drawn as a Gantt chart: dependencies, baselines, progress and milestones from the [Gantt plugin](guides/gantt.md), the critical path and the reschedule from [the scheduler](guides/scheduling.md), the team's load from [the resource view](guides/resources.md). Every edit is a command, so Undo is exact. On a phone it turns vertical. More demos are on the [showcase](showcase.md).

The smallest timeline is this:

::: example quick-start

That is the whole of it: a container, items, lanes, and an event when someone edits. Every example on this site is live — change the code and press **Run** — and it runs the same bundles you install.

## What it is for

Not one more read-only chronology widget. The gap is five properties at the same time:

- **Editable.** Drag and resize, with reversible commands: every edit comes out as a command whose `inverse` is the undo.
- **Genuinely responsive.** A vertical phone layout is the same code path as the horizontal desktop one, chosen by the container's width, not a separate build.
- **Accessible.** Every gesture has a keyboard twin, the timeline is a listbox a screen reader can walk, and axe finds 0 WCAG 2.2 AA violations on every page of this site and every state of the demo pages.
- **Light.** The engine has no dependencies: its scale and tick maths are its own. What a page does not use — the Gantt chart, the time tools, nested groups, other languages — is a plugin it never downloads: a plain timeline's page loads 50.51 kB of JavaScript minified and gzipped, a Gantt chart's 58.34 kB (as the [field benchmark](benchmark-field.md) measures), against 155.8 kB for vis-timeline's standalone build ([benchmark](benchmark.md)).
- **Typed.** No `any` on the public surface, enforced in CI.

It tells stories too: one slide at a time with images and video, beside the timeline, and [TimelineJS](https://timeline.knightlab.com/)'s stories — its JSON and its Google Sheet — load as they are ([storytelling](guides/storytelling.md)). Where TimelineJS still leads is writing a story without code: its page turns a sheet into an embed. The core of this library is a lot of editable data in lanes.

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
- [Frameworks](frameworks.md): starter projects for plain JavaScript, React, Vue, Next, Nuxt and Astro.
- [The benchmark](benchmark.md), including where it loses.
- [Stability](stability.md): what 1.0 promises, and what it does not.
