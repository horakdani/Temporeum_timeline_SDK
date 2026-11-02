// On Angular SSR (@angular/ssr) the Angular adapter draws by itself: on the
// server the component writes renderTimelineSvg's drawing into its node, the
// client (provideClientHydration) keeps the server's DOM, and the instance
// takes that over.
import { Component, signal } from "@angular/core";
import { TimelineComponent, timelineState } from "@temporeum/timeline-angular";
import type { TimelineConfig, TimelineInstance } from "@temporeum/timeline-angular";

import { config, WIDTH } from "../../shared/data.mjs";

@Component({
  selector: "app-root",
  imports: [TimelineComponent],
  template: `
    <main style="width: 960px">
      <h1 style="font-size: 16px">Angular smoke</h1>
      <tl-timeline [config]="config" [ssrWidth]="width" (ready)="onReady($event)" />
      <output id="selected">{{ (selected() ?? []).join(",") }}</output>
    </main>
  `,
})
export class App {
  readonly config = config as unknown as TimelineConfig;
  readonly width = WIDTH;
  readonly timeline = signal<TimelineInstance | null>(null);
  readonly selected = timelineState(this.timeline, (snapshot) => snapshot.selectedIds);

  onReady(instance: TimelineInstance | null): void {
    this.timeline.set(instance);
    // This is how the test knows the client has taken over the drawing.
    (window as unknown as { __tl?: unknown }).__tl = instance;
  }
}
