import { compile } from "@vue/compiler-dom";
import * as Vue from "vue";
import { createApp, defineComponent, h, isProxy, reactive, shallowRef } from "vue";
import type { App, RenderFunction, ShallowRef } from "vue";
import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";

import { registerPlugin } from "@temporeum/timeline-element";
import { toolsPlugin } from "@temporeum/timeline-element/tools";
import type { Item } from "@temporeum/timeline-core";

import { Timeline } from "../src/index.js";
import type { TimelineInstance, TimelineProps } from "../src/index.js";

registerPlugin(toolsPlugin);

/**
 * The component's props. It used to declare none
 * but `ssrWidth`: every field was an attribute, untyped, so a bare
 * `<Timeline lane-headers />` arrived as `""` — the tools plugin was asked
 * for, and the headers were not drawn — and a reactive array reached the
 * instance as Vue's proxy of it.
 */

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 1);
const items: Item[] = [
  { id: "a", start: T0 + 2 * DAY, end: T0 + 6 * DAY, label: "Planning", laneId: "l1" },
  { id: "b", start: T0 + 8 * DAY, end: T0 + 13 * DAY, label: "Building", laneId: "l2" },
];
const lanes = [
  { id: "l1", label: "Work" },
  { id: "l2", label: "Delivery" },
];
const defaultDomain: [number, number] = [T0, T0 + 24 * DAY];

let app: App | undefined;
afterEach(() => {
  app?.unmount();
  app = undefined;
  document.body.replaceChildren();
});

function host(): HTMLElement {
  const element = document.createElement("div");
  element.style.width = "800px";
  document.body.append(element);
  return element;
}

async function mountTemplate(template: string, data: Record<string, unknown>): Promise<TimelineInstance> {
  const timeline: ShallowRef<TimelineInstance | null> = shallowRef(null);
  const Page = defineComponent({
    components: { Timeline },
    setup: () => ({ ...data, ready: (instance: TimelineInstance | null) => (timeline.value = instance) }),
    // A template as Vue's compiler makes it, bound to the runtime the component uses.
    render: new Function("Vue", compile(template, { mode: "function" }).code)(Vue) as RenderFunction,
  });
  app = createApp(Page);
  app.mount(host());
  await vi.waitFor(() => {
    if (timeline.value?.result === undefined) throw new Error("not drawn yet");
  });
  return timeline.value as TimelineInstance;
}

describe("<Timeline> props", () => {
  it("a bare boolean attribute in a template is true", async () => {
    await mountTemplate(`<Timeline :items="items" :lanes="lanes" :default-domain="defaultDomain" lane-headers @ready="ready" />`, { items, lanes, defaultDomain });
    await vi.waitFor(() => expect(document.querySelectorAll("[data-tl-lane-header]")).toHaveLength(2));
  });

  it("an absent prop is not in the configuration, so the instance's default holds", async () => {
    const timeline = await mountTemplate(`<Timeline :items="items" :lanes="lanes" :default-domain="defaultDomain" @ready="ready" />`, { items, lanes, defaultDomain });
    const update = vi.spyOn(timeline, "update");
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(document.querySelectorAll("[data-tl-lane-header]")).toHaveLength(0);
    expect(update).not.toHaveBeenCalled();
  });

  it("hands the instance the host's array, not Vue's proxy of it", async () => {
    const live = reactive([...items]);
    const timeline = await mountTemplate(`<Timeline :items="live" :default-domain="defaultDomain" @ready="ready" />`, { live, defaultDomain });
    expect(isProxy(timeline.items)).toBe(false);
    expect(timeline.items[0]).not.toBe(live[0]);
    expect(isProxy(timeline.items[0])).toBe(false);
  });

  it("puts the host's class, style, id and data attributes on the box, not in the configuration", async () => {
    const timeline = await mountTemplate(`<Timeline id="plan" class="wide" style="margin: 4px" data-testid="tl" :items="items" :default-domain="defaultDomain" @ready="ready" />`, { items, defaultDomain });
    const box = document.querySelector("[data-tl-vue]") as HTMLElement;
    expect(box.id).toBe("plan");
    expect(box.className).toBe("wide");
    expect(box.getAttribute("data-testid")).toBe("tl");
    expect(box.style.margin).toBe("4px");
    expect(box.style.position).toBe("relative");
    expect(timeline.getSnapshot().domain).toEqual(defaultDomain);
  });

  it("is typed, and generic over the items' data", () => {
    interface Task {
      readonly cost: number;
    }
    expectTypeOf<TimelineProps<Task>["items"]>().toEqualTypeOf<readonly Item<Task>[] | ((domain: readonly [number, number], signal: AbortSignal) => Promise<readonly Item<Task>[]>) | undefined>();
    expectTypeOf<TimelineProps>().not.toHaveProperty("domain");
    expectTypeOf<TimelineProps>().toHaveProperty("defaultDomain");
    const check = (): void => {
      // @ts-expect-error — `height` is a number.
      h(Timeline, { height: "tall" });
      h(Timeline, { height: 200, laneHeaders: true });
      // R18: every handler was `(...args: any[]) => any`, so this compiled.
      // @ts-expect-error — itemMoved's payload is not a number.
      h(Timeline, { onItemMoved: (payload: number) => payload });
      h(Timeline, { onItemMoved: (payload) => expectTypeOf(payload.item.id).toEqualTypeOf<string>(), onReady: (timeline) => expectTypeOf(timeline).toEqualTypeOf<TimelineInstance | null>() });
    };
    // A template ref's `timeline` (R46).
    expectTypeOf<InstanceType<typeof Timeline>["timeline"]>().toEqualTypeOf<TimelineInstance | null>();
    expect(check).toBeTypeOf("function");
  });
});
