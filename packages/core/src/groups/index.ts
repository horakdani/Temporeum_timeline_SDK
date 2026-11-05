/**
 * `@temporeum/timeline-core/groups` — nested groups of lanes.
 *
 * A group is what a host calls a row of its timeline — a person, a machine,
 * a project — and groups nest: a team holds people, a project holds phases.
 * The layout knows nothing of nesting. It packs items into a flat list of
 * lanes, and this file is the translation: a tree of groups, some of them
 * collapsed, in, and the lanes and items the layout should see out.
 *
 * Three decisions shape it:
 *
 * 1. **A group is two lanes.** A header lane — one empty row, its id the
 *    group's id behind {@link GROUP_HEADER_PREFIX} — and the content lane
 *    the group's own items are packed into. The header is what a reader
 *    clicks to collapse the group and drags to reorder it, so it needs room
 *    of its own: a label drawn over the first row of items would cover them.
 *    A group with subgroups and no items of its own has no content lane;
 *    its header is the whole of it.
 * 2. **Collapsed is view state, order is data.** Collapsing a group hides
 *    its items and its subgroups, and expanding it brings back the very same
 *    layout — nothing is moved to make room, so nothing has to be moved back.
 *    That state belongs to the view, like a selection. The order of the
 *    groups belongs to the host, so a reorder leaves as a {@link GroupCommand}
 *    with its own inverse, and the library never stores it.
 * 3. **Pure, and DOM-free.** The keyboard's tree walk, the drop position of
 *    a dragged header and the reorder are functions of data; the browser
 *    binding only feeds them.
 */

import { createCommand } from "../editing.js";
import { DEFAULT_LANE_ID } from "../layout.js";
import type { Layout } from "../layout.js";
import type { KeySample } from "../keyboard.js";
import type { Item, Lane, Orientation, PackMode } from "../types.js";

/** One group. Its parent is named by id; a group without one is a root. */
export interface Group {
  readonly id: string;
  readonly label?: string;
  /** The group this one is nested in. Unknown or circular parents make it a root. */
  readonly parentId?: string;
  /** Collapsed when the timeline starts. */
  readonly collapsed?: boolean;
  readonly className?: string;
  /** Packing for the group's own items. */
  readonly packMode?: PackMode;
}

/** A group as shown: where it is in the tree, and which lanes are its. */
export interface GroupRow {
  readonly group: Group;
  /** Nesting depth, 0 for a root. */
  readonly depth: number;
  /** The header lane's id. */
  readonly headerLaneId: string;
  /** The content lane's id, or `undefined` when the group has none. */
  readonly laneId: string | undefined;
  readonly hasChildren: boolean;
  readonly expanded: boolean;
  /** Position among its siblings, from 1 — `aria-posinset`. */
  readonly position: number;
  /** How many siblings it has, itself included — `aria-setsize`. */
  readonly siblings: number;
  /** The effective parent: `undefined` for a root, whatever `parentId` said. */
  readonly parentId: string | undefined;
}

/** What the layout is given, and what the header layer draws. */
export interface GroupView<T = unknown> {
  /** Header and content lanes, in tree order. */
  readonly lanes: readonly Lane[];
  /** The items not hidden by a collapsed ancestor, in their original order. */
  readonly items: readonly Item<T>[];
  /** The groups shown, in tree order. Descendants of a collapsed group are not here. */
  readonly rows: readonly GroupRow[];
  /** Groups hidden by a collapsed ancestor. */
  readonly hidden: ReadonlySet<string>;
}

/** What {@link groupView} is tuned with. */
export interface GroupViewOptions {
  /**
   * The ids of the collapsed groups. When given, it is the whole truth and
   * `Group.collapsed` is ignored: that is how a live timeline keeps the state
   * a reader toggled.
   */
  readonly collapsed?: Iterable<string>;
}

/** The prefix of a header lane's id. A NUL, which no host's own id begins with. */
export const GROUP_HEADER_PREFIX = "\u0000h:";

/** The header lane of a group. */
export function groupHeaderLane(id: string): string {
  return GROUP_HEADER_PREFIX + id;
}

/** The group a header lane belongs to, or `undefined` for any other lane. */
export function headerGroupId(laneId: string): string | undefined {
  return laneId.startsWith(GROUP_HEADER_PREFIX) ? laneId.slice(GROUP_HEADER_PREFIX.length) : undefined;
}

