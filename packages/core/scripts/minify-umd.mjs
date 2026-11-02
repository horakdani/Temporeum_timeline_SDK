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
      return { code: `${banner}${result.code}`, map: null };
    },
  };
}
