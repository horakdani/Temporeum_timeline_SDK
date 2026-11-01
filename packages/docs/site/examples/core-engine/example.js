import { createInputMachine, createNavigator, densityMetrics, planSceneSpace, renderTimeline } from "@temporeum/timeline-core";
import { attachInput, createFrameLoop, mountScene } from "@temporeum/timeline-core/dom";

// 2 000 items: enough that drawing only what changed is what keeps it smooth.
const DAY = 86_400_000;
const START = Date.UTC(2026, 0, 1);
const items = Array.from({ length: 2000 }, (_, index) => {
  const start = START + Math.floor(index / 8) * DAY + (index % 8) * 3 * 3_600_000;
  return { id: `i${String(index)}`, start, end: start + 2 * DAY, label: `Item ${String(index)}` };
});

const element = document.querySelector("#timeline");
const readout = document.querySelector("#frames");
const width = element.clientWidth;
const height = element.clientHeight;
const metrics = densityMetrics("compact", "horizontal");

/** @type {import("@temporeum/timeline-core").Domain} */
let domain = [START, START + 30 * DAY];
let crossOffset = 0;
let space;
let gesture = false;
let frames = 0;

const machine = createInputMachine({ domain, mainSize: width, crossSize: height });
const mount = mountScene(element); // patches, pools, never reads the DOM
const view = () => ({ domain, mainSize: width });

const loop = createFrameLoop(element, () => {
  space = planSceneSpace(space, view(), { settle: !gesture, levels: true });
  const result = renderTimeline({ items, domain, width, height, density: "compact", crossOffset, space, focusedId: machine.focusedId, ariaLabel: "Two thousand items" });
  mount.update(result.scene);
  machine.setKeyboard({ navigator: createNavigator(result.layout, { crossInset: metrics.axisSize }) });
  frames += 1;
  readout.dataset.frames = String(frames);
  readout.textContent = `${String(frames)} frames drawn, ${String(result.visibleCount)} items visible`;
  // At rest the overscan fills in a strip per frame: plan again, and draw
  // again while the plan still changes.
  if (!gesture && planSceneSpace(space, view(), { settle: true }) !== space) loop.request();
  // A zoom re-anchors a step at a time: the old scale stands in until the
  // view is drawn again, a tile a frame.
  if (result.pendingTiles > 0) loop.request();
});

attachInput(element, {
  machine,
  onEffects(effects) {
    for (const e of effects) {
      if (e.type === "viewport") ({ domain, crossOffset } = e);
      if (e.type === "gestureStart") gesture = true;
      if (e.type === "gestureEnd") gesture = false;
    }
    loop.request(); // one draw per frame, however many events
  },
});
loop.request();
