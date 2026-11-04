# Security policy

## Supported versions

| Version | Security fixes |
|---|---|
| 1.x (latest minor) | Yes |
| Older minors of 1.x | Upgrade to the latest minor; it is backwards compatible |
| Release candidates (`1.0.0-rc.*`) | No |

## Reporting a vulnerability

**Do not open a public issue.** Report it privately through GitHub: on the repository's **Security** tab, choose **Report a vulnerability**. The report reaches only the maintainers.

Please include:

- the affected package(s) and version(s),
- what an attacker can do, and under which configuration,
- a minimal reproduction, if you have one.

## What happens next

- We acknowledge the report within **5 working days**.
- We confirm or dispute it, and agree on a timeline with you, within **14 days**.
- When fixed, we publish a patch release with npm provenance and a GitHub security advisory that credits you, unless you prefer otherwise.

## What is in scope

The packages in this repository: `@temporeum/timeline-core`, `@temporeum/timeline-element`, and the four framework components — `@temporeum/timeline-react`, `@temporeum/timeline-vue`, `@temporeum/timeline-svelte` and `@temporeum/timeline-angular`. The most relevant areas:

- **Injection.** Item labels, lane labels, tooltips and accessible names are text, never HTML. A way to make the timeline run markup or script from data it was given is a vulnerability.
- **Templates.** An item `template` returns HTML, and the timeline sanitises it: scripts, event handlers, `javascript:` and other unsafe URLs, and anything outside the allow-list are dropped. A way past the sanitiser with the default `templateOptions` is a vulnerability.
- **Server rendering.** `renderTimelineHtml` and `renderTimelineSvg` escape everything they write. A way to break out of the markup they produce is a vulnerability.
- **Content Security Policy and Trusted Types.** The timeline runs under `style-src 'self'` and `require-trusted-types-for 'script'`, with no `'unsafe-inline'` and no `'unsafe-eval'` ([the policy it needs](https://horakdani.github.io/Temporeum_timeline_SDK/guides/content-security-policy.html)). A way to make it need a weaker policy, or to make its `temporeum-timeline` Trusted Types policy pass markup anywhere but into its own inert parse, is a vulnerability.
- **Denial of service.** Input that makes layout or rendering hang or grow without bound counts, as long as the input size is realistic.

Not vulnerabilities, because they are the host's own code by design:

- `templateOptions: { sanitize: false }`, and `allowTags` / `allowAttributes` widened by the host. They are for a template the host wrote from data it trusts; with data it does not, keep the default.
- The render hooks (`hooks`), the framework components' item content (`renderItem`, the `#item` slot, the `item` snippet, `tlItem`) and a host's own Trusted Types policy (`trustedTypesPolicy`): they run the host's code, with the host's rights.
- The documentation site's playground running code you typed yourself. Its live examples run in a sandboxed iframe.
