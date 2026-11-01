/**
 * A gesztusok szokincse — a bemeneti gep SAJAT tipusaibol levezetve.
 *
 * Ket kapu osztozik rajta: a G-NO-GESTURE-ONLY (statikus) es a G-KEYBOARD
 * (futasideju). Mindketto ugyanazt a kerdest teszi fel — "van-e olyan
 * kepesseg, amit csak gesztussal lehet elerni?" —, es a kerdes csak akkor
 * becsuletes, ha a kepessegek listaja NEM kezzel irt lista. Egy kezzel irt
 * lista pont annyit er, amennyit a szerzoje eszrevett: ha holnap a gep egy
 * uj szerkesztesi modot kap (mondjuk "duplicate"), a lista nem tud rola, es
 * a kapu zolden atengedi.
 *
 * Ezert a lista a TypeScript tipusellenorzobol jon: az `InputEffect` unio
 * minden tagja, az `InputViewportReason` es az `EditMode` minden literalja,
 * a `ViewportEffect` es a `TapEffect` minden mezoje, es a szerkesztesi meg a
 * bemeneti kapcsolok. Mindegyiket OSZTALYOZNI kell az alabbi tablakban:
 * kepesseg (kell hozza billentyu), jelzes (nem kepesseg, csak ertesites),
 * vagy a billentyuzet sajat effektje. Az ismeretlen tag BUKAS — igy egy uj
 * gesztus-kepesseg nem tud csendben beszivarogni.
 */

import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const CORE = join(repoRoot, "packages", "core");
export const INPUT_FILE = join(CORE, "src", "input.ts");
export const KEYBOARD_FILE = join(CORE, "src", "keyboard.ts");
export const ATTACH_FILE = join(CORE, "src", "dom", "attach.ts");

/** Az `InputEffect` tagjai: mi micsoda. */
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

/** A `ViewportEffect` mezoi. */
export const VIEWPORT_FIELDS = {
  type: "discriminant",
  domain: "via-reason",
  reason: "via-reason",
  crossOffset: ["view.cross.forward", "view.cross.back"],
  atLimit: "signal",
};

/** Az `InputViewportReason` literaljai. */
export const REASON_CAPABILITIES = {
  pan: ["view.pan.later", "view.pan.earlier"],
  zoom: ["view.zoom.in", "view.zoom.out"],
};

/**
 * A `TapEffect` mezoi. Egy koppintas a hosztnak kijeloles (talalt elem) vagy
 * elengedes (semmi); a dupla koppintas befele, a ket ujjas kifele zoomol; es
 * barmelyik elem elerheto vele, amit a szem lat.
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

/** Az `EditMode` literaljai. */
export const MODE_CAPABILITIES = {
  move: ["edit.move.later", "edit.move.earlier"],
  "resize-start": ["edit.resize-start.later", "edit.resize-start.earlier"],
  "resize-end": ["edit.resize-end.later", "edit.resize-end.earlier"],
};

/** Az `EditingInputOptions` boolean kapcsoloi. */
export const EDITING_SWITCHES = {
  enabled: "rule.disabled",
  crossLane: ["edit.lane.next", "edit.lane.previous"],
  multiSelect: ["edit.selection"],
};

/** Az `InputOptions` boolean kapcsoloi. */
export const INPUT_SWITCHES = {
  pan: "rule.disabled",
  zoom: "rule.disabled",
};

/** A szabalyok, amiknek mindket uton allniuk kell. */
export const RULES = ["rule.veto", "rule.locked", "rule.disabled"];

/**
 * Kepesseg -> a billentyus akcio, ami eleri, es amit az akcio agaban HIVNI
 * kell: a gesztus sajat ikre (ugyanaz a kod, nem masolat). A `context` a
 * teljes agat tartalmazo fuggvenyben kell, hogy alljon (a kijeloles
 * szabalya minden mozgato agra ervenyes, ezert az ag elott all).
 */
export const KEY_ROUTES = {
  "view.pan.later": { actions: ["panLater"], calls: ["panDomainBy("] },
  "view.pan.earlier": { actions: ["panEarlier"], calls: ["panDomainBy("] },
  "view.zoom.in": { actions: ["zoomIn"], calls: ["zoomDomainAt("] },
  "view.zoom.out": { actions: ["zoomOut"], calls: ["zoomDomainAt("] },
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
  throw new Error(`nincs ilyen tipus a magban: ${name}`);
}

