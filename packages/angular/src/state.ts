/**
 * The instance's store, as an Angular signal.
 *
 * `timelineState(timeline, selector, isEqual?)` — called in an injection
 * context, a component's constructor or a field — gives a read-only signal
 * of the selected part of the instance's state: it changes when the part
 * changes (by `isEqual`, `Object.is` by default), and at most once per drawn
 * frame, because the store notifies at most once per frame. `timeline` is a
 * signal of the instance (`undefined` until there is one); the subscription
 * follows it, and ends with the injection context.
 */

import { effect, signal } from "@angular/core";
import type { Signal } from "@angular/core";
import type { Timeline as TimelineInstance, TimelineSnapshot } from "@temporeum/timeline-element";

export function timelineState<T, S>(
  timeline: Signal<TimelineInstance<T> | null | undefined>,
  selector: (snapshot: TimelineSnapshot) => S,
  isEqual: (a: S, b: S) => boolean = Object.is,
): Signal<S | undefined> {
  const state = signal<S | undefined>(undefined, { equal: (a, b) => a === b });
  effect((onCleanup) => {
    const instance = timeline();
    if (instance === null || instance === undefined) {
      state.set(undefined);
      return;
    }
    let seen: { snapshot: TimelineSnapshot; selected: S } | undefined;
    const read = (): void => {
      const snapshot = instance.getSnapshot();
      if (seen !== undefined && seen.snapshot === snapshot) return;
      const selected = selector(snapshot);
      if (seen !== undefined && isEqual(seen.selected, selected)) {
        seen = { snapshot, selected: seen.selected };
        return;
      }
      seen = { snapshot, selected };
      state.set(selected);
    };
    read();
    onCleanup(instance.subscribe(read));
  });
  return state.asReadonly();
}
