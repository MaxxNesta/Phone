// Month-end revaluation of what is owed and held in yuan (0223).
//
//   npx tsx scripts/test-fx-revaluation.mjs
//
// Destructive like every suite here: it empties transactions on whatever
// DATABASE_URL points at. Never run it against pilot or production.

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { takeTestLock, releaseTestLock } from "./test-lock.mjs";
import { resetTransactions } from "./test-reset.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
if (!process.env.DATABASE_URL && existsSync(join(root, ".env"))) {
  for (const line of readFileSync(join(root, ".env"), "utf8").split("\n")) {
    const m = line.match(/^\s*DATABASE_URL\s*=\s*(.+?)\s*$/);
    if (m) { process.env.DATABASE_URL = m[1].replace(/^["']|["']$/g, ""); break; }
  }
}
const P = await import("../lib/posting.ts");
const url = process.env.DATABASE_URL;
const local = url.includes("localhost") || url.includes("127.0.0.1");
const sql = postgres(url, { ssl: local ? false : "require", prepare: !url.includes("-pooler."), onnotice: () => {}, max: 1 });

await takeTestLock(sql, "test-fx-revaluation.mjs");
let failures = 0;
const check = (label, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
};
const n = (v) => Number(v ?? 0);
const r2 = (v) => Math.round(n(v) * 100) / 100;
const refuses = async (label, fn, re) => {
  try { await fn(); check(label, false, "posted, expected a refusal"); }
  catch (e) { check(label, !re || re.test(e.message), e.message.slice(0, 110)); }
};

try {
  const [co] = await sql`select id from company order by created_at limit 1`;
  await resetTransactions(sql);
  await sql`delete from exchange_rate where company_id = ${co.id}`;
  const [wh] = await sql`
    select id from location where company_id = ${co.id} and is_stock_location and not is_quarantine and not is_transit
     order by code limit 1`;
  const party = async (code, name, cols) => {
    const [f] = await sql`select id from business_partner where company_id=${co.id} and code=${code}`;
    if (f) return f;
    return (await sql`insert into business_partner ${sql({ company_id: co.id, code, name, ...cols })} returning id`)[0];
  };
  const sz = await party("FXR-SZ", "Shenzhen Revaluation", { is_supplier: true, currency: "CNY" });
  const [grp] = await sql`select id from item_group where company_id = ${co.id} limit 1`;
  const [uom] = await sql`select id from uom where company_id = ${co.id} limit 1`;
  const [it] = await sql`select id from item where company_id = ${co.id} and serial = 'FXR-CHG'`;
  const charger = it ?? (await sql`insert into item ${sql({ company_id: co.id, item_group_id: grp.id, code: "FXR-CHG",
    serial: "FXR-CHG", name: "Revaluation charger", base_uom_id: uom.id, is_stocked: true })} returning id`)[0];
  const [yuanCash] = await sql`update account set currency = 'CNY' where company_id = ${co.id} and code = '1112' returning id`;
  const DAY = (await sql`select to_char(current_date,'YYYY-MM-DD') as d`)[0].d;
  const NEXT = (await sql`select to_char(current_date + 1,'YYYY-MM-DD') as d`)[0].d;
  const bal = async (code, upTo = null) => r2((await sql`
    select coalesce(sum(jl.base_amount), 0) v from journal_line jl
      join journal_entry je on je.id = jl.journal_entry_id
      join account a on a.id = jl.account_id
     where a.company_id = ${co.id} and a.code = ${code}
       ${upTo ? sql`and je.entry_date <= ${upTo}::date` : sql``}`)[0].v);
  await sql`insert into exchange_rate (company_id, from_currency, to_currency, rate_type, valid_from, rate)
            values (${co.id}, 'CNY', 'MMK', 'MARKET', ${DAY}::date, 450)`;

  console.log("\n  what is owed in yuan");
  const pi = await P.postPurchaseWithReceipt({ companyId: co.id, partnerId: sz.id, locationId: wh.id,
    docDate: DAY, dueDate: DAY, currency: "CNY", exchangeRate: 450,
    lines: [{ itemId: charger.id, qty: 60, unitPrice: 100 }] });
  // An advance in yuan, for goods still expected: not restated (IFRIC 22).
  await P.postSupplierPayment({ companyId: co.id, partnerId: sz.id, docDate: DAY, cashAccountId: yuanCash.id,
    currency: "CNY", exchangeRate: 450, locationId: wh.id, allocations: [], advance: 1000 });
  // Paid after the month end: the month end must not see it.
  await P.postSupplierPayment({ companyId: co.id, partnerId: sz.id, docDate: NEXT, cashAccountId: yuanCash.id,
    currency: "CNY", exchangeRate: 455, locationId: wh.id, allocations: [{ invoiceId: pi.id, amount: 1000 }] });

  const plan = await P.planFxRevaluation({ companyId: co.id, periodEnd: DAY, rates: { CNY: 460 } });
  const ap = plan.lines.find((l) => l.kind === "PAYABLE");
  const cash = plan.lines.find((l) => l.kind === "CASH");
  check("the supplier owes-line is read as at the month end, before the later payment",
    ap && r2(ap.fcBalance) === -6000 && r2(ap.carried) === -2_700_000, JSON.stringify(ap));
  check("at 460 it is 2,760,000: 60,000 more owed", ap && r2(ap.revalued) === -2_760_000 && r2(ap.difference) === -60_000);
  check("yuan cash is restated too (¥1,000 paid out at 450)", cash && r2(cash.fcBalance) === -1000
    && r2(cash.difference) === -10_000, JSON.stringify(cash));
  check("the advance is not restated", !plan.lines.some((l) => /advance/i.test(l.accountName)));
  const planNoRate = await P.planFxRevaluation({ companyId: co.id, periodEnd: DAY });
  check("without a typed rate, the rate on file is used", planNoRate.rates.CNY === 450);

  const before = { ap: await bal("2110"), u: await bal("6341") };
  const run = await P.postFxRevaluation({ companyId: co.id, periodEnd: DAY, rates: { CNY: 460 } });
  check("posted, two balances restated", run.lines === 2);
  check("month end: unrealised loss of 70,000", r2((await bal("6341", DAY)) - before.u) === 70_000);
  check("…beside the balances, not in them", (await bal("2160", DAY)) === -60_000 && (await bal("1150", DAY)) === -10_000
    && (await bal("2110")) === before.ap);
  check("next morning it is all taken back", (await bal("6341")) === before.u && (await bal("2160")) === 0 && (await bal("1150")) === 0);
  const [{ v: tb }] = await sql`select coalesce(sum(base_amount),0)::float v from journal_line where company_id = ${co.id}`;
  check("trial balance balances", r2(tb) === 0);
  const [apOpen] = await sql`select coalesce(sum(outstanding),0)::float v from v_open_item
    where company_id = ${co.id} and doc_type = 'PURCHASE_INVOICE'`;
  check("the supplier ledger still agrees with the open bills", r2(-(await bal("2110"))) === r2(apOpen.v),
    `${-(await bal("2110"))} vs ${apOpen.v}`);

  await refuses("the same month end cannot be revalued twice",
    () => P.postFxRevaluation({ companyId: co.id, periodEnd: DAY, rates: { CNY: 470 } }), /already/);
  await refuses("voiding needs a reason",
    () => P.voidFxRevaluation({ companyId: co.id, revaluationId: run.id, reason: " " }), /why/);
  await P.voidFxRevaluation({ companyId: co.id, revaluationId: run.id, reason: "wrong rate" });
  check("voided: nothing left at the month end either", (await bal("6341", DAY)) === before.u && (await bal("2160", DAY)) === 0);
  const rerun = await P.postFxRevaluation({ companyId: co.id, periodEnd: DAY, rates: { CNY: 455 } });
  check("and it can be run again at the right rate", !!rerun.id && (await bal("2160", DAY)) === -30_000);

  console.log("\n  no rate, nothing open");
  await sql`delete from exchange_rate where company_id = ${co.id}`;
  await refuses("a currency with no rate is named",
    () => P.postFxRevaluation({ companyId: co.id, periodEnd: NEXT }), /CNY rate/);
} catch (e) {
  failures++;
  console.error("  CRASH ", e);
} finally {
  await sql`update account set currency = null where code = '1112'`.catch(() => {});
  await releaseTestLock(sql);
  await sql.end();
}
console.log(failures ? `\n  ${failures} FAILED` : "\n  all revaluation checks passed");
process.exit(failures ? 1 : 0);