/** Each group's effective parent: unknown and circular parents count as none. */
function parentsOf(groups: readonly Group[]): Map<string, string | undefined> {
  const byId = new Map<string, Group>();
  for (const group of groups) {
    if (byId.has(group.id)) {
      // Two groups with one id would each claim the same lane.
      throw new RangeError(`Duplicate group id "${group.id}"`);
    }
    byId.set(group.id, group);
  }
  // Whether a group's chain of parents ends without a loop, worked out once
  // per group: a walk stops at the first group already known (R28 — a chain
  // walked from every group was quadratic).
  const rooted = new Map<string, boolean>();
  const walking = new Set<string>();
  for (const group of groups) {
    const path: string[] = [];
    let at: string | undefined = group.id;
    let ends = true;
    while (at !== undefined) {
      const known = rooted.get(at);
      if (known !== undefined) {
        ends = known;
        break;
      }
      const node = byId.get(at);
      if (node === undefined) break;
      if (walking.has(at)) {
        ends = false;
        break;
      }
      walking.add(at);
      path.push(at);
      at = node.parentId;
    }
    for (const id of path) {
      rooted.set(id, ends);
      walking.delete(id);
    }
  }
  const parents = new Map<string, string | undefined>();
  for (const group of groups) {
    const parentId = group.parentId;
    parents.set(group.id, rooted.get(group.id) === true && parentId !== undefined && byId.has(parentId) ? parentId : undefined);
  }
  return parents;
}

/** Children by parent (`undefined` for the roots), in the groups' own order. */
function childrenOf(groups: readonly Group[], parents: Map<string, string | undefined>): Map<string | undefined, Group[]> {
  const children = new Map<string | undefined, Group[]>();
  for (const group of groups) {
    const parent = parents.get(group.id);
    const list = children.get(parent);
    if (list === undefined) children.set(parent, [group]);
    else list.push(group);
  }
  return children;
}

/**
 * The lanes and items for a tree of groups.
 *
 * Items whose `laneId` names a group go to that group's content lane; items
 * of a group hidden by a collapsed ancestor — or collapsed itself — are left
 * out, so they are in neither the layout nor the accessibility tree. Items
 * that name no group are kept, in a default lane after the groups.
 */
export function groupView<T>(groups: readonly Group[], items: readonly Item<T>[], options: GroupViewOptions = {}): GroupView<T> {
  const parents = parentsOf(groups);
  const children = childrenOf(groups, parents);
  const collapsed =
    options.collapsed === undefined
      ? new Set(groups.filter((group) => group.collapsed === true).map((group) => group.id))
      : new Set(options.collapsed);
  const owning = new Set<string>();
  let orphans = false;
  for (const item of items) {
    const laneId = item.laneId ?? DEFAULT_LANE_ID;
    if (parents.has(laneId)) owning.add(laneId);
    else orphans = true;
  }

  const lanes: Lane[] = [];
  const rows: GroupRow[] = [];
  const hidden = new Set<string>();
  const shown = new Set<string>();

  // Depth first, in the groups' order, with a stack of its own: a chain of
  // groups as deep as the host likes does not run out of call stack (R28).
  const roots = children.get(undefined) ?? [];
  const stack: { group: Group; depth: number; position: number; siblings: number; parent: string | undefined }[] = [];
  const push = (siblings: readonly Group[], depth: number, parent: string | undefined): void => {
    for (let index = siblings.length - 1; index >= 0; index -= 1) {
      stack.push({ group: siblings[index] as Group, depth, position: index + 1, siblings: siblings.length, parent });
    }
  };
  push(roots, 0, undefined);
  for (let next = stack.pop(); next !== undefined; next = stack.pop()) {
    const { group, depth, position, siblings, parent } = next;
    const kids = children.get(group.id) ?? [];
    const hasChildren = kids.length > 0;
    const expanded = !collapsed.has(group.id);
    const headerLaneId = groupHeaderLane(group.id);
    lanes.push({ id: headerLaneId, ...(group.label === undefined ? {} : { label: group.label }) });
    const content = expanded && (!hasChildren || owning.has(group.id));
    if (content) {
      lanes.push({
        id: group.id,
        ...(group.label === undefined ? {} : { label: group.label }),
        ...(group.packMode === undefined ? {} : { packMode: group.packMode }),
      });
      shown.add(group.id);
    }
    rows.push({ group, depth, headerLaneId, laneId: content ? group.id : undefined, hasChildren, expanded, position, siblings, parentId: parent });
    if (expanded) push(kids, depth + 1, group.id);
    else {
      // Everything under a collapsed group is hidden.
      const under = [...kids];
      for (let child = under.pop(); child !== undefined; child = under.pop()) {
        hidden.add(child.id);
        for (const grandchild of children.get(child.id) ?? []) under.push(grandchild);
      }
    }
  }

  if (orphans) lanes.push({ id: DEFAULT_LANE_ID });
  const kept = items.filter((item) => {
    const laneId = item.laneId ?? DEFAULT_LANE_ID;
    return !parents.has(laneId) || shown.has(laneId);
  });
  return { lanes, items: kept, rows, hidden };
}

