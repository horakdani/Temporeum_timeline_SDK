/**
 * The drawing's `part` names, for a timeline in a shadow root.
 *
 * A page's stylesheet does not reach into a shadow root; `::part()` is the
 * door it has. Every node the timeline draws already says what it is in its
 * classes, so its parts are its classes, read without the library's prefix:
 * `tl-item tl-item--selected urgent` is `item item-selected urgent`, the
 * root `tl` is `timeline`. A host's own class — an item's `className` — is a
 * part as it is, so `temporeum-timeline::part(urgent)` reaches the items it
 * marks.
 */

import type { SceneElement } from "./scene.js";

const cache = new Map<string, string>();

/** One class as a part name. */
function partOf(name: string): string {
  if (name === "tl") return "timeline";
  if (!name.startsWith("tl-")) return name;
  return name.slice(3).replace(/--/g, "-");
}

/** The `part` attribute for a `class` attribute; "" for none. */
export function partNames(className: string): string {
  let parts = cache.get(className);
  if (parts === undefined) {
    const names: string[] = [];
    for (const name of className.split(/\s+/)) {
      if (name === "") continue;
      const part = partOf(name);
      if (!names.includes(part)) names.push(part);
    }
    parts = names.join(" ");
    // Classes repeat; a page with unbounded distinct ones does not grow this past a bound.
    if (cache.size >= 2048) cache.clear();
    cache.set(className, parts);
  }
  return parts;
}

/**
 * A scene with every node's classes as its parts: what a server prints into
 * a declarative shadow root, so the page's `::part()` rules apply before the
 * client takes the nodes over. In the browser the mount writes them instead
 * (`MountOptions.parts`), only where a class changed.
 */
export function withParts(scene: SceneElement): SceneElement {
  const className = scene.attrs?.class;
  const children = scene.children?.map(withParts);
  const names = className === undefined ? "" : partNames(String(className));
  return {
    ...scene,
    ...(names === "" ? {} : { attrs: { ...scene.attrs, part: names } }),
    ...(children === undefined ? {} : { children }),
  };
}
