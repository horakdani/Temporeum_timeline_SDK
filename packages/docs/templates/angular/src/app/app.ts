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
      <h1 style="font-size: 18px">Release plan</h1>
      <tl-timeline [config]="config" (ready)="timeline.set($event)" (itemMoved)="onMoved($event)" />
      <p aria-live="polite">{{ log() }} {{ selected()?.length ?? 0 }} selected.</p>
    </main>
  `,
})
export class App {
  readonly config: TimelineConfig = {
    items: [
      { id: "design", label: "Design", laneId: "work", start: t, end: t + 7 * DAY },
      { id: "build", label: "Build", laneId: "work", start: t + 5 * DAY, end: t + 19 * DAY },
      { id: "review", label: "Review", laneId: "ship", start: t + 21 * DAY },
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
