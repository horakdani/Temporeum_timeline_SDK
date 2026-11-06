# Content Security Policy

The timeline runs under a strict Content-Security-Policy and under Trusted Types, with nothing loosened for it: no `'unsafe-inline'` for styles, no `'unsafe-eval'`, and no HTML string reaches the DOM except through a policy you allow. A browser test runs the element, `createTimeline`, the group tree, a story, the print view and the PNG export under such a policy on every check, and fails on any `securitypolicyviolation`.

::: example content-security-policy

The example sets `style-src 'none'` — stricter than a page needs — and Trusted Types on its own frame before it draws, and counts the violations: there are none.

## The policy

This is enough for everything the library does:

```text
Content-Security-Policy:
  style-src 'self';
  img-src 'self' blob:;
  require-trusted-types-for 'script';
  trusted-types temporeum-timeline
```

- **`style-src` needs nothing of yours.** In a browser every stylesheet the timeline brings — the drawing's, the element's, the group tree's, the story's, the print view's — is a constructed sheet in the `adoptedStyleSheets` of the document or the shadow root, and every inline style is written through the CSSOM (`element.style`). A policy allows both; neither needs `'unsafe-inline'`, a nonce or a hash.
- **`img-src blob:`** is for `exportPng()`: the frame goes through an `<img>` from a `blob:` URL onto a canvas. A page that never exports a PNG does not need it.
- **`trusted-types temporeum-timeline`** names the one policy the library makes. Its only use is the story's parse of TimelineJS's HTML: the markup goes into a `<template>`, which runs nothing, and only its safe part — text, emphasis, paragraphs, lists, quotes and links — is copied out, node by node. The policy is kept inside the library, never on the window, so no other script can use it. The drawing, the group tree, the print view and the wrappers on the client write no HTML at all: they build with the DOM.

## A story's media

A story's players and pictures load from their providers, when the reader asks for them. Allow what your stories use:

```text
frame-src https://www.youtube-nocookie.com https://player.vimeo.com
          https://w.soundcloud.com https://open.spotify.com https://www.google.com;
img-src 'self' blob: https:;
connect-src 'self' https://docs.google.com
```

`frame-src` is for the players (YouTube without cookies, Vimeo, SoundCloud, Spotify, a Google map), `img-src https:` for pictures from any address, and `connect-src https://docs.google.com` for a page that fetches a Google Sheet from the address `sheetCsvUrl` gives it. A story with none of these needs none of them.

## Your own Trusted Types policy

A page whose `trusted-types` directive lists only its own policies can hand one to the story instead of allowing `temporeum-timeline`:

```js excerpt:example/content-security-policy
const myApp = /** @type {any} */ (window).trustedTypes.createPolicy("my-app", { createHTML: (input) => input });
mountStory(document.querySelector("#story"), timeline, {
  // …
  trustedTypesPolicy: myApp,
});
```

Give the story a policy that passes markup through only if you would trust the story's source with it; the story itself only ever parses it inertly. Without a policy of its own and without `temporeum-timeline` in the directive, the story's parse is the one thing that fails, with the browser's own error naming the sink. Two copies of the library on one page make the policy twice, which the directive allows with `'allow-duplicates'`.

## The nonce

A nonce is needed in two places only, both of which write a real `<style>`:

- **Server rendering.** The server's markup carries its stylesheets as `<style>`s. Give the configuration the request's nonce, and every `<style>` it prints — the element's, the drawing's, the group tree's — carries it; `renderTimelineHtml` puts it on the element too, where the client reads it, and leaves it out of the JSON beside it. Inline `style` attributes in the server's markup are not covered by a nonce: under `style-src` without `'unsafe-inline'` they apply once the client takes the drawing over, which writes each one again through the CSSOM. Until then the browser blocks each of them, and each is a violation: with `report-uri` or `report-to`, one report per attribute on every page view — the host's `--tl-height`, the group tree's rows, a Gantt bar's progress and baseline, a dependency arrow. Before the client takes over, the box is the default 300 px tall whatever `height` says, the group tree is not positioned, and a Gantt progress bar is drawn in the SVG default, black. To keep the reports quiet, allow those attributes with `style-src-attr 'unsafe-inline'` (it permits `style` attributes only, not `<style>` elements or scripts), or give the server-rendered page a policy without a report endpoint for `style-src-attr`; a timeline rendered only on the client writes no inline attribute the browser checks.
- **A browser without constructable stylesheets.** There the timeline falls back to `<style>`s, each with the nonce.

On the server it is `renderTimelineHtml({ ...config, nonce })` with the request's nonce, and the same for `renderTimelineSvg`; in the light DOM `createTimeline(container, { ...config, nonce })`; on the element the `nonce` attribute — which the browser hides from the attribute once the element is in the document, and the element reads from the property. The story, the backlog and the task grid take the nonce from the timeline they are mounted beside (`timeline.nonce`); the calendar view, which stands alone, has its own `nonce` option. The wrappers pass `nonce` through as any other option.

## Frameworks

React, Vue, Svelte and Angular print the server's drawing as markup, and on the client none of them writes it again: hydrating, each takes the server's nodes as they are, and a client-only render leaves the box empty for the instance to draw with the DOM. Under `require-trusted-types-for 'script'` that is tested for React and Svelte; Vue and Angular set the markup on the server only.
