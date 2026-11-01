/**
 * Scene-node helpers shared by the item hooks.
 */

import type { SceneElement } from "../scene.js";

/**
 * A node about to be wrapped in a group that carries the item's id: the id
 * moves to the group, so one element per item answers `[data-tl-id]` — the
 * mount keys nodes by it, and a host's selector should find the item, not
 * its parts.
 */
export function withoutId(node: SceneElement): SceneElement {
  return node.attrs?.["data-tl-id"] === undefined ? node : { ...node, attrs: { ...node.attrs, "data-tl-id": undefined } };
}
