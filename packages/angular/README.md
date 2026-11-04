# @temporeum/timeline-angular

The timeline as an Angular standalone component, built on the shared
instance of [`@temporeum/timeline-element`](https://github.com/horakdani/Temporeum_timeline_SDK/tree/main/packages/web-component#readme).

```bash
npm install @temporeum/timeline-angular
```

The peer range is `@angular/core >=21.0.0 <23.0.0`. The package is compiled
the way the Angular Package Format asks — partially, for your build to link —
so one build serves Angular 21 and 22; the suite runs on the newest 21 and,
in CI, on 21.0.0, the lowest the range admits.

```ts excerpt:template/angular/src/app/app.ts
import { Component, signal } from "@angular/core";
import { TimelineComponent, timelineState } from "@temporeum/timeline-angular";
import type { TimelineConfig, TimelineInstance } from "@temporeum/timeline-angular";

const DAY = 86_400_000;
const t = Date.UTC(2026, 2, 2);

@Component({
  selector: "app-root",
  imports: [TimelineComponent],
  template: `
    <main style="padding: 16px">
      <tl-timeline [config]="config" (ready)="timeline.set($event)" (itemMoved)="onMoved($event)" />
      <p aria-live="polite">{{ log() }} {{ selected()?.length ?? 0 }} selected.</p>
    </main>
  `,
})
export class App {
  readonly config: TimelineConfig = {
    items: [
      { id: "design", label: "Design", laneId: "work", start: t, end: t + 7 * DAY },
      { id: "launch", label: "Launch", laneId: "ship", start: t + 25 * DAY, end: t + 32 * DAY },
    ],
    lanes: [
      { id: "work", label: "Work" },
      { id: "ship", label: "Shipping" },
    ],
    height: 320,
    ariaLabel: "Release plan",
    editing: { enabled: true, snapMs: DAY },
  };
  readonly timeline = signal<TimelineInstance | null>(null);
  readonly selected = timelineState(this.timeline, (state) => state.selectedIds);
  readonly log = signal("Drag an item.");

  onMoved({ item, to }: { item: { label?: string; start: number | Date }; to: { start?: number | Date } }): void {
    this.log.set(`${item.label ?? ""} moved to ${new Date(to.start ?? item.start).toDateString()}`);
  }
}
```

The whole project, with the Angular CLI, is the
[Angular template](https://github.com/horakdani/Temporeum_timeline_SDK/tree/main/packages/docs/templates/angular).

`[config]` takes the whole [`TimelineConfig`](https://horakdani.github.io/Temporeum_timeline_SDK/reference/api.html#configuration);
a new object whose fields hold the same values is no change, and only the
fields that changed reach the instance. Every instance event is an output by
its own name (`(itemMoved)`, `(selectionChanged)`, `(viewportChanged)`, …),
and `(ready)` hands over the live instance — `null` on destroy.

Each item's content can be an Angular template:
`<ng-template tlItem let-item>…</ng-template>` inside `<tl-timeline>`
(import `TimelineItemDirective`). It is rendered into the box over the item,
only for the items drawn, and keeps its state while its item is drawn; it
needs the element's `/items` plugin, as `template` does.

The view and the selection are where the timeline starts: the config's
`defaultDomain` and `defaultSelectedIds` (a `TimelineComponentConfig`). A
new config does not move them back; the instance's `zoomTo` and `select` do.
Every other field is compared by what it says, so an `editing` object
written anew is no change, and a drag in progress goes on.

## It does not run change detection to draw

The component creates the instance once, after its first render in the
browser. A pan, a pinch, a drag are drawn by the instance, imperatively;
Angular does not hear of them. What a template renders from is the
instance's store: `timelineState(timeline, selector, isEqual?)`, called in
an injection context, is a signal that changes when the selected part
does, and at most once per drawn frame, however many pointer events the
frame held. The component is `OnPush` and works without zone.js. With
zone.js, the instance runs outside Angular's zone — its pointer listeners,
frames, resize observer and the `rolling` clock do not check the
application, and the application becomes stable — and an output is emitted
in the zone, only when something listens to it.

## Server rendering

With `@angular/ssr` the component prints the drawing the browser would
draw, at `[ssrWidth]` (960 by default), and with `provideClientHydration()`
the client keeps the server's DOM: the instance takes those nodes over
instead of drawing again. The drawing is written on the server only, into
a node the template leaves empty, so hydration has nothing in it to compare.

## Documentation

Guides, recipes and the API reference with live examples are on the
[docs site](https://horakdani.github.io/Temporeum_timeline_SDK/) — the Angular page is [Frameworks](https://horakdani.github.io/Temporeum_timeline_SDK/frameworks.html). Every
code block in this README is checked against a running template in CI
(`npm run test:examples -w @temporeum/timeline-docs`).

## Licence

MIT
