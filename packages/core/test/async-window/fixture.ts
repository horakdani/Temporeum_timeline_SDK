/**
 * A source the test answers by hand.
 *
 * Every call is recorded with its window and its signal, and stays pending
 * until the test resolves or rejects it — in any order, and also after the
 * loader aborted it. That last part is the point: a real server that cannot
 * cancel answers anyway, and the loader has to drop that answer.
 */

import type { SceneElement } from "../../src/scene.js";
import type { Domain, Item } from "../../src/types.js";

export interface SourceCall {
  readonly n: number;
  readonly domain: Domain;
  readonly signal: AbortSignal;
  settled: boolean;
  resolve(items: readonly Item<{ fetch: number }>[]): void;
  reject(error: unknown): void;
}

export interface ControlledSource {
  readonly calls: SourceCall[];
  readonly source: (domain: Domain, signal: AbortSignal) => Promise<readonly Item<{ fetch: number }>[]>;
  /** Calls not answered yet, aborted or not. */
  pending(): SourceCall[];
}

export function controlledSource(): ControlledSource {
  const calls: SourceCall[] = [];
  return {
    calls,
    source: (domain, signal) =>
      new Promise((resolve, reject) => {
        const call: SourceCall = {
          n: calls.length,
          domain,
          signal,
          settled: false,
          resolve: (items) => {
            call.settled = true;
            resolve(items);
          },
          reject: (error) => {
            call.settled = true;
            reject(error);
          },
        };
        calls.push(call);
      }),
    pending: () => calls.filter((call) => !call.settled),
  };
}

/** Let every settled promise run its callbacks. */
export async function flush(): Promise<void> {
  for (let round = 0; round < 4; round += 1) {
    await Promise.resolve();
  }
}

export const DAY = 86_400_000;
export const ORIGIN = Date.UTC(2026, 0, 1);

/**
 * The items of a window, from a fixed universe, stamped with the call that
 * fetched them: the label ends in `@f<n>`, so the drawn frame itself says
 * where each item came from.
 */
export function answer(universe: readonly Item[], call: SourceCall): Item<{ fetch: number }>[] {
  const [from, to] = call.domain;
  const out: Item<{ fetch: number }>[] = [];
  for (const item of universe) {
    const start = item.start as number;
    const end = (item.end as number | undefined) ?? start + 1;
    if (start < to && end > from) {
      out.push({ ...item, label: `${item.label ?? item.id}@f${String(call.n)}`, data: { fetch: call.n } });
    }
  }
  return out;
}

/** Every option's accessible name in a scene. */
export function optionNames(scene: SceneElement): string[] {
  const names: string[] = [];
  const walk = (node: SceneElement): void => {
    if (node.attrs?.role === "option") {
      names.push(String(node.attrs["aria-label"]));
    }
    for (const child of node.children ?? []) {
      walk(child);
    }
  };
  walk(scene);
  return names;
}

/** The fetch numbers a scene shows, read off its option names. */
export function fetchesShown(scene: SceneElement): number[] {
  const shown: number[] = [];
  for (const name of optionNames(scene)) {
    const match = /@f(\d+)/.exec(name);
    if (match !== null) {
      shown.push(Number(match[1]));
    }
  }
  return shown;
}
