/**
 * `@temporeum/timeline-element/resources` — the resource view, as a plugin.
 *
 * Register it once and a configuration's `resources` draws: the resources
 * as lanes, a load lane under each with the load against the capacity, the
 * overload bands, and overbooked assignments marked and named. The list of
 * unscheduled tasks beside it, {@link mountBacklog}, comes from here too.
 *
 *     import { registerPlugin } from "@temporeum/timeline-element";
 *     import { mountBacklog, resourcesPlugin } from "@temporeum/timeline-element/resources";
 *     registerPlugin(resourcesPlugin);
 *
 * Its own entry point, as in the core: the load and its layer import the
 * core's `/resources`, and a page that shows only a timeline does not
 * download any of it. The `<script>`-tag build carries it and registers it
 * on load.
 */

import type { Item, Lane, RenderHooks, RenderResult, SceneElement } from "@temporeum/timeline-core";
import type { Strings } from "@temporeum/timeline-core/words";
import { loadLaneOf, loadNodes, resourceHooks, resourceLanes, resourceLoad, withLoadLanes, withLoadLayer } from "@temporeum/timeline-core/resources";
import type { Resource, ResourceLoad } from "@temporeum/timeline-core/resources";

import { EVERYWHERE, layerNodes, layerScale, sizesOf, wordsOf } from "./config.js";
import type { FrameState, TimelineConfig, Words } from "./config.js";
import type { TimelinePlugin } from "./plugins.js";

export { backlogCss, describeBacklogTask, mountBacklog } from "./backlog.js";
export type { Backlog, BacklogOptions } from "./backlog.js";

const loadLaneCache = new WeakMap<readonly Lane[], { resources: readonly Resource[]; size: number; say: Words["say"] | undefined; lanes: readonly Lane[] }>();
const resourceLaneCache = new WeakMap<readonly Resource[], readonly Lane[]>();

/**
 * The lanes with the resources': theirs when there are no others, and a
 * load lane under each resource's — one array while nothing changes, as the
 * renderer keeps its layout per lanes array.
 */
function lanes<T>(config: TimelineConfig<T>, given: readonly Lane[] | undefined): readonly Lane[] | undefined {
  const resources = config.resources;
  if (resources === undefined) return given;
  let base = given;
  if (base === undefined) {
    base = resourceLaneCache.get(resources);
    if (base === undefined) {
      base = resourceLanes(resources);
      resourceLaneCache.set(resources, base);
    }
  }
  if (config.resourceOptions?.histogram === false) return base;
  const size = config.resourceOptions?.loadSize ?? 24;
  const hit = loadLaneCache.get(base);
  const say = config.strings === undefined ? undefined : wordsOf(config).say;
  if (hit !== undefined && hit.resources === resources && hit.size === size && hit.say === say) return hit.lanes;
  const withLoad = withLoadLanes(base, resources, size, say);
  loadLaneCache.set(base, { resources, size, say, lanes: withLoad });
  return withLoad;
}

/** The load of a frame's items. */
function loadOf<T>(config: TimelineConfig<T>, items: readonly Item<T>[], resources: readonly Resource[]): ResourceLoad {
  const unitsOf = config.resourceOptions?.unitsOf;
  return resourceLoad(items, resources, unitsOf === undefined ? {} : { unitsOf });
}

const resourceHookCache = new WeakMap<
  RenderHooks<unknown>,
  { load: ResourceLoad; lanes: readonly Lane[] | undefined; locale: string | undefined; timeZone: string | undefined; strings: Partial<Strings> | undefined; hooks: RenderHooks<unknown> }
>();

/** The resource hooks over the others — one object while nothing they read changes. */
function hooks<T>(config: TimelineConfig<T>, base: RenderHooks<T>, items: readonly Item<T>[], laneList: readonly Lane[] | undefined): RenderHooks<T> {
  const resources = config.resources;
  if (resources === undefined) return base;
  const load = loadOf(config, items, resources);
  const hit = resourceHookCache.get(base as RenderHooks<unknown>);
  if (hit !== undefined && hit.load === load && hit.lanes === laneList && hit.locale === config.locale && hit.timeZone === config.timeZone && hit.strings === config.strings) {
    return hit.hooks as RenderHooks<T>;
  }
  const wrapped = resourceHooks(base, {
    load,
    ...(config.strings === undefined ? {} : { say: wordsOf(config).say }),
    ...(laneList === undefined ? {} : { lanes: new Map(laneList.map((lane) => [lane.id, lane.label])) }),
    ...(config.locale === undefined ? {} : { locale: config.locale }),
    ...(config.timeZone === undefined ? {} : { timeZone: config.timeZone }),
  });
  resourceHookCache.set(base as RenderHooks<unknown>, { load, lanes: laneList, locale: config.locale, timeZone: config.timeZone, strings: config.strings, hooks: wrapped as RenderHooks<unknown> });
  return wrapped;
}

/** The load, in a layer under the items, in the items' own space: four paths at most (`loadNodes`). */
function layer<T>(config: TimelineConfig<T>, state: FrameState<T>, result: RenderResult<T>, scene: SceneElement): SceneElement {
  const resources = config.resources;
  if (resources === undefined) return scene;
  const load = loadOf(config, state.items, resources);
  const view = state.view;
  const metrics = sizesOf(view);
  const orientation = view.orientation;
  // Off, as documented: all the load, every frame — past the layer's cache too.
  const nodes =
    config.resourceOptions?.cull === false
      ? loadNodes(result.layout, load, {
          scale: layerScale(state),
          orientation,
          crossInset: metrics.axisSize,
          crossOffset: state.crossOffset,
          clip: EVERYWHERE,
        })
      : layerNodes("load", load, state, result, "cull", (scale, clip) =>
          loadNodes(result.layout, load, { scale, orientation, crossInset: metrics.axisSize, crossOffset: state.crossOffset, clip }),
        );
  return withLoadLayer(scene, nodes);
}

/** The resource view. Register it with `registerPlugin(resourcesPlugin)`. */
export const resourcesPlugin: TimelinePlugin = Object.freeze({ name: "resources", feature: Object.freeze({ lanes, hooks, layer, loadLaneOf }) });
