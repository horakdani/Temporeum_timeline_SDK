import { describe, expect, expectTypeOf, it } from "vitest";

import type { Command, Item, ItemPatch, TimeInput } from "@temporeum/timeline-core";

import type { Timeline, TimelineConfig } from "../src/index.js";

/**
 * Type-level claims about the element's API, checked by `tsc` (the package's
 * `typecheck` covers the tests): the host's item type survives an edit (A6),
 * and a configuration field takes an explicit `undefined` under
 * `exactOptionalPropertyTypes` (A7).
 */

interface Task {
  readonly assignee: string;
}

describe("the host's item type through the instance", () => {
  it("every command an event carries is a Command<T>", () => {
    const check = (timeline: Timeline<Task>): void => {
      timeline.on("command", ({ command }) => {
        expectTypeOf(command).toEqualTypeOf<Command<Task>>();
        expectTypeOf(command.after[0]?.item?.data).toEqualTypeOf<Task | undefined>();
      });
      timeline.on("itemMoved", ({ to, command }) => {
        expectTypeOf(to).toEqualTypeOf<ItemPatch<Task>>();
        expectTypeOf(command.inverse).toEqualTypeOf<Command<Task>>();
      });
      timeline.on("itemsAdded", ({ items, command }) => {
        expectTypeOf(items).toEqualTypeOf<readonly Item<Task>[]>();
        expectTypeOf(command).toEqualTypeOf<Command<Task>>();
      });
      timeline.on("itemsRemoved", ({ command }) => {
        expectTypeOf(command.before[0]?.item).toEqualTypeOf<Item<Task> | null | undefined>();
      });
      // An untyped command — one the host built itself — is still accepted.
      timeline.applyCommand({} as Command);
    };
    expect(check).toBeTypeOf("function");
  });
});

describe("an explicit undefined in a configuration", () => {
  it("is accepted for every optional field, as the update already accepted it", () => {
    const pick = <V>(on: boolean, value: V): V | undefined => (on ? value : undefined);
    const config: TimelineConfig<Task> = {
      items: [],
      domain: pick(false, [0, 1] as const),
      height: pick(false, 300),
      editing: pick(true, { enabled: true }),
      template: pick(false, (item: Item<Task>) => item.label ?? ""),
      tooltip: pick(false, true),
      ariaLabel: undefined,
    };
    expectTypeOf(config.domain).toEqualTypeOf<readonly [TimeInput, TimeInput] | undefined>();
    expect(config.domain).toBeUndefined();
  });
});
