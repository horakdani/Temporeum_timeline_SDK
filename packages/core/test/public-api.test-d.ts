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
import { createCommand } from "../src/editing.js";
import { Emitter } from "../src/emitter.js";
// @ts-expect-error — the core's dead `new Timeline({ container })` contract is gone.
import type { TimelineOptions as Gone } from "../src/index.js";
// @ts-expect-error — and so is its plugin shape, which clashed with the element's `TimelinePlugin`.
import type { TimelinePlugin as AlsoGone } from "../src/index.js";
// @ts-expect-error — and its context.
import type { PluginContext as Context } from "../src/index.js";
import type { RenderOptions } from "../src/render.js";
import type {
  Command,
  Item,
  ItemPatch,
  TimelineEventMap,
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
    const options: RenderOptions<Task> = {
      items: [{ id: "a", start: 0, data: { assignee: "dh" } }],
      domain: [0, 1],
      width: 800,
      height: 200,
    };
    expectTypeOf(options.items).toEqualTypeOf<readonly Item<Task>[]>();
  });

  it("requires items, a domain and a size, and nothing else", () => {
    // @ts-expect-error — the domain and the size are not optional.
    const incomplete: RenderOptions = { items: [] };
    void incomplete;

    const minimal: RenderOptions = { items: [], domain: [0, 1], width: 800, height: 200 };
    expectTypeOf(minimal.orientation).toEqualTypeOf<"horizontal" | "vertical" | undefined>();
  });

  it("has no instance or plugin contract of its own: those are the element's", async () => {
    const core = await import("../src/index.js");
    // Used, so that the only error each import above can have is the missing export.
    expectTypeOf<[Gone, AlsoGone, Context]>().toBeArray();
    expectTypeOf(core).not.toHaveProperty("Timeline");
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

  it("carries the host's payload type through patches and commands", () => {
    interface Task {
      readonly assignee: string;
    }
    const command = createCommand<Task>("add", [{ id: "a", item: null }], [{ id: "a", item: { id: "a", start: 0, data: { assignee: "dh" } } }]);
    expectTypeOf(command).toEqualTypeOf<Command<Task>>();
    expectTypeOf(command.inverse).toEqualTypeOf<Command<Task>>();
    expectTypeOf(command.after).toEqualTypeOf<readonly ItemPatch<Task>[]>();
    expectTypeOf(command.after[0]?.item?.data).toEqualTypeOf<Task | undefined>();
    // A typed command is still a command: what takes any command takes it.
    expectTypeOf(command).toExtend<Command>();
    const emitter = new Emitter<TimelineEventMap<Task>>();
    emitter.on("command", ({ command: each }) => {
      expectTypeOf(each).toEqualTypeOf<Command<Task>>();
    });
    emitter.on("itemMoved", ({ to, command: each }) => {
      expectTypeOf(to.item).toEqualTypeOf<Item<Task> | null | undefined>();
      expectTypeOf(each.inverse.before[0]?.item?.data).toEqualTypeOf<Task | undefined>();
    });
  });
});
