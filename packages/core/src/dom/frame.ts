/**
 * One draw per frame, however many reasons there were to draw.
 *
 * A touch digitiser reports at 120 Hz and more, a wheel can fire several
 * times between two frames, and every one of those events moves the
 * viewport. Drawing per event renders frames the screen never shows — and
 * the layout work of the ones it does show lands behind them. This loop
 * turns any number of requests into at most one draw, on the next animation
 * frame, with the latest state.
 *
 * Like the other bindings it finds the window through the element it is
 * given, never through a global.
 */

/** What the loop did, cumulatively. */
export interface FrameLoopStats {
  /** Times a draw was asked for. */
  readonly requests: number;
  /** Times it actually ran. At most one per animation frame. */
  readonly frames: number;
}

/** A frame loop. */
export interface FrameLoop {
  /** Ask for a draw on the next animation frame. Repeated calls coalesce. */
  request(): void;
  /** Draw now if a draw is pending, instead of waiting for the frame. */
  flush(): void;
  /** Whether a draw is waiting for the next frame. */
  readonly pending: boolean;
  readonly stats: FrameLoopStats;
  /** Cancel a pending draw and stop accepting requests. */
  destroy(): void;
}

/**
 * Coalesce draw requests into animation frames.
 *
 * `draw` receives the frame's timestamp. A request made *during* a draw is
 * not lost: it schedules the next frame, so a draw that changes state (an
 * animation step, a settling space) can ask for one more.
 */
export function createFrameLoop(target: Element, draw: (time: number) => void): FrameLoop {
  const view = target.ownerDocument.defaultView;
  let handle: number | undefined;
  let requests = 0;
  let frames = 0;
  let destroyed = false;

  function run(time: number): void {
    handle = undefined;
    frames += 1;
    draw(time);
  }

  return {
    request(): void {
      if (destroyed) {
        return;
      }
      requests += 1;
      if (handle !== undefined) {
        return;
      }
      if (view === null) {
        // A document without a window (a detached or server-side one) has no
        // frames to wait for. Drawing at once is the only way to draw.
        run(0);
        return;
      }
      handle = view.requestAnimationFrame(run);
    },
    flush(): void {
      if (handle === undefined) {
        return;
      }
      view?.cancelAnimationFrame(handle);
      run(view?.performance.now() ?? 0);
    },
    get pending() {
      return handle !== undefined;
    },
    get stats(): FrameLoopStats {
      return { requests, frames };
    },
    destroy(): void {
      destroyed = true;
      if (handle !== undefined) {
        view?.cancelAnimationFrame(handle);
        handle = undefined;
      }
    },
  };
}
