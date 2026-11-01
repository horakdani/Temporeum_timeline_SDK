/**
 * The input pipeline: pointer samples in, a viewport out.
 *
 * One machine handles mouse, pen and touch, and it is the *only* thing in the
 * library that interprets a gesture. That is a deliberate constraint rather
 * than tidiness: the libraries this one is measured against grew a second
 * code path for touch, and the bugs that follow are always the same ones —
 * a pinch that jumps when one finger lifts, a zoom that drifts away from the
 * fingers, a drag that keeps going after `pointercancel`.
 *
 * Three rules hold the design together:
 *
 * 1. **No DOM, no clock, no timers.** A sample carries its own `time`, so the
 *    machine is a pure reducer: the same samples always produce the same
 *    viewport, which is what makes a gesture testable without a browser.
 *    A long press needs to know that time has passed, and it still does not
 *    get a timer: it gets {@link InputMachine.elapse}, which the host calls
 *    when the clock reaches a point the machine asked to be woken at. The
 *    *threshold* lives here, the *timer* lives in whatever owns a scheduler,
 *    and a gesture stays a replayable sequence of samples and wake-ups.
 * 2. **A pointer holds an instant.** On `down`, each pointer grabs the time
 *    under it and keeps it: every move re-solves the viewport from the
 *    anchors instead of accumulating deltas. Accumulation drifts, and at a
 *    domain limit it builds up a dead zone the user feels as stickiness.
 * 3. **Every gesture has a programmatic twin.** {@link InputMachine.pan} and
 *    {@link InputMachine.zoom} are the same code the gestures run, so a
 *    keyboard or a button can reach every capability a finger can. The
 *    keyboard itself comes in through {@link InputMachine.key}: a key is
 *    resolved to an action (`keyboard.ts`) and the action calls the twins.
 */

import { editCommand, invertPatch, modeForPart, movePatch, resizePatch } from "./editing.js";
import type { EditHit, EditMode, HitTester } from "./editing.js";
import { unprojectPoint } from "./geometry.js";
import { DEFAULT_KEY_BINDINGS, resolveKey, rowNeighbour } from "./keyboard.js";
import type { KeyAction, KeyBinding, KeySample, NavEntry, Navigator } from "./keyboard.js";
import { clampDomain, createTimeScale, panDomainBy, spanOf, zoomDomainAt } from "./scale.js";
import type { TimeWarp } from "./scale.js";
import type { TouchActionMode } from "./theme.js";
import { toTimeMs } from "./time.js";
import type {
  Command,
  Domain,
  DomainLimits,
  Item,
  ItemPatch,
  MainCross,
  MoveTrigger,
  Orientation,
  PointerKind,
  TimeInput,
  TimeMs,
} from "./types.js";

/** Which hardware produced a sample. Lives with the other public types. */
export type { PointerKind } from "./types.js";

/** What a pointer just did. Mirrors the four Pointer Events that matter. */
export type PointerPhase = "down" | "move" | "up" | "cancel";

/**
 * One pointer observation, in container-relative CSS pixels.
 *
 * `time` comes from the event, never from a clock: a replayed sequence is then
 * byte-for-byte reproducible, which is the whole basis of the gesture tests.
 */
export interface PointerSample {
  readonly pointerId: number;
  readonly phase: PointerPhase;
  readonly x: number;
  readonly y: number;
  readonly time: number;
  readonly pointerType: PointerKind;
}

/**
 * One wheel observation.
 *
 * `ctrlKey` is not a modifier here so much as a hardware signal: a trackpad
 * pinch arrives as ctrl+wheel in every engine, which is why pinch-to-zoom on
 * a laptop works at all.
 */
export interface WheelSample {
  readonly x: number;
  readonly y: number;
  readonly deltaX: number;
  readonly deltaY: number;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
  readonly time: number;
  /**
   * The frame is mirrored (`attachInput`'s `direction: "rtl"`): `x` and
   * `deltaX` are already measured from the right edge. Time runs along `x`
   * only horizontally, so where a vertical frame's sideways delta is routed
   * into time, the machine takes the mirroring back.
   */
  readonly mirrored?: boolean;
}

/** Which gesture the machine is in the middle of. */
export type GesturePhase = "idle" | "pressing" | "panning" | "pinching" | "editing";

/**
 * A gesture that moves or scales the view.
 *
 * `wheel` is a run of wheel steps: it starts with the first and ends when
 * {@link WHEEL_RUN_MS} pass without another. A wheel has no lift, so without
 * the run a host would treat every notch as the end of a gesture — and a
 * scene space would settle, re-anchor and fill its overscan between notches.
 */
export type GestureKind = "pan" | "pinch" | "wheel";

/** Why the viewport moved. */
export type InputViewportReason = "pan" | "zoom";

/** The view changed. The host applies it; the machine never draws. */
export interface ViewportEffect {
  readonly type: "viewport";
  readonly domain: Domain;
  /** How far the lanes are scrolled across the time axis, in CSS pixels. */
  readonly crossOffset: number;
  readonly reason: InputViewportReason;
  /** The request was cut short by {@link InputOptions.limits}. */
  readonly atLimit: boolean;
}

/** A gesture began or ended. Hosts use it to suspend hover and tooltips. */
export interface GestureEffect {
  readonly type: "gestureStart" | "gestureEnd";
  readonly kind: GestureKind;
  /** True when the gesture ended on `pointercancel` rather than a lift. */
  readonly cancelled: boolean;
}

/**
 * A pointer went down.
 *
 * Emitted for the first pointer only, and it is how a later editing layer
 * starts its long-press timer without opening a second pipeline.
 */
export interface PressEffect {
  readonly type: "press";
  readonly pointerId: number;
  readonly pointerType: PointerKind;
  readonly main: number;
  readonly cross: number;
  readonly time: number;
}

/** A pointer went down and up again without travelling. */
export interface TapEffect {
  readonly type: "tap";
  readonly main: number;
  readonly cross: number;
  readonly pointerType: PointerKind;
  /** 2 when this tap follows another within the double-tap window. */
  readonly tapCount: number;
  /** How many pointers were involved: one finger, or two at once. */
  readonly pointerCount: number;
  readonly durationMs: number;
}

/** How an edit gesture was started. */
export type EditTrigger = "pointer" | "long-press" | "handle" | "api" | "keyboard";

/**
 * An edit began.
 *
 * `items` lists everything the edit will move, the item under the pointer
 * first. A host uses it to raise the dragged items above the rest.
 */
export interface EditStartEffect<T = unknown> {
  readonly type: "editStart";
  readonly mode: EditMode;
  readonly trigger: EditTrigger;
  readonly items: readonly Item<T>[];
}

/**
 * The edit is at a new position.
 *
 * `patches` is always the state currently being proposed, so applying it is
 * correct on every call. When `vetoed` is true the *latest* request was
 * refused by `canMove` and `patches` holds the last accepted position — the
 * host redraws the same place and can say so, instead of having to remember
 * where the drag was allowed to be.
 */
export interface EditMoveEffect {
  readonly type: "editMove";
  readonly mode: EditMode;
  readonly patches: readonly ItemPatch[];
  readonly vetoed: boolean;
}

/**
 * The edit is over.
 *
 * `command` is present only when something actually changed and the gesture
 * was not taken away. `cancelled` covers both: a drag that came back to where
 * it started leaves nothing behind, and neither does a `pointercancel`.
 */
export interface EditEndEffect {
  readonly type: "editEnd";
  readonly mode: EditMode;
  readonly command?: Command;
  readonly cancelled: boolean;
}

/**
 * The machine asks to be woken.
 *
 * `at` is an event-time, comparable with {@link PointerSample.time}: the host
 * schedules a call to {@link InputMachine.elapse} for it. `null` cancels a
 * pending wake-up. This is how a long press works without the machine owning
 * a clock — and it keeps the delay defined in exactly one place, which is the
 * lesson of the `touchAction` setting that had to be passed to two.
 */
export interface ScheduleEffect {
  readonly type: "schedule";
  readonly at: number | null;
  /**
   * `long-press`: a held finger may become a drag. `transition`: a view
   * change the keyboard asked for is under way, and wants its next frame.
   * `wheel`: a run of wheel steps ends at `at` unless another step comes.
   */
  readonly reason: "long-press" | "transition" | "wheel";
}

/**
 * The machine took a key.
 *
 * Emitted first, whenever a key press was bound and meant something in the
 * current state — even if nothing else changed, as at the last item. The
 * browser binding uses it to `preventDefault`, so an arrow inside the
 * timeline never also scrolls the page, and an unbound key always reaches it.
 */
export interface KeyEffect {
  readonly type: "key";
  readonly action: KeyAction;
}

/**
 * The keyboard focus moved to another item, or off every item.
 *
 * The host redraws with `focusedId`, which is how the frame shows the focus
 * ring and points `aria-activedescendant` at the item.
 */
