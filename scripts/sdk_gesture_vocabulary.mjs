/**
 * The gesture vocabulary — derived from the input machine's OWN types.
 *
 * Two checks share it: the no-gesture-only check (static) and the keyboard check (runtime).
 * Both ask the same question — "is there a capability that can only be
 * reached with a gesture?" —, and the question is only honest if the list of
 * capabilities is NOT a hand-written list. A hand-written list is worth
 * exactly as much as its author noticed: if tomorrow the machine gets a new
 * edit mode (say "duplicate"), the list does not know about it, and the
 * check lets it through green.
 *
 * So the list comes from the TypeScript type checker: every member of the
 * `InputEffect` union, every literal of `InputViewportReason` and `EditMode`,
 * every field of `ViewportEffect` and `TapEffect`, and the editing and input
 * switches. Each of them must be CLASSIFIED in the tables below: capability
 * (needs a key), signal (not a capability, only a notification), or the
 * keyboard's own effect. An unknown member is a FAILURE — so a new gesture
 * capability cannot slip in silently.
 */

import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const CORE = join(repoRoot, "packages", "core");
export const INPUT_FILE = join(CORE, "src", "input.ts");
export const KEYBOARD_FILE = join(CORE, "src", "keyboard.ts");
export const ATTACH_FILE = join(CORE, "src", "dom", "attach.ts");

/** The members of `InputEffect`: what each one is. */
export const EFFECT_CLASSES = {
  viewport: "capability",
  tap: "capability",
  editStart: "edit",
  editMove: "edit",
  editEnd: "edit",
  press: "signal",
  schedule: "signal",
  gestureStart: "signal",
  gestureEnd: "signal",
  key: "keyboard",
  focus: "keyboard",
  activate: "keyboard",
  jumpRequest: "keyboard",
};

/** The fields of `ViewportEffect`. */
export const VIEWPORT_FIELDS = {
  type: "discriminant",
  domain: "via-reason",
  reason: "via-reason",
  crossOffset: ["view.cross.forward", "view.cross.back"],
  atLimit: "signal",
};

/** The literals of `InputViewportReason`. */
export const REASON_CAPABILITIES = {
  pan: ["view.pan.later", "view.pan.earlier"],
  zoom: ["view.zoom.in", "view.zoom.out"],
};

/**
 * The fields of `TapEffect`. To the host a tap is a selection (an item was
 * hit) or a deselection (nothing); a double tap zooms in, a two-finger tap
 * zooms out; and any item the eye can see can be reached with it.
 */
export const TAP_FIELDS = {
  type: "discriminant",
  main: ["item.select", "item.deselect", "item.reach"],
  cross: ["item.select", "item.deselect", "item.reach"],
  pointerType: "signal",
  tapCount: ["view.zoom.in"],
  pointerCount: ["view.zoom.out"],
  durationMs: "signal",
};

/** The literals of `EditMode`. */
export const MODE_CAPABILITIES = {
  move: ["edit.move.later", "edit.move.earlier"],
  "resize-start": ["edit.resize-start.later", "edit.resize-start.earlier"],
  "resize-end": ["edit.resize-end.later", "edit.resize-end.earlier"],
};

/** The boolean switches of `EditingInputOptions`. */
export const EDITING_SWITCHES = {
  enabled: "rule.disabled",
  crossLane: ["edit.lane.next", "edit.lane.previous"],
  multiSelect: ["edit.selection"],
};

/** The boolean switches of `InputOptions`. */
export const INPUT_SWITCHES = {
  pan: "rule.disabled",
  zoom: "rule.disabled",
};

/** The rules that must hold on both paths. */
export const RULES = ["rule.veto", "rule.locked", "rule.disabled"];

/**
 * Capability -> the key action that reaches it, and what the action's branch
 * MUST CALL: the gesture's own twin (the same code, not a copy). The
 * `context` must appear in the function containing the whole branch (the
 * selection rule applies to every moving branch, so it comes before the branch).
 */
