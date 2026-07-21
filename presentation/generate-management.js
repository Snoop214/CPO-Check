const pptxgen = require("pptxgenjs");

const pptx = new pptxgen();
pptx.defineLayout({ name: "TALABAT", width: 10, height: 5.63 });
pptx.layout = "TALABAT";

var COLORS = {
  orange: "FF5A00", burgundy: "411517", cream: "F4EDE3", white: "FFFFFF",
  lime: "CFFF00", darkGray: "343B46", mediumGray: "595959",
  blue: "2d5bff", green: "2e8b57", red: "C41E1E", teal: "0d9488",
  yellowOrange: "f0883e", purple: "a371f7", lightGreen: "1A7F4B"
};

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function addAccentBar(slide) {
  slide.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
    x: 0.42, y: 0.0, w: 1.20, h: 0.07,
    fill: { color: COLORS.orange }, line: { width: 0 }, rotate: 180, rectRadius: 0.02
  });
}

function addSlideTitle(slide, text, color) {
  slide.addText(text, {
    x: 0.36, y: 0.18, w: 9.41, h: 0.60,
    fontFace: "Poppins", fontSize: 24, bold: true, color: color || COLORS.orange, align: "left"
  });
}

function addSubtitle(slide, text, y) {
  slide.addText(text, {
    x: 0.36, y: y || 0.75, w: 9.41, h: 0.30,
    fontFace: "Poppins", fontSize: 11, color: COLORS.mediumGray, align: "left"
  });
}

function sectionDivider(line1, line2) {
  var s = pptx.addSlide();
  s.background = { color: COLORS.orange };
  s.addText([
    { text: line1 + "\n", options: { color: COLORS.cream } },
    { text: line2, options: { color: COLORS.lime } }
  ], { x: 0.42, y: 1.50, w: 9.00, h: 2.50, fontFace: "Poppins", bold: true, fontSize: 44 });
  return s;
}

function callout(slide, x, y, w, items) {
  var yy = y;
  items.forEach(function(item) {
    slide.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
      x: x, y: yy, w: w, h: item.h || 0.55,
      fill: { color: COLORS.white }, line: { color: "E0D6CC", width: 0.5 }, rectRadius: 0.06
    });
    slide.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
      x: x, y: yy, w: 0.06, h: item.h || 0.55,
      fill: { color: item.color || COLORS.orange }, rectRadius: 0
    });
    slide.addText([
      { text: item.title + "\n", options: { fontSize: 10, bold: true, color: item.color || COLORS.orange } },
      { text: item.desc, options: { fontSize: 9, color: COLORS.burgundy } }
    ], { x: x + 0.16, y: yy + 0.04, w: w - 0.24, h: (item.h || 0.55) - 0.08, fontFace: "Poppins", valign: "top" });
    yy += (item.h || 0.55) + 0.10;
  });
}