/**
 * A szokincs, a tipusellenorzobol.
 *
 * Visszaad: a nyers tagokat (amit a tipusok mondanak), az osztalyozas
 * hibait (ismeretlen tag), es a levezetett kepessegek listajat.
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
  // A tag `type` mezoje maga is lehet unio (`gestureStart | gestureEnd`).
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
        problems.push(`osztalyozatlan ${kind}: ${String(member)} — gesztus-kepesseg vagy jelzes? Dontsd el a sdk_gesture_vocabulary.mjs-ben`);
        continue;
      }
      const value = table[member];
      if (Array.isArray(value)) for (const capability of value) capabilities.add(capability);
    }
  };
  classify("effekt-tipus", raw.effectTypes, EFFECT_CLASSES);
  classify("viewport-mezo", raw.viewportFields, VIEWPORT_FIELDS);
  classify("viewport-ok", raw.reasons, REASON_CAPABILITIES);
  classify("tap-mezo", raw.tapFields, TAP_FIELDS);
  classify("szerkesztesi mod", raw.modes, MODE_CAPABILITIES);
  classify("szerkesztesi kapcsolo", raw.editingSwitches, EDITING_SWITCHES);
  classify("bemeneti kapcsolo", raw.inputSwitches, INPUT_SWITCHES);
  // A tabla nem tarthat olyat, amit a tipusok mar nem ismernek: egy elavult
  // sor elfedne, hogy a szokincs megvaltozott.
  const stale = (kind, members, table) => {
    for (const key of Object.keys(table)) {
      if (!members.includes(key)) problems.push(`elavult ${kind} a tablaban: ${key} — a tipusok mar nem ismerik`);
    }
  };
  stale("effekt-tipus", raw.effectTypes, EFFECT_CLASSES);
  stale("viewport-mezo", raw.viewportFields, VIEWPORT_FIELDS);
  stale("viewport-ok", raw.reasons, REASON_CAPABILITIES);
  stale("tap-mezo", raw.tapFields, TAP_FIELDS);
  stale("szerkesztesi mod", raw.modes, MODE_CAPABILITIES);
  stale("szerkesztesi kapcsolo", raw.editingSwitches, EDITING_SWITCHES);
  stale("bemeneti kapcsolo", raw.inputSwitches, INPUT_SWITCHES);
  for (const capability of capabilities) {
    if (!(capability in KEY_ROUTES)) problems.push(`nincs billentyus utvonal ehhez a kepesseghez: ${capability}`);
  }
  return { raw, problems, capabilities: [...capabilities].sort(), rules: RULES };
}

// --- P19: a belepesi pontok kepessegei ----------------------------------------
//
// A csoportok es az elemek hozzaadasa/torlese nem a bemeneti gepben el (annak
// belepesi pontja megtelt, P19 nyito 1), hanem a /groups es az /items
// belepesi pontban, es a createTimeline koti be oket. A szokincs itt is a
// tipusokbol jon: a GroupKeyAction es az ItemKeyAction minden tagja
// osztalyozva van, es minden kepessegnek van gesztus- ES billentyuoldali utja
// a web-component forrasaban, ugyanabba a kozos fuggvenybe futva.

export const ENTRY_FILES = {
  groups: join(CORE, "src", "groups", "index.ts"),
  items: join(CORE, "src", "items", "index.ts"),
  timeline: join(repoRoot, "packages", "web-component", "src", "timeline.ts"),
  layer: join(repoRoot, "packages", "web-component", "src", "groups.ts"),
  // P20: a Gantt billentyui a /gantt pontban, a tablazat a web-componentben.
  gantt: join(CORE, "src", "gantt", "index.ts"),
  grid: join(repoRoot, "packages", "web-component", "src", "task-grid.ts"),
  // P22: a varolista (az utemezetlen feladatok) a web-componentben.
  backlog: join(repoRoot, "packages", "web-component", "src", "backlog.ts"),
  // P24: az ido-eszkozok retege (idovonalak, attekinto sav, tartomany, tooltip).
  tools: join(repoRoot, "packages", "web-component", "src", "tools.ts"),
};

/** Billentyu-akcio -> kepesseg. `null`: csak a fa bejarasa — a mutatonak nincs ilyen gesztusa (a fejlecre kattintas a fokuszt is odateszi). */
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
  // P20. A fuggoseg kovetese csak billentyu: a nyil nem fog mutatot, mindent,
  // amit mond, a ket elem neve mond el.
  DependencyKeyAction: { predecessor: null, successor: null },
  // A tablazat bejarasa: a gorgo a tablazaton a peldany scrollLanes-et hivja,
  // ami a gep sajat keresztiranyu pasztazasa — annak billentyus ikre a gep
  // szokincseben van. A sor megnyitasa (kattintas = Enter) uj kepesseg.
  GridKeyAction: { next: null, previous: null, first: null, last: null, pageDown: null, pageUp: null, open: "grid.open" },
};

