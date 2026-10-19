// Document entry layout check: order, receipt and invoice screens, at desktop,
// tablet, phone and 200% zoom.
//
//   npm run dev &                         # or npm start, on a database with a supplier
//   npx -y -p playwright node scripts/check-doc-layout.mjs [base-url]
//
// For each screen and size it fails when the page scrolls sideways, a field or
// button is under 40px tall, or (on desktop) the Items section starts lower
// than it should. Not a substitute for looking — it catches the regressions
// that made these screens tall and cramped, not every way they can look wrong.

import { chromium } from "playwright";

const BASE = process.argv[2] ?? "http://localhost:3111";
const PAGES = [
  // Where Items must start on a 1440×900 desktop. Measured 2026-10-19 after
  // the compact headers: PO/SO 276, GR 328, PI 397 (from 485, 507, 675).
  { path: "/purchases/orders/new", itemsBy: 320 },
  { path: "/sales/orders/new", itemsBy: 320 },
  { path: "/purchases/receive/new", itemsBy: 370 },
  { path: "/purchases/new", itemsBy: 440 },
];
const SIZES = [
  { name: "desktop", width: 1440, height: 900, cols: [4, 5] },
  { name: "tablet", width: 900, height: 1000, cols: [2] },
  { name: "phone", width: 390, height: 844, cols: [1] },
  // 200% zoom on a 1440×900 screen is a 720×450 viewport.
  { name: "zoom 200%", width: 720, height: 450, cols: [2] },
];

const browser = await chromium.launch();
let failed = 0;
for (const s of SIZES) {
  const page = await browser.newPage({ viewport: { width: s.width, height: s.height } });
  for (const p of PAGES) {
    await page.goto(BASE + p.path, { waitUntil: "networkidle" });
    const m = await page.evaluate(() => {
      const d = document.documentElement;
      const items = document.querySelector("#add-items-search")?.closest(".card");
      const fields = document.querySelector(".doc-fields");
      const heights = [...document.querySelectorAll(
        ".doc-info input:not([type=hidden]), .doc-info select, .doc-info .seg, .doc-heading-back, .form-commit button")]
        .map((e) => e.getBoundingClientRect().height).filter((h) => h > 0);
      return {
        overflow: d.scrollWidth - d.clientWidth,
        itemsTop: items ? Math.round(items.getBoundingClientRect().top + scrollY) : null,
        minControl: heights.length ? Math.round(Math.min(...heights)) : null,
        cols: fields ? getComputedStyle(fields).gridTemplateColumns.split(" ").length : null,
      };
    });
    const problems = [];
    if (m.itemsTop === null) problems.push("no Items section (empty database?)");
    if (m.overflow > 0) problems.push(`scrolls sideways by ${m.overflow}px`);
    if (m.minControl !== null && m.minControl < 40) problems.push(`a control is ${m.minControl}px tall`);
    if (m.cols !== null && !s.cols.includes(m.cols)) problems.push(`${m.cols} field columns, expected ${s.cols.join(" or ")}`);
    if (s.name === "desktop" && m.itemsTop !== null && m.itemsTop > p.itemsBy) problems.push(`Items starts at ${m.itemsTop}px, expected by ${p.itemsBy}px`);
    if (problems.length) failed++;
    console.log(`${problems.length ? "FAIL" : "PASS"}  ${s.name.padEnd(9)} ${p.path.padEnd(24)} items ${m.itemsTop}px · min control ${m.minControl}px · ${m.cols} cols${problems.length ? "  — " + problems.join("; ") : ""}`);
  }
  await page.close();
}
await browser.close();
console.log(failed ? `\n  ${failed} FAILED` : "\n  all document layouts pass");
process.exit(failed ? 1 : 0);