export const KEY_ROUTES = {
  "view.pan.later": { actions: ["panLater"], calls: ["panDomainBy("] },
  "view.pan.earlier": { actions: ["panEarlier"], calls: ["panDomainBy("] },
  // zoomAt: the double tap's and the two-finger tap's own zoom — zoomDomainAt held to the span limits around the focus (R3).
  "view.zoom.in": { actions: ["zoomIn"], calls: ["zoomAt("] },
  "view.zoom.out": { actions: ["zoomOut"], calls: ["zoomAt("] },
  "view.cross.forward": { actions: ["crossForward"], calls: ["travel("] },
  "view.cross.back": { actions: ["crossBack"], calls: ["travel("] },
  "item.select": { actions: ["activate"], calls: ['type: "activate"'] },
  "item.deselect": { actions: ["dismiss"], calls: ['type: "activate"'] },
  "item.reach": { actions: ["next", "previous", "first", "last"], calls: ["focusOn("] },
  "edit.move.later": { actions: ["moveLater"], calls: ['runEdit(movableHits(ids), "move", step'] },
  "edit.move.earlier": { actions: ["moveEarlier"], calls: ['runEdit(movableHits(ids), "move", step'] },
  "edit.resize-start.later": { actions: ["startLater"], calls: ['runEdit([hit], "resize-start", step'] },
  "edit.resize-start.earlier": { actions: ["startEarlier"], calls: ['runEdit([hit], "resize-start", step'] },
  "edit.resize-end.later": { actions: ["endLater"], calls: ['runEdit([hit], "resize-end", step'] },
  "edit.resize-end.earlier": { actions: ["endEarlier"], calls: ['runEdit([hit], "resize-end", step'] },
  "edit.lane.next": { actions: ["laneNext"], calls: ['runEdit(movableHits(ids), "move", 0, lane'] },
  "edit.lane.previous": { actions: ["lanePrevious"], calls: ['runEdit(movableHits(ids), "move", 0, lane'] },
  "edit.selection": {
    actions: ["moveLater", "moveEarlier"],
    calls: ["movableHits(ids)"],
    context: ["selectedIds.includes(hit.item.id)"],
  },
};

function program() {
  const configPath = join(CORE, "tsconfig.json");
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, CORE);
  return ts.createProgram([INPUT_FILE], { ...parsed.options, noEmit: true });
}

