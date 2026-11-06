/**
 * The script-tag builds, minified. A page that loads the UMD file from a CDN
 * runs it as it is, so it is minified here; the ESM and CommonJS builds are
 * left readable for the host's bundler, which minifies them itself.
 *
 * An output plugin: `output: { format: "umd", plugins: [minifyUmd()] }`. The
 * licence banner is kept, as the first line.
 */
import { minifySync } from "rolldown/experimental";

export function minifyUmd() {
  return {
    name: "minify-umd",
    renderChunk(code, chunk) {
      const banner = /^\/\*![^]*?\*\/\n?/.exec(code)?.[0] ?? "";
      const result = minifySync(chunk.fileName, code.slice(banner.length), { compress: true, mangle: true });
      if (result.errors !== undefined && result.errors.length > 0) {
        throw new Error(`minify ${chunk.fileName}: ${result.errors.map((error) => error.message).join("; ")}`);
      }
      // A CDN serves the file without a charset, and a page without
      // `<meta charset>` reads it as windows-1252: one `ß` in a glyph table was
      // a SyntaxError there, and a dash in a string came out mangled (V11).
      // Every non-ASCII character is written as its escape, which means the
      // same character in a string, a template, a regular expression, a
      // comment and an identifier. One after a backslash would not, so none may be.
      if (/\\[\u0080-\uffff]/.test(result.code)) throw new Error(`minify ${chunk.fileName}: a non-ASCII character after a backslash cannot be escaped safely`);
      const ascii = result.code.replace(/[\u0080-\uffff]/g, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`);
      return { code: `${banner}${ascii}`, map: null };
    },
  };
}
