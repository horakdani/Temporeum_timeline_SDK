/**
 * `<tl-timeline>` — the timeline as an Angular standalone component.
 *
 * The component is a shell around the shared instance (`createTimeline`,
 * from `@temporeum/timeline-element`), as the React one is: it creates the
 * instance once, after the first render in the browser, hands it every
 * `config` field that changed, and lets go of it on destroy. It does not
 * run change detection to draw: a pan is drawn by the instance,
 * imperatively, and Angular does not hear of it. What a template renders
 * from is the instance's store, through `timelineState` — a signal. Every
 * instance event is an output by its own name (`(itemMoved)`), and
 * `(ready)` hands over the live instance.
 *
 * **Server rendering.** On the server the component prints the drawing the
 * browser would draw into its node, so the page shows a timeline before the
 * bundle loads; with `provideClientHydration()` the client keeps the
 * server's DOM, and the instance takes those nodes over instead of drawing
 * again. The drawing is written on the server only: the node has no
 * children in the template, so hydration has nothing in it to compare.
 */

import { isPlatformServer } from "@angular/common";
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  effect,
  EventEmitter,
  inject,
  Injectable,
  Input,
  Output,
  PLATFORM_ID,
  Renderer2,
  signal,
  untracked,
  ViewChild,
} from "@angular/core";
import type { AfterViewInit, ElementRef } from "@angular/core";
import { createTimeline, DEFAULT_HEIGHT, renderTimelineSvg, TIMELINE_EVENTS } from "@temporeum/timeline-element";
import type {
  ClusterOpenedPayload,
  DensityChangedPayload,
  GroupMovedPayload,
  GroupToggledPayload,
  ItemsAddedPayload,
  ItemsChangedPayload,
  ItemsRemovedPayload,
  JumpRequestPayload,
  OrientationChangedPayload,
  Timeline as TimelineInstance,
  TimelineConfig,
  TimelineInstanceEventMap,
  TimelineInstanceEventName,
  TimelineUpdate,
} from "@temporeum/timeline-element";

/**
 * Numbers the timelines of one application, in the order they are created —
 * the same order on the server (one injector per request) and on the
 * hydrating client, so the stylesheet scope of each matches.
 */
@Injectable({ providedIn: "root" })
export class TimelineIds {
  #next = 0;
  /** The next scope, `tl-ng0`, `tl-ng1`, … */
  next(): string {
    const id = `tl-ng${String(this.#next)}`;
    this.#next += 1;
    return id;
  }
}

type Payload<T, K extends TimelineInstanceEventName> = TimelineInstanceEventMap<T>[K];

/**
 * `<tl-timeline>`: every `TimelineConfig` field is an input, every instance
 * event an output, and the live instance is `timeline` (and the `ready`
 * output). Server-rendered markup is hydrated, not drawn twice.
 */
