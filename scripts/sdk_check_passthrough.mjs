#!/usr/bin/env node
/**
 * The passthrough check — the configuration does not swallow a core option.
 *
 * An earlier review found two swallowed options (`formatTick`, `touchAction`):
 * the core knew them, `createTimeline` did not pass them on, and nothing
 * measured it. Planning the next step found three more
 * (`interactions.momentum` in the type, with no implementation;
 * `editing.snapOrigin` and `minDurationMs` in the machine, unreachable from
 * the configuration). This check measures both directions, from the
 * TypeScript source:
 *
 *  1. EVERY render and input option of the core (RenderOptions, InputOptions,
 *     EditingInputOptions, KeyboardInputOptions) is classified: either the
 *     configuration supplies it (under the same name, in the named place —
 *     and the field REALLY exists there), or it is the instance's own state,
 *     or it is excluded with a reason. A new core option nobody decided on:
 *     FAILURE. A classification of an option that no longer exists: FAILURE
 *     (stale table).
 *  2. The element's source really reads EVERY field of the configuration
 *     (TimelineConfig, interactions, editing). A field only the type
 *     promises: FAILURE — that is the `momentum` case.
 *
 * Negative control: the same functions FAIL on a configuration without
 * `formatTick`, and on a source that does not read `formatTick`.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const elementSrc = join(repo, "packages", "web-component", "src");
const coreEntry = join(repo, "packages", "core", "src", "index.ts");
const elementEntry = join(elementSrc, "index.ts");

/** Where a core option comes from. `config:<path>` is a field of TimelineConfig (path: "", "interactions", "editing"). */
const CONFIG = (path = "") => ({ kind: "config", path });
const INSTANCE = (why) => ({ kind: "instance", why });
const EXCLUDED = (why) => ({ kind: "excluded", why });

const TUNING =
  "a gesture tuning constant: the gesture and anchor tests prove the defaults (the prop check, the e2e-touch check); " +
  "anyone who wants to tune it builds their own shell with the core's createInputMachine";