/** A group's place in the group list. */
export interface GroupPatch {
  readonly id: string;
  /** Index in the group array. */
  readonly index: number;
}

/**
 * A reversible reorder of the groups.
 *
 * Built like an item {@link Command} — `inverse` is lazy, non-enumerable and
 * memoised, so a stack of these serialises as plain JSON — but its patches
 * place groups, not items, which is why it has a type of its own.
 */
export interface GroupCommand {
  readonly type: "moveGroup";
  readonly label?: string;
  readonly before: readonly GroupPatch[];
  readonly after: readonly GroupPatch[];
  readonly inverse: GroupCommand;
}

/** Whether a command places groups rather than items. */
export function isGroupCommand(command: { readonly type: string }): command is GroupCommand {
  return command.type === "moveGroup";
}

/**
 * Apply group patches: each takes its group out of the list and puts it back
 * at `index`. Applying a command and then its inverse gives back the exact
 * list, order included. A patch for an unknown id is ignored.
 */
export function applyGroupPatches(groups: readonly Group[], patches: readonly GroupPatch[]): Group[] {
  const next = [...groups];
  for (const patch of patches) {
    const at = next.findIndex((group) => group.id === patch.id);
    if (at < 0) continue;
    const [group] = next.splice(at, 1) as [Group];
    next.splice(Math.max(0, Math.min(patch.index, next.length)), 0, group);
  }
  return next;
}

/**
 * The command that moves a group to `position` among its siblings, from 0.
 * `undefined` when it is already there or the position is out of range.
 *
 * The keyboard asks for one step (`position` ± 1), a dragged header for
 * wherever it was dropped ({@link dropPosition}); both build the command
 * here, so a step up by key and a drag one place up are the same command.
 */
export function moveGroupCommand(groups: readonly Group[], id: string, position: number): GroupCommand | undefined {
  const parents = parentsOf(groups);
  if (!parents.has(id)) return undefined;
  const parent = parents.get(id);
  const siblings = childrenOf(groups, parents).get(parent) ?? [];
  const from = siblings.findIndex((group) => group.id === id);
  if (!Number.isInteger(position) || position < 0 || position >= siblings.length || position === from) {
    return undefined;
  }
  const index = groups.findIndex((group) => group.id === id);
  const rest = groups.filter((group) => group.id !== id);
  const target = siblings[position] as Group;
  const targetIndex = rest.findIndex((group) => group.id === target.id);
  // Up: before the sibling now at `position`; down: after it.
  const to = position < from ? targetIndex : targetIndex + 1;
  return createCommand("moveGroup", [{ id, index }], [{ id, index: to }]) as unknown as GroupCommand;
}

/** A header lane's box across, from a drawn layout. */
export interface GroupHeaderBox {
  readonly row: GroupRow;
  /** Cross position in layout space. */
  readonly cross: number;
  readonly crossSize: number;
}

/** Where each shown group's header is, in layout space. */
export function groupHeaderBoxes(rows: readonly GroupRow[], layout: Layout): GroupHeaderBox[] {
  const lanes = new Map(layout.lanes.map((lane) => [lane.lane.id, lane]));
  const boxes: GroupHeaderBox[] = [];
  for (const row of rows) {
    const lane = lanes.get(row.headerLaneId);
    if (lane !== undefined) boxes.push({ row, cross: lane.cross, crossSize: lane.crossSize });
  }
  return boxes;
}

