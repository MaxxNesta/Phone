// The asset register paste reader (lib/fa-import.ts). Pure: no database.
//   npx tsx scripts/test-fa-import.mjs

const { readRegister, parseMonth, parseDate, num } = await import("../lib/fa-import.ts");

let bad = 0;
const check = (label, ok, detail = "") => { if (!ok) bad++; console.log(`  ${ok ? "ok  " : "FAIL"}  ${label}${detail ? "  " + detail : ""}`); };

const cats = [
  { id: "g", name: "Generator & Solar", group: "Machinery" },
  { id: "c", name: "Computer & Printer", group: "Furniture and Office Equipment" },
];
const head = ["No", "Description", "Types", "Software", "Depreciation Rate", "Mohths", "Date", "Qty", "Price", "Cost", "Disopsal", "Op; Accu",
  "Jan-26", "Feb-26", "Mar-26", "Apr-26", "May-26", "Jun-26", "Jul-26", "Aug-26", "Sep-26", "Oct-26", "Nov-26", "Dec-26", "NBV"];
const m12 = (v) => Array(12).fill(String(v));
const rows = [
  ["Fixed asset register 2026"],
  head,
  // 1,200,000 over 24 months from Jan 2026: 50,000 a month, NBV 600,000.
  ["1", "Growatt Inverter ဝယ်ယူ 12/1/2026 (Ko Aung)", "Machinery", "Generator & Solar", "24", "Jan 2026", "12/1/2026", "1", "1,200,000", "1,200,000", "", "", ...m12("50,000"), "600,000"],
  // Started 2025, 240,000 carried, 10,000 a month on 480,000 / 48.
  ["2", "HP printer", "Office Equipment", "Computer & Printer", "48", "Jan 2025", "15-Jan-25", "2", "240,000", "480,000", "", "120,000", ...m12("10,000"), "240,000"],
  // Unknown category, life as a rate, Excel's March is off.
  ["3", "Mystery", "Vehicles", "Spaceship", "24%", "Mar-26", "", "1", "100", "100", "50", "", ...m12("1")],
  ["", "Total", "", "", "", "", "", "", "", "1,780,100"],
];
const r = readRegister(rows, cats);
check("header found on line 2", r && r.headerLine === 2, String(r?.headerLine));
check("header labels all match", r.wrongHeaders.length === 0, r.wrongHeaders.join("; "));
check("year from the month headers", r.year === 2026, String(r.year));
check("three assets, total line skipped", r.rows.length === 3, String(r.rows.length));

const [a, b, c] = r.rows;
check("1 matches: 50,000 a month, NBV 600,000", a.status === "ok" && a.mtk.every((v) => v === 50000) && a.mtkNbv === 600000, JSON.stringify(a.issues));
check("1 keeps its full Burmese description", a.description.includes("ဝယ်ယူ"));
check("1 date day-first", a.date === "2026-01-12", a.date);
check("2 group case-insensitive, opening carried", b.status === "ok" && b.mtk[0] === 10000 && b.mtkNbv === 240000, JSON.stringify(b.issues) + " " + b.mtk[0] + " " + b.mtkNbv);
check("3 blocked: no such category", c.status === "blocked" && c.issues.some((i) => /Spaceship/.test(i.text)));
check("3 blocked: 24% is not months", c.issues.some((i) => /whole number of months/.test(i.text)));
check("3 review: disposal value asks", c.issues.some((i) => /Column K/.test(i.text)));

// Month and number forms Excel copies.
check("months", ["Jan 2026", "Jan-26", "January 2026", "2026-01", "1/1/2026"].every((s) => parseMonth(s) === "2026-01"));
check("ambiguous date is flagged", parseDate("3/4/2026").unsure === true && parseDate("13/4/2026").unsure === false);
check("numbers", num("1,250,000") === 1250000 && num("(500)") === -500 && num("-") === null && num("") === null);

// A blank opening on an asset started before the year asks to confirm zero.
const blank = readRegister([head, ["4", "Old PC", "Office equipment", "Computer & Printer", "36", "Jun 2025", "", "1", "360000", "360000", "", "", ...m12("10000"), "0"]], cats);
check("blank opening before the year is reviewed", blank.rows[0].issues.some((i) => /confirm it is zero/.test(i.text)));

console.log(bad ? `\n${bad} FAILED` : "\nfa-import: all good");
process.exit(bad ? 1 : 0);
