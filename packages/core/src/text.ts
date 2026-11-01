/**
 * Words the library says, filled in.
 *
 * Every phrase a timeline speaks — "23 items", "after Design (finish-to-start)",
 * "overbooked, 150% of capacity" — is a template in a dictionary, so a host
 * can replace each one. A template names its values in braces: `"{count}
 * items"`. Where a language changes the words with the number, a template is
 * a set of plural forms instead, keyed by `Intl.PluralRules` categories —
 * `{ one: "{count} item", other: "{count} items" }` — and the form is chosen
 * by the `count` value in the host's locale.
 *
 * Shared by the entry points that speak (`/gantt`, `/resources`, `/intl`),
 * and small on purpose: each of them pays for it.
 */

/** A phrase, or its plural forms by `Intl.PluralRules` category. `other` is the fallback. */
export type Phrase = string | (Readonly<Partial<Record<Intl.LDMLPluralRule, string>>> & { readonly other: string });

const plurals = new Map<string, Intl.PluralRules>();

/**
 * A phrase with its values in place. `{name}` is replaced by `values.name`
 * — a number as the locale writes it ({@link formatAmount}) — and a name
 * with no value is left as it is, so a missing value shows rather than
 * vanishing. Plural forms are chosen by `count`, a number.
 */
export function fill(phrase: Phrase, values: Readonly<Record<string, string | number>> = {}, locale = "en"): string {
  let template: string;
  if (typeof phrase === "string") {
    template = phrase;
  } else {
    let rules = plurals.get(locale);
    if (rules === undefined) plurals.set(locale, (rules = new Intl.PluralRules(locale)));
    template = phrase[rules.select(Number(values.count))] ?? phrase.other;
  }
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const value = values[name];
    return value === undefined ? whole : typeof value === "number" ? formatAmount(value, locale) : value;
  });
}

const numbers = new Map<string, Intl.NumberFormat>();

/** A number as the locale writes it: at most one decimal, or a percentage of a fraction. */
export function formatAmount(value: number, locale = "en", percent = false): string {
  const key = `${locale}\u0000${String(percent)}`;
  let format = numbers.get(key);
  if (format === undefined) {
    numbers.set(key, (format = new Intl.NumberFormat(locale, percent ? { style: "percent" } : { maximumFractionDigits: 1 })));
  }
  return format.format(value);
}
