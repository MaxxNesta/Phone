// The customer panel on Customers (lib/customer-panel-data.ts).
//
//   ALLOW_DESTRUCTIVE_TESTS=1 ./node_modules/.bin/tsx scripts/test-customer-panel.mjs
//
// One customer buys three ways — a direct invoice, a till sale, and an order
// that is delivered in part and invoiced from the delivery — and pays part of
// the direct invoice. What this proves:
//   - total sales is the three invoices; the order is not counted on top
//   - each sale is labelled by how it came: Direct SI, POS, SO → SI, SO, DO
//   - open orders and units still to deliver come from v_order_outstanding
//   - invoice balances and paid / part-paid / unpaid match v_open_item
//   - an invoice's settlements list the receipt allocated to it
//   - activity is newest first, has the customer's creation, pages with "more"
//   - someone limited to another branch sees none of it; another company's
//     customer is refused

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
const url = process.env.DATABASE_URL;
const sql = postgres(url, { ssl: url.includes("localhost") ? false : "require",
  prepare: !url.includes("-pooler."), onnotice: () => {}, max: 1 });

await takeTestLock(sql, "test-customer-panel.mjs");
const P = await import("../lib/posting.ts");
const D = await import("../lib/customer-panel-data.ts");
const { postTillSale } = await import("../lib/pos-sale.ts");

let bad = 0;
const check = (label, ok, detail = "") => {
  if (!ok) bad++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  " + detail : ""}`);
};
const section = (s) => console.log(`\n  ${s}\n`);
const n = (v) => Number(v ?? 0);
const near = (a, b) => Math.abs(n(a) - n(b)) < 0.01;
const tr = (k, v) => `${k}${v ? " " + JSON.stringify(v) : ""}`;

const cleanMasters = async (co) => {
  await sql`delete from item where company_id = ${co} and code like '97%'`;
  await sql`delete from item_group where company_id = ${co} and segment = '97'`;
  await sql`delete from business_partner where company_id = ${co} and code in ('CPX-SUP', 'CPX-CUST')`;
};

