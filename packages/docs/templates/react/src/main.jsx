import { registerPlugin } from "@temporeum/timeline-element";
import { itemsPlugin } from "@temporeum/timeline-element/items";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "./App.jsx";

// Once, before the first timeline: the items plugin draws the boxes `renderItem` fills.
registerPlugin(itemsPlugin);

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