export interface FocusEffect {
  readonly type: "focus";
  readonly id: string | null;
}

/**
 * The keyboard twin of a tap: `Enter` or `Space` on the focused item, or
 * `Escape` for a tap on nothing (`id: null`). Selection stays the host's
 * policy, exactly as it is for a tap.
 */
export interface ActivateEffect {
  readonly type: "activate";
  readonly id: string | null;
}

/**
 * The user asked to jump to a date. The host asks which one, and answers
 * with {@link InputMachine.goTo}.
 */
export interface JumpRequestEffect {
  readonly type: "jumpRequest";
}

/** Everything the machine can ask the host to do. */
export type InputEffect<T = unknown> =
  | ViewportEffect
  | GestureEffect
  | PressEffect
  | TapEffect
  | EditStartEffect<T>
  | EditMoveEffect
  | EditEndEffect
  | ScheduleEffect
  | KeyEffect
  | FocusEffect
  | ActivateEffect
  | JumpRequestEffect;

/**
 * Editing rules for the gesture layer.
 *
 * Off unless `enabled`: a timeline that rearranges the host's data because a
 * finger brushed it is worse than one that cannot be edited at all.
 *
 * The three functions are what keep the machine free of layout and DOM. The
 * host builds them with {@link createHitTester} from the frame it just drew,
 * which is also why they are functions rather than data: the frame changes on
 * every zoom, and a cached hit box is a hit box that lies.
 */
export interface EditingInputOptions<T = unknown> {
  readonly enabled?: boolean;
  /** What starts a drag. `auto` resolves per gesture from the pointer type. */
  readonly moveTrigger?: MoveTrigger;
  /** How long a press is held before it becomes a drag. */
  readonly longPressMs?: number;
  /** Grid the moved edge snaps to, in milliseconds. */
  readonly snapMs?: number;
  /** Where the snap grid is anchored. The epoch by default. */
  readonly snapOrigin?: TimeMs;
  /** Smallest duration a resize may squash an item to. */
  readonly minDurationMs?: number;
  /** Veto a move or resize before it is proposed. */
  readonly canMove?: (item: Item<T>, next: ItemPatch) => boolean;
  /** Drag the whole selection when the pointer grabs a selected item. */
  readonly multiSelect?: boolean;
  /** Let a drag across the lanes change the dragged item's lane. */
  readonly crossLane?: boolean;
  /** What is under a point, in `(main, cross)` space. */
  readonly hitTest?: HitTester<T>["hitTest"];
  /** An item by id. Required to drag a selection of more than one. */
  readonly lookup?: HitTester<T>["lookup"];
  /** The lane under a cross coordinate. Required for `crossLane`. */
  readonly laneAt?: HitTester<T>["laneAt"];
}

/**
 * Keyboard rules. On by default: a timeline that can only be reached with a
 * pointer is missing a capability, not a feature.
 */
export interface KeyboardInputOptions {
  readonly enabled?: boolean;
  /** Replace the default key table. See {@link DEFAULT_KEY_BINDINGS}. */
  readonly bindings?: readonly KeyBinding[];
  /**
   * How far one key press moves an item or an edge. The snap grid when there
   * is one, otherwise ten pixels' worth of time.
   */
  readonly stepMs?: number;
  /**
   * Change the view in one step instead of a short transition. The browser
   * binding sets it from `prefers-reduced-motion`, and follows the setting.
   */
  readonly reducedMotion?: boolean;
  /**
   * The order to walk the items in, built from the frame just drawn with
   * {@link createNavigator}. Without it the keyboard can pan and zoom but
   * has nothing to focus.
   */
  readonly navigator?: Navigator;
}

/** How the machine is set up. Every threshold is overridable. */
export interface InputOptions<T = unknown> {
  readonly domain: Domain;
  /** Container extent along the time axis, in CSS pixels. */
  readonly mainSize: number;
  /** Container extent across the lanes. Needed only for lane scrolling. */
  readonly crossSize?: number;
  /** How much cross extent the content wants; more than `crossSize` scrolls. */
  readonly contentCrossSize?: number;
  readonly orientation?: Orientation;
  readonly limits?: DomainLimits;
  /** Travel in pixels before a press becomes a drag. Defaults by pointer type. */
  readonly dragThreshold?: number;
  /** How long after a tap a second one still counts as a double tap. */
  readonly doubleTapMs?: number;
  /** How far apart two taps may be and still count as a double tap. */
  readonly doubleTapSlop?: number;
  /** Zoom factor for a double tap in, and for a two-finger tap out. */
  readonly tapZoomFactor?: number;
  /** Zoom per unit of ctrl+wheel delta, as an exponent. */
  readonly wheelZoomRate?: number;
  /** Pixels panned per unit of plain wheel delta. */
  readonly wheelPanRate?: number;
  /**
   * Main-axis separation below which a pinch stops scaling.
   *
   * Two fingers held across the time axis are separated by almost nothing
   * along it, and solving a scale from that divides by nearly zero. Below the
   * floor the gesture keeps panning and leaves the zoom alone, which is also
   * what the user means by that grip.
   */
  readonly minPinchSeparation?: number;
  readonly pan?: boolean;
  readonly zoom?: boolean;
  /**
   * How the timeline shares scrolling with the page. The same setting the
   * stylesheet gets, and it has to be passed to both.
   *
   * `touch-action` only governs touch. A mouse wheel is not covered by it at
   * all, so a `cooperative` timeline would still swallow the wheel and pan
   * time while the reader expected the article to scroll — the desktop twin
   * of exactly the bug this mode exists to prevent. In `cooperative` mode a
   * *plain* wheel with nothing to scroll across the lanes is therefore left
   * to the page. `ctrl` (zoom) and `shift` (pan) are explicit intent and
   * stay with the widget.
   */
  readonly touchAction?: TouchActionMode;
  /** Editing rules. Editing is off unless this says otherwise. */
  readonly editing?: EditingInputOptions<T>;
  /** Keyboard rules. The keyboard is on unless this says otherwise. */
  readonly keyboard?: KeyboardInputOptions;
  /**
   * Hidden dates, the renderer's `hiddenDates`: a pan moves the window by
   * shown time, and a zoom holds the instant under the focus across them.
   */
  readonly hiddenDates?: TimeWarp;
}

/** The live input state, as a reducer the host drives. */
export interface InputMachine<T = unknown> {
  readonly domain: Domain;
  readonly crossOffset: number;
  readonly phase: GesturePhase;
  /** How many pointers are down, including any beyond the two that pinch. */
  readonly pointerCount: number;
  /** Ids the next drag will carry along, when `multiSelect` is on. */
  readonly selectedIds: readonly string[];
  /** The item the keyboard is on, or `null`. */
  readonly focusedId: string | null;
  /** Feed one pointer observation. */
  handle(sample: PointerSample): readonly InputEffect<T>[];
  /** Feed one wheel observation. */
  wheel(sample: WheelSample): readonly InputEffect<T>[];
  /**
   * The clock reached `time`, and nothing else happened.
   *
   * The machine never asks what time it is; this is how it finds out. A host
   * calls it when a {@link ScheduleEffect} comes due — and because the
   * wake-up carries its own time like every other sample, a recorded session
   * replays identically.
   */
  elapse(time: number): readonly InputEffect<T>[];
  /**
   * Feed one key press.
   *
   * Ignored while a pointer gesture is running: a key in the middle of a
   * drag has no defined meaning, and guessing one is how a drag ends up
   * somewhere neither the finger nor the key put it.
   */
  key(sample: KeySample): readonly InputEffect<T>[];
  /**
   * Bring `time` to the middle of the view, keeping the zoom — the answer to
   * a {@link JumpRequestEffect}. With the event's `time` the view travels
   * there (unless motion is reduced); without one it is there at once.
   */
  goTo(time: TimeInput, eventTime?: number): readonly InputEffect<T>[];
  /** Move the window along the time axis, and the lanes across it. */
  pan(deltaMain: number, deltaCross?: number): readonly InputEffect<T>[];
  /** Zoom about a point on the time axis. Above 1 zooms in. */
  zoom(factor: number, focusMain: number): readonly InputEffect<T>[];
  /**
   * Move items programmatically — the twin of a drag.
   *
   * Same snapping, same veto, same command: a keyboard nudge and a finger
   * reach the identical code path, which is what makes the accessibility
   * promise checkable rather than aspirational.
   */
  moveItems(ids: readonly string[], deltaMs: number, laneId?: string | null): readonly InputEffect<T>[];
  /** Resize one item programmatically — the twin of dragging a handle. */
  resizeItem(id: string, edge: "start" | "end", deltaMs: number): readonly InputEffect<T>[];
  /** Which items a multi-item drag carries. The host owns selection policy. */
  setSelection(ids: readonly string[]): void;
  /** Put the keyboard on an item — after a tap selected it, say. Emits nothing. */
  setFocus(id: string | null): void;
  /** Change keyboard rules — a new navigator after a redraw. Merged. */
  setKeyboard(keyboard: KeyboardInputOptions): void;
  /** Change editing rules — a new hit tester after a redraw, a new grid. */
  setEditing(editing: EditingInputOptions<T>): void;
  /** Replace the domain from the host's own API. Emits nothing. */
  setDomain(domain: Domain): void;
  /** The container was measured again. */
  resize(size: {
    readonly mainSize?: number;
    readonly crossSize?: number;
    readonly contentCrossSize?: number;
  }): void;
  setOrientation(orientation: Orientation): void;
  /** Forget every pointer, as if each had been cancelled. */
  reset(): readonly InputEffect<T>[];
}