try {
  const [co] = await sql`select id, name from company order by created_at limit 1`;
  const disposable = /—\s*DEV\b|\bDEV\b/i.test(String(co.name));
  if (!disposable || process.env.ALLOW_DESTRUCTIVE_TESTS !== "1") {
    throw new Error(`This suite empties the transaction tables. "${co.name}" must be a DEV database and ALLOW_DESTRUCTIVE_TESTS=1 set.`);
  }
  console.log(`\n  ${co.name}`);

  await resetTransactions(sql);
  await cleanMasters(co.id);
  const [loc] = await sql`select id from location where company_id = ${co.id} and is_stock_location and is_active order by code limit 1`;
  const [other] = await sql`select id from location where company_id = ${co.id} and id <> ${loc.id} order by code limit 1`;
  const [grp] = await sql`insert into item_group (company_id, segment, code, name) values (${co.id}, '97', 'x', 'Panel test') returning id`;
  const [uom] = await sql`select id from uom where company_id = ${co.id} limit 1`;
  const [item] = await sql`insert into item (company_id, item_group_id, serial, code, name, base_uom_id)
     values (${co.id}, ${grp.id}, '001', 'x', 'Panel test item', ${uom.id}) returning id`;
  const [supp] = await sql`insert into business_partner (company_id, code, name, is_supplier) values (${co.id}, 'CPX-SUP', 'Panel test supplier', true) returning id`;
  const [cust] = await sql`insert into business_partner (company_id, code, name, is_customer, payment_terms_days, credit_limit)
     values (${co.id}, 'CPX-CUST', 'Panel test customer', true, 30, 1000000) returning id`;
  const today = new Date().toISOString().slice(0, 10);
  const base = { companyId: co.id, partnerId: cust.id, locationId: loc.id, docDate: today };
  await P.postGoodsReceipt({ ...base, partnerId: supp.id, lines: [{ itemId: item.id, qty: 100, unitCost: 1000 }] });

  // ---- three ways to sell ---------------------------------------------------
  const direct = await P.postSalesInvoice({ ...base, dueDate: today,
    lines: [{ itemId: item.id, qty: 2, unitPrice: 100_000 }] });
  const [cash] = await sql`select id from payment_channel where company_id = ${co.id} and code = 'CASH'`;
  const pos = await postTillSale({ companyId: co.id, userId: null, locationId: loc.id, partnerId: cust.id,
    salesmanId: null, priceIncludesTax: true, memo: null, attempt: "panel-" + Date.now(),
    lines: [{ itemId: item.id, qty: 1, unitPrice: 50_000, discountPct: 0, taxCodeId: null }],
    payments: [{ channelId: cash.id, amount: 50_000 }] }, tr);
  const so = await P.postSalesOrder({ ...base, dueDate: today, lines: [{ itemId: item.id, qty: 3, unitPrice: 100_000 }] });
  const [soLine] = await sql`select id from document_line where document_id = ${so.id}`;
  const dlv = await P.postDelivery({ ...base, sourceDocumentId: so.id,
    lines: [{ itemId: item.id, qty: 2, sourceLineId: soLine.id }] });
  const [dlLine] = await sql`select id from document_line where document_id = ${dlv.id}`;
  const billed = await P.postSalesInvoice({ ...base, dueDate: today, deliveryId: dlv.id,
    lines: [{ itemId: item.id, qty: 2, unitPrice: 100_000, sourceLineId: dlLine.id }] });
  const [bankAcct] = await sql`select id from account where company_id = ${co.id} and is_bank_account and is_postable order by code limit 1`;
  await P.postCustomerReceipt({ companyId: co.id, partnerId: cust.id, docDate: today, cashAccountId: bankAcct.id,
    allocations: [{ invoiceId: direct.id, amount: 50_000 }] });

  const gross = async (id) => n((await sql`select gross_total from document where id = ${id}`)[0].gross_total);
  const [gDirect, gPos, gBilled] = [await gross(direct.id), await gross(pos.id), await gross(billed.id)];
  const all = { co: co.id, locs: null };

  section("sales");
  const s = await D.customerSales(all, cust.id);
  check("total sales is the three invoices", near(s.summary.totalSales, gDirect + gPos + gBilled),
    `${s.summary.totalSales} vs ${gDirect + gPos + gBilled}`);
  check("  the order is not counted on top of its invoice", !near(s.summary.totalSales, gDirect + gPos + gBilled + 300_000));
  const src = Object.fromEntries(s.rows.map((r) => [r.id, r.source]));
  check("direct invoice is Direct SI", src[direct.id] === "DIRECT", src[direct.id]);
  check("till sale is POS", src[pos.id] === "POS", src[pos.id]);
  check("invoice from the delivery is SO → SI", src[billed.id] === "SO_SI", src[billed.id]);
  check("order and delivery are listed as SO and DO", src[so.id] === "SO" && src[dlv.id] === "DO");
  check("one open order, one unit still to deliver", s.summary.openOrders === 1 && near(s.summary.toDeliver, 1),
    `${s.summary.openOrders} / ${s.summary.toDeliver}`);
  check("  and the order row says so", near(s.rows.find((r) => r.id === so.id)?.toDeliver, 1));
  check("newest first", s.rows.every((r, i, a) => i === 0 || (a[i - 1].date ?? "") >= (r.date ?? "")));

  section("invoices");
  const inv = await D.customerInvoices(all, cust.id);
  const by = Object.fromEntries(inv.rows.map((r) => [r.id, r]));
  check("three invoices, the order is not one", inv.rows.length === 3, String(inv.rows.length));
  check("direct invoice part-paid, 50,000 off", by[direct.id]?.status === "PARTIAL" && near(by[direct.id].outstanding, gDirect - 50_000),
    `${by[direct.id]?.status} ${by[direct.id]?.outstanding}`);
  check("till sale paid", by[pos.id]?.status === "PAID" && near(by[pos.id].outstanding, 0), by[pos.id]?.status);
  check("  and flagged as POS", by[pos.id]?.pos === true);
  check("invoice from the order unpaid", by[billed.id]?.status === "UNPAID" && near(by[billed.id].outstanding, gBilled));
  const open = n((await sql`select coalesce(sum(outstanding),0) as v from v_open_item where partner_id = ${cust.id}`)[0].v);
  check("outstanding agrees with v_open_item", near(inv.summary.outstanding, open), `${inv.summary.outstanding} vs ${open}`);
  check("two unpaid invoices, none overdue", inv.summary.unpaid === 2 && near(inv.summary.overdue, 0));
  check("total invoiced", near(inv.summary.invoiced, gDirect + gPos + gBilled));
  const st = await D.invoiceSettlements(all, cust.id, direct.id);
  check("the direct invoice's receipt is listed", st.length === 1 && st[0].docType === "CUSTOMER_RECEIPT" && near(st[0].amount, 50_000),
    JSON.stringify(st.map((x) => [x.docType, x.amount])));
  const stPos = await D.invoiceSettlements(all, cust.id, pos.id);
  check("the till sale's receipt settles it", stPos.length >= 1 && near(stPos.reduce((t, x) => t + x.amount, 0), gPos));

  section("overview and activity");
  const ov = await D.customerOverview(all, cust.id);
  check("overview outstanding is the same figure", near(ov.outstanding, open));
  check("recent activity is at most five", ov.recent.length === 5);
  const act = await D.customerActivity(all, cust.id);
  check("activity includes the customer's creation", act.rows.some((a) => a.kind === "CREATED"));
  check("activity lists every document once",
    new Set(act.rows.filter((a) => a.docId).map((a) => a.docId)).size === act.rows.filter((a) => a.docId).length);
  check("newest first", act.rows.every((r, i, a) => i === 0 || (a[i - 1].at ?? "") >= (r.at ?? "")));
  const page2 = await D.customerActivity(all, cust.id, 3);
  check("load more continues where the first page stopped", page2.rows[0]?.docId === act.rows[3]?.docId);

  section("isolation");
  if (other) {
    const elsewhere = await D.customerSales({ co: co.id, locs: [other.id] }, cust.id);
    check("someone at another branch sees none of these sales", elsewhere.rows.length === 0 && near(elsewhere.summary.totalSales, 0));
  }
  let refused = null;
  try { await D.customerSales({ co: "00000000-0000-0000-0000-000000000000", locs: null }, cust.id); }
  catch (e) { refused = String(e.message); }
  check("another company's customer is refused", /not in this company/.test(refused ?? ""), refused ?? "allowed");
} catch (err) {
  bad++;
  console.error("\n  ERROR", err);
} finally {
  const [co] = await sql`select id from company order by created_at limit 1`;
  await resetTransactions(sql).catch(() => {});
  if (co) await cleanMasters(co.id).catch(() => {});
  await releaseTestLock(sql);
  await sql.end();
  const { sql: appSql } = await import("../lib/db.ts");
  await appSql.end({ timeout: 1 }).catch(() => {});
  console.log(bad ? `\n  ${bad} FAILED\n` : "\n  all passed\n");
  process.exit(bad ? 1 : 0);
}
