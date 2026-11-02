// A server component: the Node side imports the package here. The drawing
// is in the client component, which Next renders on the server too.
import { renderTimelineSvg } from "@temporeum/timeline-element";

import { config } from "../shared/data.mjs";
import Demo from "./demo.jsx";

export const dynamic = "force-dynamic";

export default function Page() {
  // The server can draw here too, in a server component: the core needs no DOM.
  const options = renderTimelineSvg(config).result.layout.items.length;
  return (
    <main style={{ width: 960 }}>
      <h1 style={{ fontSize: 16 }}>Next smoke ({options} items)</h1>
      <Demo />
    </main>
  );
}
