/**
 * Character references in text that came as HTML: a story's headlines, a
 * vis-timeline item's content. The core has no DOM to read them with, and
 * the whole HTML table is two thousand names, so this reads the numeric
 * references, every Latin-1 name (`&eacute;`, `&uuml;`, `&copy;` …), the
 * typographic ones a text editor writes (`&ndash;`, `&rsquo;`, `&hellip;` …)
 * and the double acutes of Hungarian (`&odblac;`). Any other name is left as
 * it is written.
 */

/** U+00A0 to U+00FF in order: the Latin-1 names. */
const LATIN1 =
  "nbsp iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy reg macr deg plusmn sup2 sup3 acute micro para middot cedil sup1 ordm raquo frac14 frac12 frac34 iquest Agrave Aacute Acirc Atilde Auml Aring AElig Ccedil Egrave Eacute Ecirc Euml Igrave Iacute Icirc Iuml ETH Ntilde Ograve Oacute Ocirc Otilde Ouml times Oslash Ugrave Uacute Ucirc Uuml Yacute THORN szlig agrave aacute acirc atilde auml aring aelig ccedil egrave eacute ecirc euml igrave iacute icirc iuml eth ntilde ograve oacute ocirc otilde ouml divide oslash ugrave uacute ucirc uuml yacute thorn yuml".split(
    " ",
  );

const NAMED: Readonly<Record<string, number>> = {
  quot: 34, amp: 38, apos: 39, lt: 60, gt: 62,
  Odblac: 336, odblac: 337, Udblac: 368, udblac: 369, OElig: 338, oelig: 339, Scaron: 352, scaron: 353,
  ndash: 8211, mdash: 8212, lsquo: 8216, rsquo: 8217, sbquo: 8218, ldquo: 8220, rdquo: 8221, bdquo: 8222,
  bull: 8226, hellip: 8230, euro: 8364, trade: 8482,
};

/** The text with its character references read; a reference to no character is U+FFFD, as in HTML. */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[\da-f]+|#\d+|[a-z][a-z\d]*);/gi, (whole, name: string) => {
    if (!name.startsWith("#")) {
      const at = LATIN1.indexOf(name);
      const code = at >= 0 ? 160 + at : Object.hasOwn(NAMED, name) ? NAMED[name] : undefined;
      return code === undefined ? whole : String.fromCodePoint(code);
    }
    const code = name[1] === "x" || name[1] === "X" ? Number.parseInt(name.slice(2), 16) : Number.parseInt(name.slice(1), 10);
    return code > 0 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff) ? String.fromCodePoint(code) : "�";
  });
}
