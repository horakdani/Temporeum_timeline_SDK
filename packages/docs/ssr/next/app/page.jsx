// Szerverkomponens: a Node-oldal itt importálja a csomagot. A rajz a
// kliens-komponensben van, amit a Next a szerveren is renderel.
import { renderTimelineSvg } from "@temporeum/timeline-element";

import { config } from "../shared/data.mjs";
import Demo from "./demo.jsx";

export const dynamic = "force-dynamic";

export default function Page() {
  // A szerver itt, egy szerverkomponensben is tud rajzolni: a mag DOM-mentes.
  const options = renderTimelineSvg(config).result.layout.items.length;
  return (
    <main style={{ width: 960 }}>
      <h1 style={{ fontSize: 16 }}>Next smoke ({options} elem)</h1>
      <Demo />
    </main>
  );
}