@Component({
  selector: "tl-timeline",
  template: '<div #container data-tl-angular="" [style.height.px]="height()" style="position: relative; overflow: hidden"></div>',
  host: { style: "display: block" },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TimelineComponent<T = unknown> implements AfterViewInit {
  // Decorated inputs and outputs, not the signal functions: they are what
  // Angular's JIT sees too, so the suite runs on the source.
  readonly #config = signal<TimelineConfig<T>>({});

  /** The configuration; a new object with the same field values is no change. */
  @Input()
  set config(value: TimelineConfig<T> | null | undefined) {
    this.#config.set(value ?? {});
  }
  get config(): TimelineConfig<T> {
    return this.#config();
  }

  /** Width the server draws at; the client redraws at the real one. */
  @Input() ssrWidth: number | undefined;

  /** The live instance after the first render in the browser, and `null` on destroy. */
  @Output() readonly ready = new EventEmitter<TimelineInstance<T> | null>();
  @Output() readonly itemClick = new EventEmitter<Payload<T, "itemClick">>();
  @Output() readonly itemDblClick = new EventEmitter<Payload<T, "itemDblClick">>();
  @Output() readonly itemHover = new EventEmitter<Payload<T, "itemHover">>();
  @Output() readonly selectionChanged = new EventEmitter<Payload<T, "selectionChanged">>();
  @Output() readonly viewportChanged = new EventEmitter<Payload<T, "viewportChanged">>();
  @Output() readonly layoutChanged = new EventEmitter<Payload<T, "layoutChanged">>();
  @Output() readonly itemMoved = new EventEmitter<Payload<T, "itemMoved">>();
  @Output() readonly itemResized = new EventEmitter<Payload<T, "itemResized">>();
  @Output() readonly command = new EventEmitter<Payload<T, "command">>();
  @Output() readonly densityChanged = new EventEmitter<DensityChangedPayload>();
  @Output() readonly orientationChanged = new EventEmitter<OrientationChangedPayload>();
  @Output() readonly clusterOpened = new EventEmitter<ClusterOpenedPayload<T>>();
  @Output() readonly jumpRequest = new EventEmitter<JumpRequestPayload>();
  @Output() readonly itemsAdded = new EventEmitter<ItemsAddedPayload<T>>();
  @Output() readonly itemsRemoved = new EventEmitter<ItemsRemovedPayload<T>>();
  @Output() readonly itemsChanged = new EventEmitter<ItemsChangedPayload<T>>();
  @Output() readonly groupToggled = new EventEmitter<GroupToggledPayload>();
  @Output() readonly groupMoved = new EventEmitter<GroupMovedPayload>();
  @Output() readonly timeBarMoved = new EventEmitter<Payload<T, "timeBarMoved">>();
  @Output() readonly rangeSelected = new EventEmitter<Payload<T, "rangeSelected">>();

  /** The live instance; `null` before the first render in the browser and after destroy. */
  timeline: TimelineInstance<T> | null = null;

  protected readonly height = (): number => this.#config().height ?? DEFAULT_HEIGHT;

  // A decorated query, as the inputs are: a signal query (`viewChild`) is
  // invisible to the JIT, and the suite runs on the source.
  @ViewChild("container", { static: true }) private readonly containerRef!: ElementRef<HTMLDivElement>;
  readonly #renderer = inject(Renderer2);
  readonly #destroyRef = inject(DestroyRef);
  readonly #server = isPlatformServer(inject(PLATFORM_ID));
  readonly #scope = inject(TimelineIds).next();
  #applied: Record<string, unknown> | undefined;

  constructor() {
    afterNextRender(() => {
      const applied = this.#applied ?? this.#configOf(untracked(this.#config));
      this.#applied = applied;
      const instance = createTimeline<T>(this.containerRef.nativeElement, applied as TimelineConfig<T>, { hydrate: true });
      const outputs = this as unknown as Record<string, EventEmitter<unknown> | undefined>;
      const stops = TIMELINE_EVENTS.map((type) => instance.on(type, (payload) => outputs[type]?.emit(payload)));
      this.timeline = instance;
      this.ready.emit(instance);
      this.#destroyRef.onDestroy(() => {
        for (const stop of stops) stop();
        instance.destroy();
        this.timeline = null;
        this.ready.emit(null);
      });
    });
    // Hand the instance what changed, and only that: an unchanged `items` array must not look like new data.
    effect(() => {
      const next = this.#configOf(this.#config());
      untracked(() => {
        const before = this.#applied;
        this.#applied = next;
        if (before === undefined) return;
        const changed: Record<string, unknown> = {};
        let any = false;
        for (const key of new Set([...Object.keys(before), ...Object.keys(next)])) {
          if (before[key] !== next[key]) {
            changed[key] = next[key];
            any = true;
          }
        }
        if (any) this.timeline?.update(changed as TimelineUpdate<T>);
      });
    });
  }

  ngAfterViewInit(): void {
    if (!this.#server) return;
    // The server's drawing, in the node the template leaves empty. (Lifecycle
    // hooks run on the server; the after-render ones do not.)
    const config = this.#applied ?? this.#configOf(this.#config());
    const width = this.ssrWidth;
    const frame = renderTimelineSvg(config as TimelineConfig<T>, width === undefined ? {} : { width });
    this.#renderer.setProperty(this.containerRef.nativeElement, "innerHTML", frame.svg + frame.groups);
  }

  #configOf(config: TimelineConfig<T>): Record<string, unknown> {
    // Light DOM: two timelines on one page must not share one stylesheet.
    return config.instanceId === undefined ? { ...config, instanceId: this.#scope } : { ...config };
  }
}