interface TrackedPointer {
  readonly pointerId: number;
  readonly pointerType: PointerKind;
  readonly downMain: number;
  readonly downCross: number;
  readonly downTime: number;
  main: number;
  cross: number;
  /** The instant this pointer grabbed, kept under it while it drags. */
  anchorTime: TimeMs;
  /**
   * Where the pointer was, and how far the lanes were scrolled, when it last
   * grabbed. Separate from `down*` on purpose: a second finger arriving
   * re-grabs mid-gesture, and solving from the original touch-down would then
   * jump by however far the first finger had already travelled.
   */
  anchorCross: number;
  anchorCrossOffset: number;
  moved: boolean;
}

/** A drag the pointer has earned but not yet started moving. */
interface ArmedEdit<T> {
  readonly pointerId: number;
  readonly hit: EditHit<T>;
  readonly trigger: EditTrigger;
  /** Event-time the press turns into a drag on its own, if it ever does. */
  readonly dueAt: number | undefined;
}

/** A drag in progress. */
interface EditSession<T> {
  readonly pointerId: number;
  readonly mode: EditMode;
  readonly trigger: EditTrigger;
  /** The instant the pointer held when the edit began. Never re-grabbed. */
  readonly grabTime: TimeMs;
  readonly hits: readonly EditHit<T>[];
  /** The last position `canMove` accepted. Empty until something moves. */
  patches: readonly ItemPatch[];
  /** Snapped shift of the last accepted position, for change detection. */
  shift: number | undefined;
  laneId: string | null | undefined;
  vetoed: boolean;
}

const DEFAULT_DOUBLE_TAP_MS = 320;
const DEFAULT_DOUBLE_TAP_SLOP = 28;
const DEFAULT_TAP_ZOOM = 2;
const DEFAULT_WHEEL_ZOOM_RATE = 0.004;
const DEFAULT_WHEEL_PAN_RATE = 1;
const DEFAULT_MIN_PINCH_SEPARATION = 24;
/**
 * How long a finger holds still before the timeline hands it the item.
 *
 * 500 ms is what the platforms converged on for a press-and-hold, and the
 * reason it has to exist at all is that on a touch screen the drag gesture is
 * already taken: the same movement pans the view. A mouse has a cursor and a
 * hover state, so it needs no ceremony — which is the whole content of
 * `moveTrigger: "auto"`.
 */
const DEFAULT_LONG_PRESS_MS = 500;
/** A finger is coarse and shakes; a mouse does not. */
const TOUCH_DRAG_THRESHOLD = 8;
const PRECISE_DRAG_THRESHOLD = 3;
/**
 * How long a view change the keyboard asked for takes to arrive.
 *
 * Short on purpose: long enough to see which way the view went — a jump with
 * no motion at all loses the reader's place — and short enough that holding
 * an arrow never waits for the animation. `reducedMotion` makes it zero.
 */
const TRANSITION_MS = 200;
/** A transition asks to be woken this often: a frame at 60 Hz. */
const TRANSITION_FRAME_MS = 16;
/**
 * A wheel run ends this long after its last step. Notches of a mouse wheel
 * turned in one go come 30-80 ms apart, a trackpad's events every frame; a
 * pause longer than this is the reader stopping.
 */
const WHEEL_RUN_MS = 150;
/** Beyond this many views away, a transition is a blur, not a journey: jump. */
const TRANSITION_MAX_VIEWS = 2;
/** A page key moves this share of the view. */
const PAGE_FRACTION = 0.5;
/** The keyboard step without a snap grid, in pixels' worth of time. */
const KEY_STEP_PX = 10;
/** Room kept before an item the keyboard brings into view, as a share of it. */
const REVEAL_MARGIN = 0.1;

/** A view change on its way, driven by {@link InputMachine.elapse}. */
interface Transition {
  readonly from: Domain;
  readonly to: Domain;
  readonly fromCross: number;
  readonly toCross: number;
  readonly start: number;
  readonly reason: InputViewportReason;
}

/** The key actions that edit an item. */
type EditAction = Extract<
  KeyAction,
  "moveLater" | "moveEarlier" | "laneNext" | "lanePrevious" | "endLater" | "endEarlier" | "startLater" | "startEarlier"
>;

/** Where the view is, or is heading. */
interface View {
  readonly domain: Domain;
  readonly cross: number;
}

function thresholdFor(kind: PointerKind, override: number | undefined): number {
  if (override !== undefined) {
    return override;
  }
  return kind === "touch" ? TOUCH_DRAG_THRESHOLD : PRECISE_DRAG_THRESHOLD;
}

function sameDomain(a: Domain, b: Domain): boolean {
  return a[0] === b[0] && a[1] === b[1];
}

/**
 * Create an input machine for one container.
 *
 * The machine owns the domain, because a gesture is a sequence and a sequence
 * needs somewhere to stand. Everything it computes goes through the scale
 * functions the geometry phase already proved, so a gesture cannot invent its
 * own idea of what a pixel is worth.
 */
