/**
 * The typed event bus every later phase publishes through.
 *
 * Three properties are deliberate, and each one is covered by a test:
 *
 * - **Dispatch is snapshotted.** A listener may subscribe or unsubscribe while
 *   an event is being delivered without corrupting the iteration: an addition
 *   is not seen by the event in flight, a removal takes effect at once.
 * - **One bad listener does not silence the rest.** A throwing listener is
 *   caught, the remaining listeners still run, and the error is reported — not
 *   swallowed. Swallowing is how a library earns a reputation for "sometimes
 *   nothing happens". With no error handler configured the error goes to the
 *   platform's own channel (`reportError`), never to `/dev/null`.
 * - **Unsubscribing is idempotent.** The function returned by `on` can be
 *   called any number of times, and it removes its own subscription only: the
 *   same function subscribed twice is delivered to once per event, as with
 *   `addEventListener`, and keeps listening until its last handle is called.
 *   `off` removes it outright, and so does `clear`, at once — even for the
 *   listeners an event in flight has still to reach.
 */

/** Receives one event payload. */
export type Listener<P> = (payload: P) => void;

/** Returned by `on`; calling it removes the listener. Safe to call twice. */
export type Unsubscribe = () => void;

/** Where a listener's error is reported, together with the event it came from. */
export type EmitterErrorHandler = (error: unknown, type: string) => void;

type ErasedListener = (payload: unknown) => void;

/**
 * Hands an escaped listener error to the environment's global error channel.
 *
 * `reportError` is exactly what the platform provides for this: it reaches
 * `window.onerror` and the devtools console without aborting the caller, so
 * the remaining listeners of the current dispatch are unaffected. Node has no
 * such global, so there the error is thrown from a microtask, which surfaces
 * it as an uncaught exception rather than losing it.
 */
function reportUnhandled(error: unknown): void {
  const report = globalThis.reportError;
  if (typeof report === "function") {
    report(error);
    return;
  }
  queueMicrotask(() => {
    throw error;
  });
}

/**
 * A typed event emitter: `M` maps each event name to its payload, so `on`
 * infers the listener's argument from the name and rejects an unknown one.
 * A listener that throws does not stop the others; its error goes to the
 * `onError` handler, or to the environment's error channel.
 */
export class Emitter<M extends object> {
  /** Each listener with its live handles, one token per `on`. */
  private readonly listeners = new Map<string, Map<ErasedListener, Set<object>>>();
  private readonly onError: EmitterErrorHandler | undefined;

  /**
   * @param onError Called once per throwing listener. Without it, the first
   * error of a dispatch is rethrown in a microtask, so it reaches the host's
   * global error handler instead of vanishing.
   */
  constructor(onError?: EmitterErrorHandler) {
    this.onError = onError;
  }

  on<K extends keyof M & string>(
    type: K,
    listener: Listener<M[K]>,
  ): Unsubscribe {
    const erased = listener as ErasedListener;
    const set = this.listeners.get(type) ?? new Map<ErasedListener, Set<object>>();
    this.listeners.set(type, set);
    // Its own token, so neither a second handle nor one left over from
    // before an `off` can take another subscription away.
    const token = {};
    const handles = (set.get(erased) ?? new Set<object>()).add(token);
    set.set(erased, handles);
    return () => {
      if (handles.delete(token) && handles.size === 0) this.removeErased(type, erased, handles);
    };
  }

  off<K extends keyof M & string>(type: K, listener: Listener<M[K]>): void {
    this.removeErased(type, listener as ErasedListener);
  }

  /** Subscribes for exactly one delivery. */
  once<K extends keyof M & string>(
    type: K,
    listener: Listener<M[K]>,
  ): Unsubscribe {
    const dispose = this.on(type, (payload: M[K]) => {
      dispose();
      listener(payload);
    });
    return dispose;
  }

  emit<K extends keyof M & string>(type: K, payload: M[K]): void {
    const set = this.listeners.get(type);
    if (set === undefined || set.size === 0) return;

    let firstError: { readonly error: unknown } | undefined;
    // Snapshot, plus a membership re-check. Together these give both halves of
    // what a host expects: a listener added during dispatch does not receive
    // the event in flight, and one removed during dispatch is not called at
    // all — the second is where Node's EventEmitter leaks a surprise.
    for (const listener of [...set.keys()]) {
      if (!set.has(listener)) continue;
      try {
        listener(payload);
      } catch (error: unknown) {
        if (this.onError !== undefined) {
          this.onError(error, type);
        } else if (firstError === undefined) {
          firstError = { error };
        }
      }
    }

    if (firstError !== undefined) reportUnhandled(firstError.error);
  }

  listenerCount(type?: keyof M & string): number {
    if (type !== undefined) return this.listeners.get(type)?.size ?? 0;
    let total = 0;
    for (const set of this.listeners.values()) total += set.size;
    return total;
  }

  /** Removes every listener, or every listener of one event. */
  clear(type?: keyof M & string): void {
    // Emptied, not only dropped: an event in flight re-checks membership
    // against the set it started with.
    for (const [key, set] of this.listeners) {
      if (type === undefined || key === type) {
        set.clear();
        this.listeners.delete(key);
      }
    }
  }

  /**
   * Removes a listener — when `handles` are given, only while they are still
   * its own, so a handle from before an `off` or a `clear` does nothing.
   */
  private removeErased(type: string, listener: ErasedListener, handles?: Set<object>): void {
    const set = this.listeners.get(type);
    if (set === undefined || (handles !== undefined && set.get(listener) !== handles)) return;
    set.delete(listener);
    if (set.size === 0) this.listeners.delete(type);
  }
}
