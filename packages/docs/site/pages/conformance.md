# Accessibility conformance report

This is the library's accessibility conformance report (ACR) against **WCAG 2.2, levels A and AA**: every success criterion of those levels, what the timeline does about it, and the test that shows it. A criterion marked "Supports" names at least one test, and the conformance check (`node scripts/sdk_check_acr.mjs`, run before each release) runs every one of them and fails if any is not green; the table on this page and that check read the same file, `site/conformance/wcag22.json`, so the two cannot drift apart. The same report, in the layout procurement asks for — the ITI VPAT® 2.5, International Edition, with the Revised Section 508 and EN 301 549 — is the [VPAT](vpat.md), generated from the same file.

## Scope

What is assessed is the timeline as the library draws it — `@temporeum/timeline-element` and the core under it, with its views and tools, in the default configuration and with editing on — on the documentation's own pages, in Chromium. A timeline lives inside someone else's page, so the criteria about the page itself (its title, its language, its headings and links, help and navigation across a site) are the host's, and are marked "Not applicable" here with that reason. So are the ones about media, authentication and multi-step forms, which the library has none of.

The statuses are the ones accessibility conformance reports use: **Supports**, **Partially supports** (some of it, and the remark says which part does not), **Does not support**, and **Not applicable**. Where a remark begins "Not verified by a test", the status is what the code is meant to do, not what a test has shown, and it is never "Supports".

## The report

{{acr:wcag22}}

## What falls short

The "Partially supports" rows, in short: panning with one pointer needs a drag, the wheel or the keys; moving or resizing an item without a drag takes the keyboard; a mouse target in the comfortable and compact layouts can be smaller than 24 pixels; a refused edit carries no message of the library's own, and a date the prompt cannot read gets no suggestion. Three limits stand under a "Supports": under WCAG's text spacing the element measures its labels with the reader's spacing, but a host that draws with the core's renderer and passes no `measureText` gets labels fitted by an estimate that knows no spacing, which then end in an ellipsis (never cut through a letter, the whole text in the item's name) (1.4.12); text-only enlargement does not reach the timeline's text, whose sizes are pixels — the browser's zoom is what enlarges it (1.4.4); and at 320 pixels the lanes can be wider than the view and scroll across inside the timeline, the keys bringing the focused item into view (1.4.10). And one thing has not been done at all: a manual test with a screen reader. Each is a known gap, not a hidden one; the [accessibility guide](guides/accessibility.md) says what a host can do about each in the meantime.
