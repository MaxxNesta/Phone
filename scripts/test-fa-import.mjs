// The asset register paste: read, reviewed, ready to import (lib/fa-import.ts). Pure: no database.
//   npx tsx scripts/test-fa-import.mjs

const { readRegister, parseRegister, reviewRows, unknownSubcategories, subKey, parseMonth, parseDate, num, suggestName, registerHeaders, FA_COLUMNS } =
  await import("../lib/fa-import.ts");
const { parseTsv } = await import("../lib/import-purchase-invoices.ts");

let bad = 0;
const check = (label, ok, detail = "") => { if (!ok) bad++; console.log(`  ${ok ? "ok  " : "FAIL"}  ${label}${detail ? "  " + detail : ""}`); };

const cats = [
  { id: "gen", name: "Generator & Solar", group: "Machinery" },
  { id: "tab", name: "Table, Chair & Locker", group: "Furniture and Office Equipment" },
  { id: "save", name: "Save/မီးခံသေတ္တာ", group: "Furniture and Office Equipment" },
  { id: "pc", name: "Computer & Printer", group: "Furniture and Office Equipment" },
  { id: "ev", name: "Cycle & EV Cycle", group: "Vehicles" },
];
const branches = [{ id: "main", name: "Main Store" }, { id: "mdy", name: "Mandalay" }];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const head = registerHeaders(2026);
const nine = (v) => [...Array(9).fill(v), "", "", ""];
const later = (from, v) => MON.map((_, k) => (k >= from && k < 9 ? v : ""));

// Rows from the shop's own register, as Excel copies them (Buddhist-era dates, decimals, a quoted multi-line cell).
const rows = [
  head,
  ["1", "Growatt SPG 6000ES Plus Wifi Inverter", "Growatt SPG 6000ES Plus Wifi Inverter", "MACHINERY", "Generator & Solar", "24", "Jan'2026", "11 Jan 2569", "1", "1,420,000.00", "1,420,000.00", "", "", ...nine("59,166.67"), "1,005,833.33"],
  ["4", "Office Table Small 92-IR-Table A3-19", '"\nOffice Table Small 92-IR-Table A3-19 (3လုံး)*(180000-5%dis)Sweety Home 28/12/25- Ygn Office\n"', "FURNITURES AND FITTINGS", "Table , Chair & Locker", "36", "Jan'2026", "28 Dec 2568", "3", "170,991.67", "512,975.00", "", "", ...nine("14,249.31"), "413,229.86"],
  ["8", "Meeting Table 21-ML-MT-002", "Meeting Table 21-ML-MT-002 Sweety Home", "FURNITURES AND FITTINGS", "Table , Chair & Locker", "36", "Jan'2026", "28 Dec 2568", "1", "564,300.00", "564,300.00", "", "", ...nine("15,675.00"), "454,575.00"],
  ["11", "File Cabinet", "File Cabinet ပွင့်ဦး", "FURNITURES AND FITTINGS", "Table , Chair & Locker", "36", "Jan'2026", "07 Jan 2569", "1", "1,148,000.00", "865,000.00", "", "", ...nine("24,027.78"), "696,805.56"],
  ["14", "Meeting Table 21-ML-MT-002", "Meeting Table 21-ML-MT-002 Sweety Home", "FURNITURES AND FITTINGS", "Table , Chair & Locker", "36", "Jan'2026", "28 Dec 2568", "1", "564,300.00", "564,300.00", "", "", ...nine("15,675.00"), "454,575.00"],
  ["15", "Office Table Big-8 (4' × 2')", "Office Table Big-8", "FURNITURES AND FITTINGS", "Table , Chair & Locker", "36", "Apr'2026", "01 Apr 2569", "3", "200,000.00", "600,000.00", "", "", ...later(3, "16,666.67"), "533,333.33"],
  ["17", "SB.T-1700(MNZ) မီးခံသေတ္တာ", "SB.T-1700(MNZ) မီးခံသေတ္တာ", "OFFICE EQUIPMENT", "Save Box", "120", "Jan'2026", "07 Dec 2568", "1", "7,500,250.00", "7,500,250.00", "", "", ...nine("62,502.08"), "7,062,735.42"],
  ["43", "MDY-85W 85783 EV Cycle", "MDY-85W 85783 EV Cycle", "VEHICLES", "Vehicles", "120", "Jan'2026", "19 Jan 2569", "1", "6,550,000.00", "6,550,000.00", "", "", ...nine("54,583.33"), "6,167,916.67"],
].map((r) => r.join("\t")).join("\n");

const p = parseRegister(parseTsv(rows));
check("header found, no missing columns", p && p.wrongHeaders.length === 0, p?.wrongHeaders.join("; "));
check("eight rows read", p.drafts.length === 8, String(p.drafts.length));
check("the file's NBV is as of July", p.inferred?.month === 6, JSON.stringify(p.inferred));

const unknown = unknownSubcategories(p.drafts, cats);
check("Save Box and Vehicles are subcategories to map", JSON.stringify(unknown.map((u) => u.text)) === JSON.stringify(["Save Box", "Vehicles"]), unknown.map((u) => u.text).join(", "));

const ctx = { categories: cats, branches, existing: [], subMap: {}, branchId: "main", convention: "SAME_MONTH", year: 2026, nbvMonth: 6 };
let r = reviewRows(p.drafts, ctx);
const by = (no) => r.find((x) => x.no === no);
check("unmapped subcategory needs attention", by("17").status === "attention" && by("43").status === "attention");
r = reviewRows(p.drafts, { ...ctx, subMap: { [subKey("Save Box")]: "save", [subKey("Vehicles")]: "ev" } });
check("mapped once, every row follows", by("17").category?.id === "save" && by("43").category?.id === "ev");

