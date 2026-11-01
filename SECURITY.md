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

The packages in this repository: `@temporeum/timeline-core`, `@temporeum/timeline-element` and `@temporeum/timeline-react`. The most relevant areas:

- **Injection.** Item labels, lane labels, tooltips and accessible names are text, never HTML. A way to make the timeline run markup or script from data it was given is a vulnerability.
- **Server rendering.** `renderTimelineHtml` and `renderTimelineSvg` escape everything they write. A way to break out of the markup they produce is a vulnerability.
- **Denial of service.** Input that makes layout or rendering hang or grow without bound counts, as long as the input size is realistic.

The documentation site's live examples run in a sandboxed iframe. The playground running code you typed yourself is not a vulnerability.
