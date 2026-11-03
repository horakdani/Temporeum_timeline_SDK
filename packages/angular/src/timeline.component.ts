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
  ContentChild,
  DestroyRef,
  Directive,
  effect,
  EventEmitter,
  inject,
  Injectable,
  Input,
  NgZone,
  Output,
  PLATFORM_ID,
  Renderer2,
  signal,
  TemplateRef,
  untracked,
  ViewChild,
  ViewContainerRef,
} from "@angular/core";
import type { AfterViewInit, ElementRef, EmbeddedViewRef } from "@angular/core";
import { createTimeline, DEFAULT_HEIGHT, renderTimelineSvg, TIMELINE_EVENTS } from "@temporeum/timeline-element";
import type {
  ClusterOpenedPayload,
  DensityChangedPayload,
  GroupMovedPayload,
  GroupToggledPayload,
  ItemsAddedPayload,
  ItemsChangedPayload,
  ItemSlot,
  ItemsRemovedPayload,
  JumpRequestPayload,
  OrientationChangedPayload,
  SlotsChangedPayload,
  Timeline as TimelineInstance,
  TimelineComponentConfig,
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
class TimelineIds {
  #next = 0;
  /** The next scope, `tl-ng0`, `tl-ng1`, … */
  next(): string {
    const id = `tl-ng${String(this.#next)}`;
    this.#next += 1;
    return id;
  }
}

/** Where the view and the selection start — said once, and not a change after. */
const STARTS = new Set(["defaultDomain", "defaultSelectedIds", "domain", "selectedIds"]);

/** An item, as the element's types name it. */
type Item<T> = ItemSlot<T>["item"];

/** What an item template is rendered with: the item, as `let-item` and as `item`. */
export interface TimelineItemContext<T = unknown> {
  readonly $implicit: Item<T>;
  readonly item: Item<T>;
}

/**
 * Each item's content, as an Angular template:
 * `<ng-template tlItem let-item>…</ng-template>` inside `<tl-timeline>`.
 * It is rendered into the box over the item (`slots`), only for the items
 * drawn, and keeps its state while the item is drawn. The content is a
 * picture — the pointer and the keyboard act on the item, and its `label`
 * stays its accessible name. Needs the element's `/items` plugin, as
 * `template` does.
 */
@Directive({ selector: "ng-template[tlItem]" })
export class TimelineItemDirective<T = unknown> {
  readonly template = inject<TemplateRef<TimelineItemContext<T>>>(TemplateRef);

  /** Types `let-item` in the template. */
  static ngTemplateContextGuard<T>(directive: TimelineItemDirective<T>, context: unknown): context is TimelineItemContext<T> {
    // Read by the template compiler for the types; a tlItem's context is always one.
    return directive instanceof TimelineItemDirective && typeof context === "object" && context !== null;
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
  readonly #config = signal<TimelineComponentConfig<T>>({});

  /**
   * The configuration; a new object with the same field values is no
   * change. The view and the selection are where the timeline starts
   * (`defaultDomain`, `defaultSelectedIds`): a new `config` does not move
   * them; the instance's `zoomTo` and `select` do.
   */
  @Input()
  set config(value: TimelineComponentConfig<T> | null | undefined) {
    this.#config.set(value ?? {});
  }
  get config(): TimelineComponentConfig<T> {
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
  @Output() readonly slotsChanged = new EventEmitter<SlotsChangedPayload<T>>();

  /** The item template, `<ng-template tlItem let-item>`, if there is one. */
  @ContentChild(TimelineItemDirective) itemTemplate: TimelineItemDirective<T> | undefined;

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
  readonly #zone = inject(NgZone);
  readonly #views = inject(ViewContainerRef);
  /** The item template's view in each drawn box. */
  readonly #drawn = new Map<string, { readonly element: HTMLElement; readonly view: EmbeddedViewRef<TimelineItemContext<T>>; item: Item<T> }>();
  #applied: Record<string, unknown> | undefined;

  constructor() {
    afterNextRender(() => {
      let applied = this.#applied ?? this.#configOf(untracked(this.#config));
      // With an item template every item has a box, unless `slots` picks.
      if (this.itemTemplate !== undefined && applied.slots === undefined) applied = { ...applied, slots: true };
      this.#applied = applied;
      // Outside Angular's zone: a pointer move, a frame, a resize and the
      // clock of `rolling` are the instance's, and none of them is a reason
      // to check the application. With zone.js they would each be one, and
      // `rolling`'s interval would keep the application from ever being stable.
      const instance = this.#zone.runOutsideAngular(() => createTimeline<T>(this.containerRef.nativeElement, this.#initialOf(applied), { hydrate: true }));
      const outputs = this as unknown as Record<string, EventEmitter<unknown> | undefined>;
      // An output is emitted in the zone, and only when something listens to it.
      const stops = TIMELINE_EVENTS.map((type) =>
        instance.on(type, (payload) => {
          const output = outputs[type];
          if (output?.observed === true) this.#zone.run(() => output.emit(payload));
        }),
      );
      if (this.itemTemplate !== undefined) {
        const template = this.itemTemplate.template;
        stops.push(instance.on("slotsChanged", ({ slots }) => this.#zone.run(() => this.#render(template, slots))));
        this.#render(template, instance.slots);
      }
      this.timeline = instance;
      this.#zone.run(() => this.ready.emit(instance));
      this.#destroyRef.onDestroy(() => {
        for (const stop of stops) stop();
        for (const { view } of this.#drawn.values()) view.destroy();
        this.#drawn.clear();
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
        const timeline = this.timeline;
        if (any && timeline !== null) this.#zone.runOutsideAngular(() => timeline.update(changed as TimelineUpdate<T>));
      });
    });
  }

  ngAfterViewInit(): void {
    if (!this.#server) return;
    // The server's drawing, in the node the template leaves empty. (Lifecycle
    // hooks run on the server; the after-render ones do not.)
    const config = this.#applied ?? this.#configOf(this.#config());
    const width = this.ssrWidth;
    const frame = renderTimelineSvg(this.#initialOf(config), width === undefined ? {} : { width });
    this.#renderer.setProperty(this.containerRef.nativeElement, "innerHTML", frame.svg + frame.groups);
  }

  /** The item template in each drawn box: a view per item, kept while its item is drawn. */
  #render(template: TemplateRef<TimelineItemContext<T>>, slots: ReadonlyMap<string, ItemSlot<T>>): void {
    for (const [id, drawn] of this.#drawn) {
      if (slots.get(id)?.element === drawn.element) continue;
      drawn.view.destroy();
      this.#drawn.delete(id);
    }
    for (const [id, slot] of slots) {
      const drawn = this.#drawn.get(id);
      if (drawn === undefined) {
        const view = this.#views.createEmbeddedView(template, { $implicit: slot.item, item: slot.item });
        slot.element.append(...view.rootNodes);
        view.detectChanges();
        this.#drawn.set(id, { element: slot.element, view, item: slot.item });
      } else if (drawn.item !== slot.item) {
        drawn.item = slot.item;
        drawn.view.context = { $implicit: slot.item, item: slot.item };
        drawn.view.detectChanges();
      }
    }
  }

  /** The configuration the instance is handed changes of: where the view and the selection start is not one. */
  #configOf(config: TimelineComponentConfig<T>): Record<string, unknown> {
    const own: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(config)) {
      if (!STARTS.has(key)) own[key] = value;
    }
    // Light DOM: two timelines on one page must not share one stylesheet.
    return own.instanceId === undefined ? { ...own, instanceId: this.#scope } : own;
  }

  /** What the instance starts from: the configuration, with the view and the selection it starts at. */
  #initialOf(applied: Record<string, unknown>): TimelineConfig<T> {
    const config = untracked(this.#config);
    return {
      ...applied,
      ...(config.defaultDomain === undefined ? {} : { domain: config.defaultDomain }),
      ...(config.defaultSelectedIds === undefined ? {} : { selectedIds: config.defaultSelectedIds }),
    } as TimelineConfig<T>;
  }
}
