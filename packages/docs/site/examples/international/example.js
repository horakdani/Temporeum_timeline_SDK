import { createTimeline, registerPlugin } from "@temporeum/timeline-element";
import { intlPlugin } from "@temporeum/timeline-element/intl";
import { toolsPlugin } from "@temporeum/timeline-element/tools";

// Other languages, directions and calendars are a plugin, and so are the
// tooltip and the zoom presets: registered once, before the first timeline.
registerPlugin(intlPlugin, toolsPlugin);

const day = 86_400_000;
const start = Date.UTC(2026, 2, 2);
const at = (days) => start + days * day;

// Each language: its words for the parts of the timeline you see here, its
// calendar, and its names for the lanes and items. Dates and numbers come
// from Intl in the locale.
const languages = {
  he: {
    locale: "he",
    calendar: "hebrew",
    strings: { timeline: "תוכנית הרבעון", zoom: "זום", zoomDay: "יום", zoomWeek: "שבוע", zoomMonth: "חודש", zoomYear: "שנה", range: "{start} – {end}", newItem: "פריט חדש",
      cluster: { one: "פריט אחד", two: "שני פריטים", other: "{count} פריטים" } },
    lanes: ["עיצוב", "פיתוח"],
    items: ["מחקר", "אב טיפוס", "בנייה", "בדיקות", "השקה"],
  },
  ar: {
    locale: "ar",
    calendar: "islamic-umalqura",
    strings: { timeline: "خطة الربع", zoom: "تكبير", zoomDay: "يوم", zoomWeek: "أسبوع", zoomMonth: "شهر", zoomYear: "سنة", newItem: "عنصر جديد" },
    lanes: ["التصميم", "التطوير"],
    items: ["بحث", "نموذج أولي", "بناء", "اختبار", "إطلاق"],
  },
  fa: {
    locale: "fa",
    calendar: "persian",
    strings: { timeline: "برنامه فصل", zoom: "بزرگنمایی", zoomDay: "روز", zoomWeek: "هفته", zoomMonth: "ماه", zoomYear: "سال", newItem: "مورد جدید" },
    lanes: ["طراحی", "توسعه"],
    items: ["پژوهش", "نمونه اولیه", "ساخت", "آزمون", "انتشار"],
  },
};

function configOf(language) {
  const { locale, calendar, strings, lanes, items } = languages[language];
  return {
    locale,
    calendar,
    strings,
    direction: "rtl",
    lanes: [
      { id: "design", label: lanes[0] },
      { id: "build", label: lanes[1] },
    ],
    items: [
      { id: "research", label: items[0], start: at(0), end: at(12), laneId: "design" },
      { id: "prototype", label: items[1], start: at(10), end: at(30), laneId: "design" },
      { id: "build", label: items[2], start: at(24), end: at(62), laneId: "build" },
      { id: "test", label: items[3], start: at(55), end: at(80), laneId: "build" },
      { id: "launch", label: items[4], start: at(84), laneId: "design" },
    ],
    domain: [at(-5), at(95)],
    timeZone: "UTC",
    zoomPresets: true,
    tooltip: true,
  };
}

const timeline = createTimeline(document.querySelector("#timeline"), configOf("he"));
const log = document.querySelector("#log");

for (const button of document.querySelectorAll("[data-language]")) {
  button.addEventListener("click", () => {
    timeline.update(configOf(button.dataset.language));
    log.textContent = `${button.textContent}.`;
  });
}
