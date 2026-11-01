/**
 * `@temporeum/timeline-core/dom` — the browser binding.
 *
 * A separate entry point so the main one stays provably DOM-free: a server
 * can import the engine, and only a host that actually binds events pays for
 * this file.
 */

export { attachInput, MIRRORED_KEYS } from "./attach.js";
export type { AttachInputOptions, InputBinding } from "./attach.js";
export { createFrameLoop } from "./frame.js";
export type { FrameLoop, FrameLoopStats } from "./frame.js";
export { DEFAULT_POOL_LIMIT, mountScene } from "./mount.js";
export { partNames, withParts } from "../parts.js";
export type { MountOptions, MountStats, SceneMount } from "./mount.js";
export { observeSize, openDetail } from "./responsive.js";
export type {
  DetailHandle,
  DetailOptions,
  ObservedSize,
  SizeObservation,
} from "./responsive.js";