function declarationOf(sources, name) {
  for (const source of sources) {
    let found;
    const visit = (node) => {
      if (found !== undefined) return;
      if ((ts.isTypeAliasDeclaration(node) || ts.isInterfaceDeclaration(node)) && node.name.text === name) {
        found = node;
        return;
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    if (found !== undefined) return found;
  }
  throw new Error(`no such type in the core: ${name}`);
}

/**
 * The vocabulary, from the type checker.
 *
 * Returns: the raw members (what the types say), the classification errors
 * (unknown members), and the list of derived capabilities.
 */
export function gestureVocabulary() {
  const built = program();
  const checker = built.getTypeChecker();
  const sources = built.getSourceFiles().filter((file) => file.fileName.startsWith(join(CORE, "src")));
  const typeOf = (name) => checker.getTypeAtLocation(declarationOf(sources, name).name);
  const literalsOf = (type) => (type.isUnion() ? type.types : [type]).map((member) => member.value);
  const propertyNames = (type) => checker.getPropertiesOfType(type).map((symbol) => symbol.getName());
  const booleanSwitches = (type) =>
    checker
      .getPropertiesOfType(type)
      .filter((symbol) => {
        const declared = checker.getTypeOfSymbol(symbol);
        const parts = declared.isUnion() ? declared.types : [declared];
        const flags = parts.map((part) => part.flags);
        return flags.some((flag) => flag & ts.TypeFlags.BooleanLiteral) && flags.every((flag) => flag & (ts.TypeFlags.BooleanLiteral | ts.TypeFlags.Undefined));
      })
      .map((symbol) => symbol.getName());

  const effectType = typeOf("InputEffect");
  // A member's `type` field can itself be a union (`gestureStart | gestureEnd`).
  const effectTypes = (effectType.isUnion() ? effectType.types : [effectType]).flatMap((member) => {
    const property = member.getProperty("type");
    return property === undefined ? [undefined] : literalsOf(checker.getTypeOfSymbol(property));
  });
  const raw = {
    effectTypes,
    viewportFields: propertyNames(typeOf("ViewportEffect")),
    reasons: literalsOf(typeOf("InputViewportReason")),
    tapFields: propertyNames(typeOf("TapEffect")),
    modes: literalsOf(typeOf("EditMode")),
    editingSwitches: booleanSwitches(typeOf("EditingInputOptions")),
    inputSwitches: booleanSwitches(typeOf("InputOptions")),
  };

  const problems = [];
  const capabilities = new Set();
  const classify = (kind, members, table) => {
    for (const member of members) {
      if (member === undefined || !(member in table)) {
        problems.push(`unclassified ${kind}: ${String(member)} — gesture capability or signal? Decide in sdk_gesture_vocabulary.mjs`);
        continue;
      }
      const value = table[member];
      if (Array.isArray(value)) for (const capability of value) capabilities.add(capability);
    }
  };
  classify("effect type", raw.effectTypes, EFFECT_CLASSES);
  classify("viewport field", raw.viewportFields, VIEWPORT_FIELDS);
  classify("viewport reason", raw.reasons, REASON_CAPABILITIES);
  classify("tap field", raw.tapFields, TAP_FIELDS);
  classify("edit mode", raw.modes, MODE_CAPABILITIES);
  classify("editing switch", raw.editingSwitches, EDITING_SWITCHES);
  classify("input switch", raw.inputSwitches, INPUT_SWITCHES);
  // The table must not hold anything the types no longer know: a stale row
  // would hide that the vocabulary has changed.
  const stale = (kind, members, table) => {
    for (const key of Object.keys(table)) {
      if (!members.includes(key)) problems.push(`stale ${kind} in the table: ${key} — the types no longer know it`);
    }
  };
  stale("effect type", raw.effectTypes, EFFECT_CLASSES);
  stale("viewport field", raw.viewportFields, VIEWPORT_FIELDS);
  stale("viewport reason", raw.reasons, REASON_CAPABILITIES);
  stale("tap field", raw.tapFields, TAP_FIELDS);
  stale("edit mode", raw.modes, MODE_CAPABILITIES);
  stale("editing switch", raw.editingSwitches, EDITING_SWITCHES);
  stale("input switch", raw.inputSwitches, INPUT_SWITCHES);
  for (const capability of capabilities) {
    if (!(capability in KEY_ROUTES)) problems.push(`no keyboard route for this capability: ${capability}`);
  }
  return { raw, problems, capabilities: [...capabilities].sort(), rules: RULES };
}

// --- the entry points' capabilities ----------------------------------------
//
// Groups and adding/removing items do not live in the input machine (its
// entry point was full), but in the /groups and /items entry points, and
// createTimeline wires them in. Here too the vocabulary comes from the
// types: every member of GroupKeyAction and ItemKeyAction is classified, and
// every capability has a gesture-side AND a keyboard-side path in the
// web-component source, both running into the same shared function.

export const ENTRY_FILES = {
  groups: join(CORE, "src", "groups", "index.ts"),
  items: join(CORE, "src", "items", "index.ts"),
  timeline: join(repoRoot, "packages", "web-component", "src", "timeline.ts"),
  layer: join(repoRoot, "packages", "web-component", "src", "groups", "layer.ts"),
  // The Gantt keys are in the /gantt entry point, the grid in the web-component.
  gantt: join(CORE, "src", "gantt", "index.ts"),
  grid: join(repoRoot, "packages", "web-component", "src", "task-grid.ts"),
  // The backlog (the unscheduled tasks) is in the web-component.
  backlog: join(repoRoot, "packages", "web-component", "src", "backlog.ts"),
  // The time tools layer (time bars, overview strip, range, tooltip).
  tools: join(repoRoot, "packages", "web-component", "src", "tools", "layer.ts"),
};

/** Key action -> capability. `null`: only tree navigation — the pointer has no such gesture (clicking a header moves the focus there too). */
export const ENTRY_KEY_ACTIONS = {
  GroupKeyAction: {
    next: null,
    previous: null,
    first: null,
    last: null,
    expand: "group.toggle",
    collapse: "group.toggle",
    toggle: "group.toggle",
    moveEarlier: "group.reorder",
    moveLater: "group.reorder",
  },
  ItemKeyAction: { add: "item.add", remove: "item.remove" },
  // Following a dependency is keyboard-only: the arrow does not catch the
  // pointer; everything it says is said by the names of the two items.
  DependencyKeyAction: { predecessor: null, successor: null },
  // Grid navigation: the wheel on the grid calls the instance's scrollLanes,
  // which is the machine's own cross-axis pan — its keyboard twin is in the
  // machine's vocabulary. Opening a row (click = Enter) is a new capability.
  GridKeyAction: { next: null, previous: null, first: null, last: null, pageDown: null, pageUp: null, open: "grid.open" },
};

/**
 * Capability -> where the gesture's path is, where the key's (in the source
 * of `file`), and the shared function that BOTH call. The keyboard twin of
 * dropping is not a key action but a call to the instance's `dropItem`,
 * which the host binds to a key of its own list.
 */
export const ENTRY_ROUTES = {
  "group.toggle": { file: "layer", gesture: ["host.toggle(id, row.expanded)"], key: ["host.toggle(step.toggle.id"], shared: "host.toggle(" },
  "group.reorder": { file: "layer", gesture: ["dropPosition(", "moveGroupCommand("], key: ["groupKeyStep("], shared: "host.command(" },
  "item.add": { file: "timeline", gesture: ["addAt(addTargetAt(point"], key: ["addAt(addTargetFromFocus("], shared: "addAt(" },
  "item.remove": { file: "timeline", gesture: ['closest("[data-tl-remove]")'], key: ['action === "remove"'], shared: "commitRemove(" },
  "item.drop": { file: "timeline", gesture: ["commitAdd(itemFromDrop(items, payload, target, newItemLabel()))"], key: ["dropItem(payload)"], shared: "commitAdd(" },
  "grid.open": { file: "grid", gesture: ["open(index)"], key: ["open(focusedIndex)"], shared: "open(" },
  // A backlog row gets onto the canvas by dragging (one pointer path for
  // mouse, pen and finger) and by Enter/Space; both drop from the same
  // payloadOf, and in the instance both run into the same commitAdd (the
  // the backlog check reads that from timeline.ts).
  "backlog.place": { file: "backlog", gesture: ["timeline.dropItemAt(payloadOf(task)"], key: ["timeline.dropItem(payloadOf(task))"], shared: "payloadOf(task)" },
  // The time tools. Every gesture and its key run into the same host
  // function (host.moveBar, host.setDomain, commitRange); the tooltip appears
  // with the same showTip for the item under the pointer (hitAt) and for the
  // keyboard focus (focused).
  "timebar.move": { file: "tools", gesture: ["dragTimeBarTime("], key: ["timeBarKeyTime("], shared: "host.moveBar(" },
  "minimap.move": { file: "tools", gesture: ["minimapDragDomain("], key: ["minimapKeyDomain("], shared: "host.setDomain(" },
  "range.select": { file: "tools", gesture: ["rangeFromDrag("], key: ["rangeKeyStep("], shared: "commitRange(" },
  "item.tooltip": { file: "tools", gesture: ["host.hitAt("], key: ["host.focused()"], shared: "showTip(" },
};

/** The entry points' vocabulary from the types: the capabilities, and the classification errors. */
export function entryVocabulary() {
  const configPath = join(CORE, "tsconfig.json");
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, CORE);
  const built = ts.createProgram([ENTRY_FILES.groups, ENTRY_FILES.items, ENTRY_FILES.gantt], { ...parsed.options, noEmit: true });
  const checker = built.getTypeChecker();
  const sources = built.getSourceFiles().filter((file) => file.fileName.startsWith(join(CORE, "src")));
  const problems = [];
  const capabilities = new Set();
  for (const [typeName, table] of Object.entries(ENTRY_KEY_ACTIONS)) {
    const declaration = declarationOf(sources, typeName);
    const type = checker.getTypeAtLocation(declaration.name);
    const members = (type.isUnion() ? type.types : [type]).map((member) => member.value);
    for (const member of members) {
      if (!(member in table)) problems.push(`unclassified ${typeName}: ${String(member)} — decide in sdk_gesture_vocabulary.mjs`);
      else if (table[member] !== null) capabilities.add(table[member]);
    }
    for (const key of Object.keys(table)) {
      if (!members.includes(key)) problems.push(`stale ${typeName} in the table: ${key}`);
    }
  }
  for (const capability of capabilities) {
    if (!(capability in ENTRY_ROUTES)) problems.push(`no route description for this entry-point capability: ${capability}`);
  }
  // Dropping has no key action, dropItem is its twin — but it is a capability.
  capabilities.add("item.drop");
  // Placing from the backlog is not a key action either: it is its own listbox's Enter.
  capabilities.add("backlog.place");
  // The time tools' keys live on their own controls (the slider's arrows,
  // r for the range), not among the machine's key actions.
  for (const capability of ["timebar.move", "minimap.move", "range.select", "item.tooltip"]) capabilities.add(capability);
  return { problems, capabilities: [...capabilities].sort() };
}