/**
 * The sibling position a dragged header lands at, for a pointer at `cross`
 * (layout space): one past every other sibling whose header's middle it has
 * passed. The drag twin of a key step, built into the same command by
 * {@link moveGroupCommand}.
 */
export function dropPosition(boxes: readonly GroupHeaderBox[], id: string, cross: number): number | undefined {
  const own = boxes.find((box) => box.row.group.id === id);
  if (own === undefined) return undefined;
  let position = 0;
  for (const box of boxes) {
    if (box.row.group.id === id || box.row.parentId !== own.row.parentId) continue;
    if (box.cross + box.crossSize / 2 < cross) position += 1;
  }
  return position;
}

/** What a key does in the group tree. */
export type GroupKeyAction =
  | "next"
  | "previous"
  | "first"
  | "last"
  | "expand"
  | "collapse"
  | "toggle"
  | "moveEarlier"
  | "moveLater";

/**
 * A key, as the group tree reads it — the WAI-ARIA tree pattern, along the
 * axes like every other key of the timeline: in a horizontal timeline the
 * groups are stacked down the page, so up and down walk them and right and
 * left open and close them; in a vertical one the two pairs swap. `Alt`
 * with a walking arrow moves the group among its siblings.
 */
export function resolveGroupKey(sample: KeySample, orientation: Orientation): GroupKeyAction | undefined {
  if (sample.ctrlKey || sample.metaKey) return undefined;
  const horizontal = orientation === "horizontal";
  const forward = horizontal ? "ArrowDown" : "ArrowRight";
  const back = horizontal ? "ArrowUp" : "ArrowLeft";
  const open = horizontal ? "ArrowRight" : "ArrowDown";
  const close = horizontal ? "ArrowLeft" : "ArrowUp";
  if (sample.altKey) {
    return sample.key === forward ? "moveLater" : sample.key === back ? "moveEarlier" : undefined;
  }
  switch (sample.key) {
    case forward:
      return "next";
    case back:
      return "previous";
    case open:
      return "expand";
    case close:
      return "collapse";
    case "Home":
      return "first";
    case "End":
      return "last";
    case "Enter":
    case " ":
      return "toggle";
    default:
      return undefined;
  }
}

/** What a group key asks the host to do. Every field is optional. */
export interface GroupStep {
  /** Move the tree's focus here. */
  readonly focus?: string;
  /** Collapse (`true`) or expand (`false`) a group. */
  readonly toggle?: { readonly id: string; readonly collapsed: boolean };
  /** Reorder the groups. */
  readonly command?: GroupCommand;
}

/**
 * One key in the group tree, from the shown rows and the focused group.
 * `undefined`: the key means nothing here, let it through.
 */
export function groupKeyStep(
  groups: readonly Group[],
  rows: readonly GroupRow[],
  focusedId: string | undefined,
  action: GroupKeyAction,
): GroupStep | undefined {
  if (rows.length === 0) return undefined;
  const at = rows.findIndex((row) => row.group.id === focusedId);
  const row = rows[at];
  if (row === undefined) return { focus: (rows[0] as GroupRow).group.id };
  switch (action) {
    case "next":
    case "previous": {
      const next = rows[at + (action === "next" ? 1 : -1)];
      return next === undefined ? {} : { focus: next.group.id };
    }
    case "first":
      return { focus: (rows[0] as GroupRow).group.id };
    case "last":
      return { focus: (rows[rows.length - 1] as GroupRow).group.id };
    case "expand":
      if (!row.expanded) return { toggle: { id: row.group.id, collapsed: false } };
      // Open already: the tree pattern steps into the first child.
      return row.hasChildren && rows[at + 1] !== undefined ? { focus: (rows[at + 1] as GroupRow).group.id } : {};
    case "collapse":
      if (row.expanded) return { toggle: { id: row.group.id, collapsed: true } };
      return row.parentId === undefined ? {} : { focus: row.parentId };
    case "toggle":
      return { toggle: { id: row.group.id, collapsed: row.expanded } };
    case "moveEarlier":
    case "moveLater": {
      const command = moveGroupCommand(groups, row.group.id, row.position - 1 + (action === "moveLater" ? 1 : -1));
      return command === undefined ? {} : { command };
    }
  }
}
