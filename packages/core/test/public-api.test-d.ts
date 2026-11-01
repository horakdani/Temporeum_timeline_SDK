import { describe, expectTypeOf, it } from "vitest";
import {
  clusterZoom,
  createHitTester,
  createItemLoader,
  createNavigator,
  createTimeScale,
  renderTimeline,
} from "../src/index.js";
import type { Cluster, ClusterMarker, Clustering, ItemLoader, LoadingRange } from "../src/index.js";
import { Emitter } from "../src/emitter.js";
import type {
  Item,
  TimelineEventMap,
  TimelineOptions,
  Viewport,
} from "../src/types.js";

/**
 * The shape of the public API is part of the product: a host that gets no
 * autocomplete on an event payload will reach for `as any`, and the type
 * promise is then marketing. These assertions fail the build, not a review.
 */
describe("public API types", () => {
  it("infers the payload of each event from its name", () => {
    const emitter = new Emitter<TimelineEventMap<{ note: string }>>();

    emitter.on("viewportChanged", (payload) => {
      expectTypeOf(payload.viewport).toEqualTypeOf<Viewport>();
      expectTypeOf(payload.reason).toEqualTypeOf<
        "init" | "pan" | "zoom" | "resize" | "api"
      >();
    });

    emitter.on("itemClick", (payload) => {
      expectTypeOf(payload.item).toEqualTypeOf<Item<{ note: string }>>();
      expectTypeOf(payload.item.data).toEqualTypeOf<
        { note: string } | undefined
      >();
    });
  });

  it("rejects an unknown event name", () => {
    const emitter = new Emitter<TimelineEventMap>();
    // @ts-expect-error — "itemWiggled" is not an event of the timeline.
    emitter.on("itemWiggled", () => {});
  });

  it("rejects a listener whose payload does not match the event", () => {
    const emitter = new Emitter<TimelineEventMap>();
    // @ts-expect-error — selectionChanged carries ids, not a number.
    emitter.on("selectionChanged", (payload: number) => payload);
  });

  it("carries the host's own payload type through items untouched", () => {
    interface Task {
      readonly assignee: string;
    }
    const options: TimelineOptions<Task> = {
      container: "#timeline",
      items: [{ id: "a", start: 0, data: { assignee: "dh" } }],
    };
    expectTypeOf(options.items).toExtend<readonly Item<Task>[] | unknown>();
  });

  it("requires a container and items, and nothing else", () => {
    // @ts-expect-error — items is not optional.
    const incomplete: TimelineOptions = { container: "#timeline" };
    void incomplete;

    const minimal: TimelineOptions = { container: "#timeline", items: [] };
    expectTypeOf(minimal.orientation).toEqualTypeOf<
      "horizontal" | "vertical" | "auto" | undefined
    >();
  });

  it("carries the host's payload type through a windowed loader", () => {
    interface Entry {
      readonly level: "info" | "error";
    }
    const loader = createItemLoader({
      source: (domain, signal) => {
        expectTypeOf(domain).toEqualTypeOf<readonly [start: number, end: number]>();
        expectTypeOf(signal).toEqualTypeOf<AbortSignal>();
        return Promise.resolve([{ id: "a", start: domain[0], data: { level: "info" } as Entry }]);
      },
    });
    expectTypeOf(loader).toEqualTypeOf<ItemLoader<Entry>>();
    expectTypeOf(loader.items).toEqualTypeOf<readonly Item<Entry>[]>();
    expectTypeOf(loader.loading).toEqualTypeOf<readonly LoadingRange[]>();
  });

  it("carries the host's payload type through clusters, to the marker and the hit tester", () => {
    interface Release {
      readonly version: string;
    }
    const items: readonly Item<Release>[] = [{ id: "a", start: 0, data: { version: "1.0" } }];
    const result = renderTimeline({ items, domain: [0, 1000], width: 400, height: 200, cluster: { gap: 6 } });
    expectTypeOf(result.clusters).toEqualTypeOf<readonly ClusterMarker<Release>[]>();
    expectTypeOf(result.clustering).toEqualTypeOf<Clustering<Release> | undefined>();
    const first = result.clusters[0]?.cluster;
    expectTypeOf(first?.members[0]?.item.data).toEqualTypeOf<Release | undefined>();
    const tester = createHitTester({ layout: result.layout, scale: createTimeScale([0, 1000], 400), clusters: result.clusters });
    expectTypeOf(tester.clusterAt({ main: 0, cross: 0 })).toEqualTypeOf<Cluster<Release> | undefined>();
    // The frame's clustering goes to the navigator as it is, off or on.
    createNavigator(result.layout, { clustering: result.clustering });
    expectTypeOf(clusterZoom).returns.toEqualTypeOf<{ readonly factor: number; readonly anchor: number }>();
    // @ts-expect-error — a count is not a setting.
    renderTimeline({ items, domain: [0, 1000], width: 400, height: 200, cluster: 3 });
  });
});
