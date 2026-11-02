"use client";

import { Timeline, useTimelineState } from "@temporeum/timeline-react";
import { useState } from "react";

import { config, template, WIDTH } from "../shared/data.mjs";

export default function Demo() {
  const [timeline, setTimeline] = useState(null);
  const selected = useTimelineState(timeline, (snapshot) => snapshot.selectedIds);
  return (
    <>
      <Timeline
        {...config}
        template={template}
        ssrWidth={WIDTH}
        timelineRef={(instance) => {
          setTimeline(instance);
          // This is how the test knows the client has taken over the drawing.
          if (typeof window !== "undefined") window.__tl = instance;
        }}
      />
      <output id="selected">{(selected ?? []).join(",")}</output>
    </>
  );
}
