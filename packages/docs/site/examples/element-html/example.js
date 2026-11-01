// Registers <temporeum-timeline>. With the UMD file in a <script> tag this
// line is not needed: the file registers the element when it loads.
import "@temporeum/timeline-element/define";

const timeline = document.querySelector("temporeum-timeline");
timeline.addEventListener("item-click", (event) => {
  console.log("clicked", event.detail.item.label);
});
