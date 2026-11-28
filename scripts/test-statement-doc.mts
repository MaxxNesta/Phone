// The exported statement's rows (lib/statement-doc.ts): three levels, the
// chart's top account skipped, clearing and tax folded into "Other current …",
// every column still adding up. No database.   npx tsx scripts/test-statement-doc.mts
import assert from "node:assert/strict";
import { rowsToDoc } from "../lib/statement-doc";
import type { CompareRow } from "../lib/statement-compare";

const r = (key: string, kind: CompareRow["kind"], label: string, depth: number, under: string[], v: number): CompareRow =>
  ({ key, kind, label, depth, under, better: 1, values: [v], total: v });
const rows: CompareRow[] = [
  r("h:ASSET", "section", "Assets", 0, [], 0),
  r("n:1", "group", "Assets", 1, [], 1000),
  r("n:1CA", "group", "Current Assets", 2, ["n:1"], 700),
  r("n:11", "group", "Cash and Bank", 3, ["n:1", "n:1CA"], 500),
  r("n:1110", "account", "Cash", 4, ["n:1", "n:1CA", "n:11"], 500),
  r("n:14", "group", "Clearing and Tax", 3, ["n:1", "n:1CA"], 200),
  r("n:1410", "account", "GR/IR Clearing", 4, ["n:1", "n:1CA", "n:14"], 150),
  r("n:1440", "account", "Input Tax", 4, ["n:1", "n:1CA", "n:14"], 50),
  r("n:1NC", "group", "Non-current Assets", 2, ["n:1"], 300),
  r("n:16", "account", "Equipment", 3, ["n:1", "n:1NC"], 300),
  r("t:ASSET", "total", "Total assets", 0, [], 1000),
];
const doc = rowsToDoc(rows, { columns: 1, total: false, foldIds: new Set(["1410", "1440"]) });
const labels = doc.map((d) => `${d.level}${d.kind[0]} ${d.label}`);
assert.deepEqual(labels, [
  "1h Assets",
  "2h Current Assets", "3l Cash and Bank", "3l Other current assets", "2t Total Current Assets",
  "2h Non-current Assets", "3l Equipment", "2t Total Non-current Assets",
  "1t Total assets",
]);
assert.equal(doc.find((d) => d.label === "Other current assets")!.values[0], 200);
// No account deeper than level 3 is printed, and the folded accounts are not either.
assert.ok(!labels.some((l) => /GR\/IR|Input Tax|^.. Cash$/.test(l)));
console.log("statement doc: all checks pass");
