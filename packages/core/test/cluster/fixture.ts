/**
 * The cluster check's meter: what a frame shows, read back from its scene.
 *
 * A clustered frame is compared with the frame the same renderer draws for
 * the same view with clustering off — its item set is "what is visible",
 * and the culling that decides it has its own property (`culling.test.ts`),
 * tied to the layout and a fresh scale. The meter then reads the clustered
 * frame's item layer, option by option, and asks four questions:
 *
 * 1. Is every visible item represented — as itself, or by a marker — exactly
 *    once? (Nothing lost, nothing counted twice.)
 * 2. Does every marker's count, as drawn, equal its cluster's members?
 * 3. Is everything represented either visible, or a member of a marker that
 *    has a visible member? (Nothing invented: the only items beyond the
 *    visible set are the far members of a cluster across the culling edge.)
 * 4. Does the frame's own `visibleCount`, and the marker list it hands the
 *    hit tester, agree with what it drew?
 */

import type { RenderResult } from "../../src/render.js";
import type { SceneElement } from "../../src/scene.js";
import type { Item } from "../../src/types.js";

export const DAY = 86_400_000;
export const HOUR = 3_600_000;
export const ORIGIN = Date.UTC(2021, 0, 1);

/** What the item layer holds, in drawing order. */
export interface FrameReading {
  readonly singles: readonly string[];
  readonly markers: readonly { readonly id: string; readonly count: number }[];
}

function itemsLayer(scene: SceneElement): readonly SceneElement[] {
  const layer = (scene.children ?? []).find((child) => child.attrs?.class === "tl-layer tl-layer--items");
  // In a space the items sit in tile groups.
  return (layer?.children ?? []).flatMap((node) =>
    node.attrs?.["data-tl-tile"] === undefined ? [node] : (node.children ?? []),
  );
}

/** Read a frame's items and markers off its scene. */
export function readFrame(scene: SceneElement): FrameReading {
  const singles: string[] = [];
  const markers: { id: string; count: number }[] = [];
  for (const node of itemsLayer(scene)) {
    const id = node.attrs?.["data-tl-id"];
    const cluster = node.attrs?.["data-tl-cluster"];
    if (cluster !== undefined) {
      markers.push({ id: String(cluster), count: Number(node.attrs?.["data-tl-count"]) });
    } else if (id !== undefined) {
      singles.push(String(id));
    }
  }
  return { singles, markers };
}

/** What one measured frame showed. */
export interface Measurement {
  readonly problems: readonly string[];
  /** Items the plain frame draws. */
  readonly visible: number;
  /** Singles plus every marker's count. */
  readonly sum: number;
  readonly markers: number;
  /** Members beyond the visible set: far ends of markers across the culling edge. */
  readonly extras: number;
}

/** Members of a cluster by its id — the frame's own `clustering.byId`, or a control's. */
export type MembersOf = (clusterId: string) => readonly string[] | undefined;

export function membersFrom<T>(result: RenderResult<T>): MembersOf {
  return (id) => result.clustering?.byId(id)?.members.map((member) => member.item.id);
}

