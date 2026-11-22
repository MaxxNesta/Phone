// Write-off of defective stock (Path B, 0225): phones rejected at a receipt
// or reported faulty after it, that the supplier will neither take back nor
// credit, leave quarantine on a stock adjustment charged to Inventory Damage.
//
//   ALLOW_DESTRUCTIVE_TESTS=1 npx tsx scripts/test-write-off.mjs
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
const Q = await import("../lib/queries.ts");

const url = process.env.DATABASE_URL;
const local = url.includes("localhost") || url.includes("127.0.0.1");
const pooled = url.includes("-pooler.");
const sql = postgres(url, { ssl: local ? false : "require", prepare: !pooled, onnotice: () => {}, max: 1 });

await takeTestLock(sql, "test-write-off.mjs");
let failures = 0;
const check = (label, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
};
const n = (v) => Number(v ?? 0);
const refuses = async (label, fn, pattern) => {
  try { await fn(); check(label, false, "posted, expected a refusal"); }
  catch (e) { check(label, !pattern || pattern.test(e.message), e.message.slice(0, 120)); }
};

try {
  const [co] = await sql`select id from company order by created_at limit 1`;
  await resetTransactions(sql);

  const [loc] = await sql`select id from location where company_id = ${co.id} and is_stock_location and is_active and not is_quarantine order by code limit 1`;
  const [sup] = await sql`select id from business_partner where company_id = ${co.id} and is_supplier order by code limit 1`;
  const [ph] = await sql`select id from item where company_id = ${co.id} and tracks_serial and is_active and is_stocked
    and not exists (select 1 from item c where c.parent_item_id = item.id) order by code limit 1`;
  const d = (await sql`select to_char(fn_shop_today(), 'YYYY-MM-DD') as d`)[0].d;
  const s = String(Date.now()).slice(-8), imei = (k) => `35${s}0${k}0`;
  const base = { companyId: co.id, partnerId: sup.id, locationId: loc.id, docDate: d };

  console.log("\n1. The write-off account (0225)");
  const [role] = await sql`select a.code, a.name from system_account s join account a on a.id = s.account_id
    where s.company_id = ${co.id} and s.role = 'INVENTORY_DAMAGE'`;
  check("INVENTORY_DAMAGE is mapped", !!role, role ? `${role.code} ${role.name}` : "missing");

  console.log("\n2. Three phones: one rejected at receipt, one reported faulty after");
  const po = await P.postPurchaseOrder({ ...base, dueDate: d, lines: [{ itemId: ph.id, qty: 3, unitPrice: 1_000_000 }] });
  const [pol] = await sql`select id from document_line where document_id = ${po.id}`;
  const gr = await P.postGoodsReceipt({ ...base, sourceDocumentId: po.id, lines: [
    { itemId: ph.id, qty: 2, unitCost: 1_000_000, serials: [imei(1), imei(2)], sourceLineId: pol.id },
    { itemId: ph.id, qty: 1, unitCost: 1_000_000, serials: [imei(3)], sourceLineId: pol.id, rejected: { reason: "cracked", outcome: "CREDIT" } } ] });
  const [kept] = await sql`select id from document_line where document_id = ${gr.id} and reject_reason is null`;
  const [refusedLine] = await sql`select id, location_id from document_line where document_id = ${gr.id} and reject_reason is not null`;
  await P.reportFaulty({ companyId: co.id, receiptId: gr.id, reason: "no sound", outcome: "CREDIT", lines: [{ receiptLineId: kept.id, serials: [imei(2)] }] });
  const bin = refusedLine.location_id;

  console.log("\n3. A write-off refuses found stock");
  await refuses("a write-off with a positive line is refused",
    () => P.postStockAdjustment({ companyId: co.id, locationId: loc.id, docDate: d, writeOff: true,
      lines: [{ itemId: ph.id, qty: 1, unitCost: 1 }] }), /only takes stock away/);

  console.log("\n4. Writing both defects off from quarantine");
  const gl = () => sql`select a.code, coalesce(sum(jl.base_amount),0)::float as bal from journal_line jl
      join account a on a.id = jl.account_id where a.company_id = ${co.id} and a.code in ('5920','5910') group by a.code`;
  const glBefore = await gl();
  const bal = (rows, code) => n(rows.find((r) => r.code === code)?.bal);
  const adj = await P.postStockAdjustment({ companyId: co.id, locationId: bin, docDate: d, writeOff: true,
    memo: "test write-off", lines: [
      { itemId: ph.id, qty: -1, serials: [imei(3)], sourceLineId: refusedLine.id },
      { itemId: ph.id, qty: -1, serials: [imei(2)], sourceLineId: kept.id },
    ] });
  const glAfter = await gl();
  check("Inventory Damage (5920) is debited 2,000,000", Math.abs(bal(glAfter, "5920") - bal(glBefore, "5920") - 2_000_000) < 0.01,
    String(bal(glAfter, "5920") - bal(glBefore, "5920")));
  check("Stock Adjustment (5910) is untouched", Math.abs(bal(glAfter, "5910") - bal(glBefore, "5910")) < 0.01);
  const units = await sql`select s.serial_no, v.status from stock_serial s join v_stock_serial v on v.serial_id = s.id
     where s.serial_no in (${imei(1)}, ${imei(2)}, ${imei(3)}) order by s.serial_no`;
  check("both defective phones are written off", units.filter((u) => u.status === "WRITTEN_OFF").length === 2,
    units.map((u) => `${u.serial_no.slice(-3)} ${u.status}`).join(", "));
  check("the good phone stays in stock", units.find((u) => u.serial_no === imei(1))?.status === "IN_STOCK");
  const [{ q }] = await sql`select fn_qty_on_hand(${co.id}, ${ph.id}, ${bin})::float as q`;
  check("the quarantine bin is empty of them", n(q) === 0, String(q));
  const lines = await sql`select source_line_id from document_line where document_id = ${adj.id} order by line_no`;
  check("each line names its receipt line", lines[0].source_line_id === refusedLine.id && lines[1].source_line_id === kept.id);

  console.log("\n5. The receipt says what became of them");
  const rows = await Q.rejectedOnReceipt(gr.id);
  const all = rows.flatMap((r) => r.units);
  check("no unit is still held", all.every((u) => !u.stillHeld));
  check("both units read as written off", all.filter((u) => u.writtenOff).length === 2);

  console.log("\n6. Ledger");
  const [tb] = await sql`select coalesce(sum(jl.base_amount),0)::float as t from journal_line jl
    join journal_entry je on je.id = jl.journal_entry_id where je.company_id = ${co.id}`;
  check("trial balance nets to zero", Math.abs(n(tb.t)) < 0.01, String(tb.t));
  const [inv] = await sql`
    select (select coalesce(sum(jl.base_amount),0) from journal_line jl join account a on a.id = jl.account_id
             where a.company_id = ${co.id} and a.code = '1310')::float as gl,
           (select coalesce(sum(value_on_hand),0) from v_stock_on_hand where company_id = ${co.id})::float as stock`;
  check("inventory GL (1310) equals the valued stock", Math.abs(n(inv.gl) - n(inv.stock)) < 1, `${inv.gl} vs ${inv.stock}`);

  console.log(failures ? `\n  ${failures} check(s) FAILED` : "\n  all write-off checks pass");
} finally {
  await releaseTestLock(sql);
  await sql.end();
}
process.exit(failures ? 1 : 0);
