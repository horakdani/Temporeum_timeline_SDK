/**
 * The instance's store, as a Svelte store.
 *
 * `timelineState(timeline, selector, isEqual?)` follows the store contract —
 * `subscribe(run)` calls `run` at once, then whenever the selected part
 * changes (by `isEqual`, `Object.is` by default), and returns the
 * unsubscriber — so `$selected` works in a component, and nothing in it is
 * Svelte's: the instance's own store notifies at most once per drawn frame,
 * however many events the frame held. `undefined` while there is no
 * instance; make the store again when the instance arrives
 * (`const selected = $derived(timelineState(timeline, …))`).
 */

import type { Timeline as TimelineInstance, TimelineSnapshot } from "@temporeum/timeline-element";

/** Svelte's store contract, without importing Svelte: what `$store` reads. */
export interface Readable<V> {
  subscribe(run: (value: V) => void): () => void;
}

export function timelineState<T, S>(
  timeline: TimelineInstance<T> | null | undefined,
  selector: (snapshot: TimelineSnapshot) => S,
  isEqual: (a: S, b: S) => boolean = Object.is,
): Readable<S | undefined> {
  return {
    subscribe(run) {
      if (timeline === null || timeline === undefined) {
        run(undefined);
        return () => {};
      }
      let seen: { snapshot: TimelineSnapshot; selected: S } | undefined;
      const read = (): void => {
        const snapshot = timeline.getSnapshot();
        if (seen !== undefined && seen.snapshot === snapshot) return;
        const selected = selector(snapshot);
        if (seen !== undefined && isEqual(seen.selected, selected)) {
          seen = { snapshot, selected: seen.selected };
          return;
        }
        seen = { snapshot, selected };
        run(selected);
      };
      read();
      return timeline.subscribe(read);
    },
  };
}
