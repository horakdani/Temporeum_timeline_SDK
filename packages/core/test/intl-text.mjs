/**
 * Text the platform's Intl writes, made comparable across ICU versions.
 *
 * The visual and right-to-left fixtures are compared byte for byte, and
 * their accessible names hold dates the platform formats. ICU updates have
 * changed the spaces in them more than once — a narrow no-break space
 * before AM/PM, a thin space around a range's dash — without anything in
 * the drawing changing. This turns every such space into a plain one and
 * spaces a dash one way, on both sides of the comparison: a changed
 * character, digit or word still differs.
 *
 * Plain JavaScript, so the snapshot scripts (Node, no TypeScript) and the
 * suites read the same rule.
 */
export function intlStable(text) {
  return text.replace(/[   ]/gu, " ").replace(/ ?([–—]) ?/gu, " $1 ");
}
