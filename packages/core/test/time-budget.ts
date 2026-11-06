/**
 * The wall-clock budget of a "finishes in time" test (V30).
 *
 * Each of these guards a quadratic or exponential slip whose old code ran for
 * tens of seconds to minutes, so the budget is far from both. It was measured
 * on a laptop, though: under coverage — V8 instruments every line — and on a
 * CI runner of two vCPUs with parallel workers, the same work takes several
 * times longer. The budget grows with each (twice under coverage, twice in
 * CI), never near what the old code took.
 */
const factor = (process.env.TL_COVERAGE === "1" ? 2 : 1) * (process.env.CI === "true" || process.env.CI === "1" ? 2 : 1);

/** `ms`, for this run. */
export const budgetMs = (ms: number): number => ms * factor;
