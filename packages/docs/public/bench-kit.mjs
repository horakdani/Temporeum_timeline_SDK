/*
 * A teljesítmény-mérés közös eszközei: az adat, a gesztusok, a képkocka-
 * számlálás és a forgatókönyvek.
 *
 * Két lap használja: a bench.html a mag saját útját méri (G-PERF), a
 * bench-public.html a publikus utat, `createTimeline`-t a shippelt
 * element-bundle-ból (G-PERF-PUBLIC). A P13-ig ez a kód a bench.html-ben
 * élt; azért van most egy helyen, hogy a két mérés ne sodródhasson szét —
 * ugyanaz az adat, ugyanaz az ujj, ugyanaz a számlálás, csak a mért út más.
 */

// --- az adat: 10 000 elem, determinisztikusan --------------------------
// 60 egymásba csúsztatott folyam, 8 napos elemek 10 naponként: a pakolás
// ~48 sort ad, ami dense sűrűségen kitölti a 900 px-et. A nézet a teljes
// tartomány ötöde, így ~2000 elem látszik a 10 000-ből.
const DAY = 86_400_000;
export const START = Date.UTC(2026, 0, 1);
const STREAMS = 60;
const PERIOD = 10 * DAY;
const LENGTH = 8 * DAY;

export function benchItems() {
  const items = [];
  for (let index = 0; items.length < 10_000; index += 1) {
    const stream = index % STREAMS;
    const round = Math.floor(index / STREAMS);
    const start = START + round * PERIOD + (stream * PERIOD) / STREAMS;
    items.push({ id: `e${index}`, start, end: start + LENGTH, label: `Elem ${index}` });
  }
  return items;
}

/** A kiinduló nézet: a teljes tartomány második ötöde. */
export function benchDomain(items) {
  const total = items[items.length - 1].end - START;
  return [START + total * 0.2, START + total * 0.4];
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));

/**
 * A mérőeszközök egy kerethez.
 *
 * `counters()` adja a hurok két számát: hány rajzolást kértek (`requests`)
 * és hányat rajzolt (`frames`) — ebből látszik, hogy a bemenet képkockánként
 * össze van vonva. `settleAt(domain)` a lap saját útján állítja be a nézetet,
 * és megvárja, hogy kirajzolódjon.
 */
