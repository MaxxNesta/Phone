// CSV cells stay text in a spreadsheet: npx tsx scripts/test-csv-cell.ts
import { csvCell } from "../lib/csv";
const cases: [unknown, string][] = [
  ["=HYPERLINK(\"x\")", "\"'=HYPERLINK(\"\"x\"\")\""], ["+1+1", "'+1+1"], ["@SUM(A1)", "'@SUM(A1)"],
  ["-1500", "-1500"], [-2.5, "-2.5"], ["a,b", "\"a,b\""], [null, ""], ["iPhone 15", "iPhone 15"],
];
for (const [v, want] of cases) if (csvCell(v) !== want) { console.error("FAIL", v, csvCell(v), want); process.exit(1); }
console.log("PASS");
