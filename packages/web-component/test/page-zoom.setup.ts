import { afterEach, expect } from "vitest";

/**
 * Every browser test leaves the page at the zoom it found. A Ctrl+wheel the
 * timeline does not take (zoom switched off, say) is the browser's, and
 * Firefox on Linux zooms the whole page with it: the tests after it then
 * send their pointer to the wrong place, files later. This says which test
 * did it, at once.
 */
const width = parent.innerWidth;

afterEach((context) => {
  expect(parent.innerWidth, `"${context.task.name}" left the page zoomed`).toBe(width);
});
