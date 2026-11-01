// A server component: the timeline is drawn on the server and hydrated.
// Callbacks are functions, so they come from a client component.
import { Timeline } from "@temporeum/timeline-react";

import { items, lanes } from "./data.js";

export default function Page() {
  return (
    <main>
      <h1 style={{ fontSize: 18, padding: "0 16px" }}>Release plan</h1>
      <Timeline items={items} lanes={lanes} height={320} ariaLabel="Release plan" />
    </main>
  );
}
