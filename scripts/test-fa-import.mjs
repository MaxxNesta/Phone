// The asset register paste reader (lib/fa-import.ts). Pure: no database.
//   npx tsx scripts/test-fa-import.mjs

const { readRegister, parseMonth, parseDate, num, suggestName, FA_COLUMNS } = await import("../lib/fa-import.ts");
const { parseTsv } = await import("../lib/import-purchase-invoices.ts");

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
check("3 review: disposal value asks", c.issues.some((i) => /Disopsal has/.test(i.text)));

// Month and number forms Excel copies.
check("months", ["Jan 2026", "Jan-26", "January 2026", "2026-01", "1/1/2026"].every((s) => parseMonth(s) === "2026-01"));
check("ambiguous date is flagged", parseDate("3/4/2026").unsure === true && parseDate("13/4/2026").unsure === false);
check("numbers", num("1,250,000") === 1250000 && num("(500)") === -500 && num("-") === null && num("") === null);

// A blank opening on an asset started before the year asks to confirm zero.
const blank = readRegister([head, ["4", "Old PC", "Office equipment", "Computer & Printer", "36", "Jun 2025", "", "1", "360000", "360000", "", "", ...m12("10000"), "0"]], cats);
check("blank opening before the year is reviewed", blank.rows[0].issues.some((i) => /confirm it is zero/.test(i.text)));

// The name is the start of a description that mixes name and notes.
check("name stops at Burmese text", suggestName("Growatt Inverter ဝယ်ယူ 12/1/2026 (Ko Aung)") === "Growatt Inverter");
check("name stops at a bracket", suggestName("Office Table Small 92-IR-Table A3-19 (Ko Aung) 2 pcs") === "Office Table Small 92-IR-Table A3-19");
check("a plain name is kept whole", suggestName("HP LaserJet printer") === "HP LaserJet printer");
check("the row keeps the full description as notes", a.description.includes("Ko Aung") && a.name === "Growatt Inverter");

// A Name column added after No shifts every other column; headers still find them.
const withName = readRegister([
  ["No", "Name", ...head.slice(1)],
  ["9", "Office Table Small 92-IR-Table A3-19", "Office Table Small 92-IR-Table A3-19 (ကိုအောင်) 2 pcs", "Furniture", "Computer & Printer", "48", "Jan 2025", "15-Jan-25", "2", "240,000", "480,000", "", "120,000", ...m12("10,000"), "240,000"],
], cats);
const t = withName.rows[0];
check("the Name column is the name", t.name === "Office Table Small 92-IR-Table A3-19", t.name);
check("Description stays whole as notes", t.description.includes("2 pcs"));
check("shifted columns still read: cost, opening, months, NBV", t.cost === 480000 && t.opening === 120000 && t.mtk[0] === 10000 && t.nbv === 240000, JSON.stringify(t.issues));
check("no header complaints", withName.wrongHeaders.length === 0, withName.wrongHeaders.join("; "));
const noTypes = readRegister([["No", "Description", "Cost"], ["1", "x", "10"]], cats);
check("a missing column is reported by name", noTypes.wrongHeaders.some((w) => /Types/.test(w)), noTypes.wrongHeaders.join("; "));

// Rows from the shop's own register, as Excel copies them (a cell with a line break comes quoted).
const realCats = [
  { id: "g", name: "Generator & Solar", group: "Machinery" },
  { id: "t", name: "Table, Chair & Locker", group: "Furniture and Office Equipment" },
];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const realHead = ["No", "Asset name (review)", "Notes / original description", "Category (Types)", "Subcategory", "Useful life (months)",
  "Depreciation start", "Asset date", "Quantity", "Unit price", "Total cost", "Disposal (source)", "Opening accumulated depreciation",
  ...MON.map((m) => `${m} 2026`), "NBV (source)"];