export function createInputMachine<T = unknown>(options: InputOptions<T>): InputMachine<T> {
  const limits = options.limits;
  const panEnabled = options.pan !== false;
  const zoomEnabled = options.zoom !== false;
  const doubleTapMs = options.doubleTapMs ?? DEFAULT_DOUBLE_TAP_MS;
  const doubleTapSlop = options.doubleTapSlop ?? DEFAULT_DOUBLE_TAP_SLOP;
  const tapZoom = options.tapZoomFactor ?? DEFAULT_TAP_ZOOM;
  const wheelZoomRate = options.wheelZoomRate ?? DEFAULT_WHEEL_ZOOM_RATE;
  const wheelPanRate = options.wheelPanRate ?? DEFAULT_WHEEL_PAN_RATE;
  const minPinchSeparation = options.minPinchSeparation ?? DEFAULT_MIN_PINCH_SEPARATION;
  const cooperative = (options.touchAction ?? "own") === "cooperative";
  const warp = options.hiddenDates;

  let orientation: Orientation = options.orientation ?? "horizontal";
  let mainSize = options.mainSize;
  let crossSize = options.crossSize ?? 0;
  let contentCrossSize = options.contentCrossSize ?? 0;
  let domain: Domain = clampDomain(options.domain, limits);
  let crossOffset = 0;
  let phase: GesturePhase = "idle";
  /** Insertion-ordered: the first two pointers are the ones that pinch. */
  const pointers = new Map<number, TrackedPointer>();
  let driving: readonly [TrackedPointer, TrackedPointer] | undefined;
  let gestureMoved = false;
  /** When the second finger landed. A two-finger tap has to be quick. */
  let pinchStartTime = 0;
  /**
   * The gesture is over but fingers are still down.
   *
   * Two fingers never lift in the same event, so a two-finger tap is decided
   * on the first lift. Without this flag the finger still on the glass would
   * then start a pan from where it happens to be resting.
   */
  let consumed = false;
  let lastTap: { main: number; cross: number; time: number } | undefined;
  let editing: EditingInputOptions<T> = options.editing ?? {};
  let selectedIds: readonly string[] = [];
  /** A press that may still become a drag. */
  let armed: ArmedEdit<T> | undefined;
  let session: EditSession<T> | undefined;
  let keyboard: KeyboardInputOptions = options.keyboard ?? {};
  let focusedId: string | null = null;
  let transition: Transition | undefined;
  /** When the running wheel run ends, unless another step comes first. */
  let wheelRunEnd: number | undefined;

  const scale = (): ReturnType<typeof createTimeScale> => createTimeScale(domain, mainSize, warp);

  /**
   * A container with no pixels cannot be gestured on.
   *
   * The same situation the renderer has to survive — a hidden tab, a frame
   * before layout — reaches the machine too, because a host constructs it
   * alongside the element. Throwing from inside a pointer handler is the
   * worst place to throw, so the machine simply has nothing to say.
   */
  function drawable(): boolean {
    return mainSize > 0;
  }

  function maxCrossOffset(): number {
    return Math.max(0, contentCrossSize - crossSize);
  }

  function clampCross(value: number): number {
    const max = maxCrossOffset();
    return value < 0 ? 0 : value > max ? max : value;
  }

  /** Commit a candidate domain and say whether the limits cut it short. */
  function commit(
    candidate: Domain,
    nextCrossOffset: number,
    reason: InputViewportReason,
    into: InputEffect<T>[],
  ): void {
    const limited = clampDomain(candidate, limits);
    const clampedCross = clampCross(nextCrossOffset);
    const atLimit = !sameDomain(limited, candidate) || clampedCross !== nextCrossOffset;
    if (sameDomain(limited, domain) && clampedCross === crossOffset) {
      // Nothing moved. A viewport effect here would make hosts re-render for
      // every move event at a limit, which is exactly where frames matter.
      return;
    }
    domain = limited;
    crossOffset = clampedCross;
    into.push({ type: "viewport", domain, crossOffset, reason, atLimit });
  }

  /** Put `time` back under `main`, without changing the zoom. */
  function panTimeTo(time: TimeMs, main: number, from: Domain): Domain {
    const current = createTimeScale(from, mainSize, warp);
    return panDomainBy(from, mainSize, current.toMain(time) - main, warp);
  }

  function sample(point: { readonly x: number; readonly y: number }): MainCross {
    return unprojectPoint(point, orientation);
  }

  /**
   * The two pointers that drive the pinch, in the order they landed.
   *
   * Held as state rather than looked up on every sample, and that is not a
   * micro-optimisation: `driving !== undefined` is exactly "a pinch is
   * running", so there is one condition instead of a size check, a phase
   * check and two existence checks that can disagree with each other.
   */
  function pairFromPointers(): readonly [TrackedPointer, TrackedPointer] | undefined {
    const [a, b] = [...pointers.values()];
    return a === undefined || b === undefined ? undefined : [a, b];
  }

  /** Re-grab the instant under every pointer. The cure for the pinch jump. */
  function reanchor(): void {
    if (!drawable()) {
      return;
    }
    const current = scale();
    for (const pointer of pointers.values()) {
      pointer.anchorTime = current.toTime(pointer.main);
      pointer.anchorCross = pointer.cross;
      pointer.anchorCrossOffset = crossOffset;
    }
  }

  function endGesture(cancelled: boolean, into: InputEffect<T>[]): void {
    if (phase === "panning" || phase === "pinching") {
      into.push({
        type: "gestureEnd",
        kind: phase === "pinching" ? "pinch" : "pan",
        cancelled,
      });
    }
    phase = "idle";
  }

  function startGesture(kind: GestureKind, into: InputEffect<T>[]): void {
    phase = kind === "pinch" ? "pinching" : "panning";
    into.push({ type: "gestureStart", kind, cancelled: false });
  }

  /** One pointer dragging: its instant stays under it, its lanes follow it. */
  function applyPan(pointer: TrackedPointer, into: InputEffect<T>[]): void {
    if (!panEnabled) {
      return;
    }
    const nextDomain = panTimeTo(pointer.anchorTime, pointer.main, domain);
    const nextCross = pointer.anchorCrossOffset - (pointer.cross - pointer.anchorCross);
    commit(nextDomain, nextCross, "pan", into);
  }

  /** Lane scroll from how far the pair's midpoint has travelled across. */
  function crossMidpointOffset(a: TrackedPointer, b: TrackedPointer): number {
    const travelled = (a.cross + b.cross) / 2 - (a.anchorCross + b.anchorCross) / 2;
    return a.anchorCrossOffset - travelled;
  }

  /**
   * Two pointers dragging: both instants stay under their own finger.
   *
   * Solving for the pair at once is what makes a pinch feel attached to the
   * hand — zoom and pan fall out of the same equation instead of being
   * stitched together from a scale factor and a midpoint.
   */
  function applyPinch(a: TrackedPointer, b: TrackedPointer, into: InputEffect<T>[]): void {
    const separation = b.main - a.main;
    const anchorSeparation = b.anchorTime - a.anchorTime;
    const scaleable =
      zoomEnabled &&
      Math.abs(separation) >= minPinchSeparation &&
      anchorSeparation !== 0 &&
      Math.sign(separation) === Math.sign(anchorSeparation);
    if (!scaleable) {
      // Fingers across the axis, or on top of each other: pan from the
      // midpoint and leave the zoom alone.
      if (!panEnabled) {
        return;
      }
      const midpoint = (a.main + b.main) / 2;
      const anchorMidpoint = (a.anchorTime + b.anchorTime) / 2;
      commit(panTimeTo(anchorMidpoint, midpoint, domain), crossMidpointOffset(a, b), "pan", into);
      return;
    }
    const wantMsPerPx = anchorSeparation / separation;
    const factor = spanOf(domain) / mainSize / wantMsPerPx;
    const zoomed = zoomDomainAt(domain, mainSize, 0, factor, warp);
    const nextDomain = panTimeTo(a.anchorTime, a.main, zoomed);
    commit(nextDomain, crossMidpointOffset(a, b), "zoom", into);
  }

  /**
   * Whether a press on this hit starts an edit, and whether it starts now.
   *
   * This is the whole of `moveTrigger: "auto"`, and it is resolved *per
   * gesture* rather than per instance: the same timeline, in the same session,
   * gives a mouse the item straight away and asks a finger to hold. A laptop
   * with a touch screen is not an exotic case, and an instance-wide decision
   * would be wrong for one of its two input devices at all times.
   */
  function resolveTrigger(
    hit: EditHit<T>,
    kind: PointerKind,
  ): { readonly trigger: EditTrigger; readonly immediate: boolean } | undefined {
    const mode: MoveTrigger = editing.moveTrigger ?? "auto";
    if (hit.part !== "body") {
      if (hit.item.resizable === false) {
        return undefined;
      }
      // A handle is aimed at, so the intent is already explicit: even a
      // finger gets it without ceremony. A host that wants the ceremony
      // everywhere says so literally.
      return mode === "long-press"
        ? { trigger: "long-press", immediate: false }
        : { trigger: "handle", immediate: true };
    }
    if (hit.item.movable === false || mode === "handle") {
      return undefined;
    }
    if (mode === "edit-mode") {
      return { trigger: "pointer", immediate: true };
    }
    if (mode === "long-press") {
      return { trigger: "long-press", immediate: false };
    }
    return kind === "touch"
      ? { trigger: "long-press", immediate: false }
      : { trigger: "pointer", immediate: true };
  }

  /** Decide whether this press could become an edit, and arm it if so. */
  function armEdit(pointer: TrackedPointer, time: number, into: InputEffect<T>[]): void {
    armed = undefined;
    const hitTest = editing.hitTest;
    if (editing.enabled !== true || hitTest === undefined) {
      return;
    }
    // The pointer type travels with the point: the same press is a 4-pixel
    // target for a mouse and a 12-pixel one for a finger.
    const hit = hitTest({ main: pointer.main, cross: pointer.cross }, pointer.pointerType);
    if (hit === undefined) {
      return;
    }
    const resolved = resolveTrigger(hit, pointer.pointerType);
    if (resolved === undefined) {
      return;
    }
    if (resolved.immediate) {
      armed = { pointerId: pointer.pointerId, hit, trigger: resolved.trigger, dueAt: undefined };
      return;
    }
    const dueAt = time + (editing.longPressMs ?? DEFAULT_LONG_PRESS_MS);
    armed = { pointerId: pointer.pointerId, hit, trigger: resolved.trigger, dueAt };
    into.push({ type: "schedule", at: dueAt, reason: "long-press" });
  }

  function disarm(into: InputEffect<T>[]): void {
    if (armed?.dueAt !== undefined) {
      into.push({ type: "schedule", at: null, reason: "long-press" });
    }
    armed = undefined;
  }

  /** Everything the drag carries: the grabbed item, then the rest of the selection. */
  function hitsFor(hit: EditHit<T>, mode: EditMode): readonly EditHit<T>[] {
    const lookup = editing.lookup;
    if (
      mode !== "move" ||
      editing.multiSelect !== true ||
      lookup === undefined ||
      !selectedIds.includes(hit.item.id)
    ) {
      return [hit];
    }
    const hits: EditHit<T>[] = [hit];
    for (const id of selectedIds) {
      if (id === hit.item.id) {
        continue;
      }
      const other = lookup(id);
      // An item the host locked is simply not part of the drag. Refusing the
      // whole gesture because one selected item is pinned would make a
      // selection unusable, and leaving it where it is is what the user means.
      if (other !== undefined && other.item.movable !== false) {
        hits.push(other);
      }
    }
    return hits;
  }

  /**
   * The patches one edit proposes.
   *
   * The grabbed item lands on the grid and the rest of the selection keeps its
   * distance from it. Snapping every item on its own would scatter a selection
   * whose items are not all on the same phase of the grid — the selection
   * would arrive rearranged, which is not what dragging it together means.
   */
  function patchesFor(
    hits: readonly EditHit<T>[],
    mode: EditMode,
    deltaMs: number,
    laneId: string | null | undefined,
  ): readonly ItemPatch[] {
    const primary = hits[0];
    if (primary === undefined) {
      return [];
    }
    if (mode !== "move") {
      // One edge, one item: which item's edge a multi-resize would move is
      // not a question the gesture can answer.
      const patch = resizePatch(primary, {
        edge: mode === "resize-start" ? "start" : "end",
        deltaMs,
        snapMs: editing.snapMs,
        snapOrigin: editing.snapOrigin,
        minDurationMs: editing.minDurationMs,
      });
      return patch === undefined ? [] : [patch];
    }
    const first = movePatch(primary, {
      deltaMs,
      laneId,
      snapMs: editing.snapMs,
      snapOrigin: editing.snapOrigin,
    });
    const patches: ItemPatch[] = [first];
    const shift = (first.start ?? 0) - toTimeMs(primary.item.start);
    for (let index = 1; index < hits.length; index += 1) {
      const other = hits[index];
      if (other !== undefined) {
        patches.push(movePatch(other, { deltaMs: shift }));
      }
    }
    return patches;
  }

  /**
   * Whether `canMove` refuses this position.
   *
   * One veto refuses the whole proposal. A partial move would silently change
   * the arrangement the user grabbed, and they would read the result as a bug
   * in the library rather than as their own rule being enforced.
   */
  function refused(hits: readonly EditHit<T>[], patches: readonly ItemPatch[]): boolean {
    const canMove = editing.canMove;
    if (canMove === undefined) {
      return false;
    }
    for (const patch of patches) {
      const hit = hits.find((candidate) => candidate.item.id === patch.id);
      if (hit !== undefined && !canMove(hit.item, patch)) {
        return true;
      }
    }
    return false;
  }

  /** Whether the proposal actually differs from where the items already are. */
  function noop(hits: readonly EditHit<T>[], patches: readonly ItemPatch[]): boolean {
    for (const patch of patches) {
      const hit = hits.find((candidate) => candidate.item.id === patch.id);
      if (hit === undefined) {
        continue;
      }
      const before = invertPatch(hit, patch);
      if (
        before.start !== patch.start ||
        before.end !== patch.end ||
        before.laneId !== patch.laneId
      ) {
        return false;
      }
    }
    return true;
  }

  function startEdit(pending: ArmedEdit<T>, into: InputEffect<T>[]): EditSession<T> | undefined {
    const pointer = pointers.get(pending.pointerId);
    if (pointer === undefined) {
      return undefined;
    }
    const mode = modeForPart(pending.hit.part);
    const hits = hitsFor(pending.hit, mode);
    if (pending.dueAt !== undefined) {
      into.push({ type: "schedule", at: null, reason: "long-press" });
    }
    armed = undefined;
    const next: EditSession<T> = {
      pointerId: pending.pointerId,
      mode,
      trigger: pending.trigger,
      // The instant under the pointer where it went DOWN, so the grab point
      // inside the item stays under the finger — including across a zoom in
      // the middle of the drag, which re-maps every pixel but no instant.
      grabTime: scale().toTime(pointer.downMain),
      hits,
      patches: [],
      shift: undefined,
      laneId: undefined,
      vetoed: false,
    };
    session = next;
    phase = "editing";
    into.push({
      type: "editStart",
      mode,
      trigger: pending.trigger,
      items: hits.map((hit) => hit.item),
    });
    return next;
  }

  function applyEdit(
    current: EditSession<T>,
    pointer: TrackedPointer,
    into: InputEffect<T>[],
  ): void {
    const deltaMs = scale().toTime(pointer.main) - current.grabTime;
    const laneId =
      current.mode === "move" && editing.crossLane === true && editing.laneAt !== undefined
        ? (editing.laneAt(pointer.cross) ?? null)
        : undefined;
    const patches = patchesFor(current.hits, current.mode, deltaMs, laneId);
    if (refused(current.hits, patches)) {
      if (current.vetoed) {
        return;
      }
      current.vetoed = true;
      // The last accepted position goes out again: applying `patches` is then
      // always the right thing for the host to do, and `vetoed` is feedback
      // rather than a special case it has to handle.
      into.push({ type: "editMove", mode: current.mode, patches: current.patches, vetoed: true });
      return;
    }
    const primary = patches[0];
    const at = primary === undefined ? undefined : (primary.start ?? primary.end ?? undefined);
    if (!current.vetoed && at === current.shift && laneId === current.laneId) {
      return;
    }
    current.vetoed = false;
    current.shift = at;
    current.laneId = laneId;
    current.patches = patches;
    into.push({ type: "editMove", mode: current.mode, patches, vetoed: false });
  }

  function endEdit(cancelled: boolean, into: InputEffect<T>[]): void {
    const current = session;
    if (current === undefined) {
      return;
    }
    session = undefined;
    phase = "idle";
    if (!cancelled && current.patches.length > 0 && !noop(current.hits, current.patches)) {
      into.push({
        type: "editEnd",
        mode: current.mode,
        command: editCommand(current.mode, current.hits, current.patches),
        cancelled: false,
      });
      return;
    }
    // Nothing to undo: a drag that came back to where it started leaves no
    // command, and neither does a gesture the browser took away.
    into.push({ type: "editEnd", mode: current.mode, cancelled: true });
  }

  /** One complete edit, start to finish. The programmatic twin of a drag. */
  function runEdit(
    hits: readonly EditHit<T>[],
    mode: EditMode,
    deltaMs: number,
    laneId: string | null | undefined,
    trigger: EditTrigger = "api",
  ): readonly InputEffect<T>[] {
    const effects: InputEffect<T>[] = [];
    if (hits.length === 0) {
      return effects;
    }
    effects.push({
      type: "editStart",
      mode,
      trigger,
      items: hits.map((hit) => hit.item),
    });
    const patches = patchesFor(hits, mode, deltaMs, laneId);
    if (refused(hits, patches)) {
      effects.push({ type: "editMove", mode, patches: [], vetoed: true });
      effects.push({ type: "editEnd", mode, cancelled: true });
      return effects;
    }
    if (patches.length === 0 || noop(hits, patches)) {
      effects.push({ type: "editEnd", mode, cancelled: true });
      return effects;
    }
    effects.push({ type: "editMove", mode, patches, vetoed: false });
    effects.push({
      type: "editEnd",
      mode,
      command: editCommand(mode, hits, patches),
      cancelled: false,
    });
    return effects;
  }

  // --- the keyboard ---------------------------------------------------------

  /** Where the view is heading: a running transition's end, or where it is. */
  function viewTarget(): View {
    return transition === undefined
      ? { domain, cross: crossOffset }
      : { domain: transition.to, cross: transition.toCross };
  }

  /**
   * A wheel step that moved the view: the run starts — announced before the
   * move, as a pan's is — or goes on, and either way now ends later. A step
   * that moved nothing (a limit, or the page's scroll) neither starts nor
   * lengthens one.
   */
  function continueWheelRun(time: number, into: InputEffect<T>[]): InputEffect<T>[] {
    const moved = into.findIndex((effect) => effect.type === "viewport");
    if (moved < 0) {
      return into;
    }
    if (wheelRunEnd === undefined) {
      into.splice(moved, 0, { type: "gestureStart", kind: "wheel", cancelled: false });
    }
    wheelRunEnd = time + WHEEL_RUN_MS;
    into.push({ type: "schedule", at: wheelRunEnd, reason: "wheel" });
    return into;
  }

  /** A pointer or a key ends a wheel run at once: a run is wheel steps only. */
  function endWheelRun(into: InputEffect<T>[]): void {
    if (wheelRunEnd !== undefined) {
      wheelRunEnd = undefined;
      into.push({ type: "gestureEnd", kind: "wheel", cancelled: false });
    }
  }

  function stopTransition(into: InputEffect<T>[]): void {
    if (transition !== undefined) {
      transition = undefined;
      into.push({ type: "schedule", at: null, reason: "transition" });
    }
  }

  /**
   * Move the view to `target`, travelling there when motion is welcome.
   *
   * The transition is driven like a long press: the machine asks to be woken
   * and computes the frame from the wake-up's own time, so a recorded key
   * session replays to the same pixels. Without an event time, with reduced
   * motion, or across more than a couple of views, the view is simply there.
   */
  function travel(
    target: Domain,
    targetCross: number,
    reason: InputViewportReason,
    time: number | undefined,
    into: InputEffect<T>[],
  ): void {
    const to = clampDomain(target, limits);
    const toCross = clampCross(targetCross);
    const reach = TRANSITION_MAX_VIEWS * Math.max(spanOf(domain), spanOf(to));
    const far = Math.abs(to[0] + to[1] - domain[0] - domain[1]) / 2 > reach;
    if (time === undefined || keyboard.reducedMotion === true || far) {
      stopTransition(into);
      commit(to, toCross, reason, into);
      return;
    }
    if (sameDomain(to, domain) && toCross === crossOffset) {
      stopTransition(into);
      return;
    }
    transition = { from: domain, to, fromCross: crossOffset, toCross, start: time, reason };
    into.push({ type: "schedule", at: time + TRANSITION_FRAME_MS, reason: "transition" });
  }

  /** One frame of a transition: ease out, and land exactly on the target. */
  function advance(current: Transition, time: number, into: InputEffect<T>[]): void {
    const progress = Math.min(Math.max((time - current.start) / TRANSITION_MS, 0), 1);
    if (progress === 1) {
      transition = undefined;
      commit(current.to, current.toCross, current.reason, into);
      return;
    }
    const eased = 1 - (1 - progress) ** 3;
    const lerp = (from: number, to: number): number => from + (to - from) * eased;
    // Both ends move linearly between two domains that agree on where the
    // anchor sits, so a zoom keeps its anchor still the whole way.
    commit(
      [lerp(current.from[0], current.to[0]), lerp(current.from[1], current.to[1])],
      lerp(current.fromCross, current.toCross),
      current.reason,
      into,
    );
    into.push({ type: "schedule", at: time + TRANSITION_FRAME_MS, reason: "transition" });
  }

  /** The extent along time that has to show for an item to count as shown. */
  function shows(view: View, entry: NavEntry, inset: number): boolean {
    const margin = spanOf(view.domain) * REVEAL_MARGIN;
    const overlap = Math.min(entry.end, view.domain[1]) - Math.max(entry.start, view.domain[0]);
    if (overlap < Math.min(entry.end - entry.start, margin)) {
      return false;
    }
    if (crossSize <= 0) {
      return true;
    }
    const band = crossSize - inset;
    return entry.crossSize >= band
      ? entry.cross < view.cross + band && entry.cross + entry.crossSize > view.cross
      : entry.cross >= view.cross && entry.cross + entry.crossSize <= view.cross + band;
  }

  /** The nearest view to `from` that shows `entry`. */
  function revealing(from: View, entry: NavEntry, inset: number): View {
    if (shows(from, entry, inset)) {
      return from;
    }
    const [start, end] = from.domain;
    const span = end - start;
    const margin = span * REVEAL_MARGIN;
    let shift = 0;
    if (entry.end - entry.start > span - 2 * margin || entry.start < start + margin) {
      shift = entry.start - (start + margin);
    } else if (entry.end > end - margin) {
      shift = entry.end - (end - margin);
    }
    let cross = from.cross;
    const band = crossSize - inset;
    if (crossSize > 0 && entry.cross < cross) {
      cross = entry.cross;
    } else if (crossSize > 0 && entry.cross + entry.crossSize > cross + band) {
      cross = entry.cross + entry.crossSize - band;
    }
    return { domain: [start + shift, end + shift], cross };
  }

  function setFocused(id: string | null, into: InputEffect<T>[]): void {
    if (id !== focusedId) {
      focusedId = id;
      into.push({ type: "focus", id });
    }
  }

  /** Focus an item and bring it into view. */
  function focusOn(navigator: Navigator, entry: NavEntry | undefined, time: number, into: InputEffect<T>[]): void {
    if (entry === undefined) {
      return;
    }
    setFocused(entry.id, into);
    if (panEnabled) {
      const target = revealing(viewTarget(), entry, navigator.crossInset);
      travel(target.domain, target.cross, "pan", time, into);
    }
  }

  /** The first item, walking in `direction`, that the view heading somewhere shows. */
  function firstShown(navigator: Navigator, direction: 1 | -1): NavEntry | undefined {
    const view = viewTarget();
    const entries = navigator.entries;
    for (let step = 0; step < entries.length; step += 1) {
      const entry = entries[direction === 1 ? step : entries.length - 1 - step] as NavEntry;
      if (shows(view, entry, navigator.crossInset)) {
        return entry;
      }
    }
    return undefined;
  }

  /**
   * After the view moved, the focus must not be left behind off-screen: it
   * moves to the first item the new view shows, or off every item. A focus
   * ring nobody can see is the failure WCAG 2.4.11 names.
   */
  function keepFocusShown(direction: 1 | -1, into: InputEffect<T>[]): void {
    const navigator = keyboard.navigator;
    if (navigator === undefined || focusedId === null) {
      return;
    }
    const entry = navigator.entries[navigator.indexOf(focusedId)];
    if (entry !== undefined && shows(viewTarget(), entry, navigator.crossInset)) {
      return;
    }
    setFocused(firstShown(navigator, direction)?.id ?? null, into);
  }

  function focusedEntry(navigator: Navigator | undefined): NavEntry | undefined {
    return navigator === undefined || focusedId === null
      ? undefined
      : navigator.entries[navigator.indexOf(focusedId)];
  }

  /** Items by id, as a drag would carry them. Locked ones stay behind. */
  function movableHits(ids: readonly string[]): EditHit<T>[] {
    const hits: EditHit<T>[] = [];
    const lookup = editing.lookup;
    for (const id of ids) {
      const hit = lookup?.(id);
      if (hit !== undefined && hit.item.movable !== false) {
        hits.push(hit);
      }
    }
    return hits;
  }

  /**
   * One edit from the keyboard: the same {@link runEdit} a programmatic move
   * uses, with the same selection rule a drag follows — the focused item
   * first, the rest of the selection with it when the focused one is part of
   * it. The edited item is then brought back into view.
   */
  function keyEdit(action: EditAction, time: number, into: InputEffect<T>[]): boolean {
    const navigator = keyboard.navigator;
    const lookup = editing.lookup;
    const hit = focusedId === null || lookup === undefined ? undefined : lookup(focusedId);
    // A cluster is one stop for the keyboard, named after its first member;
    // an edit there would move that one item, which nobody can see.
    if (editing.enabled !== true || hit === undefined || focusedEntry(navigator)?.count !== undefined) {
      return false;
    }
    const later = action === "moveLater" || action === "endLater" || action === "startLater";
    const snap = editing.snapMs;
    const step =
      (keyboard.stepMs ?? (snap !== undefined && snap > 0 ? snap : (spanOf(domain) / mainSize) * KEY_STEP_PX)) *
      (later ? 1 : -1);
    const ids =
      editing.multiSelect === true && selectedIds.includes(hit.item.id)
        ? [hit.item.id, ...selectedIds.filter((id) => id !== hit.item.id)]
        : [hit.item.id];
    let effects: readonly InputEffect<T>[];
    switch (action) {
      case "endLater":
      case "endEarlier":
        if (hit.item.resizable === false) {
          return false;
        }
        effects = runEdit([hit], "resize-end", step, undefined, "keyboard");
        break;
      case "startLater":
      case "startEarlier":
        if (hit.item.resizable === false) {
          return false;
        }
        effects = runEdit([hit], "resize-start", step, undefined, "keyboard");
        break;
      case "moveLater":
      case "moveEarlier":
        if (hit.item.movable === false) {
          return false;
        }
        effects = runEdit(movableHits(ids), "move", step, undefined, "keyboard");
        break;
      case "laneNext":
      case "lanePrevious": {
        const lanes = navigator?.lanes ?? [];
        if (hit.item.movable === false || editing.crossLane !== true || lanes.length === 0) {
          return false;
        }
        const lane = lanes[lanes.indexOf(hit.laneId) + (action === "laneNext" ? 1 : -1)];
        effects = lane === undefined ? [] : runEdit(movableHits(ids), "move", 0, lane, "keyboard");
        break;
      }
    }
    into.push(...effects);
    const end = effects[effects.length - 1];
    const patch = end?.type === "editEnd" ? end.command?.after.find((each) => each.id === hit.item.id) : undefined;
    const entry = focusedEntry(navigator);
    if (patch !== undefined && entry !== undefined && navigator !== undefined && panEnabled) {
      // The navigator is the frame before the edit; where the item went is in
      // the patch. Moved, both ends travel; resized, only the one edge.
      const start = patch.start ?? entry.start;
      const finish =
        "end" in patch && patch.end !== undefined && patch.end !== null
          ? patch.end
          : entry.end + (start - entry.start);
      const target = revealing(viewTarget(), { ...entry, start, end: Math.max(finish, start) }, navigator.crossInset);
      travel(target.domain, target.cross, "pan", time, into);
    }
    return true;
  }

  /** Run one key action. `false`: not ours in this state, let the key through. */
  function runKey(action: KeyAction, time: number, into: InputEffect<T>[]): boolean {
    const navigator = keyboard.navigator;
    const entries = navigator?.entries ?? [];
    const current = focusedEntry(navigator);
    const target = viewTarget();
    switch (action) {
      case "next":
      case "previous":
      case "rowNext":
      case "rowPrevious":
      case "first":
      case "last": {
        if (navigator === undefined || entries.length === 0) {
          return false;
        }
        const direction = action === "next" || action === "rowNext" || action === "first" ? 1 : -1;
        let next: NavEntry | undefined;
        if (action === "first" || action === "last") {
          next = entries[direction === 1 ? 0 : entries.length - 1];
        } else if (current === undefined) {
          // Nothing focused yet: start where the user is looking.
          next = firstShown(navigator, direction) ?? entries[direction === 1 ? 0 : entries.length - 1];
        } else if (action === "next" || action === "previous") {
          next = entries[navigator.indexOf(current.id) + direction] ?? current;
        } else {
          next = rowNeighbour(navigator, current, direction) ?? current;
        }
        focusOn(navigator, next, time, into);
        return true;
      }
      case "panLater":
      case "panEarlier": {
        if (!panEnabled) {
          return false;
        }
        const direction = action === "panLater" ? 1 : -1;
        travel(panDomainBy(target.domain, mainSize, direction * mainSize * PAGE_FRACTION, warp), target.cross, "pan", time, into);
        keepFocusShown(direction, into);
        return true;
      }
      case "crossForward":
      case "crossBack": {
        if (!panEnabled || maxCrossOffset() <= 0) {
          return false;
        }
        const direction = action === "crossForward" ? 1 : -1;
        travel(target.domain, target.cross + direction * crossSize * PAGE_FRACTION, "pan", time, into);
        keepFocusShown(direction, into);
        return true;
      }
      case "zoomIn":
      case "zoomOut": {
        if (!zoomEnabled) {
          return false;
        }
        // The keyboard has no pointer to anchor on; its focus is the focused
        // item — the middle of the part of it in view, which is finite even
        // for an interval with no known end. Without one, the middle of the
        // view.
        let anchor = mainSize / 2;
        if (current !== undefined && navigator !== undefined && shows(target, current, navigator.crossInset)) {
          const from = Math.max(current.start, target.domain[0]);
          const to = Math.min(current.end, target.domain[1]);
          anchor = createTimeScale(target.domain, mainSize, warp).toMain((from + to) / 2);
        }
        const factor = action === "zoomIn" ? tapZoom : 1 / tapZoom;
        travel(zoomDomainAt(target.domain, mainSize, anchor, factor, warp), target.cross, "zoom", time, into);
        keepFocusShown(1, into);
        return true;
      }
      case "activate": {
        if (current !== undefined) {
          into.push({ type: "activate", id: current.id });
          return true;
        }
        if (navigator === undefined || entries.length === 0) {
          return false;
        }
        focusOn(navigator, firstShown(navigator, 1) ?? entries[0], time, into);
        return true;
      }
      case "dismiss": {
        if (focusedId === null && selectedIds.length === 0) {
          return false;
        }
        setFocused(null, into);
        into.push({ type: "activate", id: null });
        return true;
      }
      case "jump":
        if (!panEnabled) {
          return false;
        }
        into.push({ type: "jumpRequest" });
        return true;
      // Named one by one, with no default: a new action that is not handled
      // here is a compile error, not a silent edit.
      case "moveLater":
      case "moveEarlier":
      case "laneNext":
      case "lanePrevious":
      case "endLater":
      case "endEarlier":
      case "startLater":
      case "startEarlier":
        return keyEdit(action, time, into);
    }
  }

  function emitTap(
    pointer: TrackedPointer,
    pointerCount: number,
    at: { main: number; cross: number },
    time: number,
    into: InputEffect<T>[],
  ): void {
    const isDouble =
      pointerCount === 1 &&
      lastTap !== undefined &&
      time - lastTap.time <= doubleTapMs &&
      Math.abs(at.main - lastTap.main) <= doubleTapSlop &&
      Math.abs(at.cross - lastTap.cross) <= doubleTapSlop;
    into.push({
      type: "tap",
      main: at.main,
      cross: at.cross,
      pointerType: pointer.pointerType,
      tapCount: isDouble ? 2 : 1,
      pointerCount,
      durationMs: time - pointer.downTime,
    });
    if (pointerCount === 2) {
      // Two fingers tapped: the gesture every map has for "out one step".
      lastTap = undefined;
      if (zoomEnabled) {
        commit(zoomDomainAt(domain, mainSize, at.main, 1 / tapZoom, warp), crossOffset, "zoom", into);
      }
      return;
    }
    if (isDouble) {
      lastTap = undefined;
      if (zoomEnabled) {
        commit(zoomDomainAt(domain, mainSize, at.main, tapZoom, warp), crossOffset, "zoom", into);
      }
      return;
    }
    lastTap = { main: at.main, cross: at.cross, time };
  }

  function onDown(input: PointerSample, into: InputEffect<T>[]): void {
    const at = sample(input);
    const current = scale();
    const pointer: TrackedPointer = {
      pointerId: input.pointerId,
      pointerType: input.pointerType,
      downMain: at.main,
      downCross: at.cross,
      downTime: input.time,
      main: at.main,
      cross: at.cross,
      anchorTime: current.toTime(at.main),
      anchorCross: at.cross,
      anchorCrossOffset: crossOffset,
      moved: false,
    };
    pointers.set(input.pointerId, pointer);
    if (pointers.size === 1) {
      phase = "pressing";
      gestureMoved = false;
      consumed = false;
      into.push({
        type: "press",
        pointerId: pointer.pointerId,
        pointerType: pointer.pointerType,
        main: at.main,
        cross: at.cross,
        time: input.time,
      });
      armEdit(pointer, input.time, into);
      return;
    }
    if (session !== undefined) {
      // An edit owns the gesture. A later pointer is tracked so that its lift
      // is handled, but it neither pinches nor takes the drag over: losing a
      // drag a finger held half a second to earn, because a palm brushed the
      // glass, is worse than not being able to zoom in the middle of one.
      return;
    }
    if (pointers.size === 2) {
      // A second finger turns a press or a pan into a pinch. Both pointers
      // re-grab what is under them *now*, so the switch moves nothing.
      if (phase === "panning") {
        into.push({ type: "gestureEnd", kind: "pan", cancelled: false });
      }
      // Two fingers mean zoom, not edit: whatever the first one was still
      // deciding is off.
      disarm(into);
      reanchor();
      driving = pairFromPointers();
      pinchStartTime = input.time;
      consumed = false;
      startGesture("pinch", into);
    }
    // A third finger is tracked so its lift is handled, but it does not drive
    // the gesture: two points already determine the whole transform.
  }

  function onMove(input: PointerSample, into: InputEffect<T>[]): void {
    const pointer = pointers.get(input.pointerId);
    if (pointer === undefined) {
      return;
    }
    const at = sample(input);
    pointer.main = at.main;
    pointer.cross = at.cross;
    const travel = Math.max(
      Math.abs(at.main - pointer.downMain),
      Math.abs(at.cross - pointer.downCross),
    );
    const beyond = travel > thresholdFor(pointer.pointerType, options.dragThreshold);
    if (beyond) {
      pointer.moved = true;
      gestureMoved = true;
    }
    if (session === undefined && armed !== undefined && armed.pointerId === input.pointerId) {
      const due = armed.dueAt !== undefined && input.time >= armed.dueAt;
      if (due || (armed.dueAt === undefined && beyond)) {
        // `due` wins over the threshold on purpose: the host's timer would
        // have woken the machine before this move arrived, so a replayed
        // sequence has to reach the same conclusion as a live one.
        startEdit(armed, into);
      } else if (beyond) {
        // The finger moved before the hold came due. It is panning, not
        // dragging an item, and the hold is off.
        disarm(into);
      }
    }
    if (session !== undefined) {
      if (session.pointerId === input.pointerId) {
        applyEdit(session, pointer, into);
      }
      return;
    }
    if (phase === "pressing") {
      if (!pointer.moved) {
        return;
      }
      startGesture("pan", into);
    }
    if (driving !== undefined) {
      // A pinch is running, and the pair that drives it is this one. Which
      // of the two moved does not matter: the transform comes from both.
      applyPinch(driving[0], driving[1], into);
      return;
    }
    if (phase === "panning") {
      applyPan(pointer, into);
    }
  }

  function onRelease(input: PointerSample, into: InputEffect<T>[]): void {
    const pointer = pointers.get(input.pointerId);
    if (pointer === undefined) {
      return;
    }
    const cancelled = input.phase === "cancel";
    // Captured before the delete: a two-finger tap is decided from where the
    // pair was, and one of them is about to be gone.
    const midpoint =
      driving === undefined
        ? undefined
        : {
            main: (driving[0].main + driving[1].main) / 2,
            cross: (driving[0].cross + driving[1].cross) / 2,
          };
    pointers.delete(input.pointerId);

    if (armed !== undefined && armed.pointerId === input.pointerId) {
      disarm(into);
    }
    if (session !== undefined) {
      if (session.pointerId === input.pointerId) {
        endEdit(cancelled, into);
        // Fingers still on the glass must not inherit the gesture: the next
        // pan would start from wherever one of them happens to be resting.
        consumed = pointers.size > 0;
      }
      return;
    }

    if (pointers.size === 0) {
      if (!cancelled && !consumed && phase === "pressing" && !gestureMoved) {
        emitTap(pointer, 1, { main: pointer.main, cross: pointer.cross }, input.time, into);
        phase = "idle";
      } else {
        endGesture(cancelled, into);
      }
      if (cancelled) {
        lastTap = undefined;
      }
      consumed = false;
      return;
    }

    if (pointers.size >= 2) {
      // Still a pinch, by whichever two are left. The driving pair may have
      // changed, so re-grab — but the gesture did not end, and saying it did
      // would make the host blink its tooltips mid-pinch.
      driving = pairFromPointers();
      reanchor();
      return;
    }

    driving = undefined;
    // One pointer left and two in the map a moment ago: a pinch was running,
    // because a second pointer landing is the only thing that starts one.
    into.push({ type: "gestureEnd", kind: "pinch", cancelled });

    if (!cancelled && !gestureMoved && midpoint !== undefined && input.time - pinchStartTime <= doubleTapMs) {
      // Two fingers down and straight back up: zoom out one step, about the
      // point between them. Decided here, on the FIRST lift, because the
      // other finger is still down and must not start a pan of its own.
      consumed = true;
      phase = "idle";
      emitTap(pointer, 2, midpoint, input.time, into);
      return;
    }

    // The jump this phase exists to prevent: the surviving finger still holds
    // the instant it grabbed before the zoom. Re-grabbing is the whole fix.
    reanchor();
    startGesture("pan", into);
  }

  return {
    get domain() {
      return domain;
    },
    get crossOffset() {
      return crossOffset;
    },
    get phase() {
      return phase;
    },
    get pointerCount() {
      return pointers.size;
    },
    get selectedIds() {
      return selectedIds;
    },
    get focusedId() {
      return focusedId;
    },
    handle(input) {
      const effects: InputEffect<T>[] = [];
      if (!drawable()) {
        return effects;
      }
      switch (input.phase) {
        case "down":
          // A finger takes the view from wherever a transition had got it
          // to: the instant it grabs is the one under it now.
          stopTransition(effects);
          endWheelRun(effects);
          onDown(input, effects);
          break;
        case "move":
          onMove(input, effects);
          break;
        default:
          onRelease(input, effects);
      }
      return effects;
    },
    wheel(input) {
      const effects: InputEffect<T>[] = [];
      if (!drawable()) {
        return effects;
      }
      stopTransition(effects);
      const at = sample(input);
      if (input.ctrlKey) {
        // A trackpad pinch. It always arrives on deltaY, whichever way the
        // timeline runs, because that is what the hardware reports.
        if (zoomEnabled) {
          commit(
            zoomDomainAt(domain, mainSize, at.main, Math.exp(-input.deltaY * wheelZoomRate), warp),
            crossOffset,
            "zoom",
            effects,
          );
        }
        return continueWheelRun(input.time, effects);
      }
      if (!panEnabled) {
        return effects;
      }
      const crossHasRoom = maxCrossOffset() > 0;
      if (cooperative && !input.shiftKey && !crossHasRoom) {
        // The page's scroll, not ours.
        return effects;
      }
      const delta = sample({ x: input.deltaX, y: input.deltaY });
      // A plain wheel is one-dimensional on most mice: it only ever reports
      // the cross axis of a horizontal timeline. Routing that into time when
      // the lanes have nothing to scroll is the difference between a wheel
      // that works and one that looks broken.
      const crossScrollable = crossHasRoom && !input.shiftKey;
      // Vertically the cross axis is `x`: mirrored for the lanes, not for
      // time, so what is routed into time is taken back.
      const mainDelta = crossScrollable ? delta.main : delta.main + (input.mirrored && orientation !== "horizontal" ? -delta.cross : delta.cross);
      const crossDelta = crossScrollable ? delta.cross : 0;
      commit(
        panDomainBy(domain, mainSize, mainDelta * wheelPanRate, warp),
        crossOffset + crossDelta * wheelPanRate,
        "pan",
        effects,
      );
      return continueWheelRun(input.time, effects);
    },
    pan(deltaMain, deltaCross = 0) {
      const effects: InputEffect<T>[] = [];
      if (!panEnabled || !drawable()) {
        return effects;
      }
      stopTransition(effects);
      commit(
        panDomainBy(domain, mainSize, deltaMain, warp),
        crossOffset + deltaCross,
        "pan",
        effects,
      );
      reanchor();
      return effects;
    },
    zoom(factor, focusMain) {
      const effects: InputEffect<T>[] = [];
      if (!zoomEnabled || !drawable()) {
        return effects;
      }
      stopTransition(effects);
      commit(zoomDomainAt(domain, mainSize, focusMain, factor, warp), crossOffset, "zoom", effects);
      reanchor();
      return effects;
    },
    elapse(time) {
      const effects: InputEffect<T>[] = [];
      if (wheelRunEnd !== undefined) {
        // Woken early — a later step moved the end — the run goes on.
        if (time < wheelRunEnd) {
          return [{ type: "schedule", at: wheelRunEnd, reason: "wheel" }];
        }
        endWheelRun(effects);
        return effects;
      }
      if (transition !== undefined && drawable()) {
        advance(transition, time, effects);
        return effects;
      }
      const pending = armed;
      if (
        !drawable() ||
        pending === undefined ||
        pending.dueAt === undefined ||
        time < pending.dueAt
      ) {
        return effects;
      }
      // The hold came due with the finger still on the item and still still.
      startEdit(pending, effects);
      return effects;
    },
    key(input) {
      const effects: InputEffect<T>[] = [];
      if (keyboard.enabled === false || !drawable() || phase !== "idle") {
        return effects;
      }
      const action = resolveKey(input, orientation, keyboard.bindings ?? DEFAULT_KEY_BINDINGS);
      if (action === undefined || !runKey(action, input.time, effects)) {
        return [];
      }
      // A key the timeline took ends a wheel run: a run is wheel steps only.
      const ended: InputEffect<T>[] = [];
      endWheelRun(ended);
      return [{ type: "key", action }, ...ended, ...effects];
    },
    goTo(time, eventTime) {
      const effects: InputEffect<T>[] = [];
      if (!panEnabled || !drawable()) {
        return effects;
      }
      const at = toTimeMs(time);
      const target = viewTarget();
      const half = spanOf(target.domain) / 2;
      travel([at - half, at + half], target.cross, "pan", eventTime, effects);
      keepFocusShown(1, effects);
      return effects;
    },
    moveItems(ids, deltaMs, laneId) {
      if (editing.enabled !== true || editing.lookup === undefined) {
        return [];
      }
      return runEdit(movableHits(ids), "move", deltaMs, laneId);
    },
    resizeItem(id, edge, deltaMs) {
      const lookup = editing.lookup;
      if (editing.enabled !== true || lookup === undefined) {
        return [];
      }
      const hit = lookup(id);
      if (hit === undefined || hit.item.resizable === false) {
        return [];
      }
      return runEdit([hit], edge === "start" ? "resize-start" : "resize-end", deltaMs, undefined);
    },
    setSelection(ids) {
      selectedIds = [...ids];
    },
    setFocus(id) {
      focusedId = id;
    },
    setKeyboard(next) {
      keyboard = { ...keyboard, ...next };
    },
    setEditing(next) {
      // Merged, not replaced: the common call is a host handing over a fresh
      // hit tester after a redraw, and it should not have to repeat its rules.
      editing = { ...editing, ...next };
    },
    setDomain(next) {
      // The host's word is final; a transition still heading elsewhere would
      // overwrite it on its next frame.
      transition = undefined;
      domain = clampDomain(next, limits);
      reanchor();
    },
    resize(size) {
      if (size.mainSize !== undefined) {
        mainSize = size.mainSize;
      }
      if (size.crossSize !== undefined) {
        crossSize = size.crossSize;
      }
      if (size.contentCrossSize !== undefined) {
        contentCrossSize = size.contentCrossSize;
      }
      crossOffset = clampCross(crossOffset);
      reanchor();
    },
    setOrientation(next) {
      orientation = next;
      reanchor();
    },
    reset() {
      const effects: InputEffect<T>[] = [];
      pointers.clear();
      driving = undefined;
      gestureMoved = false;
      consumed = false;
      lastTap = undefined;
      stopTransition(effects);
      disarm(effects);
      endEdit(true, effects);
      endGesture(true, effects);
      return effects;
    },
  };
}
