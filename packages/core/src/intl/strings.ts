/**
 * The dictionary's translation tools. The dictionary itself — the English
 * defaults, `resolveStrings` and `sayIn` — is `/words`, which a
 * timeline loads without this entry point; it is exported here too.
 */

import { DEFAULT_STRINGS } from "../shared/dictionary.js";
import type { Strings } from "../shared/dictionary.js";
import type { Phrase } from "../text.js";

export { DEFAULT_STRINGS, resolveStrings, sayIn } from "../shared/dictionary.js";
export type { Strings } from "../shared/dictionary.js";

/** Where a pseudo-translated phrase begins. */
export const PSEUDO_OPEN = "⟦";
/** Where a pseudo-translated phrase ends. */
export const PSEUDO_CLOSE = "⟧";

function pseudo(template: string): string {
  return `${PSEUDO_OPEN}${template}${PSEUDO_CLOSE}`;
}

/**
 * Every phrase of a dictionary between ⟦ and ⟧, the values still in place.
 *
 * The test of a translation's reach: a frame drawn with these words shows
 * every phrase the library said marked, and any text that is neither marked,
 * nor the host's, nor a date or number is a word the dictionary missed.
 */
export function pseudoStrings(strings: Strings = DEFAULT_STRINGS): Strings {
  const out: Record<string, Phrase> = {};
  for (const [key, phrase] of Object.entries(strings) as [string, Phrase][]) {
    out[key] =
      typeof phrase === "string"
        ? pseudo(phrase)
        : (Object.fromEntries(Object.entries(phrase).map(([form, text]) => [form, pseudo(text)])) as Phrase);
  }
  return out as Strings;
}
