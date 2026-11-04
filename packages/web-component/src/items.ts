/**
 * `@temporeum/timeline-element/items` — the item kinds and the items a
 * reader makes, as a plugin: `box`, `point` and `background` items, an HTML
 * `template` for each item's picture, and adding, removing and dropping
 * items (`editing.add`, `editing.remove`, `editing.drop`).
 *
 *     import { registerPlugin } from "@temporeum/timeline-element";
 *     import { itemsPlugin } from "@temporeum/timeline-element/items";
 *     registerPlugin(itemsPlugin);
 *
 * Its own entry point: the kinds, the template's sanitiser and
 * the add and remove commands are the core's `/items`, and a timeline of
 * ranges — a Gantt chart's tasks among them — does not download it. Moving
 * and resizing are not here: they are the base's, as they always were.
 */

import type { Item, RenderHooks } from "@temporeum/timeline-core";
import {
  addCommand,
  addTargetAt,
  addTargetFromFocus,
  applyItemPatches,
  DROP_MIME,
  itemForTarget,
  itemFromDrop,
  itemKindHooks,
  removeCommand,
  removeTargets,
  resolveItemKey,
  splitBackgrounds,
  slotHooks,
  templateHooks,
} from "@temporeum/timeline-core/items";

import type { TimelineConfig } from "./config.js";
import type { TimelinePlugin } from "./plugins.js";

const hookCache = new WeakMap<object, Map<unknown, Map<string, RenderHooks<unknown>>>>();

/** The render hooks: the host's, under a template, under the item kinds. One object per combination. */
function hooks<T>(config: TimelineConfig<T>, base: RenderHooks<T>): RenderHooks<T> {
  const removable = config.editing?.enabled === true && config.editing.remove === true;
  const own = base as RenderHooks<unknown>;
  let byTemplate = hookCache.get(own);
  if (byTemplate === undefined) {
    byTemplate = new Map();
    hookCache.set(own, byTemplate);
  }
  // Slots over a template: a framework's content is what the host asked for last.
  const slots = config.slots === false ? undefined : config.slots;
  const source = slots ?? config.template;
  let byOptions = byTemplate.get(source);
  if (byOptions === undefined) {
    byOptions = new Map();
    byTemplate.set(source, byOptions);
  }
  const options = config.templateOptions;
  const key = `${String(slots !== undefined)}|${String(removable)}|${String(options?.sanitize)}|${(options?.allowTags ?? []).join(",")}|${(options?.allowAttributes ?? []).join(",")}`;
  let made = byOptions.get(key);
  if (made === undefined) {
    const template = config.template as ((item: Item<unknown>) => string | null) | undefined;
    const drawn =
      slots !== undefined
        ? slotHooks<unknown>(slots === true ? () => true : (item) => (slots as (item: Item<unknown>) => boolean)(item), own)
        : template === undefined
          ? own
          : templateHooks<unknown>((item) => template(item), { ...options, hooks: own });
    made = itemKindHooks(drawn, { removable });
    byOptions.set(key, made);
  }
  return made as RenderHooks<T>;
}

/** Item kinds, templates, adding and removing. Register them with `registerPlugin(itemsPlugin)`. */
export const itemsPlugin: TimelinePlugin = Object.freeze({
  name: "items",
  feature: Object.freeze({
    hooks,
    split: splitBackgrounds,
    applyItemPatches,
    addCommand,
    removeCommand,
    removeTargets,
    itemForTarget,
    itemFromDrop,
    addTargetAt,
    addTargetFromFocus,
    resolveItemKey,
    DROP_MIME,
  }),
});
