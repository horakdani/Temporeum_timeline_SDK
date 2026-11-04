/**
 * `@temporeum/timeline-core/words` — the library's words in English, and
 * the filler that writes them.
 *
 * Its own entry point: a timeline speaks English without `/intl`,
 * which holds what another language, direction or calendar needs. `/intl`
 * exports all of this too — the same objects, from the shared module
 * (`src/shared/dictionary.ts`), so that neither entry point carries the other's
 * own code.
 */
export { DEFAULT_STRINGS, fill, formatAmount, resolveStrings, sayIn } from "../shared/dictionary.js";
export type { Phrase, Strings } from "../shared/dictionary.js";
