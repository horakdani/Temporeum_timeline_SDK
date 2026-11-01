/**
 * A small property-based testing harness.
 *
 * Written rather than depended on, for two reasons. The campaign pins its
 * toolchain to current versions after two critical advisories came in with a
 * set of pins from my knowledge cutoff, so every new dev dependency is a cost
 * to weigh; and the properties here need about sixty lines of generator, with
 * shrinking that is a greedy item-removal loop. A library would be the right
 * call the moment the generators get interesting — that trade is recorded in
 * the P2 report rather than hidden here.
 *
 * What it does give is the two things a property test is worthless without:
 * a **printed seed** so a failure is reproducible, and **shrinking** so the
 * counterexample is small enough to read.
 */

import { writeFileSync } from "node:fs";

import { resolveSpan } from "../../src/layout.js";
import type { Granularity, Item, Lane, PackMode } from "../../src/types.js";

/** Deterministic PRNG (mulberry32): same seed, same cases, every run. */
export function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * One generated problem.
 *
 * `steps` is what turns this from a layout generator into a state-machine
 * generator: a property about editing is not about one input but about a
 * *sequence* applied to one, and the shrinker has to be able to drop a step
 * as readily as an item. Keeping both in one case keeps one runner, one
 * report format and one shrinker — the trade against a dedicated library is
 * recorded in the P2 report and still open.
 */
export interface GeneratedCase<S = never> {
  readonly items: readonly Item[];
  readonly lanes?: readonly Lane[];
  readonly packMode?: PackMode;
  readonly steps?: readonly S[];
}

const GRANULARITIES: readonly Granularity[] = ["millisecond", "hour", "day", "month", "year"];
const DAY = 86_400_000;
const ORIGIN = Date.UTC(2020, 0, 1);

export interface GeneratorOptions {
  /** Allow items with no known end. */
  readonly open?: boolean;
  /** Allow items taller than one sublane. */
  readonly tall?: boolean;
  /** Allow a per-item granularity, which gives an item its unit's extent. */
  readonly granularity?: boolean;
  /** How many lanes to spread items over. */
  readonly lanes?: number;
  /**
   * Keep at most one item per resolved start inside a lane.
   *
   * Two items in a lane starting at the same instant are interchangeable, and
   * which one takes the lower row is the one thing input order is allowed to
   * decide — including for the items placed after them. A property about
   * order independence is only well defined without such ties, so the
   * generator removes them rather than the property skipping cases.
   */
  readonly distinctStarts?: boolean;
}

/** A random set of items, deliberately full of the awkward cases. */
export function generateCase(random: () => number, options: GeneratorOptions = {}): GeneratedCase {
  const laneCount = options.lanes ?? 1;
  const count = Math.floor(random() * 24);
  const items: Item[] = [];
  for (let index = 0; index < count; index += 1) {
    const start = ORIGIN + Math.floor(random() * 400) * DAY + Math.floor(random() * DAY);
    const roll = random();
    const item: {
      id: string;
      start: number;
      end?: number;
      open?: boolean;
      laneId?: string;
      sublaneSpan?: number;
      granularity?: Granularity;
    } = { id: `i${String(index)}`, start };

    if (roll < 0.15) {
      // An instant: no end at all.
    } else if (options.open === true && roll < 0.25) {
      item.open = true;
    } else {
      // Zero-length and inverted intervals are in range on purpose.
      item.end = start + Math.floor(random() * 30 - 2) * DAY;
    }
    if (laneCount > 1) {
      item.laneId = `lane${String(Math.floor(random() * laneCount))}`;
    }
    if (options.tall === true && random() < 0.2) {
      item.sublaneSpan = 1 + Math.floor(random() * 3);
    }
    if (options.granularity === true && random() < 0.4) {
      const picked = GRANULARITIES[Math.floor(random() * GRANULARITIES.length)];
      if (picked !== undefined) {
        item.granularity = picked;
      }
    }
    items.push(item as Item);
  }
  if (options.distinctStarts === true) {
    const seen = new Set<string>();
    return {
      items: items.filter((candidate) => {
        const key = `${candidate.laneId ?? ""}@${String(resolveSpan(candidate).start)}`;
        if (seen.has(key)) {
          return false;
        }
        seen.add(key);
        return true;
      }),
    };
  }
  return { items };
}

