// Az Angular SSR-en (@angular/ssr) az Angular-adapter maga rajzol: a
// komponens a szerveren a renderTimelineSvg rajzát írja a csomópontjába, a
// kliens (provideClientHydration) a szerver DOM-ját megtartja, és a példány
// azt veszi át (P23).
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
    // A teszt innen tudja, hogy a kliens átvette a rajzot.
    (window as unknown as { __tl?: unknown }).__tl = instance;
  }
}
