# Accessibility conformance report

This is the library's accessibility conformance report (ACR) against **WCAG 2.2, levels A and AA**: every success criterion of those levels, what the timeline does about it, and the test that shows it. A criterion marked "Supports" names at least one test, and the release check runs every one of them and fails if any is not green; the table on this page and that check read the same file, `site/conformance/wcag22.json`, so the two cannot drift apart.

## Scope

What is assessed is the timeline as the library draws it — `@temporeum/timeline-element` and the core under it, with its views and tools, in the default configuration and with editing on — on the documentation's own pages, in Chromium. A timeline lives inside someone else's page, so the criteria about the page itself (its title, its language, its headings and links, help and navigation across a site) are the host's, and are marked "Not applicable" here with that reason. So are the ones about media, authentication and multi-step forms, which the library has none of.

The statuses are the ones accessibility conformance reports use: **Supports**, **Partially supports** (some of it, and the remark says which part does not), **Does not support**, and **Not applicable**. Where a remark begins "Not verified by a test", the status is what the code is meant to do, not what a test has shown, and it is never "Supports".

## The report

{{acr:wcag22}}

## What falls short

The "Partially supports" rows, in short: text-only zoom and text spacing are not tested; reflow is tested at 375 CSS pixels rather than WCAG's 320; panning with one pointer needs a drag, the wheel or the keys; moving or resizing an item without a drag takes the keyboard; a mouse target in the comfortable and compact layouts can be smaller than 24 pixels; a refused edit carries no message of the library's own, and a date the prompt cannot read gets no suggestion. Each is a known gap, not a hidden one; the [accessibility guide](guides/accessibility.md) says what a host can do about each in the meantime.
