/**
 * Trusted Types.
 *
 * The one place the element hands a string to an HTML sink is the story's
 * inert parse: TimelineJS's HTML goes into a `<template>`, which runs
 * nothing, and only its safe part is copied out, node by node
 * (`storyHtml`). Under `require-trusted-types-for 'script'` that sink needs
 * a `TrustedHTML`, which comes from the host's policy when it gives one,
 * and from a `temporeum-timeline` policy otherwise — the name a page's
 * `trusted-types` directive then lists.
 *
 * The policy is kept here, never on the window: a policy that passes its
 * input through is safe only in the hands that use it for an inert parse.
 */

/** What the element needs of a Trusted Types policy. */
export interface TrustedHtmlPolicy {
  /** The markup as a `TrustedHTML`. */
  createHTML(input: string): unknown;
}

/** The name of the element's own policy, for a page's `trusted-types` directive. */
export const TRUSTED_TYPES_POLICY = "temporeum-timeline";

interface PolicyFactory {
  createPolicy(name: string, rules: { createHTML(input: string): string }): TrustedHtmlPolicy;
}

/** Each window's policy; `null` where the page would not let it be made. */
const policies = new WeakMap<object, TrustedHtmlPolicy | null>();

/**
 * Markup for an inert parse: through `policy`, or through the element's
 * own where the browser has Trusted Types, or as it is.
 *
 * A page whose `trusted-types` directive does not list the name, or a
 * second copy of the library without `'allow-duplicates'`, makes no policy:
 * the string goes as it is, which works where Trusted Types are not
 * required, and where they are, the browser's own error names the sink.
 */
export function trustedHtml(win: Window | null, html: string, policy?: TrustedHtmlPolicy): string {
  if (policy !== undefined) return policy.createHTML(html) as string;
  const factory = (win as { trustedTypes?: PolicyFactory } | null)?.trustedTypes;
  if (win === null || factory === undefined) return html;
  let own = policies.get(win);
  if (own === undefined) {
    try {
      own = factory.createPolicy(TRUSTED_TYPES_POLICY, { createHTML: (input) => input });
    } catch {
      own = null;
    }
    policies.set(win, own);
  }
  return own === null ? html : (own.createHTML(html) as string);
}
