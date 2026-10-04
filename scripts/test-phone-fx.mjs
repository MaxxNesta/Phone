// Buying in yuan, selling in kyat: receipts valued at the day's rate, bills
// carried as yuan debts, payments and advances settled with exchange gain or
// loss, and every kyat reconciling.
//
//   npx tsx scripts/test-phone-fx.mjs
//
// Destructive like every suite here: never run it against pilot or production.

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
const sql = postgres(url, { ssl: url.includes("localhost") ? false : "require",
  prepare: !url.includes("-pooler."), onnotice: () => {}, max: 1 });

await takeTestLock(sql, "test-phone-fx.mjs");
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
    select id from location where company_id = ${co.id} and is_stock_location and code <> 'BR2-WH'
     order by code limit 1`;
  const party = async (code, name, cols) => {
    const [f] = await sql`select id from business_partner where company_id=${co.id} and code=${code}`;
    if (f) return f;
    return (await sql`insert into business_partner ${sql({ company_id: co.id, code, name, ...cols })}
      returning id`)[0];
  };
  const sz = await party("FX-SZ", "Shenzhen Supplier", { is_supplier: true, currency: "CNY" });
  const cust = await party("FX-C", "FX Customer", { is_customer: true });
  const [grp] = await sql`select id from item_group where company_id = ${co.id} limit 1`;
  const [uom] = await sql`select id from uom where company_id = ${co.id} limit 1`;
  const ensure = async (serial, name, cols) => {
    const [f] = await sql`select id from item where company_id = ${co.id} and serial = ${serial}`;
    if (f) return f;
    return (await sql`insert into item ${sql({ company_id: co.id, item_group_id: grp.id, code: serial,
      serial, name, base_uom_id: uom.id, is_stocked: true, ...cols })} returning id`)[0];
  };
  const phone = await ensure("FX-PHONE", "Redmi Note 15", { tracks_serial: true });
  const charger = await ensure("FX-CHG", "Charger", {});
  const [bank] = await sql`select id from account where company_id = ${co.id} and code = '1010'`;
  const DAY = (await sql`select to_char(current_date,'YYYY-MM-DD') as d`)[0].d;
  const bal = async (code) => r2((await sql`
    select coalesce(sum(jl.base_amount), 0) v from journal_line jl join account a on a.id = jl.account_id
     where a.company_id = ${co.id} and a.code = ${code}`)[0].v);
  const open = async (id) => (await sql`select * from v_open_item where document_id = ${id}`)[0];

  console.log("\n  rates");
  await refuses("a yuan document with no rate is refused",
    () => P.postGoodsReceipt({ companyId: co.id, partnerId: sz.id, locationId: wh.id, docDate: DAY,
      currency: "CNY", lines: [{ itemId: charger.id, qty: 1, unitCost: 10 }] }), /rate/);
  await sql`insert into exchange_rate (company_id, from_currency, to_currency, rate_type, valid_from, rate)
            values (${co.id}, 'CNY', 'MMK', 'MARKET', ${DAY}::date, 450)`;

  console.log("\n  receive and bill in yuan");
  const gr = await P.postGoodsReceipt({ companyId: co.id, partnerId: sz.id, locationId: wh.id, docDate: DAY,
    currency: "CNY", lines: [{ itemId: phone.id, qty: 2, unitCost: 3000, serials: ["FX-1", "FX-2"] }] });
  const [grDoc] = await sql`select currency, exchange_rate, gross_total from document where id = ${gr.id}`;
  check("receipt uses the rate on file", grDoc.currency === "CNY" && n(grDoc.exchange_rate) === 450);
  check("stock valued in kyat at that rate", r2(grDoc.gross_total) === 2_700_000 && (await bal("1040")) === 2_700_000);

  const pi = await P.postPurchaseInvoice({ companyId: co.id, partnerId: sz.id, locationId: wh.id,
    docDate: DAY, dueDate: DAY, goodsReceiptId: gr.id, currency: "CNY", exchangeRate: 480,
    lines: [{ itemId: phone.id, qty: 2, unitPrice: 3000 }] });
  const [piDoc] = await sql`select exchange_rate, gross_total from document where id = ${pi.id}`;
  check("bill for a yuan receipt takes the receipt's rate, not its own",
    n(piDoc.exchange_rate) === 450 && r2(piDoc.gross_total) === 2_700_000);
  check("GR/IR clears exactly, no variance", (await bal("1060")) === 0 && (await bal("5050")) === 0);
  const [apLine] = await sql`
    select jl.currency, jl.amount, jl.exchange_rate, jl.base_amount from document d
      join journal_line jl on jl.journal_entry_id = d.journal_entry_id
     where d.id = ${pi.id}
       and jl.account_id = fn_resolve_control_account(${co.id}, 'AP_CONTROL', ${sz.id})`;
  check("payable carried as a yuan debt", apLine.currency === "CNY" && r2(apLine.amount) === -6000
    && r2(apLine.base_amount) === -2_700_000 && n(apLine.exchange_rate) === 450);
  check("open item shows ¥6,000 owing", r2((await open(pi.id)).fc_outstanding) === 6000);

  console.log("\n  pay in yuan");
  await refuses("a yuan bill cannot be paid in kyat",
    () => P.postSupplierPayment({ companyId: co.id, partnerId: sz.id, docDate: DAY, cashAccountId: bank.id,
      allocations: [{ invoiceId: pi.id, amount: 100 }] }), /settled in CNY/);
  const fxLossBefore = await bal("6400");
  const p1 = await P.postSupplierPayment({ companyId: co.id, partnerId: sz.id, docDate: DAY,
    cashAccountId: bank.id, currency: "CNY", exchangeRate: 460, locationId: wh.id,
    allocations: [{ invoiceId: pi.id, amount: 2000 }] });
  check("part payment: bank pays at today's rate", (await bal("1010")) === -920_000);
  check("…the debt comes down at its own rate", r2((await open(pi.id)).fc_outstanding) === 4000
    && r2((await open(pi.id)).outstanding) === 1_800_000);
  check("…and the difference is FX loss", r2((await bal("6400")) - fxLossBefore) === 20_000);
  const p2 = await P.postSupplierPayment({ companyId: co.id, partnerId: sz.id, docDate: DAY,
    cashAccountId: bank.id, currency: "CNY", exchangeRate: 440.123, locationId: wh.id,
    allocations: [{ invoiceId: pi.id, amount: 4000 }] });
  check("final payment leaves nothing owing, to the kyat", !(await open(pi.id)));
  check("gain on the second part", (await bal("4100")) === r2(-(1_800_000 - 4000 * 440.123)));
  await refuses("cannot overpay", () => P.postSupplierPayment({ companyId: co.id, partnerId: sz.id,
    docDate: DAY, cashAccountId: bank.id, currency: "CNY", exchangeRate: 450, locationId: wh.id,
    allocations: [{ invoiceId: pi.id, amount: 1 }] }), /outstanding|no longer|POSTED|settled/i);

  console.log("\n  void restores the yuan debt");
  await P.voidDocument({ documentId: p2.id, reason: "test" });
  check("voided payment: ¥4,000 owing again", r2((await open(pi.id)).fc_outstanding) === 4000);
  const [vl] = await sql`
    select jl.currency, jl.amount from document d join journal_line jl on jl.journal_entry_id = d.journal_entry_id
     where d.reverses_document_id = ${p2.id} and jl.partner_id = ${sz.id}`;
  check("reversal line is in yuan", vl.currency === "CNY" && r2(vl.amount) === -4000);

  console.log("\n  advance in yuan, applied to a later bill");
  const adv = await P.postSupplierPayment({ companyId: co.id, partnerId: sz.id, docDate: DAY,
    cashAccountId: bank.id, currency: "CNY", exchangeRate: 450, locationId: wh.id,
    allocations: [], advance: 1000 });
  check("advance carried at its rate", r2((await sql`select available, fc_available from v_partner_advance
    where payment_id = ${adv.id}`)[0].fc_available) === 1000);
  const pi2 = await P.postPurchaseWithReceipt({ companyId: co.id, partnerId: sz.id, locationId: wh.id,
    docDate: DAY, dueDate: DAY, currency: "CNY", exchangeRate: 470,
    lines: [{ itemId: charger.id, qty: 10, unitPrice: 100 }] });
  check("receive-and-bill in yuan uses one rate", r2((await open(pi2.id)).outstanding) === 470_000);
  const gainBefore = await bal("4100");
  await P.applyAdvance({ companyId: co.id, invoiceId: pi2.id, docDate: DAY,
    allocations: [{ paymentId: adv.id, amount: 1000 }] });
  check("bill settled by the advance", !(await open(pi2.id)));
  check("advance used up", !(await sql`select 1 from v_partner_advance where payment_id = ${adv.id}`)[0]);
  check("gain: debt carried at 470, paid with yuan bought at 450",
    r2((await bal("4100")) - gainBefore) === -20_000);

  console.log("\n  return and sale");
  const pr = await P.postPurchaseReturn({ companyId: co.id, partnerId: sz.id, locationId: wh.id,
    docDate: DAY, sourceDocumentId: pi.id,
    lines: [{ itemId: phone.id, qty: 1, unitPrice: 3000, serials: ["FX-1"] }] });
  check("return against a yuan bill takes ¥3,000 off it", r2((await open(pi.id)).fc_outstanding) === 1000);
  check("…at the bill's rate", r2((await sql`select gross_total from document where id = ${pr.id}`)[0].gross_total) === 1_350_000);
  const sale = await P.postRetailSale({ companyId: co.id, partnerId: cust.id, locationId: wh.id,
    docDate: DAY, dueDate: DAY, paymentType: "CREDIT",
    lines: [{ itemId: phone.id, qty: 1, unitPrice: 1_600_000, serials: ["FX-2"] }] });
  const [cogs] = await sql`select coalesce(sum(jl.base_amount),0) v from document d
    join journal_line jl on jl.journal_entry_id = d.journal_entry_id join account a on a.id = jl.account_id
   where d.id = ${sale.id} and a.code = '5000'`;
  check("a phone bought in yuan sells in kyat at its kyat cost", r2(cogs.v) === 1_350_000);

  console.log("\n  reconciliation");
  check("trial balance balances", r2((await sql`select coalesce(sum(base_amount),0) v from journal_line
    where company_id = ${co.id}`)[0].v) === 0);
  const [ap] = await sql`select coalesce(sum(outstanding),0) v from v_open_item
    where company_id = ${co.id} and doc_type = 'PURCHASE_INVOICE'`;
  const [apGl] = await sql`select coalesce(sum(jl.base_amount),0) v from journal_line jl
    where jl.account_id = fn_resolve_control_account(${co.id}, 'AP_CONTROL', ${sz.id})`;
  check("payables ledger equals the open bills, in kyat", r2(-apGl.v) === r2(ap.v), `${-apGl.v} vs ${ap.v}`);
  const [fcGl] = await sql`select coalesce(sum(jl.amount),0) v from journal_line jl
    where jl.account_id = fn_resolve_control_account(${co.id}, 'AP_CONTROL', ${sz.id})
      and jl.currency = 'CNY' and jl.partner_id = ${sz.id}`;
  const [fcOpen] = await sql`select coalesce(sum(fc_outstanding),0) v from v_open_item
    where partner_id = ${sz.id} and doc_type = 'PURCHASE_INVOICE'`;
  check("…and in yuan", r2(-fcGl.v) === r2(fcOpen.v), `${-fcGl.v} vs ${fcOpen.v}`);
} catch (e) {
  failures++;
  console.error("\n  ERROR", e);
} finally {
  await releaseTestLock(sql);
  await sql.end();
  const { sql: appSql } = await import("../lib/db.ts");
  await appSql.end({ timeout: 1 }).catch(() => {});
  console.log(failures === 0 ? "\n  all currency checks passed\n" : `\n  ${failures} FAILED\n`);
  process.exit(failures === 0 ? 0 : 1);
}