export function createBenchKit({ frame, counters, settleAt, origin }) {
  const H = () => frame.clientHeight;
  const W = () => frame.clientWidth;
  let dispatched = 0;

  /** A böngésző szerint TÉNYLEG látható elemek és címkék — nem a renderelő szerint. */
  function visibility() {
    const box = frame.getBoundingClientRect();
    const inside = (rect) =>
      rect.right > box.left && rect.left < box.right && rect.bottom > box.top && rect.top < box.bottom;
    let visibleItems = 0;
    for (const node of frame.querySelectorAll("rect.tl-item")) {
      if (inside(node.getBoundingClientRect())) visibleItems += 1;
    }
    let visibleLabels = 0;
    for (const node of frame.querySelectorAll(".tl-label")) {
      if (inside(node.getBoundingClientRect())) visibleLabels += 1;
    }
    return {
      visibleItems,
      visibleLabels,
      domNodes: frame.getElementsByTagName("*").length,
    };
  }

  function dispatch(type, pointerId, x, y) {
    const box = frame.getBoundingClientRect();
    dispatched += 1;
    frame.dispatchEvent(
      new PointerEvent(type, {
        pointerId,
        pointerType: "touch",
        isPrimary: pointerId === 1,
        clientX: box.left + x,
        clientY: box.top + y,
        bubbles: true,
        cancelable: true,
      }),
    );
  }

  /**
   * Egy gesztus 120 Hz-es digitalizálóval. A pozíció az eltelt IDŐBŐL
   * számol, nem a képkockákból — ahogy egy valódi ujj is halad, akkor is,
   * ha a lap lemarad. `path(u)` az u ∈ [0, 1] helyhez adja az ujjakat.
   */
  async function performGesture(durationMs, path) {
    const frames = [];
    let recording = true;
    const record = (time) => {
      frames.push(time);
      if (recording) requestAnimationFrame(record);
    };
    const loopBefore = counters();
    const startPointers = path(0);
    startPointers.forEach((p, index) => dispatch("pointerdown", index + 1, p.x, p.y));
    requestAnimationFrame(record);
    const began = performance.now();
    await new Promise((resolve) => {
      const tick = () => {
        const u = Math.min((performance.now() - began) / durationMs, 1);
        path(u).forEach((p, index) => dispatch("pointermove", index + 1, p.x, p.y));
        if (u < 1) setTimeout(tick, 8);
        else resolve();
      };
      setTimeout(tick, 8);
    });
    // Az utolsó gesztus-képkocka még kirajzolódik, mielőtt az ujj felemelkedik.
    await nextFrame();
    recording = false;
    const end = path(1);
    const upAt = performance.now();
    end.forEach((p, index) => dispatch("pointerup", index + 1, p.x, p.y));
    // A nyugvó képkocka: a felemelés után a hurok rajzol (elemtérben
    // újrahorgonyoz, ha volt zoom), és a KÖVETKEZŐ képkocka eleje az, amikor
    // az már a képernyőn van.
    await nextFrame();
    await nextFrame();
    const settleMs = performance.now() - upAt;
    const loopAfter = counters();
    return {
      frames,
      settleMs,
      requests: loopAfter.requests - loopBefore.requests,
      draws: loopAfter.frames - loopBefore.frames,
    };
  }

  function summarize(run) {
    const times = run.frames;
    const intervals = times.slice(1).map((time, index) => time - times[index]);
    const duration = times[times.length - 1] - times[0];
    const expected = duration / (1000 / 60);
    const missed = expected <= 0 ? 1 : Math.max(0, 1 - intervals.length / expected);
    return {
      frames: intervals.length,
      durationMs: duration,
      missedVsyncShare: missed,
      effectiveFps: intervals.length / (duration / 1000),
      longestFrameMs: Math.max(...intervals),
      p95FrameMs: [...intervals].sort((a, b) => a - b)[Math.floor(intervals.length * 0.95)],
      settleMs: run.settleMs,
      inputEvents: run.requests,
      draws: run.draws,
    };
  }

  /** Egy ujjas húzás jobbról balra és vissza: 960 px/s, két másodperc. */
  const panPath = (u) => {
    const x = u < 0.5 ? 1200 - 1920 * u : 240 + 1920 * (u - 0.5);
    return [{ x, y: H() / 2 }];
  };

  /** Csipesz a közép körül: 200 px-ről 400 px-re (2x) és vissza. */
  const pinchPath = (u) => {
    const spread = u < 0.5 ? 200 + 400 * u : 400 - 400 * (u - 0.5);
    const cx = W() / 2;
    return [
      { x: cx - spread / 2, y: H() / 2 },
      { x: cx + spread / 2, y: H() / 2 },
    ];
  };

  /**
   * Mély csipesz: 100 px-ről 400 px-re (4x) és vissza — a G-PERF-DEEP
   * forgatókönyve (P14 óta kapu). A 2x-es zoom sem fér az elemtér 1,5x-es
   * nyújtásába (útközben két-három újrahorgonyzás; a P13-ig itt álló
   * komment ennek az ellenkezőjét állította), a 4x-es pedig hatot kér:
   * ez a forgatókönyv azt méri, mibe kerül az újrahorgonyzás.
   */
  const deepPinchPath = (u) => {
    const spread = u < 0.5 ? 100 + 600 * u : 400 - 600 * (u - 0.5);
    const cx = W() / 2;
    return [
      { x: cx - spread / 2, y: H() / 2 },
      { x: cx + spread / 2, y: H() / 2 },
    ];
  };

  /**
   * Hosszú pásztázás, csak tájékoztatásra: négy húzás egymás után, mind
   * 1200 px balra, 960 px/s-mal — 4800 px, a ráhagyáson messze túl, így a
   * belépő csempéket a gesztus alatt kell megrajzolni. A húzások között
   * nincs szünet: a nyugalmi feltöltés csak annyi képkockát kap, amennyi
   * két húzás közé esik.
   */
  async function longPan() {
    const runs = [];
    for (let index = 0; index < 4; index += 1) {
      runs.push(await performGesture(1250, (u) => [{ x: 1300 - 1200 * u, y: H() / 2 }]));
    }
    const parts = runs.map(summarize);
    const frames = parts.reduce((sum, part) => sum + part.frames, 0);
    const duration = parts.reduce((sum, part) => sum + part.durationMs, 0);
    const expected = duration / (1000 / 60);
    return {
      frames,
      durationMs: duration,
      missedVsyncShare: Math.max(0, 1 - frames / expected),
      effectiveFps: frames / (duration / 1000),
      longestFrameMs: Math.max(...parts.map((part) => part.longestFrameMs)),
      p95FrameMs: Math.max(...parts.map((part) => part.p95FrameMs)),
      settleMs: Math.max(...parts.map((part) => part.settleMs)),
      inputEvents: parts.reduce((sum, part) => sum + part.inputEvents, 0),
      draws: parts.reduce((sum, part) => sum + part.draws, 0),
    };
  }

  /**
   * Felvétel kívülről jövő bemenethez (P15, G-PERF-WHEEL): a valódi görgőt a
   * mérő szkript küldi a Node-ból (`page.mouse.wheel`), ahogy a
   * vis-összevetés is, így a böngésző saját bemeneti útja is a mérésben van.
   * A felvétel a rAF-időket, a lapra érkező görgő-eseményeket és a hurok
   * rajzolásait gyűjti. A `stop()` összegzése ugyanaz, mint a gesztusoké; a
   * nyugvó képkocka itt a leghosszabb képkocka az utolsó görgő-lépés után
   * (abban rajzol a lap újra nyugalomban, a görgő-sorozat végét kivárva).
   */
  let recordingNow;

  async function startRecording(extras = {}) {
    await settleAt(origin);
    // A csendes lapról indul, ahogy a vis-összevetés is: ott a mérés a
    // `ready` után kezdődik (két egymást követő képkocka rajzolás nélkül),
    // itt is megvárja, hogy a hurok két képkockán át ne rajzoljon.
    for (let quiet = 0, waited = 0; quiet < 2 && waited < 300; waited += 1) {
      const drawn = counters().frames;
      await nextFrame();
      quiet = counters().frames === drawn ? quiet + 1 : 0;
    }
    const before = visibility();
    const token = extras.start?.();
    const frames = [];
    let recording = true;
    let wheels = 0;
    let lastWheelAt = -Infinity;
    const onWheel = () => {
      wheels += 1;
      lastWheelAt = performance.now();
    };
    frame.addEventListener("wheel", onWheel, { capture: true, passive: true });
    const record = (time) => {
      frames.push(time);
      if (recording) requestAnimationFrame(record);
    };
    const loopBefore = counters();
    requestAnimationFrame(record);
    recordingNow = {
      stop() {
        recording = false;
        frame.removeEventListener("wheel", onWheel, { capture: true });
        const after = frames.filter((time) => time > lastWheelAt);
        const tail = after.slice(1).map((time, index) => time - after[index]);
        const measured = summarize({
          frames,
          settleMs: tail.length === 0 ? 0 : Math.max(...tail),
          requests: wheels,
          draws: counters().frames - loopBefore.frames,
        });
        return {
          name: "zoom-wheel",
          before,
          after: visibility(),
          ...(extras.end?.(token) ?? {}),
          ...measured,
          frameTimes: frames.map((time) => Math.round(time)),
          lastWheelAt: Math.round(lastWheelAt),
        };
      },
    };
    return before;
  }

  /**
   * Egy forgatókönyv. `extras.start()` a mérés elején fut, `extras.end(token)`
   * a végén, és amit visszaad, a lap saját diagnosztikája (újrahorgonyzás,
   * leglassabb rajzolások) — a kapu azt nem méri.
   */
  async function scenario(name, extras = {}) {
    await settleAt(origin);
    if (name === "pan-labelled") {
      // A 2x-es nézet, ahol a címkék kiférnek.
      const middle = (origin[0] + origin[1]) / 2;
      const half = (origin[1] - origin[0]) / 4;
      await settleAt([middle - half, middle + half]);
    }
    await sleep(100);
    const before = visibility();
    const token = extras.start?.();
    let measured;
    if (name === "pan-long") {
      measured = await longPan();
    } else {
      const path = name === "zoom" ? pinchPath : name === "zoom-deep" ? deepPinchPath : panPath;
      measured = summarize(await performGesture(2000, path));
    }
    const after = visibility();
    return { name, before, after, ...(extras.end?.(token) ?? {}), ...measured };
  }

  return {
    visibility,
    performGesture,
    scenario,
    startRecording,
    stopRecording: () => recordingNow.stop(),
    get dispatched() {
      return dispatched;
    },
  };
}