/** Measure a clustered frame against the plain frame of the same view. */
export function measure(
  clustered: FrameReading,
  plain: FrameReading,
  membersOf: MembersOf,
  reported?: { readonly visibleCount: number; readonly markerIds: readonly string[] },
): Measurement {
  const problems: string[] = [];
  const visible = new Set(plain.singles);
  const seen = new Map<string, number>();
  const note = (id: string): void => {
    seen.set(id, (seen.get(id) ?? 0) + 1);
  };
  for (const id of clustered.singles) {
    if (!visible.has(id)) {
      problems.push(`single ${id} is drawn, but the plain frame does not draw it`);
    }
    note(id);
  }
  let sum = clustered.singles.length;
  for (const marker of clustered.markers) {
    const members = membersOf(marker.id);
    if (members === undefined) {
      problems.push(`marker ${marker.id} names no cluster`);
      continue;
    }
    if (marker.count !== members.length) {
      problems.push(`marker ${marker.id} says ${String(marker.count)}, its cluster has ${String(members.length)}`);
    }
    if (!members.some((id) => visible.has(id))) {
      problems.push(`marker ${marker.id} is drawn, but none of its members would be`);
    }
    sum += marker.count;
    members.forEach(note);
  }
  for (const id of visible) {
    const times = seen.get(id) ?? 0;
    if (times !== 1) {
      problems.push(times === 0 ? `visible item ${id} is lost` : `visible item ${id} is shown ${String(times)} times`);
    }
  }
  for (const [id, times] of seen) {
    if (times > 1 && !visible.has(id)) {
      problems.push(`item ${id} is shown ${String(times)} times`);
    }
  }
  if (sum !== seen.size) {
    problems.push(`the counts add up to ${String(sum)}, but ${String(seen.size)} items are represented`);
  }
  if (reported !== undefined) {
    if (reported.visibleCount !== sum) {
      problems.push(`visibleCount says ${String(reported.visibleCount)}, the frame shows ${String(sum)}`);
    }
    const drawn = clustered.markers.map((marker) => marker.id).join(",");
    if (reported.markerIds.join(",") !== drawn) {
      problems.push(`the hit tester's markers (${reported.markerIds.join(",")}) are not the drawn ones (${drawn})`);
    }
  }
  return { problems, visible: visible.size, sum, markers: clustered.markers.length, extras: seen.size - visible.size };
}

/**
 * A dense universe: bursts of short items — instants, hours, days — that a
 * zoomed-out view cannot tell apart, among bars long enough to read, open
 * intervals and tall bands, over three lanes and every pack mode.
 */
export function denseUniverse(random: () => number): { items: Item[]; lanes: { id: string; packMode?: "pack" | "overlap" | "single" }[] } {
  const items: Item[] = [];
  const bursts = 8 + Math.floor(random() * 24);
  let index = 0;
  for (let burst = 0; burst < bursts; burst += 1) {
    const centre = ORIGIN + Math.floor(random() * 700) * DAY;
    const count = 2 + Math.floor(random() * 60);
    const spread = (0.5 + random() * 30) * DAY;
    const lane = `l${String(Math.floor(random() * 3))}`;
    for (let k = 0; k < count; k += 1) {
      const start = centre + Math.floor(random() * spread);
      const roll = random();
      const item: { id: string; start: number; end?: number; laneId: string; label: string; granularity?: "day" | "hour" } = {
        id: `b${String(index)}`,
        start,
        laneId: lane,
        label: `B${String(index)}`,
      };
      if (roll < 0.4) {
        // An instant.
      } else if (roll < 0.7) {
        item.end = start + Math.floor(random() * 6 * HOUR) + 1;
      } else if (roll < 0.85) {
        item.granularity = "day";
      } else {
        item.granularity = "hour";
      }
      items.push(item);
      index += 1;
    }
  }
  const scattered = Math.floor(random() * 40);
  for (let k = 0; k < scattered; k += 1) {
    const start = ORIGIN + Math.floor(random() * 730 * DAY);
    const roll = random();
    const lane = `l${String(Math.floor(random() * 3))}`;
    if (roll < 0.15) {
      items.push({ id: `o${String(k)}`, start, open: true, laneId: lane, label: `O${String(k)}` });
    } else if (roll < 0.3) {
      items.push({ id: `t${String(k)}`, start, end: start + Math.floor(random() * 3 * DAY) + 1, sublaneSpan: 2, laneId: lane });
    } else if (roll < 0.6) {
      items.push({ id: `L${String(k)}`, start, end: start + Math.floor((1 + random() * 120) * DAY), laneId: lane, label: `Long ${String(k)}` });
    } else {
      items.push({ id: `s${String(k)}`, start, laneId: lane });
    }
  }
  const modes = [undefined, undefined, "overlap", "single"] as const;
  const lanes = ["l0", "l1", "l2"].map((id) => {
    const mode = modes[Math.floor(random() * modes.length)];
    return mode === undefined ? { id } : { id, packMode: mode };
  });
  return { items, lanes };
}
