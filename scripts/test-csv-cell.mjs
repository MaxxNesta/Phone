// Every export writes its cells through lib/csv's csvCell: a name that starts
// like a formula must reach a spreadsheet as text.
//   npx tsx scripts/test-csv-cell.mjs
import assert from "node:assert/strict";
const { csvCell } = await import("../lib/csv.ts");

assert.equal(csvCell('=HYPERLINK("http://x","y")'), `"'=HYPERLINK(""http://x"",""y"")"`);
assert.equal(csvCell("+cmd"), "'+cmd");
assert.equal(csvCell("@SUM(A1)"), "'@SUM(A1)");
assert.equal(csvCell("-2+3"), "'-2+3");
assert.equal(csvCell("-1500.25"), "-1500.25");   // a negative amount stays a number
assert.equal(csvCell(-42), "-42");
assert.equal(csvCell("iPhone 17, 256GB"), '"iPhone 17, 256GB"');
assert.equal(csvCell(null), "");
console.log("PASS csvCell: 8 checks");
