// Supplier and customer settlement, end to end, inside one transaction that is
// rolled back: nothing it posts survives. Safe on a database with real data.
//
//   npx tsx scripts/check-payables-flow.mjs            (DATABASE_URL or .env)
//
// For one partner with at least two open invoices:
//   1. pay an advance (money out, no bill)          Dr Advance      Cr Cash
//   2. apply part of it to the oldest bill          Dr AP           Cr Advance
//   3. pay that bill's rest and part of the next    Dr AP           Cr Cash
// then check every figure the screens read: each bill's outstanding, its paid
// and advance-applied split, the advance left, and that the ledger's control
// and advance accounts say the same as the subledger.

import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

if (!process.env.DATABASE_URL && existsSync(".env")) {
  for (const line of readFileSync(".env", "utf8").split("\n")) {
    const m = line.match(/^\s*DATABASE_URL\s*=\s*(.+?)\s*$/);
    if (m) { process.env.DATABASE_URL = m[1].replace(/^["']|["']$/g, ""); break; }
  }
}
const P = await import("../lib/posting.ts");
const { sql } = await import("../lib/db.ts");
const ROLLBACK = new Error("rollback");
const today = new Date().toISOString().slice(0, 10);
let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; console.log("  ✓", msg); };
const near = (a, b) => Math.abs(a - b) < 0.01;

async function run(side) {
  const pay = side === "SUPPLIER";
  const docType = pay ? "PURCHASE_INVOICE" : "SALES_INVOICE";
  const [co] = await sql`select id, name from company`;
  // A partner with two open kyat invoices, oldest first.
  const [pick] = await sql`
    select partner_id from v_open_item
     where company_id = ${co.id} and doc_type = ${docType} and coalesce(currency, 'MMK') = 'MMK' and outstanding > 10
     group by partner_id having count(*) >= 2 limit 1`;
  if (!pick) { console.log(`${side}: no partner with two open kyat invoices — skipped`); return; }
  const inv = await sql`
    select o.document_id, o.doc_no, o.outstanding::float as outstanding, d.location_id
      from v_open_item o join document d on d.id = o.document_id
     where o.partner_id = ${pick.partner_id} and o.doc_type = ${docType} and coalesce(o.currency, 'MMK') = 'MMK' and o.outstanding > 10
     order by d.posting_date, d.doc_no limit 2`;
  const [a, b] = inv;
  const [cash] = await sql`select id from account where company_id = ${co.id} and code = '13101'`;
  console.log(`${side} · ${co.name} · ${a.doc_no} owes ${a.outstanding}, ${b.doc_no} owes ${b.outstanding}`);

  const glOf = (tx, role) => tx`
    select coalesce(sum(jl.base_amount), 0)::float as v from journal_line jl
     where jl.company_id = ${co.id} and jl.partner_id = ${pick.partner_id}
       and jl.account_id = fn_resolve_control_account(${co.id}, ${role}, ${pick.partner_id})`;
  const advGl = (tx) => tx`
    select coalesce(sum(jl.base_amount), 0)::float as v from journal_line jl
     where jl.company_id = ${co.id} and jl.partner_id = ${pick.partner_id}
       and jl.account_id = fn_system_account(${co.id}, ${pay ? "SUPPLIER_ADVANCE" : "CUSTOMER_ADVANCE"})`;
  const outOf = async (tx, id) => Number((await tx`select coalesce((select outstanding from v_open_item where document_id = ${id}), 0)::float as v`)[0].v);

  await sql.begin(async (tx) => {
    const ctlBefore = (await glOf(tx, pay ? "AP_CONTROL" : "AR_CONTROL"))[0].v;
    const advBefore = (await advGl(tx))[0].v;
    const X = Math.round(a.outstanding / 2), applyA = Math.round(X * 0.6), cashB = Math.round(b.outstanding / 3);
    const base = { companyId: co.id, partnerId: pick.partner_id, docDate: today, cashAccountId: cash.id, reference: null, memo: "flow check", locationId: a.location_id };

    const post = pay ? P.postSupplierPayment : P.postCustomerReceipt;
    const adv = await post({ ...base, allocations: [], advance: X }, tx);
    ok(near((await advGl(tx))[0].v - advBefore, pay ? X : -X), `advance of ${X} sits on the advance account`);

    await P.applyAdvance({ companyId: co.id, invoiceId: a.document_id, allocations: [{ paymentId: adv.id, amount: applyA }], docDate: today }, tx);
    ok(near(await outOf(tx, a.document_id), a.outstanding - applyA), `${a.doc_no} comes down by the ${applyA} applied`);
    ok(near((await advGl(tx))[0].v - advBefore, pay ? X - applyA : -(X - applyA)), `advance left is ${X - applyA}`);
    const [left] = await tx`select available::float as v from v_partner_advance where payment_id = ${adv.id}`;
    ok(near(left.v, X - applyA), "the advance's own remaining matches");

    const restA = await outOf(tx, a.document_id);
    await post({ ...base, allocations: [{ invoiceId: a.document_id, amount: restA }, { invoiceId: b.document_id, amount: cashB }], advance: 0 }, tx);
    ok(near(await outOf(tx, a.document_id), 0), `${a.doc_no} is settled`);
    ok(near(await outOf(tx, b.document_id), b.outstanding - cashB), `${b.doc_no} part paid by ${cashB}`);

    const [split] = await tx`
      select coalesce(sum(pa.amount) filter (where pa.applied_by_document_id is not null), 0)::float as adv,
             coalesce(sum(pa.amount) filter (where pa.applied_by_document_id is null), 0)::float as cash
        from payment_allocation pa where pa.invoice_id = ${a.document_id}`;
    ok(near(split.adv, applyA), `${a.doc_no}: advance applied reads ${applyA}`);
    ok(split.cash >= restA - 0.01, `${a.doc_no}: cash paid includes the ${restA} just paid`);

    const ctlMove = (await glOf(tx, pay ? "AP_CONTROL" : "AR_CONTROL"))[0].v - ctlBefore;
    const settled = applyA + restA + cashB;
    ok(near(ctlMove, pay ? settled : -settled), `control account moved by everything settled (${settled})`);

    const [sub] = await tx`
      select coalesce(sum(outstanding), 0)::float as v from v_open_item
       where partner_id = ${pick.partner_id} and doc_type = ${docType} and coalesce(currency, 'MMK') = 'MMK'`;
    const ctl = (await glOf(tx, pay ? "AP_CONTROL" : "AR_CONTROL"))[0].v;
    ok(near(pay ? -ctl : ctl, sub.v), `ledger control (${pay ? -ctl : ctl}) equals open invoices (${sub.v})`);
    throw ROLLBACK;
  }).catch((e) => { if (e !== ROLLBACK) throw e; });
  console.log(`  rolled back — nothing kept\n`);
}

await run("SUPPLIER");
await run("CUSTOMER");
console.log(`${checks} checks passed`);
await sql.end();
process.exit(0);