const g = by("1");
check("Growatt is ready: 11 Jan 2569 is 2026-01-11", g.status === "ready" && g.acquired === "2026-01-11", JSON.stringify(g.issues));
// The engine spreads what is left over the months left, so a month is 59,166 or 59,167, never the file's 59,166.67.
check("engine's months, not the file's", g.monthly === 59167 && g.mtk.every((v) => v === 59167 || v === 59166), JSON.stringify(g.mtk));
const tb = by("4");
check("28 Dec 2568 is 2025-12-28", tb.acquired === "2025-12-28", tb.acquired);
check("explicit Jan start against the same-month rule is reviewed, and kept", tb.start === "2026-01" && tb.issues.some((i) => /first-month rule would start it Dec 2025/.test(i.text)), JSON.stringify(tb.issues));
check("FURNITURES AND FITTINGS sits under Furniture and Office Equipment; “Table , Chair” matches", tb.category?.id === "tab" && !tb.issues.some((i) => /chart files/.test(i.text)));
check("the whole multi-line description is kept as notes", tb.notes.includes("Sweety Home 28/12/25- Ygn Office"));
check("quantity is kept for a group", tb.qty === 3);
const fc = by("11");
check("quantity × unit price that is not the cost: the total cost is used", fc.status === "review" && fc.issues.some((i) => /total cost 865,000 is used/.test(i.text)));
check("the second Meeting Table is a possible duplicate", /line/.test(by("14").duplicateOf ?? ""), by("14").duplicateOf);
check("the first Meeting Table is not", by("8").duplicateOf === null);
const apr = by("15");
check("an April start depreciates from April", apr.mtk[2] === 0 && apr.mtk[3] === 16667, JSON.stringify(apr.mtk));
const sb = by("17");
check("Save Box: OFFICE EQUIPMENT is within the chart's Furniture and Office Equipment", !sb.issues.some((i) => /chart files/.test(i.text)), JSON.stringify(sb.issues));

// Duplicates of what is already registered.
r = reviewRows(p.drafts, { ...ctx, existing: [{ code: "FA-0007", name: "Growatt SPG 6000ES Plus Wifi Inverter", cost: 1420000, acquired: "2026-01-11" }] });
check("an asset already registered is a possible duplicate", r.find((x) => x.no === "1").duplicateOf === "FA-0007");

// No branch, a bad life, a bad date.
const broken = parseRegister(parseTsv([head.slice(0, 13).join("\t"), ["9", "X", "x", "MACHINERY", "Generator & Solar", "24%", "Jan'2026", "31 Feb 2569", "1", "1", "100", "", ""].join("\t")].join("\n")));
const br = reviewRows(broken.drafts, { ...ctx, branchId: null })[0];
check("24% is not months, 31 Feb is not a date, no branch: needs attention",
  br.status === "attention" && br.issues.some((i) => /whole number of months/.test(i.text)) && br.issues.some((i) => /not a date/.test(i.text)) && br.issues.some((i) => /branch/.test(i.text)),
  JSON.stringify(br.issues));

// An opening figure runs to the month before the start unless the sheet says otherwise.
const old = parseRegister(parseTsv([head.slice(0, 13).join("\t"), ["1", "Old PC", "Old PC", "Furniture", "Computer & Printer", "36", "Jan'2025", "05 Jan 2568", "1", "", "3,600,000", "", "1,200,000"].join("\t")].join("\n")));
const op = reviewRows(old.drafts, ctx)[0];
check("opening 1,200,000 runs to Dec 2024; MTK continues from there", op.openingThrough === "2024-12" && op.monthly === 66667, `${op.openingThrough} ${op.monthly}`);
const blank = parseRegister(parseTsv([head.slice(0, 13).join("\t"), ["1", "Old PC", "Old PC", "Furniture", "Computer & Printer", "36", "Jun'2025", "05 Jun 2568", "1", "", "3,600,000", "", ""].join("\t")].join("\n")));
check("a blank opening on an asset started before the year asks to confirm zero", reviewRows(blank.drafts, ctx)[0].issues.some((i) => /confirm it is zero/.test(i.text)));

// Months and NBV are optional: a sheet without them reads.
const lean = parseRegister(parseTsv([head.slice(0, 13).join("\t"), ["1", "Growatt", "Growatt", "MACHINERY", "Generator & Solar", "24", "Jan'2026", "11 Jan 2569", "1", "1,420,000", "1,420,000", "", ""].join("\t")].join("\n")));
check("without months or NBV, nothing is missing", lean.wrongHeaders.length === 0 && !lean.hasMonths && reviewRows(lean.drafts, ctx)[0].status === "ready", JSON.stringify(reviewRows(lean.drafts, ctx)[0].issues));

// Small parsers.
check("months", ["Jan 2026", "Jan'2026", "Jan-26", "January 2569", "2026-01", "1/1/2026"].every((s) => parseMonth(s) === "2026-01"));
check("ambiguous dates are flagged", parseDate("3/4/2026").unsure === true && parseDate("13/4/2026").unsure === false);
check("numbers", num("1,250,000") === 1250000 && num("(500)") === -500 && num("-") === null && num("") === null);
check("a name is suggested from a description", suggestName("Growatt Inverter ဝယ်ယူ 12/1/2026 (Ko Aung)") === "Growatt Inverter");
check("old headers still read (Subcategory (Software))", readRegister(parseTsv(rows.replace("\tSubcategory\t", "\tSubcategory (Software)\t")), cats).wrongHeaders.length === 0);
check("the guide lists the schedule's columns without months and NBV", JSON.stringify(FA_COLUMNS.map((c) => c.header)) === JSON.stringify(head.slice(0, 13)));

console.log(bad ? `\n${bad} FAILED` : "\nfa-import: all good");
process.exit(bad ? 1 : 0);
