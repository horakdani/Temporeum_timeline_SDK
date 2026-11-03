# @temporeum/timeline-angular

The timeline as an Angular standalone component, built on the shared
instance of [`@temporeum/timeline-element`](../web-component/README.md).

```bash
npm install @temporeum/timeline-angular
```

The peer range is `@angular/core >=21`. The package is compiled the way the
Angular Package Format asks — partially, for your build to link — so one
build serves the Angular versions after 21 too.

```ts excerpt:template/angular/src/app/app.ts
import { Component, signal } from "@angular/core";
import { TimelineComponent, timelineState } from "@temporeum/timeline-angular";

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
  readonly timeline = signal<TimelineInstance | null>(null);
  readonly selected = timelineState(this.timeline, (state) => state.selectedIds);
  readonly log = signal("Drag an item.");
}
```

The whole project, with the Angular CLI, is the Angular template
(`packages/docs/templates/angular`).

`[config]` takes the whole [`TimelineConfig`](../web-component/src/config.ts);
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

## Licence

MIT
