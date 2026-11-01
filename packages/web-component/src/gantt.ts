/**
 * `@temporeum/timeline-element/gantt` — the Gantt chart, as a plugin.
 *
 * Register it once and a configuration's `gantt` draws: dependency arrows
 * under the items, each item's `progress` and `baseline`, `kind:
 * "milestone"` diamonds, the dependencies in each item's accessible name,
 * and `[` and `]` to a predecessor and a successor. The task table beside
 * the chart, {@link mountTaskGrid}, comes from here too.
 *
 *     import { registerPlugin } from "@temporeum/timeline-element";
 *     import { ganttPlugin, mountTaskGrid } from "@temporeum/timeline-element/gantt";
 *     registerPlugin(ganttPlugin);
 *
 * Its own entry point, as in the core: the arrows, their routing and the
 * table import the core's `/gantt`, and a page that shows only a timeline
 * does not download any of it. The `<script>`-tag build carries it and
 * registers it on load.
 */

import type { Item, KeySample, Lane, RenderHooks, RenderResult, SceneElement } from "@temporeum/timeline-core";
import { dependencyKeyStep, dependencyPaths, ganttHooks, resolveDependencyKey, routeDependencies, routePath, withDependencyLayer } from "@temporeum/timeline-core/gantt";
import type { Dependency, DependencyKeyAction } from "@temporeum/timeline-core/gantt";
import type { Strings } from "@temporeum/timeline-core/words";

import { layerNodes, sizesOf, wordsOf } from "./config.js";
import type { FrameState, TimelineConfig } from "./config.js";
import type { GanttFeature, TimelinePlugin } from "./plugins.js";

export { defaultTaskColumns, mountTaskGrid, taskGridCss } from "./task-grid.js";
export type { TaskColumnWords, TaskGrid, TaskGridColumn, TaskGridOptions, TaskGridRowContext } from "./task-grid.js";

const ganttCache = new WeakMap<
  RenderHooks<unknown>,
  {
    readonly dependencies: readonly Dependency[] | undefined;
    readonly items: readonly Item<unknown>[];
    readonly lanes: readonly Lane[] | undefined;
    readonly locale: string | undefined;
    readonly timeZone: string | undefined;
    readonly strings: Partial<Strings> | undefined;
    readonly hooks: RenderHooks<unknown>;
  }
>();

/**
 * The Gantt hooks over the others, for a frame's items and lanes — one object
 * while none of them changes, since the renderer's tiles are kept per hooks
 * object.
 */
function hooks<T>(config: TimelineConfig<T>, base: RenderHooks<T>, items: readonly Item<T>[], lanes: readonly Lane[] | undefined): RenderHooks<T> {
  const dependencies = config.gantt?.dependencies;
  const hit = ganttCache.get(base as RenderHooks<unknown>);
  if (
    hit !== undefined &&
    hit.dependencies === dependencies &&
    hit.items === items &&
    hit.lanes === lanes &&
    hit.locale === config.locale &&
    hit.timeZone === config.timeZone &&
    hit.strings === config.strings
  ) {
    return hit.hooks as RenderHooks<T>;
  }
  const wrapped = ganttHooks(base, {
    ...(config.strings === undefined ? {} : { say: wordsOf(config).say }),
    ...(dependencies === undefined ? {} : { dependencies }),
    items,
    ...(lanes === undefined ? {} : { lanes: new Map(lanes.map((lane) => [lane.id, lane.label])) }),
    ...(config.locale === undefined ? {} : { locale: config.locale }),
    ...(config.timeZone === undefined ? {} : { timeZone: config.timeZone }),
  });
  ganttCache.set(base as RenderHooks<unknown>, {
    dependencies,
    items: items as readonly Item<unknown>[],
    lanes,
    locale: config.locale,
    timeZone: config.timeZone,
    strings: config.strings,
    hooks: wrapped as RenderHooks<unknown>,
  });
  return wrapped;
}

const NO_DEPENDENCIES: readonly Dependency[] = [];

/**
 * The dependency arrows, in a layer between the load and the items, in the
 * items' own space: a path per look ({@link dependencyPaths}), not one each,
 * through the element's layer cache — a pan in a space does not draw them
 * again (P20, G-PERF-GANTT).
 */
function layer<T>(config: TimelineConfig<T>, state: FrameState<T>, result: RenderResult<T>, scene: SceneElement): SceneElement {
  const view = state.view;
  const metrics = sizesOf(view);
  const orientation = view.orientation;
  const dependencies = config.gantt?.dependencies ?? NO_DEPENDENCIES;
  const cull = config.gantt?.cull !== false;
  return withDependencyLayer(
    scene,
    layerNodes("deps", dependencies, state, result, String(cull), (scale, clip, made) => {
      const routes = routeDependencies(result.layout, dependencies, {
        scale,
        crossInset: metrics.axisSize,
        crossOffset: state.crossOffset,
        minItemMainSize: metrics.minItemMainSize,
        rowGap: metrics.rowGap,
        ...(cull ? { clip } : {}),
      });
      return dependencyPaths(routes, orientation, state.selectedIds.length === 0 ? {} : { selectedIds: new Set(state.selectedIds) }, (route) => {
        let d = made.get(route.id);
        if (d === undefined) {
          d = routePath(route.points, orientation);
          made.set(route.id, d);
        }
        return d;
      });
    }),
  );
}

/** One instance's `[` and `]`: focus moves along a dependency, and the next press goes on from where the last landed. */
function keys(): ReturnType<GanttFeature["keys"]> {
  let memory: { readonly origin: string; readonly action: DependencyKeyAction; readonly last: string } | undefined;
  return (config: TimelineConfig<unknown>, sample: KeySample, focusedId: string | null, focus: (id: string) => boolean): boolean | undefined => {
    const action = resolveDependencyKey(sample);
    if (action === undefined) return undefined;
    const dependencies = config.gantt?.dependencies;
    if (dependencies === undefined) return false;
    const step = dependencyKeyStep(dependencies, focusedId, action, memory);
    if (step === undefined || !focus(step.focus)) return false;
    memory = { origin: step.origin, action, last: step.focus };
    return true;
  };
}

/** The Gantt chart. Register it with `registerPlugin(ganttPlugin)`. */
export const ganttPlugin: TimelinePlugin = Object.freeze({ name: "gantt", feature: Object.freeze({ hooks, layer, keys }) });
