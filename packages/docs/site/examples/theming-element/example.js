// Registers <temporeum-timeline>. With the UMD file in a <script> tag this
// line is not needed: the file registers the element when it loads.
import "@temporeum/timeline-element/define";

// Sizes are configuration, not CSS: the layout packs the rows and measures
// the labels with them. They can change like any other setting.
const timeline = document.querySelector("temporeum-timeline");
timeline.addEventListener("item-click", (event) => {
  console.log("clicked", event.detail.item.label);
});