export const CLASSIFICATION = {
  RenderOptions: {
    items: CONFIG(),
    lanes: CONFIG(),
    domain: CONFIG(),
    width: INSTANCE("the container's measured width (observeSize)"),
    height: CONFIG(),
    orientation: CONFIG(),
    density: CONFIG(),
    theme: CONFIG(),
    packMode: CONFIG(),
    timeZone: CONFIG(),
    decorations: CONFIG(),
    selectedIds: CONFIG(),
    measureText: CONFIG(),
    formatTick: CONFIG(),
    axisContext: CONFIG(),
    // The axis calendar is the configuration's calendar field; the instance derives the calendarTicks source from it.
    ticks: INSTANCE("from the calendar configuration: the instance passes on the calendar's calendarTicks source (tickOptionsOf)"),
    maxLabels: CONFIG(),
    labelOverflow: CONFIG(),
    includeStyle: EXCLUDED(
      "the drawing's stylesheet carries the --tl-* tokens and the theme; the host styles with the tokens and the classes (theming), and only a host calling the core directly needs a frame without a stylesheet",
    ),
    touchAction: CONFIG(),
    instanceId: CONFIG(),
    ariaLabel: CONFIG(),
    focusedId: INSTANCE("the machine's keyboard focus"),
    locale: CONFIG(),
    multiSelect: CONFIG("editing"),
    interactive: EXCLUDED(
      "a live instance is always interactive; a non-interactive frame (export, thumbnail) is the job of exportSvg and renderTimelineSvg",
    ),
    hooks: CONFIG(),
    loading: INSTANCE("the item loader's in-flight windows (createItemLoader)"),
    crossOffset: INSTANCE("the machine's cross-axis scroll"),
    space: INSTANCE("the item space, planned by the instance according to the sceneSpace setting (planSceneSpace)"),
    cluster: CONFIG(),
    // The configuration's ranges; the instance passes them on as a HiddenDates (createHiddenDates).
    hiddenDates: CONFIG(),
    layout: INSTANCE("after a live change, the result of relayout: the instance repacks the affected lanes (live data)"),
    // The configuration's metrics field (overrides or a function); the instance passes it on with metricsProviderOf.
    metrics: CONFIG(),
  },
  InputOptions: {
    domain: CONFIG(),
    mainSize: INSTANCE("the resolved view's size along the time axis"),
    crossSize: INSTANCE("the resolved view's cross size"),
    contentCrossSize: INSTANCE("the cross size of the frame's content"),
    orientation: CONFIG(),
    limits: CONFIG(),
    dragThreshold: CONFIG("interactions"),
    doubleTapMs: EXCLUDED(TUNING),
    doubleTapSlop: EXCLUDED(TUNING),
    tapZoomFactor: EXCLUDED(TUNING),
    wheelZoomRate: EXCLUDED(TUNING),
    wheelPanRate: EXCLUDED(TUNING),
    minPinchSeparation: EXCLUDED(TUNING),
    pan: CONFIG("interactions"),
    zoom: CONFIG("interactions"),
    touchAction: CONFIG(),
    editing: CONFIG(),
    keyboard: INSTANCE("the instance sets the navigator, the binding sets reducedMotion; the other fields are in the KeyboardInputOptions rows"),
    // The same HiddenDates the renderer gets — pan and zoom work in displayed time.
    hiddenDates: CONFIG(),
  },
  EditingInputOptions: {
    enabled: CONFIG("editing"),
    moveTrigger: CONFIG("interactions"),
    longPressMs: CONFIG("interactions"),
    snapMs: CONFIG("editing"),
    snapOrigin: CONFIG("editing"),
    minDurationMs: CONFIG("editing"),
    canMove: CONFIG("editing"),
    multiSelect: CONFIG("editing"),
    crossLane: CONFIG("editing"),
    hitTest: INSTANCE("the hit tester built per frame"),
    lookup: INSTANCE("the hit tester built per frame"),
    laneAt: INSTANCE("the hit tester built per frame"),
  },
  KeyboardInputOptions: {
    enabled: EXCLUDED(
      "the keyboard cannot be turned off: the keyboard check claims that every gesture capability is also reachable by keyboard; turned off, the instance would lose capabilities",
    ),
    bindings: EXCLUDED(
      "the instance uses the default key table, which the accessibility guide documents and the keyboard check proves; a remapped table is for a host that builds its own shell",
    ),
    stepMs: EXCLUDED("the step is the editing grid (editing.snapMs), as is the machine's default"),
    reducedMotion: INSTANCE("the attachInput binding sets it from prefers-reduced-motion, and follows it"),
    navigator: INSTANCE("the navigator built from the frame (createNavigator)"),
  },
};

/** The config types whose every field must be read, and the expressions that read them. */
export const READERS = {
  "": ["config", "next", "initial"],
  interactions: ["interactions"],
  editing: ["edit", "config.editing", "config.editing?"],
};

function program() {
  return ts.createProgram([coreEntry, elementEntry], {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    skipLibCheck: true,
    lib: ["lib.es2022.d.ts", "lib.dom.d.ts"],
  });
}

function propertiesOf(checker, entry, name) {
  const source = checker.getSymbolAtLocation(entry);
  const aliased = (symbol) => (symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol);
  const symbol = checker.getExportsOfModule(source).map(aliased).find((each) => each.getName() === name);
  if (symbol === undefined) throw new Error(`no such export: ${name}`);
  return checker.getPropertiesOfType(checker.getDeclaredTypeOfSymbol(symbol)).map((property) => property.getName());
}

/** 1. Every core option classified; every `config` one present in the config type. */
export function classify(core, config, table = CLASSIFICATION) {
  const problems = [];
  const notes = { config: 0, instance: 0, excluded: [] };
  for (const [type, fields] of Object.entries(core)) {
    const rows = table[type] ?? {};
    for (const field of fields) {
      const row = rows[field];
      if (row === undefined) {
        problems.push(`${type}.${field}: a core option nobody has decided on — expose it in the configuration, or exclude it with a reason`);
        continue;
      }
      if (row.kind === "config") {
        if (!(config[row.path] ?? []).includes(field)) {
          problems.push(`${type}.${field}: by its classification the configuration supplies it (${row.path === "" ? "TimelineConfig" : `TimelineConfig.${row.path}`}), but there is no such field there — a swallowed option`);
        } else {
          notes.config += 1;
        }
      } else if (row.kind === "instance") {
        notes.instance += 1;
      } else if (row.why === undefined || row.why.trim().length < 20) {
        problems.push(`${type}.${field}: excluded without a reason`);
      } else {
        notes.excluded.push(`${type}.${field}`);
      }
    }
    for (const field of Object.keys(rows)) {
      if (!fields.includes(field)) problems.push(`${type}.${field}: classified, but the core has no such option — stale table`);
    }
  }
  return { problems, notes };
}