function addCard(slide, x, y, w, h, topColor) {
  slide.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
    x: x, y: y, w: w, h: h,
    fill: { color: COLORS.white }, line: { color: "E0D6CC", width: 1 }, rectRadius: 0.1
  });
  if (topColor) {
    slide.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
      x: x, y: y, w: w, h: 0.08, fill: { color: topColor }, rectRadius: 0
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SLIDE 1: COVER
// ═══════════════════════════════════════════════════════════════════════════════
var s1 = pptx.addSlide();
s1.background = { color: COLORS.orange };
s1.addText([
  { text: "COST PER ORDER\n", options: { color: COLORS.burgundy, fontFace: "Poppins", fontSize: 46, bold: true } },
  { text: "MANAGEMENT OVERVIEW", options: { color: COLORS.cream, fontFace: "Poppins", fontSize: 46, bold: true } }
], { x: 0.40, y: 0.50, w: 9.20, h: 3.00 });
s1.addText("talabat Local Shops Operations (UAE)  |  July 2026", {
  x: 0.40, y: 4.00, w: 6.00, h: 1.00, fontFace: "Poppins", fontSize: 13, color: COLORS.cream
});

// ═══════════════════════════════════════════════════════════════════════════════
// SLIDE 2: AGENDA
// ═══════════════════════════════════════════════════════════════════════════════
var s2 = pptx.addSlide();
s2.background = { color: COLORS.cream };
addAccentBar(s2);
addSlideTitle(s2, "Agenda");

var agenda = [
  { section: "01. System Overview", items: "What is CPO\nThe CPO Formula\nLoaded CPO Breakdown\nUser Roles & Access" },
  { section: "02. Data & Dashboard", items: "Data Sources & Architecture\nPeriod Selection & Filters\nStore-Level CPO Table\nKPI Cards & Metrics" },
  { section: "03. Config & Reports", items: "Vendor Rate Management\nEmployee Cost Config\nAutomated Email Reports\nBenefits by Stakeholder" }
];

agenda.forEach(function(col, idx) {
  var xOff = 0.44 + (idx * 3.11);
  s2.addText([
    { text: col.section + "\n\n", options: { fontSize: 15, color: COLORS.orange, fontFace: "Poppins", bold: true } },
    { text: col.items, options: { fontSize: 11, color: COLORS.burgundy, fontFace: "Poppins", lineSpacing: 18 } }
  ], { x: xOff, y: 1.20, w: 2.85, h: 3.80 });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SLIDE 3: SECTION DIVIDER — SYSTEM OVERVIEW
// ═══════════════════════════════════════════════════════════════════════════════
sectionDivider("SYSTEM OVERVIEW &", "STRATEGIC OBJECTIVES");

// ═══════════════════════════════════════════════════════════════════════════════
// SLIDE 4: WHAT IS CPO
// ═══════════════════════════════════════════════════════════════════════════════
var s4 = pptx.addSlide();
s4.background = { color: COLORS.cream };
addAccentBar(s4);
addSlideTitle(s4, "What is Cost Per Order?");

s4.addText("CPO measures the cost of fulfilling each order at a store level. It divides the total picker cost (based on 3PL vendor rates and attendance days) by the number of successful orders. This gives operations a per-order cost metric to benchmark stores, vendors, and cities.", {
  x: 0.44, y: 1.00, w: 9.00, h: 0.70, fontFace: "Poppins", fontSize: 13, color: COLORS.burgundy
});

var objectives = [
  { title: "Store-Level Visibility", desc: "CPO calculated per store — compare performance across locations, chains, and cities instantly." },
  { title: "Vendor Benchmarking", desc: "8 vendor rates tracked with effective dating. Compare cost efficiency across KRH, Transguard, and more." },
  { title: "Loaded CPO", desc: "Adds Champion (AED 6,400) and Supervisor (AED 8,500) cost allocation per store for true total cost." },
  { title: "Full Automation", desc: "Data pulled from 3 Google Sheets. Weekly and monthly reports sent automatically. Zero manual calculation." }
];
objectives.forEach(function(obj, i) {
  var cx = 0.44 + (i * 2.31);
  addCard(s4, cx, 2.00, 2.15, 3.10, COLORS.orange);
  s4.addText([
    { text: obj.title + "\n\n", options: { fontSize: 13, color: COLORS.orange, bold: true } },
    { text: obj.desc, options: { fontSize: 10, color: COLORS.burgundy } }
  ], { x: cx + 0.12, y: 2.15, w: 1.90, h: 2.80, fontFace: "Poppins" });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SLIDE 5: THE CPO FORMULA
// ═══════════════════════════════════════════════════════════════════════════════
var s5 = pptx.addSlide();
s5.background = { color: COLORS.cream };
addAccentBar(s5);
addSlideTitle(s5, "The CPO Formula");
addSubtitle(s5, "How cost per order is calculated at the store level");

// Formula box
s5.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
  x: 0.80, y: 1.20, w: 8.40, h: 1.20,
  fill: { color: COLORS.burgundy }, rectRadius: 0.1
});
s5.addText([
  { text: "Picker Cost", options: { fontSize: 22, color: COLORS.lime, bold: true } },
  { text: "  ÷  ", options: { fontSize: 22, color: COLORS.cream } },
  { text: "Successful Orders", options: { fontSize: 22, color: COLORS.lime, bold: true } },
  { text: "  =  ", options: { fontSize: 22, color: COLORS.cream } },
  { text: "CPO", options: { fontSize: 26, color: COLORS.orange, bold: true } }
], { x: 0.80, y: 1.20, w: 8.40, h: 1.20, fontFace: "Poppins", align: "center", valign: "middle" });

// Breakdown cards
var formParts = [
  { title: "Picker Cost", formula: "Vendor Rate ÷ Working Days\n× Attendance Days", example: "AED 2,750 ÷ 27 days\n× 24 days = AED 2,444", color: COLORS.orange },
  { title: "Successful Orders", formula: "Total orders from\nOrder Sheet per store", example: "Store ABC-01\n= 387 orders", color: COLORS.blue },
  { title: "CPO Result", formula: "Picker Cost ÷ Orders\n= Per-order cost", example: "AED 2,444 ÷ 387\n= AED 6.31 per order", color: COLORS.lightGreen }
];
formParts.forEach(function(p, i) {
  var cx = 0.44 + (i * 3.11);
  addCard(s5, cx, 2.70, 2.85, 2.60, p.color);
  s5.addText([
    { text: p.title + "\n\n", options: { fontSize: 14, color: p.color, bold: true } },
    { text: p.formula + "\n\n", options: { fontSize: 10.5, color: COLORS.burgundy } },
    { text: "Example:\n", options: { fontSize: 9, color: COLORS.mediumGray, bold: true } },
    { text: p.example, options: { fontSize: 10, color: COLORS.burgundy } }
  ], { x: cx + 0.18, y: 2.90, w: 2.50, h: 2.30, fontFace: "Poppins" });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SLIDE 6: LOADED CPO
// ═══════════════════════════════════════════════════════════════════════════════
var s6 = pptx.addSlide();
s6.background = { color: COLORS.cream };
addAccentBar(s6);
addSlideTitle(s6, "Loaded CPO Breakdown");
addSubtitle(s6, "True cost per order including Champion and Supervisor allocation");

// Loaded formula box
s6.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
  x: 0.44, y: 1.20, w: 9.12, h: 0.80,
  fill: { color: COLORS.burgundy }, rectRadius: 0.08
});
s6.addText([
  { text: "Picker CPO", options: { fontSize: 16, color: COLORS.lime, bold: true } },
  { text: "  +  ", options: { fontSize: 16, color: COLORS.cream } },
  { text: "Champion Cost ÷ Orders", options: { fontSize: 16, color: COLORS.lime, bold: true } },
  { text: "  +  ", options: { fontSize: 16, color: COLORS.cream } },
  { text: "Supervisor Cost ÷ Orders", options: { fontSize: 16, color: COLORS.lime, bold: true } },
  { text: "  =  ", options: { fontSize: 16, color: COLORS.cream } },
  { text: "Loaded CPO", options: { fontSize: 18, color: COLORS.orange, bold: true } }
], { x: 0.44, y: 1.20, w: 9.12, h: 0.80, fontFace: "Poppins", align: "center", valign: "middle" });

// Sample calculation
var loadedParts = [
  { label: "Picker CPO", value: "AED 7.20", detail: "3PL vendor rate\n÷ working days × attendance\n÷ successful orders", color: COLORS.orange },
  { label: "Champion", value: "+  AED 1.40", detail: "AED 6,400/month\n÷ working days × attendance\n÷ store orders", color: COLORS.teal },
  { label: "Supervisor", value: "+  AED 0.85", detail: "AED 8,500/month\n÷ working days × store count\n÷ store orders", color: COLORS.blue },
  { label: "Loaded CPO", value: "=  AED 9.45", detail: "Total cost per order\nincluding management\noverhead allocation", color: COLORS.lightGreen }
];
loadedParts.forEach(function(p, i) {
  var cx = 0.44 + (i * 2.31);
  addCard(s6, cx, 2.30, 2.15, 2.90, p.color);
  s6.addShape(pptx.shapes.OVAL, { x: cx + 0.60, y: 2.50, w: 0.95, h: 0.95, fill: { color: p.color } });
  s6.addText(p.value.replace(/[+= ]/g, '').substring(0, 3), {
    x: cx + 0.60, y: 2.50, w: 0.95, h: 0.95,
    fontFace: "Poppins", fontSize: 11, bold: true, color: COLORS.white, align: "center", valign: "middle"
  });
  s6.addText([
    { text: p.label + "\n", options: { fontSize: 12, color: p.color, bold: true } },
    { text: p.value + "\n\n", options: { fontSize: 16, color: COLORS.burgundy, bold: true } },
    { text: p.detail, options: { fontSize: 9, color: COLORS.mediumGray, lineSpacing: 14 } }
  ], { x: cx + 0.12, y: 3.55, w: 1.90, h: 1.50, fontFace: "Poppins", align: "center" });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SLIDE 7: USER ROLES
// ═══════════════════════════════════════════════════════════════════════════════
var s7 = pptx.addSlide();
s7.background = { color: COLORS.cream };
addAccentBar(s7);
addSlideTitle(s7, "User Roles & Access");

var roles = [
  { title: "SUPER ADMIN", icon: "SA", desc: "Full access to dashboard and all settings. Can manage vendor rates, employee costs, working days, email config, and access control. Sees all data unfiltered.", color: COLORS.orange },
  { title: "ADMIN", icon: "A", desc: "Full dashboard access with all filters. Can view settings and configuration but cannot modify access control. All data visible.", color: COLORS.burgundy },
  { title: "MANAGER", icon: "M", desc: "Dashboard access with all stores visible. Can view data and export reports. No access to settings or configuration panel.", color: COLORS.blue },
  { title: "SUPERVISOR", icon: "S", desc: "Dashboard filtered to assigned stores only. Sees CPO data for their supervised locations. No settings access.", color: COLORS.lightGreen }
];
roles.forEach(function(role, i) {
  var cx = 0.44 + (i * 2.31);
  addCard(s7, cx, 1.10, 2.15, 4.10);
  s7.addShape(pptx.shapes.OVAL, { x: cx + 0.65, y: 1.25, w: 0.85, h: 0.85, fill: { color: role.color } });
  s7.addText(role.icon, {
    x: cx + 0.65, y: 1.25, w: 0.85, h: 0.85,
    fontFace: "Poppins", fontSize: role.icon.length > 1 ? 20 : 28, bold: true, color: COLORS.white, align: "center", valign: "middle"
  });
  s7.addText([
    { text: role.title + "\n\n", options: { fontSize: 14, color: role.color, bold: true } },
    { text: role.desc, options: { fontSize: 9.5, color: COLORS.burgundy } }
  ], { x: cx + 0.12, y: 2.25, w: 1.90, h: 2.80, fontFace: "Poppins" });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SLIDE 8: SECTION DIVIDER — DATA & DASHBOARD
// ═══════════════════════════════════════════════════════════════════════════════
sectionDivider("DATA ARCHITECTURE &", "DASHBOARD FEATURES");

// ═══════════════════════════════════════════════════════════════════════════════
// SLIDE 9: DATA SOURCES
// ═══════════════════════════════════════════════════════════════════════════════
var s9 = pptx.addSlide();
s9.background = { color: COLORS.cream };
addAccentBar(s9);
addSlideTitle(s9, "Data Sources & Architecture");
addSubtitle(s9, "Three Google Sheets feed into the CPO calculation engine");

var sources = [
  {
    title: "Order Data Sheet", icon: "1",
    tabs: "MTD Order · Weekly Order · Monthly Order",
    fields: "Store codes, chain, city, successful orders count per period",
    color: COLORS.orange
  },
  {
    title: "Attendance Sheet", icon: "2",
    tabs: "MTD Know · Weekly Know · Monthly Know",
    fields: "Picker name, vendor/3PL, store, supervisor, attendance days per period",
    color: COLORS.blue
  },
  {
    title: "Master Data Sheet", icon: "3",
    tabs: "Store mapping & reference",
    fields: "Store-to-chain mapping, city assignments, supervisor assignments",
    color: COLORS.lightGreen
  }
];
sources.forEach(function(src, i) {
  var cx = 0.44 + (i * 3.11);
  addCard(s9, cx, 1.20, 2.85, 3.90, src.color);
  s9.addShape(pptx.shapes.OVAL, { x: cx + 0.95, y: 1.45, w: 0.95, h: 0.95, fill: { color: src.color } });
  s9.addText(src.icon, {
    x: cx + 0.95, y: 1.45, w: 0.95, h: 0.95,
    fontFace: "Poppins", fontSize: 30, bold: true, color: COLORS.white, align: "center", valign: "middle"
  });
  s9.addText([
    { text: src.title + "\n\n", options: { fontSize: 14, color: src.color, bold: true } },
    { text: "Tabs:\n", options: { fontSize: 9, color: COLORS.mediumGray, bold: true } },
    { text: src.tabs + "\n\n", options: { fontSize: 10, color: COLORS.burgundy } },
    { text: "Data:\n", options: { fontSize: 9, color: COLORS.mediumGray, bold: true } },
    { text: src.fields, options: { fontSize: 10, color: COLORS.burgundy } }
  ], { x: cx + 0.18, y: 2.55, w: 2.50, h: 2.40, fontFace: "Poppins" });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SLIDE 10: CALCULATION FLOW
// ═══════════════════════════════════════════════════════════════════════════════
var s10 = pptx.addSlide();
s10.background = { color: COLORS.cream };
addAccentBar(s10);
addSlideTitle(s10, "How CPO is Calculated");
addSubtitle(s10, "End-to-end data flow from raw sheets to per-store CPO");

var flow = [
  { num: "1", title: "Read\nAttendance", desc: "Pull picker attendance data from Know sheets for selected period", color: COLORS.orange },
  { num: "2", title: "Match\nVendor Rate", desc: "Look up effective vendor rate for each picker's 3PL company", color: COLORS.burgundy },
  { num: "3", title: "Calc Picker\nCost", desc: "Rate ÷ working days × attendance days = picker cost per store", color: COLORS.blue },
  { num: "4", title: "Read\nOrders", desc: "Pull successful order count per store from Order sheets", color: COLORS.teal },
  { num: "5", title: "Divide\n= CPO", desc: "Total picker cost ÷ successful orders = store-level CPO", color: COLORS.lightGreen }
];
flow.forEach(function(step, i) {
  var cx = 0.30 + (i * 1.95);
  s10.addShape(pptx.shapes.OVAL, { x: cx + 0.35, y: 1.20, w: 0.85, h: 0.85, fill: { color: step.color } });
  s10.addText(step.num, {
    x: cx + 0.35, y: 1.20, w: 0.85, h: 0.85,
    fontFace: "Poppins", fontSize: 26, bold: true, color: COLORS.white, align: "center", valign: "middle"
  });
  s10.addText([
    { text: step.title + "\n\n", options: { fontSize: 11, color: step.color, bold: true } },
    { text: step.desc, options: { fontSize: 9, color: COLORS.burgundy } }
  ], { x: cx + 0.05, y: 2.25, w: 1.50, h: 2.80, fontFace: "Poppins", align: "center" });
  if (i < 4) {
    s10.addText("→", {
      x: cx + 1.55, y: 1.30, w: 0.40, h: 0.65,
      fontFace: "Poppins", fontSize: 22, color: step.color, align: "center", valign: "middle"
    });
  }
});

s10.addText("All calculations happen server-side in Google Apps Script — the dashboard displays pre-computed results", {
  x: 0.36, y: 5.15, w: 9.28, h: 0.30,
  fontFace: "Poppins", fontSize: 10, color: COLORS.mediumGray, italic: true, align: "center"
});

// ═══════════════════════════════════════════════════════════════════════════════
// SLIDE 11: PERIOD SELECTION & FILTERS
// ═══════════════════════════════════════════════════════════════════════════════
var s11 = pptx.addSlide();
s11.background = { color: COLORS.cream };
addAccentBar(s11);
addSlideTitle(s11, "Period Selection & Filters");
addSubtitle(s11, "Multiple time views and granular filters for drilling down");

// Period cards
var periods = [
  { label: "MTD", desc: "Month-to-date — live cumulative data from Day 1 to today", color: COLORS.orange },
  { label: "Daily", desc: "Pick any specific day to see that day's CPO snapshot", color: COLORS.blue },
  { label: "Weekly", desc: "Select a week range to compare weekly CPO performance", color: COLORS.teal },
  { label: "Monthly", desc: "Full month view — final CPO figures for completed months", color: COLORS.lightGreen }
];
periods.forEach(function(p, i) {
  var cx = 0.44 + (i * 2.31);
  addCard(s11, cx, 1.20, 2.15, 1.50, p.color);
  s11.addText([
    { text: p.label + "\n", options: { fontSize: 16, color: p.color, bold: true } },
    { text: p.desc, options: { fontSize: 9, color: COLORS.burgundy } }
  ], { x: cx + 0.15, y: 1.40, w: 1.85, h: 1.20, fontFace: "Poppins" });
});

// Filter chips
var filters = [
  { label: "Chain", desc: "Filter by store chain (brand)", icon: "fa-store", color: COLORS.orange },
  { label: "City", desc: "Filter by emirate/city", icon: "fa-city", color: COLORS.blue },
  { label: "Supervisor", desc: "Filter by supervisor", icon: "fa-user-tie", color: COLORS.burgundy },
  { label: "3PL Vendor", desc: "Filter by vendor company", icon: "fa-truck", color: COLORS.teal },
  { label: "Type", desc: "Picker / Picker+Scanner / All", icon: "fa-filter", color: COLORS.lightGreen }
];
filters.forEach(function(f, i) {
  var yy = 3.05 + (i * 0.48);
  s11.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
    x: 0.44, y: yy, w: 1.40, h: 0.38, fill: { color: f.color }, rectRadius: 0.06
  });
  s11.addText(f.label, {
    x: 0.44, y: yy, w: 1.40, h: 0.38,
    fontFace: "Poppins", fontSize: 11, bold: true, color: COLORS.white, align: "center", valign: "middle"
  });
  s11.addText(f.desc, {
    x: 2.05, y: yy, w: 7.40, h: 0.38,
    fontFace: "Poppins", fontSize: 11, color: COLORS.burgundy, valign: "middle"
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SLIDE 12: KPI CARDS
// ═══════════════════════════════════════════════════════════════════════════════
var s12 = pptx.addSlide();
s12.background = { color: COLORS.white };
addAccentBar(s12);
addSlideTitle(s12, "Dashboard KPI Cards");
addSubtitle(s12, "Four key metrics displayed at the top of the dashboard");

var kpis = [
  { label: "AVG CPO", value: "AED 7.84", sub: "Average cost per order across all filtered stores", borderColor: COLORS.orange },
  { label: "TOTAL ORDERS", value: "12,847", sub: "Successful orders in the selected period", borderColor: COLORS.blue },
  { label: "TOTAL COST", value: "AED 100,721", sub: "Sum of all picker costs for the period", borderColor: COLORS.lightGreen },
  { label: "STORES", value: "42", sub: "Active stores with both orders and attendance data", borderColor: COLORS.red }
];
kpis.forEach(function(k, i) {
  var cx = 0.44 + (i * 2.31);
  s12.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
    x: cx, y: 1.20, w: 2.15, h: 1.70,
    fill: { color: COLORS.white },
    shadow: { type: "outer", blur: 5, offset: 2, color: "000000", opacity: 0.08 },
    line: { color: "E0D6CC", width: 0.5 }, rectRadius: 0.08
  });
  s12.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
    x: cx, y: 1.20, w: 0.08, h: 1.70, fill: { color: k.borderColor }, rectRadius: 0
  });
  s12.addText([
    { text: k.label + "\n", options: { fontSize: 9, color: COLORS.mediumGray, bold: true } },
    { text: k.value + "\n", options: { fontSize: 24, color: COLORS.burgundy, bold: true } },
    { text: k.sub, options: { fontSize: 8.5, color: COLORS.mediumGray } }
  ], { x: cx + 0.18, y: 1.30, w: 1.85, h: 1.50, fontFace: "Poppins" });
});

// Sample table description
s12.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
  x: 0.44, y: 3.20, w: 9.12, h: 2.10,
  fill: { color: COLORS.white },
  shadow: { type: "outer", blur: 5, offset: 2, color: "000000", opacity: 0.08 },
  line: { color: "E0D6CC", width: 0.5 }, rectRadius: 0.08
});

// Mini table header
var tableHeaders = ["Store", "Chain", "City", "3PL", "Pickers", "Orders", "Cost", "CPO"];
var colWidths = [1.40, 1.00, 0.90, 1.00, 0.80, 0.85, 1.10, 1.07];
var xStart = 0.44;
tableHeaders.forEach(function(h, i) {
  var cx = xStart;
  for (var j = 0; j < i; j++) cx += colWidths[j];
  s12.addShape(pptx.shapes.RECTANGLE, {
    x: cx, y: 3.20, w: colWidths[i], h: 0.35, fill: { color: COLORS.burgundy }
  });
  s12.addText(h, {
    x: cx, y: 3.20, w: colWidths[i], h: 0.35,
    fontFace: "Poppins", fontSize: 8, bold: true, color: COLORS.white, align: "center", valign: "middle"
  });
});

// Sample data rows
var sampleRows = [
  ["ABC-DXB-01", "Carrefour", "Dubai", "KRH", "6", "523", "16,345", "6.24"],
  ["DEF-SHJ-03", "Lulu", "Sharjah", "Transguard", "4", "287", "10,078", "7.02"],
  ["GHI-AUH-02", "Spinneys", "Abu Dhabi", "WeSource", "5", "412", "13,620", "6.61"],
  ["JKL-DXB-05", "Union Coop", "Dubai", "KRH", "3", "198", "8,120", "8.19"],
  ["MNO-AJM-01", "Choithrams", "Ajman", "Zone", "2", "145", "5,490", "7.57"]
];
sampleRows.forEach(function(row, ri) {
  var yy = 3.55 + (ri * 0.35);
  var bgColor = ri % 2 === 0 ? COLORS.white : "FAF6F1";
  row.forEach(function(cell, ci) {
    var cx = xStart;
    for (var j = 0; j < ci; j++) cx += colWidths[j];
    s12.addShape(pptx.shapes.RECTANGLE, {
      x: cx, y: yy, w: colWidths[ci], h: 0.35, fill: { color: bgColor }
    });
    var cellColor = COLORS.burgundy;
    var cellBold = false;
    if (ci === 7) {
      cellColor = parseFloat(cell) > 7.5 ? COLORS.red : COLORS.lightGreen;
      cellBold = true;
    }
    s12.addText(cell, {
      x: cx, y: yy, w: colWidths[ci], h: 0.35,
      fontFace: "Poppins", fontSize: 8.5, color: cellColor, bold: cellBold, align: "center", valign: "middle"
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SLIDE 13: SECTION DIVIDER — CONFIG & REPORTS
// ═══════════════════════════════════════════════════════════════════════════════
sectionDivider("CONFIGURATION &", "AUTOMATED REPORTS");

// ═══════════════════════════════════════════════════════════════════════════════
// SLIDE 14: VENDOR RATES
// ═══════════════════════════════════════════════════════════════════════════════
var s14 = pptx.addSlide();
s14.background = { color: COLORS.white };
addAccentBar(s14);
addSlideTitle(s14, "Vendor Rate Management");
addSubtitle(s14, "3PL vendor monthly rates with effective date support — configurable in Settings");

var vendors = [
  { name: "KRH", rate: "2,750" },
  { name: "Transguard", rate: "2,574" },
  { name: "WeSource", rate: "2,780" },
  { name: "Zone", rate: "2,780" },
  { name: "Trumax", rate: "2,780" },
  { name: "Sanket", rate: "2,750" },
  { name: "MTM", rate: "2,780" },
  { name: "Jumbo", rate: "2,780" }
];

vendors.forEach(function(v, i) {
  var row = Math.floor(i / 4);
  var col = i % 4;
  var cx = 0.44 + (col * 2.31);
  var yy = 1.20 + (row * 1.55);

  addCard(s14, cx, yy, 2.15, 1.35, COLORS.orange);
  s14.addText([
    { text: v.name + "\n", options: { fontSize: 14, color: COLORS.burgundy, bold: true } },
    { text: "AED " + v.rate + " / month", options: { fontSize: 12, color: COLORS.orange, bold: true } },
    { text: "\nEffective: Jan 2025 → Present", options: { fontSize: 8, color: COLORS.mediumGray } }
  ], { x: cx + 0.15, y: yy + 0.18, w: 1.85, h: 1.00, fontFace: "Poppins", align: "center" });
});

// Effective dating note
s14.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
  x: 0.44, y: 4.50, w: 9.12, h: 0.80,
  fill: { color: COLORS.cream }, line: { color: "E0D6CC", width: 0.5 }, rectRadius: 0.06
});
s14.addText([
  { text: "Effective Dating  ", options: { fontSize: 11, color: COLORS.orange, bold: true } },
  { text: "Each rate has a start and optional end date. The system automatically resolves the correct rate for any calculation period. Multiple rates can exist for the same vendor — only the active one is used.", options: { fontSize: 10, color: COLORS.burgundy } }
], { x: 0.60, y: 4.55, w: 8.80, h: 0.70, fontFace: "Poppins", valign: "middle" });

// ═══════════════════════════════════════════════════════════════════════════════
// SLIDE 15: SETTINGS & CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════════
var s15 = pptx.addSlide();
s15.background = { color: COLORS.cream };
addAccentBar(s15);
addSlideTitle(s15, "Settings & Configuration");
addSubtitle(s15, "Four configuration panels managed by Admin/Super Admin in the Settings tab");

var configs = [
  { title: "Vendor Rates", desc: "Add, edit, or remove 3PL vendor monthly rates. Each entry has effective start/end dates for historical accuracy.", icon: "AED", color: COLORS.orange, h: 1.80 },
  { title: "Employee Costs", desc: "Champion (AED 6,400) and City Supervisor (AED 8,500) monthly costs. Used for Loaded CPO calculation.", icon: "EMP", color: COLORS.burgundy, h: 1.80 },
  { title: "Working Days", desc: "Override calendar working days per month. Default auto-calculates (27 for 31-day months, 26 for 30-day, 24 for Feb).", icon: "CAL", color: COLORS.blue, h: 1.80 },
  { title: "Email Settings", desc: "Configure weekly (Sunday) and monthly (1st) automated report emails. Enable/disable, set day, customize subject line.", icon: "MSG", color: COLORS.lightGreen, h: 1.80 }
];
configs.forEach(function(cfg, i) {
  var cx = 0.44 + (i * 2.31);
  addCard(s15, cx, 1.20, 2.15, cfg.h, cfg.color);
  s15.addShape(pptx.shapes.OVAL, { x: cx + 0.60, y: 1.45, w: 0.95, h: 0.95, fill: { color: cfg.color } });
  s15.addText(cfg.icon, {
    x: cx + 0.60, y: 1.45, w: 0.95, h: 0.95,
    fontFace: "Poppins", fontSize: cfg.icon.length > 2 ? 13 : 16, bold: true, color: COLORS.white, align: "center", valign: "middle"
  });
  s15.addText([
    { text: cfg.title + "\n\n", options: { fontSize: 13, color: cfg.color, bold: true } },
    { text: cfg.desc, options: { fontSize: 9.5, color: COLORS.burgundy } }
  ], { x: cx + 0.12, y: 2.50, w: 1.90, h: 1.35, fontFace: "Poppins" });
});

// Access control row
s15.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
  x: 0.44, y: 3.30, w: 9.12, h: 2.00,
  fill: { color: COLORS.white }, line: { color: "E0D6CC", width: 1 }, rectRadius: 0.1
});
s15.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
  x: 0.44, y: 3.30, w: 9.12, h: 0.08, fill: { color: COLORS.burgundy }, rectRadius: 0
});
s15.addText([
  { text: "Access Control Panel\n\n", options: { fontSize: 14, color: COLORS.burgundy, bold: true } },
  { text: "Manage user access from Settings. Assign roles: ", options: { fontSize: 10.5, color: COLORS.burgundy } },
  { text: "Super Admin", options: { fontSize: 10.5, color: COLORS.orange, bold: true } },
  { text: " · ", options: { fontSize: 10.5, color: COLORS.mediumGray } },
  { text: "Admin", options: { fontSize: 10.5, color: COLORS.burgundy, bold: true } },
  { text: " · ", options: { fontSize: 10.5, color: COLORS.mediumGray } },
  { text: "Manager", options: { fontSize: 10.5, color: COLORS.blue, bold: true } },
  { text: " · ", options: { fontSize: 10.5, color: COLORS.mediumGray } },
  { text: "Supervisor", options: { fontSize: 10.5, color: COLORS.lightGreen, bold: true } },
  { text: " · ", options: { fontSize: 10.5, color: COLORS.mediumGray } },
  { text: "Viewer", options: { fontSize: 10.5, color: COLORS.mediumGray, bold: true } },
  { text: " · ", options: { fontSize: 10.5, color: COLORS.mediumGray } },
  { text: "Revoked", options: { fontSize: 10.5, color: COLORS.red, bold: true } },
  { text: "\n\nEach user is identified by email. Super Admin can add, edit roles, or revoke access. Supervisors are automatically filtered to see only their assigned stores.", options: { fontSize: 10, color: COLORS.mediumGray } }
], { x: 0.65, y: 3.50, w: 8.70, h: 1.70, fontFace: "Poppins" });

// ═══════════════════════════════════════════════════════════════════════════════
// SLIDE 16: AUTOMATED REPORTS
// ═══════════════════════════════════════════════════════════════════════════════
var s16 = pptx.addSlide();
s16.background = { color: COLORS.cream };
addAccentBar(s16);
addSlideTitle(s16, "Automated Email Reports");
addSubtitle(s16, "Scheduled performance reports sent to all authorized users");

// Weekly report card
addCard(s16, 0.44, 1.20, 4.30, 3.90, COLORS.orange);
s16.addText([
  { text: "Weekly Report\n", options: { fontSize: 18, color: COLORS.orange, bold: true } },
  { text: "Every Sunday at 8:00 AM\n\n", options: { fontSize: 11, color: COLORS.mediumGray } },
  { text: "What's included:\n\n", options: { fontSize: 11, color: COLORS.burgundy, bold: true } },
  { text: "• Store-level CPO for the past week\n", options: { fontSize: 10, color: COLORS.burgundy } },
  { text: "• Top & bottom performing stores\n", options: { fontSize: 10, color: COLORS.burgundy } },
  { text: "• Vendor cost comparison\n", options: { fontSize: 10, color: COLORS.burgundy } },
  { text: "• Week-over-week trend\n", options: { fontSize: 10, color: COLORS.burgundy } },
  { text: "• City/emirate breakdown\n\n", options: { fontSize: 10, color: COLORS.burgundy } },
  { text: "Configurable subject line\n", options: { fontSize: 9, color: COLORS.mediumGray, italic: true } },
  { text: "Can be enabled/disabled in Settings", options: { fontSize: 9, color: COLORS.mediumGray, italic: true } }
], { x: 0.65, y: 1.40, w: 3.90, h: 3.50, fontFace: "Poppins" });

// Monthly report card
addCard(s16, 5.26, 1.20, 4.30, 3.90, COLORS.blue);
s16.addText([
  { text: "Monthly Report\n", options: { fontSize: 18, color: COLORS.blue, bold: true } },
  { text: "1st of every month at 8:00 AM\n\n", options: { fontSize: 11, color: COLORS.mediumGray } },
  { text: "What's included:\n\n", options: { fontSize: 11, color: COLORS.burgundy, bold: true } },
  { text: "• Full month CPO by store\n", options: { fontSize: 10, color: COLORS.burgundy } },
  { text: "• Loaded CPO with management costs\n", options: { fontSize: 10, color: COLORS.burgundy } },
  { text: "• Month-over-month comparison\n", options: { fontSize: 10, color: COLORS.burgundy } },
  { text: "• Budget variance analysis\n", options: { fontSize: 10, color: COLORS.burgundy } },
  { text: "• Vendor performance ranking\n\n", options: { fontSize: 10, color: COLORS.burgundy } },
  { text: "Configurable subject line\n", options: { fontSize: 9, color: COLORS.mediumGray, italic: true } },
  { text: "Can be enabled/disabled in Settings", options: { fontSize: 9, color: COLORS.mediumGray, italic: true } }
], { x: 5.47, y: 1.40, w: 3.90, h: 3.50, fontFace: "Poppins" });

// ═══════════════════════════════════════════════════════════════════════════════
// SLIDE 17: SECTION DIVIDER — SECURITY & BENEFITS
// ═══════════════════════════════════════════════════════════════════════════════
sectionDivider("SECURITY MODEL &", "STAKEHOLDER BENEFITS");

// ═══════════════════════════════════════════════════════════════════════════════
// SLIDE 18: ACCESS CONTROL MODEL
// ═══════════════════════════════════════════════════════════════════════════════
var s18 = pptx.addSlide();
s18.background = { color: COLORS.white };
addAccentBar(s18);
addSlideTitle(s18, "Access Control & Security Model");

var tiers = [
  { role: "Super Admin", auth: "Email-based login\nFull config access", scope: "All data, all actions\nManage users & settings\nVendor rates, costs", color: COLORS.orange },
  { role: "Admin", auth: "Email-based login\nDashboard access", scope: "All data visible\nView settings\nNo access control edit", color: COLORS.burgundy },
  { role: "Manager", auth: "Email-based login\nDashboard access", scope: "All stores visible\nExport & view only\nNo settings access", color: COLORS.blue },
  { role: "Supervisor", auth: "Email-based login\nFiltered access", scope: "Assigned stores only\nOwn city data\nNo settings access", color: COLORS.lightGreen }
];
tiers.forEach(function(tier, i) {
  var cx = 0.44 + (i * 2.31);
  addCard(s18, cx, 1.10, 2.15, 4.00);
  s18.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
    x: cx, y: 1.10, w: 2.15, h: 0.08, fill: { color: tier.color }, rectRadius: 0
  });
  s18.addText([
    { text: "TIER " + (i + 1) + "\n", options: { fontSize: 9, color: COLORS.mediumGray } },
    { text: tier.role + "\n\n", options: { fontSize: 16, color: tier.color, bold: true } },
    { text: "Authentication\n", options: { fontSize: 9, color: COLORS.mediumGray, bold: true } },
    { text: tier.auth + "\n\n", options: { fontSize: 10, color: COLORS.burgundy } },
    { text: "Data Scope\n", options: { fontSize: 9, color: COLORS.mediumGray, bold: true } },
    { text: tier.scope, options: { fontSize: 10, color: COLORS.burgundy } }
  ], { x: cx + 0.15, y: 1.30, w: 1.85, h: 3.60, fontFace: "Poppins" });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SLIDE 19: BENEFITS
// ═══════════════════════════════════════════════════════════════════════════════
var s19 = pptx.addSlide();
s19.background = { color: COLORS.cream };
addAccentBar(s19);
addSlideTitle(s19, "Benefits by Stakeholder");

var benefits = [
  { title: "For Management", items: "Real-time cost visibility\nStore-level benchmarking\nVendor cost comparison\nLoaded CPO with overheads\nBudget variance tracking\nAutomated weekly/monthly reports", color: COLORS.orange },
  { title: "For Supervisors", items: "Own-city CPO monitoring\nStore performance ranking\nIdentify cost outliers\nPeriod-over-period trends\nFiltered dashboard view\nNo manual calculation needed", color: COLORS.blue },
  { title: "For Operations", items: "Zero manual data entry\nAutomatic rate resolution\nConfigurable vendor rates\nEffective date tracking\nRole-based access control\nBuilt in-house at $0 cost", color: COLORS.burgundy }
];
benefits.forEach(function(b, i) {
  var cx = 0.44 + (i * 3.11);
  addCard(s19, cx, 1.10, 2.85, 4.00, b.color);
  s19.addText([
    { text: b.title + "\n\n", options: { fontSize: 15, color: b.color, bold: true } },
    { text: b.items, options: { fontSize: 11, color: COLORS.burgundy, lineSpacing: 20 } }
  ], { x: cx + 0.20, y: 1.40, w: 2.45, h: 3.50, fontFace: "Poppins" });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SLIDE 20: THANK YOU
// ═══════════════════════════════════════════════════════════════════════════════
var s20 = pptx.addSlide();
s20.background = { color: COLORS.orange };
s20.addText("THANK YOU", {
  x: 0.30, y: 0.80, w: 9.40, h: 2.00,
  fontFace: "Poppins", bold: true, fontSize: 72, color: COLORS.cream, align: "center"
});
s20.addText("Cost Per Order — Management Overview", {
  x: 0.30, y: 2.80, w: 9.40, h: 0.80,
  fontFace: "Poppins", fontSize: 20, color: COLORS.burgundy, align: "center"
});
s20.addText("talabat Local Shops Operations — UAE", {
  x: 0.30, y: 3.80, w: 9.40, h: 0.60,
  fontFace: "Poppins", fontSize: 14, color: COLORS.cream, align: "center"
});

// ═══════════════════════════════════════════════════════════════════════════════
// GENERATE
// ═══════════════════════════════════════════════════════════════════════════════
pptx.writeFile({ fileName: "CPO-Management.pptx" })
  .then(function() { console.log("CPO Management deck generated: CPO-Management.pptx (" + pptx.slides.length + " slides)"); })
  .catch(function(err) { console.error("Error:", err); });
