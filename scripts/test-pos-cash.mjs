// Cash received and change at the till. Pure arithmetic plus a source check:
// the payment a counter sale posts is the sale's total — never the cash
// handed over — and nothing about change reaches the server.
//
//   npx tsx scripts/test-pos-cash.mjs

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { postedAmount, tender, fmtCents, exactText, quickAmounts } from "../lib/pos-cash.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
let good = 0, bad = 0;
const check = (label, ok, detail = "") => {
  if (ok) good++; else bad++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? "   " + detail : ""}`);
};
const section = (s) => console.log(`\n  ${s}`);

section("Change and shortfall");
let t = tender(4_450_000, "10000000");
check("handed 10,000,000 for 4,450,000 → change 5,550,000", t.changeCents === 555_000_000 && t.shortCents === 0 && fmtCents(t.changeCents) === "5,550,000");
t = tender(4_450_000, "4450000");
check("exact amount → no change, nothing short", t.changeCents === 0 && t.shortCents === 0 && !t.invalid);
t = tender(4_450_000, "");
check("nothing typed = the exact amount: no change, nothing short, not invalid", t.receivedCents === null && t.changeCents === 0 && t.shortCents === 0 && !t.invalid);
t = tender(4_450_000, "1000000");
check("handed 1,000,000 for 4,450,000 → short 3,450,000, no change", t.shortCents === 345_000_000 && t.changeCents === 0 && fmtCents(t.shortCents) === "3,450,000");
check("one kyat short is short (not rounded away)", tender(1000, "999").shortCents === 100 && tender(1000, "999").changeCents === 0);
check("one kyat over is change", tender(1000, "1001").changeCents === 100);

section("Part-kyat totals");
t = tender(1000.4, "1000");
check("1,000.40 due, 1,000 handed → short 0.40, shown as 0.40 (not '0 short')", t.shortCents === 40 && fmtCents(t.shortCents) === "0.40");
t = tender(1000.4, "1001");
check("1,000.40 due, 1,001 handed → change 0.60", t.changeCents === 60 && fmtCents(t.changeCents) === "0.60");
t = tender(0.1 + 0.2, "0.3");
check("0.1 + 0.2 due, 0.30 handed → exactly paid (no float noise)", t.changeCents === 0 && t.shortCents === 0, JSON.stringify(t));
check("due is the total rounded the way it posts", tender(37_037.014, "").dueCents === Math.round(postedAmount(37_037.014) * 100) && tender(37_037.014, "").dueCents === 3_703_701);
t = tender(37_037.01, "40000");
check("3 × 12,345.67 = 37,037.01 due, 40,000 handed → change 2,962.99", t.changeCents === 296_299 && fmtCents(t.changeCents) === "2,962.99");
check("whole amounts print without decimals; part-kyat with two", fmtCents(123_400) === "1,234" && fmtCents(123_456) === "1,234.56" && fmtCents(5) === "0.05");

section("Bad input");
check("negative is invalid and gives no change", tender(1000, "-5").invalid && tender(1000, "-5").changeCents === 0);
check("text is invalid", tender(1000, "abc").invalid && tender(1000, "1e").invalid);
check("zero handed is short by the whole total (not treated as blank)", tender(1000, "0").shortCents === 100_000 && !tender(1000, "0").invalid);
check("spaces around a number are fine", tender(1000, " 1500 ").changeCents === 50_000);

section("Always balances");
let bal = true, worst = "";
for (let i = 0; i < 20000; i++) {
  const total = Math.round(Math.random() * 1e8) / 100 + (i % 3 === 0 ? 0.004 : 0);
  const handed = (Math.round(Math.random() * 2e8) / 100).toFixed(2);
  const x = tender(total, handed);
  if (x.receivedCents - x.changeCents + x.shortCents !== x.dueCents || (x.changeCents > 0 && x.shortCents > 0)) { bal = false; worst = `${total} / ${handed}`; break; }
}
check("received − change + short = due, and never both change and short (20,000 random cases)", bal, worst);

section("Quick amounts");
const q = quickAmounts(445_000_000);
check("Exact first, then round notes above the total", q[0] === 445_000_000 && q.slice(1).every((c) => c >= 445_000_000), q.join());
check("no duplicates, at most four", new Set(q).size === q.length && q.length <= 4);
check("a total already on a round note is offered once, as Exact", quickAmounts(500_000_000).length === 1 && quickAmounts(500_000_000)[0] === 500_000_000);
check("nothing to offer for an empty cart", quickAmounts(0).length === 0);
check("Exact types the total itself", exactText(445_000_000) === "4450000" && exactText(3_703_701) === "37037.01");

section("What posts is the sale total — never the cash handed over");
check("postedAmount takes the total alone (one parameter)", postedAmount.length === 1);
check("postedAmount ignores everything but the total", postedAmount(4_450_000) === 4_450_000 && postedAmount(37_037.014) === 37_037.01 && postedAmount(1000.005) === Math.round(1000.005 * 100) / 100);
const till = readFileSync(join(root, "components/pos-till.tsx"), "utf8");
const pay = till.slice(till.indexOf("const payments = ()"), till.indexOf("const customerName"));
check("the till's payments() uses postedAmount(totals.total)", /postedAmount\(totals\.total\)/.test(pay));
check("payments() never reads the cash received, the tender or the change", !/received|tend\b|tend\.|change/i.test(pay.replace(/\/\/.*$/gm, "")), pay.length + " chars");
const sale = till.slice(till.indexOf("await posPostSale({"), till.indexOf("if (!r.ok) return flash"));
check("what is sent to the server carries no cash-received or change field", !/received|change|tender/i.test(sale));
const actions = readFileSync(join(root, "lib/pos-actions.ts"), "utf8");
const saleType = actions.slice(actions.indexOf("export type PosSale"), actions.indexOf("export type PosResult"));
check("the server's PosSale type has no cash-received or change field", !/received|change|tender/i.test(saleType));
check("lib/pos-cash.ts posts nothing and imports nothing from the database or posting code",
  !/from ["']\.\/(db|posting|actions|pos-actions)["']/.test(readFileSync(join(root, "lib/pos-cash.ts"), "utf8")));

console.log(`\n  ${good} passed, ${bad} failed\n`);
process.exit(bad ? 1 : 0);
