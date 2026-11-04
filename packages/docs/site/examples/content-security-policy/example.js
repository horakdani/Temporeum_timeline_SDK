import { createTimeline } from "@temporeum/timeline-element";
import { mountStory } from "@temporeum/timeline-element/story";

// The policy, before anything is drawn: no inline style at all, and HTML only through a named policy.
const policy = document.createElement("meta");
policy.httpEquiv = "Content-Security-Policy";
policy.content = "style-src 'none'; require-trusted-types-for 'script'; trusted-types temporeum-timeline my-app";
document.head.append(policy);

const violations = [];
document.addEventListener("securitypolicyviolation", (event) => violations.push(event.violatedDirective));

const day = 86_400_000;
const start = Date.UTC(2026, 0, 5);
const timeline = createTimeline(document.querySelector("#timeline"), {
  items: [
    { id: "draft", start: start + day, end: start + 4 * day, label: "Draft" },
    { id: "review", start: start + 5 * day, end: start + 8 * day, label: "Review" },
    { id: "ship", start: start + 10 * day, label: "Ship" },
  ],
  domain: [start, start + 14 * day],
});

// The page's own Trusted Types policy, for the story's HTML; without it, the library's `temporeum-timeline`.
const myApp = /** @type {any} */ (window).trustedTypes.createPolicy("my-app", { createHTML: (input) => input });
mountStory(document.querySelector("#story"), timeline, {
  title: { headline: "A <em>strict</em> page", text: "<p>No inline style, and no HTML without a policy.</p>" },
  trustedTypesPolicy: myApp,
});

// A violation is reported in a task of its own.
setTimeout(() => {
  const result = document.querySelector("#result");
  result.dataset.violations = String(violations.length);
  result.textContent = violations.length === 0 ? "No policy violation." : `Violations: ${violations.join(", ")}`;
}, 300);
