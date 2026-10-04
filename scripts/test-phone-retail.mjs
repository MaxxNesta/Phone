// Phone retail: serialized stock end to end, and the counter sale that posts
// revenue and cost of sales together on the invoice — no delivery, no 1090.
//
//   npx tsx scripts/test-phone-retail.mjs
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
const pooled = url.includes("-pooler.");
const sql = postgres(url, { ssl: local ? false : "require", prepare: !pooled, onnotice: () => {}, max: 1 });

await takeTestLock(sql, "test-phone-retail.mjs");
let failures = 0;
const check = (label, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
};
const n = (v) => Number(v ?? 0);
const r2 = (v) => Math.round(n(v) * 100) / 100;
const refuses = async (label, fn, pattern) => {
  try {
    await fn();
    check(label, false, "posted, expected a refusal");
  } catch (e) {
    check(label, !pattern || pattern.test(e.message), e.message.slice(0, 110));
  }
};

try {
  const [co] = await sql`select id from company order by created_at limit 1`;
  await resetTransactions(sql);
  await sql`update company set retail_mode = true where id = ${co.id}`;

  const [wh] = await sql`
    select id, parent_id from location where company_id = ${co.id} and is_stock_location and code <> 'BR2-WH' order by code limit 1`;

  // A second shop, with its own stock room.
  const place = async (code, name, parent, stock) => {
    const [f] = await sql`select id from location where company_id = ${co.id} and code = ${code}`;
    if (f) return f;
    return (await sql`insert into location (company_id, code, name, parent_id, is_stock_location)
      values (${co.id}, ${code}, ${name}, ${parent}, ${stock}) returning id`)[0];
  };
  const br2 = await place("BR2", "Branch 2", null, false);
  const wh2 = await place("BR2-WH", "Branch 2 Stock", br2.id, true);

  const party = async (code, name, cols) => {
    const [f] = await sql`select id from business_partner where company_id=${co.id} and code=${code}`;
    if (f) return f;
    return (await sql`insert into business_partner ${sql({ company_id: co.id, code, name, ...cols })}
      returning id`)[0];
  };
  const supp = await party("PH-S", "Phone Distributor", { is_supplier: true });
  const supp2 = await party("PH-S2", "Other Distributor", { is_supplier: true });
  const custA = await party("PH-A", "Customer A", { is_customer: true, payment_terms_days: 30 });
  const custB = await party("PH-B", "Customer B", { is_customer: true, payment_terms_days: 30 });

  const [grp] = await sql`select id from item_group where company_id = ${co.id} limit 1`;
  const [uom] = await sql`select id from uom where company_id = ${co.id} limit 1`;
  const ensureItem = async (serial, name, cols = {}) => {
    const [f] = await sql`select id from item where company_id = ${co.id} and serial = ${serial}`;
    if (f) { await sql`update item set ${sql(cols)} where id = ${f.id}`.catch(() => {}); return f; }
    return (await sql`insert into item ${sql({ company_id: co.id, item_group_id: grp.id,
      code: serial, serial, name, base_uom_id: uom.id, is_stocked: true, ...cols })} returning id`)[0];
  };
  const phone = await ensureItem("PH-IP16-256-BK", "iPhone 16 256GB Black",
    { tracks_serial: true, warranty_months: 12, supplier_warranty_months: 12 });
  const phone2 = await ensureItem("PH-S26-512-BL", "Galaxy S26 512GB Blue",
    { tracks_serial: true, warranty_months: 6 });
  const caseItem = await ensureItem("PH-CASE", "Clear case", { tracks_serial: false });
  const [ct5] = await sql`select id from tax_code where company_id = ${co.id} and code = 'CT5'`;
  const [cash] = await sql`select id from account where company_id = ${co.id} and code = '1000'`;

  const DAY = (await sql`select to_char(current_date,'YYYY-MM-DD') as d`)[0].d;
  const bal = async (code) => r2((await sql`
    select coalesce(sum(jl.base_amount), 0) as v from journal_line jl
      join account a on a.id = jl.account_id
     where a.company_id = ${co.id} and a.code = ${code}`)[0].v);
  const unit = async (imei) => (await sql`select * from v_stock_serial where imei = ${imei}`)[0];
  const entryOf = async (docId, code) => r2((await sql`
    select coalesce(sum(jl.base_amount), 0) as v from document d
      join journal_line jl on jl.journal_entry_id = d.journal_entry_id
      join account a on a.id = jl.account_id
     where d.id = ${docId} and a.code = ${code}`)[0].v);

  const receive = (imeis, cost, extra = {}) => P.postGoodsReceipt({
    companyId: co.id, partnerId: supp.id, locationId: wh.id, docDate: DAY,
    lines: [{ itemId: phone.id, qty: imeis.length, unitCost: cost, serials: imeis, ...extra }],
  });
  const sell = (lines, extra = {}) => P.postRetailSale({
    companyId: co.id, partnerId: custA.id, locationId: wh.id, docDate: DAY, dueDate: DAY,
    paymentType: "CASH", lines, ...extra,
  });

  console.log("\n  purchase");
  const gr1 = await receive(["IMEI-A1", "IMEI-A2", "IMEI-A3"], 1_000_000, {
    unitDetails: [{ serial: "IMEI-A1", imei2: "IMEI-A1-2", deviceSerial: "SN-A1" }],
  });
  check("three phones received, each its own unit",
    n((await sql`select count(*) c from v_stock_serial where status = 'IN_STOCK'`)[0].c) === 3);
  check("IMEI 2 and maker's serial kept", (await unit("IMEI-A1"))?.imei2 === "IMEI-A1-2"
    && (await unit("IMEI-A1"))?.device_serial === "SN-A1");
  check("supplier and receipt reachable from the unit",
    (await unit("IMEI-A2"))?.supplier_id === supp.id
    && (await unit("IMEI-A2"))?.received_document_id === gr1.id);
  await refuses("receipt quantity must equal serial count",
    () => receive(["IMEI-X1"], 1_000_000, { qty: 2 }), /serial/);
  await refuses("duplicate IMEI rejected", () => receive(["IMEI-A2"], 1_000_000), /already/);
  await refuses("IMEI already used as someone's IMEI 2 rejected",
    () => receive(["IMEI-A1-2"], 1_000_000), /already/);
  await refuses("found stock of a phone is a receipt, not an adjustment",
    () => P.postStockAdjustment({ companyId: co.id, locationId: wh.id, docDate: DAY,
      lines: [{ itemId: phone.id, qty: 1, unitCost: 1 }] }), /goods receipt/);

  const gr2 = await receive(["IMEI-B1"], 1_200_000);

  const cogsBeforePi = await bal("5000");
  const pi = await P.postPurchaseInvoice({
    companyId: co.id, partnerId: supp.id, locationId: wh.id, docDate: DAY, dueDate: DAY,
    goodsReceiptId: gr1.id,
    lines: [{ itemId: phone.id, qty: 3, unitPrice: 1_000_000 }],
  });
  check("purchase invoice creates no cost of sales",
    (await bal("5000")) === cogsBeforePi && (await entryOf(pi.id, "5000")) === 0);
  check("purchase invoice clears GR/IR for what it bills",
    (await bal("1060")) === -1_200_000, `1060 = ${await bal("1060")}`);

  await refuses("purchase return to the wrong supplier refused",
    () => P.postPurchaseReturn({ companyId: co.id, partnerId: supp2.id, locationId: wh.id,
      docDate: DAY, lines: [{ itemId: phone.id, qty: 1, unitPrice: 1_000_000, serials: ["IMEI-A3"] }] }),
    /came from/);
  const pr = await P.postPurchaseReturn({ companyId: co.id, partnerId: supp.id, locationId: wh.id,
    docDate: DAY, sourceDocumentId: pi.id,
    lines: [{ itemId: phone.id, qty: 1, unitPrice: 1_000_000, serials: ["IMEI-A3"] }] });
  check("purchase return sends back the exact unit",
    (await unit("IMEI-A3"))?.status === "RETURNED_TO_SUPPLIER");
  check("purchase return relieves that unit's cost", (await entryOf(pr.id, "1040")) === -1_000_000);

  console.log("\n  counter sale");
  await sql`insert into stock_serial_hold (company_id, serial_id, kind)
    select ${co.id}, serial_id, 'RESERVED' from v_stock_serial where imei = 'IMEI-A2'`;
  await refuses("reserved unit cannot be sold until released",
    () => sell([{ itemId: phone.id, qty: 1, unitPrice: 1_500_000, serials: ["IMEI-A2"] }]), /reserved/);
  await sql`update stock_serial_hold set released_at = now() where released_at is null`;

  const docsBefore = n((await sql`select count(*) c from document where doc_type = 'DELIVERY'`)[0].c);
  const invBefore = await bal("1040");
  const s1 = await sell([{ itemId: phone.id, qty: 1, unitPrice: 1_500_000, serials: ["IMEI-B1"] }],
    { cashIn: 1_500_000, cashAccountId: cash.id });
  check("sale costs the exact unit, not the oldest layer",
    (await entryOf(s1.id, "5000")) === 1_200_000, `COGS ${await entryOf(s1.id, "5000")}`);
  check("revenue and cost of sales in one entry",
    (await entryOf(s1.id, "4000")) === -1_500_000 && (await entryOf(s1.id, "1040")) === -1_200_000);
  check("inventory relieved once", r2(invBefore - (await bal("1040"))) === 1_200_000);
  check("no delivery document", n((await sql`select count(*) c from document where doc_type = 'DELIVERY'`)[0].c) === docsBefore);
  check("goods-shipped-not-invoiced untouched", (await bal("1090")) === 0);
  check("cash sale settled at the counter",
    n((await sql`select outstanding from v_open_item where document_id = ${s1.id}`)[0]?.outstanding) === 0);
  const u1 = await unit("IMEI-B1");
  check("unit becomes SOLD, to that customer, on that invoice",
    u1?.status === "SOLD" && u1.customer_id === custA.id && u1.out_document_id === s1.id);
  check("warranty from the model, expiring a year on",
    u1?.warranty_months === 12 && u1?.warranty_expiry !== null);
  await refuses("the same IMEI cannot be sold twice",
    () => sell([{ itemId: phone.id, qty: 1, unitPrice: 1_500_000, serials: ["IMEI-B1"] }]), /already sold/);
  await refuses("a phone line needs its IMEI",
    () => sell([{ itemId: phone.id, qty: 1, unitPrice: 1_500_000 }]), /serial/);
  await refuses("an IMEI of a different model refused",
    () => sell([{ itemId: phone2.id, qty: 1, unitPrice: 1_500_000, serials: ["IMEI-A1"] }]), /not the item/);

  // Accessories: anonymous stock, ordinary FIFO.
  await P.postGoodsReceipt({ companyId: co.id, partnerId: supp.id, locationId: wh.id, docDate: DAY,
    lines: [{ itemId: caseItem.id, qty: 10, unitCost: 5_000 }] });

  const s2 = await P.postRetailSale({
    companyId: co.id, partnerId: custB.id, locationId: wh.id, docDate: DAY, dueDate: DAY,
    paymentType: "CREDIT",
    lines: [
      { itemId: phone.id, qty: 1, unitPrice: 1_400_000, discountPct: 10, taxCodeId: ct5.id, serials: ["IMEI-A1"] },
      { itemId: caseItem.id, qty: 2, unitPrice: 20_000, taxCodeId: ct5.id },
    ],
  });
  // 1,400,000 less 10% = 1,260,000; cases 40,000; net 1,300,000; tax 5% 65,000.
  check("credit sale: receivable is the gross", (await entryOf(s2.id, "1030")) === 1_365_000,
    `${await entryOf(s2.id, "1030")}`);
  check("discount shown as contra-revenue", (await entryOf(s2.id, "4020")) === 140_000);
  check("tax charged", (await entryOf(s2.id, "7000")) === -65_000);
  check("phone + accessory cost together", (await entryOf(s2.id, "5000")) === 1_010_000);
  check("accessory stock down by two",
    n((await sql`select fn_qty_on_hand(${co.id}, ${caseItem.id}, ${wh.id}) q`)[0].q) === 8);

  const gr3 = await receive(["IMEI-C1", "IMEI-C2"], 900_000);
  const s3 = await sell([{ itemId: phone.id, qty: 2, unitPrice: 1_300_000, serials: ["IMEI-C1", "IMEI-C2"] }],
    { cashIn: 2_600_000, cashAccountId: cash.id });
  check("two phones on one invoice", (await entryOf(s3.id, "5000")) === 1_800_000
    && (await unit("IMEI-C1")).status === "SOLD" && (await unit("IMEI-C2")).status === "SOLD");

  console.log("\n  returns");
  await refuses("another customer cannot return it",
    () => P.postSalesReturn({ companyId: co.id, partnerId: custA.id, locationId: wh.id, docDate: DAY,
      lines: [{ itemId: phone.id, qty: 1, unitPrice: 1_260_000, serials: ["IMEI-A1"] }] }),
    /different customer/);
  const ret = await P.postSalesReturn({ companyId: co.id, partnerId: custB.id, locationId: wh.id,
    docDate: DAY, sourceDocumentId: s2.id,
    lines: [{ itemId: phone.id, qty: 1, unitPrice: 1_260_000, taxCodeId: ct5.id, serials: ["IMEI-A1"] }] });
  const ua = await unit("IMEI-A1");
  check("returned unit back on the shelf", ua.status === "IN_STOCK" && ua.was_returned);
  check("restored at its original cost", r2(ua.unit_cost) === 1_000_000
    && (await entryOf(ret.id, "1040")) === 1_000_000 && (await entryOf(ret.id, "5000")) === -1_000_000);
  check("revenue reversed against the invoice", (await entryOf(ret.id, "4010")) === 1_260_000
    && (await entryOf(ret.id, "1030")) === -1_323_000);
  check("one unit record, not a duplicate",
    n((await sql`select count(*) c from stock_serial where serial_no = 'IMEI-A1'`)[0].c) === 1);
  await refuses("cannot return it twice",
    () => P.postSalesReturn({ companyId: co.id, partnerId: custB.id, locationId: wh.id, docDate: DAY,
      lines: [{ itemId: phone.id, qty: 1, unitPrice: 1, serials: ["IMEI-A1"] }] }), /not out/);
  const s4 = await sell([{ itemId: phone.id, qty: 1, unitPrice: 1_450_000, serials: ["IMEI-A1"] }]);
  check("returned unit sells again at its own cost", (await entryOf(s4.id, "5000")) === 1_000_000);

  console.log("\n  void and amend");
  await refuses("void of a counter sale asks whether the goods are back",
    () => P.voidDocument({ documentId: s1.id, reason: "test" }), /shelf/);
  const v1 = await P.voidDocument({ documentId: s1.id, reason: "keyed wrong", goodsBack: true });
  const ub = await unit("IMEI-B1");
  check("voided sale puts the unit back", ub.status === "IN_STOCK" && r2(ub.unit_cost) === 1_200_000);
  check("void reverses revenue and cost", (await entryOf(v1.reversalId, "4000")) === 1_500_000
    && (await entryOf(v1.reversalId, "5000")) === -1_200_000);
  check("original kept, marked reversed, history written",
    (await sql`select status from document where id = ${s1.id}`)[0].status === "REVERSED"
    && n((await sql`select count(*) c from document_history where document_id = ${s1.id} and action = 'VOID'`)[0].c) === 1);
  check("cost claims released with it",
    n((await sql`select coalesce(sum(a.qty),0) q from sales_cost_allocation a
                  join document_line dl on dl.id = a.invoice_line_id where dl.document_id = ${s1.id}`)[0].q) === 0);

  // s4 is on account, unpaid: correct its price.
  const am = await P.amendInvoice({
    companyId: co.id, documentId: s4.id, reason: "agreed price",
    invoice: { companyId: co.id, partnerId: custA.id, locationId: wh.id, docDate: DAY, dueDate: DAY,
      paymentType: "CREDIT",
      lines: [{ itemId: phone.id, qty: 1, unitPrice: 1_420_000, serials: ["IMEI-A1"] }] },
  });
  const amId = am.replacementId;
  const [v2] = await sql`select doc_no, version, supersedes_document_id from document where id = ${amId}`;
  check("amendment is the next version under the same number",
    v2.version === 2 && v2.supersedes_document_id === s4.id);
  check("amended sale still costs the unit once",
    (await entryOf(amId, "5000")) === 1_000_000 && (await unit("IMEI-A1")).out_document_id === amId);
  await refuses("amendment cannot swap the handset",
    () => P.amendInvoice({ companyId: co.id, documentId: amId, reason: "swap",
      invoice: { companyId: co.id, partnerId: custA.id, locationId: wh.id, docDate: DAY, dueDate: DAY,
        paymentType: "CREDIT", lines: [{ itemId: phone.id, qty: 1, unitPrice: 1_420_000, serials: ["IMEI-A2"] }] } }),
    /which handsets/);

  await P.postCustomerReceipt({ companyId: co.id, partnerId: custA.id, docDate: DAY,
    cashAccountId: cash.id, allocations: [{ invoiceId: amId, amount: 1_420_000 }] });
  await refuses("paid invoice cannot be voided", () => P.voidDocument({ documentId: amId, goodsBack: true }),
    /settled/);

  console.log("\n  transfer");
  const gr4 = await receive(["IMEI-D1"], 1_100_000);
  await P.postStockTransfer({ companyId: co.id, fromLocationId: wh.id, toLocationId: wh2.id, docDate: DAY,
    lines: [{ itemId: phone.id, qty: 1, serials: ["IMEI-D1"] }] });
  const ud = await unit("IMEI-D1");
  check("unit moves branch with its identity", ud.location_id === wh2.id && ud.status === "IN_STOCK" && ud.was_transferred);
  check("and its cost", r2(ud.unit_cost) === 1_100_000);
  await refuses("cannot be sold at the old branch",
    () => sell([{ itemId: phone.id, qty: 1, unitPrice: 1_500_000, serials: ["IMEI-D1"] }]), /Transfer it here/);
  const s5 = await P.postRetailSale({ companyId: co.id, partnerId: custA.id, locationId: wh2.id,
    docDate: DAY, dueDate: DAY, paymentType: "CREDIT",
    lines: [{ itemId: phone.id, qty: 1, unitPrice: 1_500_000, serials: ["IMEI-D1"] }] });
  check("sold at the new branch at its own cost", (await entryOf(s5.id, "5000")) === 1_100_000);

  console.log("\n  write-off");
  await P.postStockAdjustment({ companyId: co.id, locationId: wh.id, docDate: DAY,
    lines: [{ itemId: phone.id, qty: -1, serials: ["IMEI-A2"] }] });
  check("lost unit written off by name", (await unit("IMEI-A2")).status === "WRITTEN_OFF");

  console.log("\n  concurrency");
  await receive(["IMEI-E1"], 950_000);
  const race = await Promise.allSettled([
    sell([{ itemId: phone.id, qty: 1, unitPrice: 1_300_000, serials: ["IMEI-E1"] }]),
    sell([{ itemId: phone.id, qty: 1, unitPrice: 1_300_000, serials: ["IMEI-E1"] }]),
  ]);
  check("two tills, one IMEI: exactly one sale",
    race.filter((r) => r.status === "fulfilled").length === 1,
    race.map((r) => r.status === "rejected" ? r.reason.message.slice(0, 60) : "ok").join(" | "));
  check("the unit was issued once",
    n((await sql`select count(*) c from stock_serial_issue si join stock_serial s on s.id = si.serial_id
                  where s.serial_no = 'IMEI-E1'`)[0].c) === 1);
  await refuses("database refuses a second issue of a sold unit directly", () => sql`
    insert into stock_serial_issue (company_id, serial_id, stock_movement_id, lot_id)
    select s.company_id, s.id, si.stock_movement_id, s.stock_lot_id
      from stock_serial s join stock_serial_issue si on si.serial_id = s.id
     where s.serial_no = 'IMEI-E1' limit 1`, /already gone out/);

  console.log("\n  reconciliation");
  const [tb] = await sql`select coalesce(sum(base_amount), 0) v from journal_line where company_id = ${co.id}`;
  check("trial balance balances", r2(tb.v) === 0);
  check("1090 never used", (await bal("1090")) === 0);
  const [stockValue] = await sql`
    select coalesce(sum((l.qty_received - coalesce(c.q, 0)) * (l.unit_cost + coalesce(a.d, 0))), 0) v
      from stock_lot l
      left join (select lot_id, sum(qty) q from stock_lot_consumption group by lot_id) c on c.lot_id = l.id
      left join (select lot_id, sum(delta_unit_cost) d from stock_lot_adjustment group by lot_id) a on a.lot_id = l.id
     where l.company_id = ${co.id}`;
  check("inventory GL equals the valued stock layers", r2(stockValue.v) === (await bal("1040")),
    `${r2(stockValue.v)} vs ${await bal("1040")}`);
  const [serialVal] = await sql`
    select count(*) c, coalesce(sum(unit_cost), 0) v from v_stock_serial
     where item_id = ${phone.id} and status = 'IN_STOCK'`;
  const [phoneQty] = await sql`
    select coalesce(sum(fn_qty_on_hand(${co.id}, ${phone.id}, l.id)), 0) q
      from location l where l.company_id = ${co.id} and l.is_stock_location`;
  check("serials in stock equal the phone quantity on hand", n(serialVal.c) === n(phoneQty.q),
    `${serialVal.c} serials vs ${phoneQty.q} on hand`);
  const [phoneLayers] = await sql`
    select coalesce(sum((l.qty_received - coalesce(c.q, 0)) * l.unit_cost), 0) v
      from stock_lot l
      left join (select lot_id, sum(qty) q from stock_lot_consumption group by lot_id) c on c.lot_id = l.id
     where l.item_id = ${phone.id}`;
  check("serial stock value equals the phone layers' value", r2(serialVal.v) === r2(phoneLayers.v),
    `${r2(serialVal.v)} vs ${r2(phoneLayers.v)}`);
  const [claims] = await sql`
    select coalesce(sum(a.qty * a.unit_cost), 0) v from sales_cost_allocation a where a.company_id = ${co.id}`;
  const [returnsCost] = await sql`
    select coalesce(sum(jl.base_amount), 0) v from journal_line jl
      join account a on a.id = jl.account_id join journal_entry je on je.id = jl.journal_entry_id
      join document d on d.journal_entry_id = je.id
     where a.code = '5000' and d.doc_type = 'SALES_RETURN'`;
  check("cost of sales = posted sales cost less returns",
    (await bal("5000")) === r2(n(claims.v) + n(returnsCost.v)),
    `${await bal("5000")} vs ${r2(n(claims.v) + n(returnsCost.v))}`);
  const [rev] = await sql`
    select coalesce(sum(dl.net_amount), 0) v from document_line dl join document d on d.id = dl.document_id
     where d.doc_type = 'SALES_INVOICE' and d.status = 'POSTED' and d.company_id = ${co.id}`;
  check("net revenue in the ledger = posted invoice lines less returns",
    r2(-((await bal("4000")) + (await bal("4020")) + (await bal("4010")))) === r2(n(rev.v) - 1_260_000),
    `${r2(-((await bal("4000")) + (await bal("4020")) + (await bal("4010"))))} vs ${r2(n(rev.v) - 1_260_000)}`);
} catch (e) {
  failures++;
  console.error("\n  ERROR", e);
} finally {
  await releaseTestLock(sql);
  await sql.end();
  const { sql: appSql } = await import("../lib/db.ts");
  await appSql.end({ timeout: 1 }).catch(() => {});
  console.log(failures === 0 ? "\n  all phone retail checks passed\n" : `\n  ${failures} FAILED\n`);
  process.exit(failures === 0 ? 0 : 1);
}
