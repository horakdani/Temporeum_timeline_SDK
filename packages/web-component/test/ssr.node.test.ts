import { describe, expect, it } from "vitest";

import { renderTimeline, renderToSvgString } from "@temporeum/timeline-core";
import type { Item } from "@temporeum/timeline-core";

import * as element from "../src/index.js";
import {
  configFromAttributes,
  DEFAULT_HEIGHT,
  DEFAULT_SERVER_WIDTH,
  defineTimelineElement,
  eventNameOf,
  frameOptions,
  initialDomain,
  initialSpace,
  OBSERVED_ATTRIBUTES,
  renderTimelineHtml,
  renderTimelineSvg,
  resolveView,
  serializeConfig,
  TemporeumTimelineElement,
} from "../src/index.js";

/**
 * The server half, in Node — where there is no `window`, no `document`, no
 * `HTMLElement` and no `customElements`. That this file loads at all is the
 * first claim: every module of the package was imported above.
 */

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 1);
const items: Item[] = [
  { id: "a", start: T0, end: T0 + 4 * DAY, label: "Tervezés", laneId: "l1" },
  { id: "b", start: new Date(T0 + 6 * DAY), end: new Date(T0 + 9 * DAY), label: "Építés </script><b>", laneId: "l2" },
  { id: "c", start: T0 + 12 * DAY, label: "Mérföldkő", laneId: "l1" },
];
const lanes = [
  { id: "l1", label: "Munka" },
  { id: "l2", label: "Szállítás" },
];

describe("importing in Node", () => {
  it("touches no browser global", () => {
    for (const name of ["window", "document", "HTMLElement", "customElements", "ResizeObserver", "requestAnimationFrame"]) {
      expect(name in globalThis, name).toBe(false);
    }
    expect(typeof element.createTimeline).toBe("function");
    // The class is importable for its type and its statics; it extends a stand-in.
    expect(TemporeumTimelineElement.observedAttributes).toEqual(OBSERVED_ATTRIBUTES);
  });

  it("registers nothing and throws nothing where there is no registry", () => {
    expect(() => defineTimelineElement()).not.toThrow();
  });

  it("imports the side-effect entry without a registry", async () => {
    await expect(import("../src/define.js")).resolves.toBeDefined();
  });
});

describe("renderTimelineSvg", () => {
  it("draws the frame the renderer draws, at the server width", () => {
    const frame = renderTimelineSvg({ items, lanes, locale: "hu", timeZone: "UTC" });
    expect(frame.view.width).toBe(DEFAULT_SERVER_WIDTH);
    expect(frame.view.height).toBe(DEFAULT_HEIGHT);
    expect(frame.svg.startsWith("<svg")).toBe(true);
    expect(frame.result.layout.items).toHaveLength(3);
    // Byte for byte what the core prints for the same options — in the
    // space the client's first frame plans (rc.2: every size draws in one).
    const direct = renderTimeline(
      frameOptions({ items, lanes, locale: "hu", timeZone: "UTC" }, {
        items,
        domain: frame.domain,
        view: frame.view,
        selectedIds: [],
        focusedId: null,
        crossOffset: 0,
        loading: [],
        space: initialSpace(frame.domain, frame.view),
      }),
    );
    expect(frame.svg).toBe(renderToSvgString(direct.scene));
  });

  it("is deterministic: the same configuration, the same markup", () => {
    expect(renderTimelineHtml({ items, lanes })).toBe(renderTimelineHtml({ items, lanes }));
  });

  it("honours width, height, orientation and selection", () => {
    const frame = renderTimelineSvg({ items, height: 500, orientation: "vertical", selectedIds: ["a"] }, { width: 360 });
    expect(frame.view).toMatchObject({ width: 360, height: 500, orientation: "vertical", mainSize: 500, crossSize: 360 });
    expect(frame.svg).toContain('data-tl-orientation="vertical"');
    expect(frame.svg).toContain("tl-item--selected");
  });

  it("resolves `auto` from the width it draws at", () => {
    expect(renderTimelineSvg({ items, orientation: "auto" }, { width: 360 }).view.orientation).toBe("vertical");
    expect(renderTimelineSvg({ items, orientation: "auto" }, { width: 1200 }).view.orientation).toBe("horizontal");
  });

  it("draws nothing it would have to fetch", () => {
    const frame = renderTimelineSvg({ items: () => Promise.resolve(items), domain: [T0, T0 + 10 * DAY] });
    expect(frame.result.layout.items).toHaveLength(0);
  });
});

describe("initialDomain", () => {
  it("is the given domain, in milliseconds", () => {
    expect(initialDomain({ domain: [new Date(T0), T0 + DAY] })).toEqual([T0, T0 + DAY]);
  });

  it("is the items' extent with a margin", () => {
    const [start, end] = initialDomain({ items });
    expect(start).toBeLessThan(T0);
    expect(end).toBeGreaterThan(T0 + 12 * DAY);
  });

  it("keeps a day of margin around a single instant", () => {
    expect(initialDomain({ items: [{ id: "x", start: T0 }] })).toEqual([T0 - DAY, T0 + DAY]);
  });

  it("is the month around now with nothing to go by", () => {
    expect(initialDomain({}, () => T0)).toEqual([T0 - 15 * DAY, T0 + 15 * DAY]);
  });
});