/** What a property run reports, and what the gate script reads. */
export interface PropertyResult {
  readonly name: string;
  readonly cases: number;
  readonly seed: number;
  readonly passed: boolean;
  readonly counterexample?: unknown;
}

const results: PropertyResult[] = [];

/** Every property run so far, in order. */
export function propertyResults(): readonly PropertyResult[] {
  return results;
}

/**
 * Write this file's property results where the gate reads them.
 *
 * One report per test file, named after it. A single shared path looks
 * tidier and is wrong: vitest gives each test file its own module registry,
 * so two files would each hold their own results and the second one to finish
 * would overwrite the first's report. The gate would then see fewer
 * properties than actually ran — which is exactly what happened when the
 * second property file was added in P3.
 */
export function writePropertyReport(suite: string): void {
  writeFileSync(
    `.property-report-${suite}.json`,
    `${JSON.stringify(propertyResults(), null, 2)}\n`,
  );
}

/**
 * Run a property over generated cases, shrink any failure, and record it.
 *
 * `check` returns a reason string when the property is violated, or undefined
 * when it holds. Returning a reason rather than throwing is what makes
 * shrinking possible: the loop needs to ask "does it still fail?" cheaply.
 */
export function forAll<S = never>(
  name: string,
  cases: number,
  seed: number,
  generate: (random: () => number) => GeneratedCase<S>,
  check: (generated: GeneratedCase<S>) => string | undefined,
): void {
  const random = makeRandom(seed);
  for (let index = 0; index < cases; index += 1) {
    const generated = generate(random);
    const reason = check(generated);
    if (reason !== undefined) {
      const shrunk = shrink(generated, check);
      // The reason is read off the SHRUNK case, so the message and the input
      // printed under it describe the same failure.
      const shrunkReason = check(shrunk) ?? reason;
      results.push({
        name,
        cases: index + 1,
        seed,
        passed: false,
        counterexample: {
          reason: shrunkReason,
          items: shrunk.items,
          lanes: shrunk.lanes,
          steps: shrunk.steps,
        },
      });
      throw new Error(
        `Property "${name}" failed on case ${String(index + 1)} (seed ${String(seed)}): ${shrunkReason}\n` +
          `Smallest failing input: ${JSON.stringify({ items: shrunk.items, steps: shrunk.steps })}`,
      );
    }
  }
  results.push({ name, cases, seed, passed: true });
}

/**
 * Greedily drop items, then steps, while the property still fails.
 *
 * Steps are dropped last on purpose: a failing sequence usually has one
 * guilty step, and removing the items it does not touch first makes that step
 * readable before the loop starts taking steps away.
 */
function shrink<S>(
  generated: GeneratedCase<S>,
  check: (generated: GeneratedCase<S>) => string | undefined,
): GeneratedCase<S> {
  let best = generated;
  let improved = true;
  while (improved) {
    improved = false;
    for (let index = 0; index < best.items.length; index += 1) {
      const candidate: GeneratedCase<S> = {
        ...best,
        items: best.items.filter((_, position) => position !== index),
      };
      if (check(candidate) !== undefined) {
        best = candidate;
        improved = true;
        break;
      }
    }
    if (improved) {
      continue;
    }
    const steps = best.steps ?? [];
    for (let index = 0; index < steps.length; index += 1) {
      const candidate: GeneratedCase<S> = {
        ...best,
        steps: steps.filter((_, position) => position !== index),
      };
      if (check(candidate) !== undefined) {
        best = candidate;
        improved = true;
        break;
      }
    }
  }
  return best;
}