const nine = (v) => [...Array(9).fill(v), " ", " ", " "];
const tsv = [
  realHead,
  ["1", "Growatt SPG 6000ES Plus Wifi Inverter", "Growatt SPG 6000ES Plus Wifi Inverter", "MACHINERY", "Generator & Solar", "24", "Jan'2026", "11 Jan 2569", "1", "1,420,000.00", "1,420,000.00", " ", " ", ...nine("59,166.67"), "1,005,833.33"],
  ["4", "Office Table Small 92-IR-Table A3-19", '"\nOffice Table Small 92-IR-Table A3-19 (3လုံး)*(180000-5%dis)Sweety Home 28/12/25- Ygn Office\n"', "FURNITURES AND FITTINGS", "Table , Chair & Locker", "36", "Jan'2026", "28 Dec 2568", "3", "170,991.67", "512,975.00", " ", " ", ...nine("14,249.31"), "413,229.86"],
  ["11", "File Cabinet", "File Cabinet ပွင့်ဦး", "FURNITURES AND FITTINGS", "Table , Chair & Locker", "36", "Jan'2026", "07 Jan 2569", "1", "1,148,000.00", "865,000.00", " ", " ", ...nine("24,027.78"), "696,805.56"],
].map((r) => r.join("\t")).join("\n");
const real = readRegister(parseTsv(tsv), realCats);
check("real headers all found", real.wrongHeaders.length === 0, real.wrongHeaders.join("; "));
check("the NBV is worked out as of July", real.nbvMonth === 6 && real.inferred.matches === 3, JSON.stringify(real.inferred));
const [g, tb, fc] = real.rows;
check("Buddhist-era date: 11 Jan 2569 is 2026-01-11", g.date === "2026-01-11", g.date);
check("Jan'2026 is the start month", g.start === "2026-01");
check("MACHINERY matches the chart, months and NBV agree", g.status === "ok", JSON.stringify(g.issues));
check("FURNITURES AND FITTINGS under Furniture and Office Equipment; “Table , Chair” matches", tb.status === "ok" && tb.category?.id === "t", JSON.stringify(tb.issues));
check("the multi-line description is kept whole", tb.description.includes("Sweety Home"));
check("28 Dec 2568 is 2025-12-28", tb.date === "2025-12-28", tb.date);
check("qty × price that is not the cost is flagged", fc.status === "review" && fc.issues.some((i) => /Qty × price/.test(i.text)), JSON.stringify(fc.issues));
const asSep = readRegister(parseTsv(tsv), realCats, 8);
check("choosing September instead shows the NBV gap", asSep.rows[0].issues.some((i) => /NBV/.test(i.text)));
// An older sheet headed "Subcategory (Software)" still reads.
const oldHead = readRegister(parseTsv([realHead.map((h) => (h === "Subcategory" ? "Subcategory (Software)" : h)).join(String.fromCharCode(9)), ...tsv.split(String.fromCharCode(10)).slice(1)].join(String.fromCharCode(10))), realCats);
check("the old Subcategory (Software) header still reads", oldHead.wrongHeaders.length === 0 && oldHead.rows[0].category?.id === "g");
// What the Asset schedule exports reads straight back in: same headers, nothing missing.
const { registerHeaders } = await import("../lib/fa-import.ts");
check("the schedule's headers are the register's", JSON.stringify(registerHeaders(2026)) === JSON.stringify(realHead));
const back = readRegister([registerHeaders(2026),
  ["1", "Growatt SPG 6000ES Plus Wifi Inverter", "Growatt SPG 6000ES Plus Wifi Inverter", "Machinery", "Generator & Solar", "24", "Jan 2026", "11 Jan 2026", "", "", "1420000", "", "0",
    ...Array(12).fill("59167"), "0"]], realCats);
check("an exported row reads back with no header complaints", back.wrongHeaders.length === 0 && back.rows[0].category?.id === "g", back.wrongHeaders.join("; "));
// The columns-to-match list names exactly the register's headers, in its order.
check("Columns to match lists the register's exact headers",
  JSON.stringify(FA_COLUMNS.map((c) => c.header)) === JSON.stringify([...realHead.slice(0, 13), "Jan 2026 … Dec 2026", "NBV (source)"]),
  FA_COLUMNS.map((c) => c.header).join(" | "));

console.log(bad ? `\n${bad} FAILED` : "\nfa-import: all good");
process.exit(bad ? 1 : 0);