/** 2. Every config field read by the element's source. */
export function reads(config, source, readers = READERS) {
  const problems = [];
  let read = 0;
  for (const [path, fields] of Object.entries(config)) {
    const objects = readers[path];
    for (const field of fields) {
      const found = objects.some((object) => {
        const prefix = object.replace(/[.?]/g, (char) => `\\${char}`);
        return new RegExp(`\\b${prefix}\\??\\.${field}\\b`).test(source) || (path === "" && new RegExp(`"${field}" in next`).test(source));
      });
      if (found) read += 1;
      else problems.push(`${path === "" ? "TimelineConfig" : `TimelineConfig.${path}`}.${field}: the type promises it, but the element's source never reads it — a swallowed option`);
    }
  }
  return { problems, read };
}

// --- the run ----------------------------------------------------------------
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const problems = [];
  const lines = [];
  const built = program();
  const checker = built.getTypeChecker();
  const coreFile = built.getSourceFile(coreEntry);
  const elementFile = built.getSourceFile(elementEntry);
  const core = Object.fromEntries(Object.keys(CLASSIFICATION).map((name) => [name, propertiesOf(checker, coreFile, name)]));
  const config = {
    "": propertiesOf(checker, elementFile, "TimelineConfig"),
    interactions: propertiesOf(checker, coreFile, "InteractionOptions"),
    editing: propertiesOf(checker, elementFile, "TimelineEditingOptions"),
  };
  // The plugins are the element's source too: a resource view's options are read in its
  // plugin, a template's in /items. Every source file, so that a new plugin's file is read without
  // anyone remembering to list it — this check once failed on a fixed list.
  const source = readdirSync(elementSrc)
    .filter((file) => file.endsWith(".ts"))
    .sort()
    .map((file) => readFileSync(join(elementSrc, file), "utf8"))
    .join("\n");

  const classified = classify(core, config);
  problems.push(...classified.problems);
  const fieldCount = Object.values(core).reduce((sum, fields) => sum + fields.length, 0);
  lines.push(
    `core options: ${String(fieldCount)} — ${String(classified.notes.config)} from the configuration, ${String(classified.notes.instance)} the instance's own state, ${String(classified.notes.excluded.length)} excluded with a reason (${classified.notes.excluded.join(", ")})`,
  );
  const readBack = reads(config, source);
  problems.push(...readBack.problems);
  const configCount = Object.values(config).reduce((sum, fields) => sum + fields.length, 0);
  lines.push(`configuration fields: ${String(configCount)}, of which ${String(readBack.read)} are read in the element's source`);

  // Negative controls: the same functions must see a dropped option.
  const withoutFormatTick = { ...config, "": config[""].filter((field) => field !== "formatTick") };
  if (classify(core, withoutFormatTick).problems.length === 0) problems.push("NEGATIVE CONTROL: the configuration without formatTick passed too — the classification is blind");
  const unread = source.replace(/formatTick/g, "formatTock");
  if (reads(config, unread).problems.length === 0) problems.push("NEGATIVE CONTROL: the source that does not read formatTick passed too — the read measure is blind");
  const withMomentum = { ...config, interactions: [...config.interactions, "momentum"] };
  if (reads(withMomentum, source).problems.length === 0) problems.push("NEGATIVE CONTROL: a field that exists only in the type (momentum) passed — the read measure is blind");
  lines.push("negative control: the configuration without formatTick, the source that does not read it, and an unimplemented field (momentum) fail");

  for (const line of lines) console.log(`  ok  ${line}`);
  if (problems.length > 0) {
    console.error(`\npassthrough FAILED — ${String(problems.length)} problem(s):`);
    for (const problem of problems) console.error(`  ✗ ${problem}`);
    process.exit(1);
  }
  console.log("\npassthrough: every core option decided, every configuration field read.");
}
