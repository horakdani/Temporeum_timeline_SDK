import { describe, expect, expectTypeOf, it } from "vitest";

import type { Command, Item, ItemPatch, TimeInput } from "@temporeum/timeline-core";

import type { CalendarViewOptions } from "../src/calendar.js";
import type { TaskGridOptions } from "../src/gantt.js";
import type { ServerHtmlOptions, Timeline, TimelineConfig } from "../src/index.js";
import type { BacklogOptions } from "../src/resources.js";

/**
 * Type-level claims about the element's API, checked by `tsc` (the package's
 * `typecheck` covers the tests): the host's item type survives an edit,
 * and a configuration field takes an explicit `undefined` under
 * `exactOptionalPropertyTypes`.
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

describe("an explicit undefined in the views' and the server's options (R47)", () => {
  it("is accepted for every optional field, as in the configuration", () => {
    // Under exactOptionalPropertyTypes a host forwarding its own optional
    // value got TS2375 here, while TimelineConfig took it.
    const maybe = <V>(value: V): V | undefined => (Date.now() < 0 ? value : undefined);
    const calendar: CalendarViewOptions<Task> = { view: maybe("day"), timeZone: maybe("UTC"), now: maybe(false), strings: maybe({}), toolbar: maybe(true) };
    const grid: TaskGridOptions<Task> = { ariaLabel: maybe("Tasks"), overscan: maybe(4), focusTarget: maybe({} as HTMLElement), locale: maybe("hu") };
    const backlog: BacklogOptions<Task> = { tasks: [], describe: maybe(() => ""), dragThreshold: maybe(6), locale: maybe("hu") };
    const server: ServerHtmlOptions = { width: maybe(800), now: maybe(() => 0), tagName: maybe("temporeum-timeline"), attributes: maybe({}) };
    expect([calendar.view, grid.overscan, backlog.dragThreshold, server.width]).toEqual([undefined, undefined, undefined, undefined]);
  });
});

describe("the element's exported defaults (R85)", () => {
  it("cannot be changed by a page: a change would reach every timeline", async () => {
    const { OBSERVED_ATTRIBUTES } = await import("../src/element.js");
    const { STORY_STRINGS } = await import("../src/story.js");
    expect(Object.isFrozen(OBSERVED_ATTRIBUTES)).toBe(true);
    expect(Object.isFrozen(STORY_STRINGS)).toBe(true);
  });
});
