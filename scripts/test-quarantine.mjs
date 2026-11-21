// Quarantine (0218, docs/06 D-P7): stock held apart that nobody can sell.
// A broken phone received with the rest, or a faulty one a customer brought
// back, waits there at its cost until it goes to the supplier, is written
// off, or is checked and released.
//
//   npx tsx scripts/test-quarantine.mjs
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

await takeTestLock(sql, "test-quarantine.mjs");
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
    check(label, !pattern || pattern.test(e.message), e.message.slice(0, 120));
  }
};

try {
  const [co] = await sql`select id from company order by created_at limit 1`;
  await resetTransactions(sql);
  await sql`update company set retail_mode = true where id = ${co.id}`;

  const [wh] = await sql`
    select id, parent_id from location
     where company_id = ${co.id} and is_stock_location and not is_quarantine and parent_id is not null
     order by code limit 1`;

  const party = async (code, name, cols) => {
    const [f] = await sql`select id from business_partner where company_id=${co.id} and code=${code}`;
    if (f) return f;
    return (await sql`insert into business_partner ${sql({ company_id: co.id, code, name, ...cols })}
      returning id`)[0];
  };
  const supp = await party("QR-S", "Quarantine Supplier", { is_supplier: true });
  const cust = await party("QR-C", "Quarantine Customer", { is_customer: true, payment_terms_days: 30 });

  const [grp] = await sql`select id from item_group where company_id = ${co.id} limit 1`;
  const [uom] = await sql`select id from uom where company_id = ${co.id} limit 1`;
  const ensureItem = async (serial, name, cols = {}) => {
    const [f] = await sql`select id from item where company_id = ${co.id} and serial = ${serial}`;
    if (f) { await sql`update item set ${sql(cols)} where id = ${f.id}`.catch(() => {}); return f; }
    return (await sql`insert into item ${sql({ company_id: co.id, item_group_id: grp.id,
      code: serial, serial, name, base_uom_id: uom.id, is_stocked: true, ...cols })} returning id`)[0];
  };
  const phone = await ensureItem("QR-PHONE", "Quarantine test phone",
    { tracks_serial: true, warranty_months: 12, supplier_warranty_months: 12 });
  const charger = await ensureItem("QR-CHARGER", "Quarantine test charger", { tracks_serial: false });

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
  const onHand = async (itemId, locationId) => n((await sql`
    select coalesce(sum(qty_on_hand), 0) as q from v_stock_on_hand
     where item_id = ${itemId} and location_id = ${locationId}`)[0].q);

  const sell = (lines, locationId = wh.id) => P.postRetailSale({
    companyId: co.id, partnerId: cust.id, locationId, docDate: DAY, dueDate: DAY,
    paymentType: "CASH", lines,
  });
  const move = (from, to, lines, memo = null) => P.postStockTransfer({
    companyId: co.id, fromLocationId: from, toLocationId: to, docDate: DAY, memo, lines,
  });

  console.log("\n  the quarantine bin");
  const [{ q: qid }] = await sql`select fn_quarantine_location(${wh.id}) as q`;
  const [{ q: qid2 }] = await sql`select fn_quarantine_location(${wh.id}) as q`;
  const [qloc] = await sql`select * from location where id = ${qid}`;
  check("one per warehouse, made with it and found after", qid === qid2);
  check("a bin inside the warehouse, marked quarantine",
    qloc.is_stock_location && qloc.is_quarantine && qloc.parent_id === wh.id);
  await refuses("a second quarantine bin in the same warehouse is refused",
    () => sql`insert into location (company_id, parent_id, code, name, is_stock_location, is_quarantine)
              values (${co.id}, ${wh.id}, 'QR-DUP', 'Dup', true, true)`, /unique|duplicate/i);
  await refuses("quarantine must hold stock",
    () => sql`update location set is_stock_location = false where id = ${qid}`, /quarantine_is_a_bin/);

  const [home] = await sql`select fn_stock_home(${qid}) as w, fn_stock_home(${wh.id}) as w2`;
  check("its stock counts in the warehouse", home.w === wh.id && home.w2 === wh.id);
  await refuses("there is no quarantine for a branch office: it is a bin in a warehouse",
    () => sql`select fn_quarantine_location(${wh.parent_id})`, /not one/);

  console.log("\n  stock goes in on purpose");
  await P.postGoodsReceipt({
    companyId: co.id, partnerId: supp.id, locationId: wh.id, docDate: DAY,
    lines: [
      { itemId: phone.id, qty: 3, unitCost: 1_000_000, serials: ["QR-IMEI-1", "QR-IMEI-2", "QR-IMEI-3"] },
      { itemId: charger.id, qty: 10, unitCost: 10_000 },
    ],
  });
  const stockBefore = await bal("1310");
  await refuses("into quarantine without a reason is refused",
    () => move(wh.id, qid, [{ itemId: phone.id, qty: 1, serials: ["QR-IMEI-1"] }]), /what is wrong/);
  await move(wh.id, qid, [
    { itemId: phone.id, qty: 1, serials: ["QR-IMEI-1"] },
    { itemId: charger.id, qty: 2 },
  ], "Screen cracked; chargers do not charge");
  check("the phone is in quarantine, at its own cost", (await unit("QR-IMEI-1"))?.location_id === qid);
  check("chargers counted there", (await onHand(charger.id, qid)) === 2 && (await onHand(charger.id, wh.id)) === 8);
  check("quarantine is still stock: inventory value unchanged", (await bal("1310")) === stockBefore);
  const [sellable] = await sql`
    select coalesce(sum(qty_on_hand) filter (where not is_quarantine), 0)::float as s,
           coalesce(sum(qty_on_hand) filter (where is_quarantine), 0)::float as q
      from v_stock_on_hand where item_id = ${charger.id}`;
  check("stock on hand tells sellable from quarantine", sellable.s === 8 && sellable.q === 2);

  console.log("\n  nothing is sold from it");
  await refuses("scanning a quarantined IMEI at the shop says why",
    () => sell([{ itemId: phone.id, qty: 1, unitPrice: 1_500_000, serials: ["QR-IMEI-1"] }]), /quarantine/);
  await refuses("a sale dated at the quarantine location is refused",
    () => sell([{ itemId: charger.id, qty: 1, unitPrice: 20_000 }], qid), /quarantine/);
  await refuses("a sales order dated there is refused",
    () => P.postSalesOrder({ companyId: co.id, partnerId: cust.id, locationId: qid, docDate: DAY,
      lines: [{ itemId: charger.id, qty: 1, unitPrice: 20_000 }] }), /quarantine/);
  const s1 = await sell([{ itemId: phone.id, qty: 1, unitPrice: 1_500_000, serials: ["QR-IMEI-2"] }]);
  await refuses("the database refuses stock leaving it on a sale, whatever the document says",
    () => sql.begin(async (tx) => {
      await tx`insert into stock_movement (company_id, item_id, location_id, movement_date, qty, document_id)
               values (${co.id}, ${charger.id}, ${qid}, current_date, -1, ${s1.id})`;
      throw new Error("not refused");
    }), /quarantine/);
  check("the good phones still sell", !!s1.id);
  await refuses("the till cannot oversell from sellable stock by counting quarantine",
    () => sell([{ itemId: charger.id, qty: 9, unitPrice: 20_000 }]), /not enough/i);

  console.log("\n  released on purpose");
  await refuses("out of quarantine without a reason is refused",
    () => move(qid, wh.id, [{ itemId: charger.id, qty: 2 }]), /released from quarantine/);
  await move(qid, wh.id, [{ itemId: charger.id, qty: 2 }], "Tested: charge fine, was a bad cable");
  check("released chargers are back on the shelf", (await onHand(charger.id, wh.id)) === 10 && (await onHand(charger.id, qid)) === 0);
  // A release made in error goes back by a transfer back, with its reason.
  await move(wh.id, qid, [{ itemId: charger.id, qty: 2 }], "Released by mistake: not yet tested");
  check("a mistaken release goes back into quarantine",
    (await onHand(charger.id, wh.id)) === 8 && (await onHand(charger.id, qid)) === 2);
  await move(qid, wh.id, [{ itemId: charger.id, qty: 2 }], "Retested: fine");
  await sell([{ itemId: charger.id, qty: 9, unitPrice: 20_000 }]);
  check("released stock sells", (await onHand(charger.id, wh.id)) === 1);

  console.log("\n  ten ordered, ten arrive, one broken");
  const po = await P.postPurchaseOrder({ companyId: co.id, partnerId: supp.id, locationId: wh.id, docDate: DAY,
    lines: [{ itemId: phone.id, qty: 10, unitPrice: 1_000_000 }] });
  const [poLine] = await sql`select id from document_line where document_id = ${po.id}`;
  const imeis = Array.from({ length: 10 }, (_, i) => `QR-PO-${i + 1}`);
  const grirBefore = await bal("1410");
  const receiveTen = (rejected) => P.postGoodsReceipt({
    companyId: co.id, partnerId: supp.id, locationId: wh.id, docDate: DAY, sourceDocumentId: po.id,
    lines: [
      { itemId: phone.id, qty: 9, unitCost: 1_000_000, serials: imeis.slice(0, 9), sourceLineId: poLine.id },
      { itemId: phone.id, qty: 1, unitCost: 1_000_000, serials: [imeis[9]], sourceLineId: poLine.id, rejected },
    ],
  });
  await refuses("a rejection without a reason is refused",
    () => receiveTen({ reason: " ", outcome: "REPLACE" }), /what is wrong/);
  await refuses("a rejection without replace or credit is refused",
    () => receiveTen({ reason: "Screen cracked", outcome: "" }), /replaces .* or credits/);
  const gr = await receiveTen({ reason: "Screen cracked", outcome: "REPLACE" });
  check("the nine are on the shelf", (await sql`select count(*)::int c from v_stock_serial
    where imei like 'QR-PO-%' and status = 'IN_STOCK' and location_id = ${wh.id}`)[0].c === 9);
  check("the broken one is in quarantine", (await unit(imeis[9]))?.location_id === qid
    && (await unit(imeis[9]))?.status === "IN_STOCK");
  const [rl] = await sql`select location_id, reject_reason, reject_outcome, base_qty::float q
    from document_line where document_id = ${gr.id} and reject_reason is not null`;
  check("the receipt line says why, and what the supplier will do",
    rl?.reject_reason === "Screen cracked" && rl?.reject_outcome === "REPLACE" && rl?.location_id === qid && rl?.q === 1);
  const [os] = await sql`select ordered::float o, fulfilled::float f, outstanding::float x
    from v_order_outstanding where order_id = ${po.id}`;
  check("the order counts all ten arrived", os?.f === 10 && os?.x === 0, JSON.stringify(os));
  check("GR/IR carries all ten until billed or returned",
    r2((await bal("1410")) - grirBefore) === -10_000_000, String(r2((await bal("1410")) - grirBefore)));
  await refuses("the broken one cannot be sold",
    () => sell([{ itemId: phone.id, qty: 1, unitPrice: 1_500_000, serials: [imeis[9]] }]), /quarantine/);

  console.log("\n  sent back for replacement, before the bill");
  const ret = (lines, extra = {}) => P.postPurchaseReturn({
    companyId: co.id, partnerId: supp.id, locationId: qid, docDate: DAY, ...extra, lines });
  const outstanding = async (orderId) => n((await sql`
    select coalesce(sum(outstanding), 0) v from v_order_outstanding where order_id = ${orderId}`)[0].v);
  const [refusedLine] = await sql`select id from document_line where document_id = ${gr.id} and reject_outcome = 'REPLACE'`;
  const [keptLine] = await sql`select id from document_line where document_id = ${gr.id} and reject_reason is null`;
  await refuses("more than the refused line cannot go back against it",
    () => ret([{ itemId: phone.id, qty: 2, unitPrice: 1_000_000, serials: [imeis[9], imeis[8]], sourceLineId: refusedLine.id }],
      { sourceDocumentId: gr.id }), /left to send back|Not enough/);
  await refuses("a replacement goes back on its own, not with other units",
    () => ret([
      { itemId: phone.id, qty: 1, unitPrice: 1_000_000, serials: [imeis[9]], sourceLineId: refusedLine.id },
      { itemId: phone.id, qty: 1, unitPrice: 1_000_000, serials: [imeis[8]], sourceLineId: keptLine.id },
    ], { sourceDocumentId: gr.id }), /on their own/);
  const grirB = await bal("1410");
  const r1 = await ret([{ itemId: phone.id, qty: 1, unitPrice: 1_000_000, serials: [imeis[9]], sourceLineId: refusedLine.id }],
    { sourceDocumentId: gr.id, memo: "Screen cracked, for replacement" });
  check("the broken phone has gone back", (await unit(imeis[9]))?.status === "RETURNED_TO_SUPPLIER");
  check("quarantine is empty of it", (await onHand(phone.id, qid)) === 1, `${await onHand(phone.id, qid)} left (QR-IMEI-1 from earlier)`);
  check("the return clears GR/IR for the unit, not the payable",
    r2((await bal("1410")) - grirB) === 1_000_000 && (await entryOf(r1.id, "2110")) === 0);
  check("the order expects one again", (await outstanding(po.id)) === 1);
  await refuses("it cannot go back twice",
    () => ret([{ itemId: phone.id, qty: 1, unitPrice: 1_000_000, serials: [imeis[9]], sourceLineId: refusedLine.id }],
      { sourceDocumentId: gr.id }), /left to send back|returned|not in stock|in stock|is /);
  const repl = await P.postGoodsReceipt({
    companyId: co.id, partnerId: supp.id, locationId: wh.id, docDate: DAY, sourceDocumentId: po.id,
    lines: [{ itemId: phone.id, qty: 1, unitCost: 1_000_000, serials: ["QR-PO-11"], sourceLineId: poLine.id }],
  });
  check("the replacement arrives against the order, which is complete again", (await outstanding(po.id)) === 0 && !!repl.id);
  const bill = await P.postPurchaseInvoice({ companyId: co.id, partnerId: supp.id, locationId: wh.id, docDate: DAY,
    dueDate: DAY, goodsReceiptId: gr.id, lines: [{ itemId: phone.id, qty: 9, unitPrice: 1_000_000, sourceLineId: keptLine.id }] });
  const [replLine] = await sql`select id from document_line where document_id = ${repl.id}`;
  await P.postPurchaseInvoice({ companyId: co.id, partnerId: supp.id, locationId: wh.id, docDate: DAY,
    dueDate: DAY, goodsReceiptId: repl.id, lines: [{ itemId: phone.id, qty: 1, unitPrice: 1_000_000, sourceLineId: replLine.id }] });
  check("billed ten in all, GR/IR is back where it started", r2(await bal("1410")) === r2(grirBefore), `${await bal("1410")} vs ${grirBefore}`);
  check("the supplier is owed nine on that bill, one on the replacement's", (await entryOf(bill.id, "2110")) === -9_000_000);

  console.log("\n  sent back for replacement, after the bill");
  const po2 = await P.postPurchaseOrder({ companyId: co.id, partnerId: supp.id, locationId: wh.id, docDate: DAY,
    lines: [{ itemId: phone.id, qty: 2, unitPrice: 800_000 }] });
  const [po2Line] = await sql`select id from document_line where document_id = ${po2.id}`;
  const gr2 = await P.postGoodsReceipt({ companyId: co.id, partnerId: supp.id, locationId: wh.id, docDate: DAY,
    sourceDocumentId: po2.id, lines: [
      { itemId: phone.id, qty: 1, unitCost: 800_000, serials: ["QR-B-1"], sourceLineId: po2Line.id },
      { itemId: phone.id, qty: 1, unitCost: 800_000, serials: ["QR-B-2"], sourceLineId: po2Line.id,
        rejected: { reason: "No sound", outcome: "REPLACE" } },
    ] });
  const gr2Lines = await sql`select id, reject_outcome from document_line where document_id = ${gr2.id} order by line_no`;
  const bill2 = await P.postPurchaseInvoice({ companyId: co.id, partnerId: supp.id, locationId: wh.id, docDate: DAY,
    dueDate: DAY, goodsReceiptId: gr2.id, lines: [{ itemId: phone.id, qty: 2, unitPrice: 800_000 }] });
  const grirC = await bal("1410");
  const r2b = await ret([{ itemId: phone.id, qty: 1, unitPrice: 800_000, serials: ["QR-B-2"], sourceLineId: gr2Lines[1].id }],
    { sourceDocumentId: gr2.id });
  check("billed already, the replacement still goes back against the receipt",
    !!r2b.id && r2((await bal("1410")) - grirC) === 800_000 && (await entryOf(r2b.id, "2110")) === 0);
  check("the bill stands at two", (await entryOf(bill2.id, "2110")) === -1_600_000);
  check("the order expects one again", (await outstanding(po2.id)) === 1);
  await P.postGoodsReceipt({ companyId: co.id, partnerId: supp.id, locationId: wh.id, docDate: DAY,
    sourceDocumentId: po2.id, lines: [{ itemId: phone.id, qty: 1, unitCost: 800_000, serials: ["QR-B-3"], sourceLineId: po2Line.id }] });
  check("the replacement arrives and GR/IR is clear again", r2((await bal("1410")) - grirC) === 0 && (await outstanding(po2.id)) === 0);

  console.log("\n  refused for credit");
  const po3 = await P.postPurchaseOrder({ companyId: co.id, partnerId: supp.id, locationId: wh.id, docDate: DAY,
    lines: [{ itemId: phone.id, qty: 2, unitPrice: 700_000 }] });
  const [po3Line] = await sql`select id from document_line where document_id = ${po3.id}`;
  const grirPre3 = await bal("1410");
  const gr3 = await P.postGoodsReceipt({ companyId: co.id, partnerId: supp.id, locationId: wh.id, docDate: DAY,
    sourceDocumentId: po3.id, lines: [
      { itemId: phone.id, qty: 1, unitCost: 700_000, serials: ["QR-C-1"], sourceLineId: po3Line.id },
      { itemId: phone.id, qty: 1, unitCost: 700_000, serials: ["QR-C-2"], sourceLineId: po3Line.id,
        rejected: { reason: "Wrong colour", outcome: "CREDIT" } },
    ] });
  const gr3Lines = await sql`select id from document_line where document_id = ${gr3.id} order by line_no`;
  const grirD = await bal("1410");
  await ret([{ itemId: phone.id, qty: 1, unitPrice: 700_000, serials: ["QR-C-2"], sourceLineId: gr3Lines[1].id }],
    { sourceDocumentId: gr3.id });
  check("unbilled: the credit comes off GR/IR", r2((await bal("1410")) - grirD) === 700_000);
  check("and the order stays complete", (await outstanding(po3.id)) === 0);
  const bill3 = await P.postPurchaseInvoice({ companyId: co.id, partnerId: supp.id, locationId: wh.id, docDate: DAY,
    dueDate: DAY, goodsReceiptId: gr3.id, lines: [{ itemId: phone.id, qty: 1, unitPrice: 700_000, sourceLineId: gr3Lines[0].id }] });
  check("the bill is for the one kept, and GR/IR is back where it was before the receipt",
    (await entryOf(bill3.id, "2110")) === -700_000 && r2(await bal("1410")) === r2(grirPre3),
    `${await bal("1410")} vs ${grirPre3}`);

  console.log("\n  found faulty after the receipt was posted (0224)");
  const po4 = await P.postPurchaseOrder({ companyId: co.id, partnerId: supp.id, locationId: wh.id, docDate: DAY,
    lines: [{ itemId: phone.id, qty: 3, unitPrice: 800_000 }] });
  const [po4Line] = await sql`select id from document_line where document_id = ${po4.id}`;
  const gr4 = await P.postGoodsReceipt({ companyId: co.id, partnerId: supp.id, locationId: wh.id, docDate: DAY,
    sourceDocumentId: po4.id, lines: [
      { itemId: phone.id, qty: 3, unitCost: 800_000, serials: ["QR-F-1", "QR-F-2", "QR-F-3"], sourceLineId: po4Line.id },
    ] });
  const [gr4Line] = await sql`select id from document_line where document_id = ${gr4.id}`;
  const bill4 = await P.postPurchaseInvoice({ companyId: co.id, partnerId: supp.id, locationId: wh.id, docDate: DAY,
    dueDate: DAY, goodsReceiptId: gr4.id, lines: [{ itemId: phone.id, qty: 3, unitPrice: 800_000, sourceLineId: gr4Line.id }] });
  const report = (serials, outcome = "REPLACE", reason = "Battery drains overnight", lineId = gr4Line.id) =>
    P.reportFaulty({ companyId: co.id, receiptId: gr4.id, reason, outcome, lines: [{ receiptLineId: lineId, serials }] });
  await refuses("a report says what is wrong", () => report(["QR-F-2"], "REPLACE", "  "), /what is wrong/);
  await refuses("a unit from another receipt is not reported here", () => report(["QR-PO-2"]), /did not arrive on this line/);
  const stock4 = await bal("1310");
  const f1 = await report(["QR-F-2"]);
  check("the faulty phone moves to quarantine by a transfer", (await unit("QR-F-2"))?.location_id === qid && f1.transferIds.length === 1);
  const [t4] = await sql`select memo, reference, to_location_id from document where id = ${f1.transferIds[0]}`;
  check("the transfer names the receipt and the fault",
    t4?.to_location_id === qid && t4?.reference !== null && /Found faulty after receipt .*Battery drains overnight/.test(t4?.memo ?? ""), t4?.memo);
  const [fr] = await sql`select fr.*, s.serial_no from fault_report fr join stock_serial s on s.id = fr.serial_id
    where fr.receipt_line_id = ${gr4Line.id}`;
  check("written against the receipt line it came in on", fr?.serial_no === "QR-F-2" && fr?.outcome === "REPLACE" && fr?.bin_location_id === qid);
  check("the receipt itself is unchanged, and stock value too",
    (await sql`select count(*)::int c from document_line where document_id = ${gr4.id}`)[0].c === 1 && (await bal("1310")) === stock4);
  check("the order is still complete until it goes back", (await outstanding(po4.id)) === 0);
  await refuses("it cannot be reported twice", () => report(["QR-F-2"]), /already been reported/);
  await refuses("it cannot be sold", () => sell([{ itemId: phone.id, qty: 1, unitPrice: 1_500_000, serials: ["QR-F-2"] }]), /quarantine/);
  const grirF = await bal("1410");
  const rf = await ret([{ itemId: phone.id, qty: 1, unitPrice: 800_000, serials: ["QR-F-2"], sourceLineId: gr4Line.id }],
    { sourceDocumentId: gr4.id, memo: "Found faulty after receipt: battery" });
  const [rfl] = await sql`select for_replacement from document_line where document_id = ${rf.id}`;
  check("billed already, it still goes back against the receipt for replacement",
    r2((await bal("1410")) - grirF) === 800_000 && (await entryOf(rf.id, "2110")) === 0 && rfl?.for_replacement === true);
  check("the order expects one again", (await outstanding(po4.id)) === 1);
  check("the bill stands at three", (await entryOf(bill4.id, "2110")) === -2_400_000);

  await report(["QR-F-3"], "CREDIT", "Camera fails");
  check("found faulty for credit, in quarantine", (await unit("QR-F-3"))?.location_id === qid);
  await refuses("for credit, once billed, it does not go back against the receipt",
    () => ret([{ itemId: phone.id, qty: 1, unitPrice: 800_000, serials: ["QR-F-3"], sourceLineId: gr4Line.id }],
      { sourceDocumentId: gr4.id }), /bill|invoice/i);
  const rc = await ret([{ itemId: phone.id, qty: 1, unitPrice: 800_000, serials: ["QR-F-3"] }], { sourceDocumentId: bill4.id });
  check("it goes back against the bill: the supplier owes the credit", (await entryOf(rc.id, "2110")) === 800_000);
  check("and the order does not wait for it", (await outstanding(po4.id)) === 1);
  const sold4 = await sell([{ itemId: phone.id, qty: 1, unitPrice: 1_500_000, serials: ["QR-F-1"] }]);
  await refuses("a sold phone is not reported against its receipt", () => report(["QR-F-1"]), /customer return/);

  const grC = await P.postGoodsReceipt({ companyId: co.id, partnerId: supp.id, locationId: wh.id, docDate: DAY,
    lines: [{ itemId: charger.id, qty: 5, unitCost: 10_000 }] });
  const [grCLine] = await sql`select id from document_line where document_id = ${grC.id}`;
  const qC = await onHand(charger.id, qid);
  await refuses("no more than arrived on the line",
    () => P.reportFaulty({ companyId: co.id, receiptId: grC.id, reason: "Frayed cable", outcome: "CREDIT",
      lines: [{ receiptLineId: grCLine.id, qty: 6 }] }), /more than that/);
  await P.reportFaulty({ companyId: co.id, receiptId: grC.id, reason: "Frayed cable", outcome: "CREDIT",
    lines: [{ receiptLineId: grCLine.id, qty: 2 }] });
  check("untracked: two chargers counted into quarantine", (await onHand(charger.id, qid)) === qC + 2);
  check("and written down with the count", n((await sql`select sum(qty) q from fault_report where receipt_line_id = ${grCLine.id}`)[0].q) === 2);
  void sold4;

  console.log("\n  a customer brings back a faulty phone");
  const sold = await sell([{ itemId: phone.id, qty: 1, unitPrice: 1_500_000, serials: ["QR-PO-1"] }]);
  const back = (extra = {}) => P.postSalesReturn({ companyId: co.id, partnerId: cust.id, locationId: wh.id,
    docDate: DAY, sourceDocumentId: sold.id, ...extra,
    lines: [{ itemId: phone.id, qty: 1, unitPrice: 1_500_000, serials: ["QR-PO-1"] }] });
  await refuses("faulty without saying what is wrong is refused", () => back({ faulty: { reason: "  " } }), /what is wrong/);
  const sr = await back({ faulty: { reason: "Battery swells" } });
  check("it comes back into quarantine, not onto the shelf", (await unit("QR-PO-1"))?.location_id === qid
    && (await unit("QR-PO-1"))?.status === "IN_STOCK");
  const [srDoc] = await sql`select location_id, memo from document where id = ${sr.id}`;
  check("the return says so", srDoc.location_id === qid && /Faulty: Battery swells/.test(srDoc.memo ?? ""));
  check("posted as any return: sales returns, cost of sales back, the phone at its cost",
    (await entryOf(sr.id, "4180")) === 1_500_000 && (await entryOf(sr.id, "5110")) === -1_000_000
    && (await entryOf(sr.id, "1310")) === 1_000_000);
  await refuses("and it cannot be sold again", () => sell([{ itemId: phone.id, qty: 1, unitPrice: 1_400_000, serials: ["QR-PO-1"] }]), /quarantine/);
  const toSupplier = await ret([{ itemId: phone.id, qty: 1, unitPrice: 1_000_000, serials: ["QR-PO-1"] }],
    { memo: "Under supplier warranty: battery swells" });
  check("it goes to the supplier from quarantine", (await unit("QR-PO-1"))?.status === "RETURNED_TO_SUPPLIER" && !!toSupplier.id);

  console.log("\n  reconciliation");
  check("trial balance balances", r2((await sql`select coalesce(sum(base_amount),0) v from journal_line jl
    join journal_entry je on je.id = jl.journal_entry_id where je.company_id = ${co.id}`)[0].v) === 0);
  const [layers] = await sql`select coalesce(sum(value_on_hand),0)::float v from v_stock_on_hand where company_id = ${co.id}`;
  check("inventory GL equals the valued stock, quarantine included", r2(layers.v) === (await bal("1310")),
    `${r2(layers.v)} vs ${await bal("1310")}`);
} catch (e) {
  failures++;
  console.error("  CRASH ", e);
} finally {
  await releaseTestLock(sql);
  await sql.end();
}
console.log(failures ? `\n  ${failures} FAILED` : "\n  all quarantine checks passed");
process.exit(failures ? 1 : 0);