describe("resolveView", () => {
  it("prefers the configured height, then the measured one, then the default", () => {
    const domain = initialDomain({ items });
    expect(resolveView({ height: 420 }, items, domain, 800, 200).height).toBe(420);
    expect(resolveView({}, items, domain, 800, 200).height).toBe(200);
    expect(resolveView({}, items, domain, 800, 0).height).toBe(DEFAULT_HEIGHT);
  });

  it("keeps the previous orientation inside the hysteresis band", () => {
    const domain = initialDomain({ items });
    const wide = resolveView({ orientation: "auto", breakpoint: 600 }, items, domain, 620, 0);
    expect(wide.orientation).toBe("horizontal");
    const kept = resolveView({ orientation: "auto", breakpoint: 600 }, items, domain, 590, 0, wide);
    expect(kept.orientation).toBe("horizontal");
    expect(resolveView({ orientation: "auto", breakpoint: 600 }, items, domain, 590, 0).orientation).toBe("vertical");
  });

  it("passes the density setting through, and fits `auto`", () => {
    const domain = initialDomain({ items });
    expect(resolveView({ density: "dense" }, items, domain, 800, 0).density).toBe("dense");
    expect(["comfortable", "compact", "dense"]).toContain(resolveView({ density: "auto", lanes, packMode: "pack", timeZone: "UTC" }, items, domain, 800, 0).density);
  });
});

describe("serializeConfig and renderTimelineHtml", () => {
  it("writes dates as milliseconds and drops what cannot travel", () => {
    const json = JSON.parse(
      serializeConfig({ items, hooks: { describeItem: () => "x" }, editing: { enabled: true, canMove: () => true } }),
    ) as { items: { start: unknown; end: unknown }[]; hooks: object; editing: object };
    expect(json.items[1]).toMatchObject({ start: T0 + 6 * DAY, end: T0 + 9 * DAY });
    expect(json.hooks).toEqual({});
    expect(json.editing).toEqual({ enabled: true });
  });

  it("cannot be ended early by an item's text", () => {
    const html = renderTimelineHtml({ items });
    const script = html.slice(html.indexOf("<script"), html.indexOf("</script>") + 9);
    // The only </script> is the script's own end.
    expect(html.split("</script>")).toHaveLength(2);
    expect(script).toContain("\\u003c/script>");
    expect(JSON.parse(script.slice(script.indexOf(">") + 1, -9))).toMatchObject({ items: [{ id: "a" }, { label: "Építés </script><b>" }, { id: "c" }] });
  });

  it("escapes U+2028 and U+2029, which end a line in a script", () => {
    const json = serializeConfig({ ariaLabel: `a${String.fromCharCode(0x2028)}b${String.fromCharCode(0x2029)}c` });
    expect(json).toContain("\\u2028");
    expect(json).toContain("\\u2029");
    expect(JSON.parse(json)).toEqual({ ariaLabel: `a${String.fromCharCode(0x2028)}b${String.fromCharCode(0x2029)}c` });
  });

  it("puts the drawing in a declarative shadow root and the state beside it", () => {
    const html = renderTimelineHtml({ items, lanes, height: 320 }, { attributes: { id: "plan", style: "margin: 0;" } });
    expect(html.startsWith('<temporeum-timeline id="plan" style="margin: 0;--tl-height:320px">')).toBe(true);
    expect(html).toContain('<template shadowrootmode="open"><style>:host{');
    expect(html).toContain('<script type="application/json" data-tl-config>');
    const state = JSON.parse(html.slice(html.indexOf("data-tl-config>") + 15, html.lastIndexOf("</script>"))) as { domain: number[] };
    // The domain the server chose travels, so the client does not choose again.
    expect(state.domain).toEqual([...renderTimelineSvg({ items, lanes, height: 320 }).domain]);
  });

  it("uses another tag and escapes attribute values", () => {
    const html = renderTimelineHtml({ items }, { tagName: "my-timeline", attributes: { title: 'a "b" <c>' } });
    expect(html.startsWith('<my-timeline title="a &quot;b&quot; &lt;c&gt;">')).toBe(true);
    expect(html.endsWith("</my-timeline>")).toBe(true);
  });
});

describe("configFromAttributes", () => {
  const read = (attrs: Record<string, string>) => (name: string) => attrs[name] ?? null;

  it("maps every observed attribute", () => {
    expect(
      configFromAttributes(
        read({
          orientation: "vertical",
          density: "compact",
          theme: "dark",
          locale: "hu",
          "time-zone": "Europe/Budapest",
          label: "Projekt",
          start: "2026-01-01T00:00:00Z",
          end: String(T0 + 30 * DAY),
          height: "320",
          breakpoint: "600",
          "pack-mode": "overlap",
          cluster: "",
          editable: "",
          "multi-select": "",
          "snap-ms": String(DAY),
        }),
      ),
    ).toEqual({
      orientation: "vertical",
      density: "compact",
      theme: "dark",
      locale: "hu",
      timeZone: "Europe/Budapest",
      ariaLabel: "Projekt",
      domain: [T0, T0 + 30 * DAY],
      height: 320,
      breakpoint: 600,
      packMode: "overlap",
      cluster: true,
      editing: { enabled: true, multiSelect: true, snapMs: DAY },
    });
  });

  it("is empty without attributes", () => {
    expect(configFromAttributes(read({}))).toEqual({});
  });

  it("reads `false` as off and ignores what is not a number or a range", () => {
    expect(
      configFromAttributes(read({ cluster: "false", editable: "false", "multi-select": "false", height: "tall", start: "x", end: "2026-01-02" })),
    ).toEqual({ cluster: false, editing: { enabled: false, multiSelect: false } });
    expect(configFromAttributes(read({ start: "2026-02-01", end: "2026-01-01" }))).toEqual({});
    expect(configFromAttributes(read({ height: "-3", "snap-ms": " " }))).toEqual({});
  });
});

describe("eventNameOf", () => {
  it("is the kebab-case of the instance event", () => {
    expect(eventNameOf("itemMoved")).toBe("item-moved");
    expect(eventNameOf("selectionChanged")).toBe("selection-changed");
    expect(eventNameOf("command")).toBe("command");
  });
});