/**
 * Kepesseg -> hol a gesztus utja, hol a billentyue (a `file` forrasaban), es
 * a kozos fuggveny, amit MINDKETTO hiv. A behuzas billentyus ikre nem
 * billentyu-akcio, hanem a peldany `dropItem` hivasa, amit a host a sajat
 * listajanak billentyujere kot.
 */
export const ENTRY_ROUTES = {
  "group.toggle": { file: "layer", gesture: ["host.toggle(id, row.expanded)"], key: ["host.toggle(step.toggle.id"], shared: "host.toggle(" },
  "group.reorder": { file: "layer", gesture: ["dropPosition(", "moveGroupCommand("], key: ["groupKeyStep("], shared: "host.command(" },
  "item.add": { file: "timeline", gesture: ["addAt(addTargetAt(point"], key: ["addAt(addTargetFromFocus("], shared: "addAt(" },
  "item.remove": { file: "timeline", gesture: ['closest("[data-tl-remove]")'], key: ['action === "remove"'], shared: "commitRemove(" },
  "item.drop": { file: "timeline", gesture: ["commitAdd(itemFromDrop(items, payload, target))"], key: ["dropItem(payload)"], shared: "commitAdd(" },
  "grid.open": { file: "grid", gesture: ["open(index)"], key: ["open(focusedIndex)"], shared: "open(" },
  // P22: a varolista sora huzassal (egy mutatos ut egerre, tollra, ujjra) es
  // Enterrel/Szokozzel kerul a vaszonra; mindketto ugyanabbol a payloadOf-bol
  // tesz le, es a peldanyban ugyanabba a commitAdd-ba fut (azt a G-BACKLOG
  // meroje olvassa a timeline.ts-bol).
  "backlog.place": { file: "backlog", gesture: ["timeline.dropItemAt(payloadOf(task)"], key: ["timeline.dropItem(payloadOf(task))"], shared: "payloadOf(task)" },
  // P24: az ido-eszkozok. Minden gesztus es a billentyuje ugyanabba a gazda-
  // fuggvenybe fut (host.moveBar, host.setDomain, commitRange); a tooltip a
  // mutato alatti elemre (hitAt) es a billentyu fokuszara (focused) ugyanazzal
  // a showTip-pel jelenik meg.
  "timebar.move": { file: "tools", gesture: ["dragTimeBarTime("], key: ["timeBarKeyTime("], shared: "host.moveBar(" },
  "minimap.move": { file: "tools", gesture: ["minimapDragDomain("], key: ["minimapKeyDomain("], shared: "host.setDomain(" },
  "range.select": { file: "tools", gesture: ["rangeFromDrag("], key: ["rangeKeyStep("], shared: "commitRange(" },
  "item.tooltip": { file: "tools", gesture: ["host.hitAt("], key: ["host.focused()"], shared: "showTip(" },
};

/** A P19 szokincse a tipusokbol: a kepessegek, es az osztalyozas hibai. */
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
      if (!(member in table)) problems.push(`osztalyozatlan ${typeName}: ${String(member)} — dontsd el a sdk_gesture_vocabulary.mjs-ben`);
      else if (table[member] !== null) capabilities.add(table[member]);
    }
    for (const key of Object.keys(table)) {
      if (!members.includes(key)) problems.push(`elavult ${typeName} a tablaban: ${key}`);
    }
  }
  for (const capability of capabilities) {
    if (!(capability in ENTRY_ROUTES)) problems.push(`nincs utvonal-leiras ehhez a P19-kepesseghez: ${capability}`);
  }
  // A behuzasnak nincs billentyu-akcioja, a dropItem az ikre — de kepesseg.
  capabilities.add("item.drop");
  // A varolista behuzasa sem billentyu-akcio: a sajat listabox Enterje.
  capabilities.add("backlog.place");
  // P24: az ido-eszkozok billentyui a sajat vezerlojukon elnek (a csuszka
  // nyilai, az r a tartomanyhoz), nem a gep billentyu-akcioi kozott.
  for (const capability of ["timebar.move", "minimap.move", "range.select", "item.tooltip"]) capabilities.add(capability);
  return { problems, capabilities: [...capabilities].sort() };
}
