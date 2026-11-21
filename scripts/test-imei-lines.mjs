// Each line of a document lists its own IMEIs (lib/phone.ts serialsOnDocument
// and serialsByLine, the document page). Every flow that moves a phone is
// posted with two lines of the same model, so a unit put under the wrong line
// — or under the first line of its item — shows.
//
//   npx tsx scripts/test-imei-lines.mjs
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
const { serialsOnDocument, serialsByLine } = await import("../lib/phone.ts");
const url = process.env.DATABASE_URL;
const local = url.includes("localhost") || url.includes("127.0.0.1");
const sql = postgres(url, { ssl: local ? false : "require", prepare: !url.includes("-pooler."), onnotice: () => {}, max: 1 });

await takeTestLock(sql, "test-imei-lines.mjs");
let failures = 0;
const check = (label, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
};

try {
  const [co] = await sql`select id from company order by created_at limit 1`;
  await resetTransactions(sql);
  const [wh] = await sql`
    select id from location where company_id = ${co.id} and is_stock_location and not is_quarantine
       and parent_id is not null order by code limit 1`;
  const [wh2] = await sql`
    select id from location where company_id = ${co.id} and is_stock_location and not is_quarantine
       and id <> ${wh.id} order by code limit 1`;
  const party = async (code, name, cols) => (await sql`select id from business_partner where company_id=${co.id} and code=${code}`)[0]
    ?? (await sql`insert into business_partner ${sql({ company_id: co.id, code, name, ...cols })} returning id`)[0];
  const supp = await party("IL-S", "IMEI Lines Supplier", { is_supplier: true });
  const cust = await party("IL-C", "IMEI Lines Customer", { is_customer: true, payment_terms_days: 30 });
  const [grp] = await sql`select id from item_group where company_id = ${co.id} limit 1`;
  const [uom] = await sql`select id from uom where company_id = ${co.id} limit 1`;
  const item = async (serial, name, cols) => (await sql`select id from item where company_id=${co.id} and serial=${serial}`)[0]
    ?? (await sql`insert into item ${sql({ company_id: co.id, item_group_id: grp.id, code: serial, serial, name,
      base_uom_id: uom.id, is_stocked: true, ...cols })} returning id`)[0];
  const phone = await item("IL-PHONE", "IMEI lines phone", { tracks_serial: true });
  const DAY = (await sql`select to_char(current_date,'YYYY-MM-DD') as d`)[0].d;
  let n = 0;
  const imeis = (k) => Array.from({ length: k }, () => `IL-${String(++n).padStart(4, "0")}`);
  const linesOf = async (docId) => sql`select id, item_id from document_line where document_id = ${docId} order by line_no`;

  /** Every line of `docId` lists exactly the IMEIs expected for it, in line order. */
  const expectLines = async (label, docId, expected) => {
    const lines = await linesOf(docId);
    const { byLine, leftover } = serialsByLine(await serialsOnDocument(docId), lines);
    const got = lines.map((l) => (byLine.get(String(l.id)) ?? []).map((s) => s.imei).sort());
    const want = expected.map((e) => [...e].sort());
    const ok = JSON.stringify(got) === JSON.stringify(want) && leftover.length === 0;
    check(label, ok, ok ? "" : `got ${JSON.stringify(got)} want ${JSON.stringify(want)} leftover ${leftover.length}`);
  };
  const setRetail = (on) => sql`update company set retail_mode = ${on}, features = coalesce(features, '{}'::jsonb)
    || ${sql.json({ orders_deliveries: !on })} where id = ${co.id}`;

  console.log("\n  buying");
  const [a1, a2] = [imeis(2), imeis(1)];
  const gr = await P.postGoodsReceipt({ companyId: co.id, partnerId: supp.id, locationId: wh.id, docDate: DAY,
    lines: [{ itemId: phone.id, qty: 2, unitCost: 1_000_000, serials: a1 }, { itemId: phone.id, qty: 1, unitCost: 1_100_000, serials: a2 }] });
  await expectLines("goods receipt: each line its own", gr.id, [a1, a2]);

  const grL = await linesOf(gr.id);
  const bill = await P.postPurchaseInvoice({ companyId: co.id, partnerId: supp.id, locationId: wh.id, docDate: DAY, dueDate: DAY,
    goodsReceiptId: gr.id, lines: [
      { itemId: phone.id, qty: 2, unitPrice: 1_000_000, sourceLineId: grL[0].id },
      { itemId: phone.id, qty: 1, unitPrice: 1_100_000, sourceLineId: grL[1].id }] });
  await expectLines("bill for that receipt: each line the units it bills", bill.id, [a1, a2]);

  const [b1, b2] = [imeis(1), imeis(2)];
  const pwr = await P.postPurchaseWithReceipt({ companyId: co.id, partnerId: supp.id, locationId: wh.id, docDate: DAY, dueDate: DAY,
    lines: [{ itemId: phone.id, qty: 1, unitPrice: 1_000_000, serials: b1 }, { itemId: phone.id, qty: 2, unitPrice: 1_050_000, serials: b2 }] });
  await expectLines("bill that receives the goods itself", pwr.id, [b1, b2]);

  const [c1, c2] = [imeis(1), imeis(1)];
  const grR = await P.postGoodsReceipt({ companyId: co.id, partnerId: supp.id, locationId: wh.id, docDate: DAY,
    lines: [{ itemId: phone.id, qty: 1, unitCost: 1_000_000, serials: c1 },
            { itemId: phone.id, qty: 1, unitCost: 1_000_000, serials: c2, rejected: { reason: "Dead", outcome: "CREDIT" } }] });
  await expectLines("receipt with a refused line", grR.id, [c1, c2]);
  const ret = await P.postPurchaseReturn({ companyId: co.id, partnerId: supp.id, docDate: DAY,
    locationId: (await sql`select fn_quarantine_location(${wh.id}) as q`)[0].q, sourceDocumentId: grR.id,
    lines: [{ itemId: phone.id, qty: 1, unitPrice: 1_000_000, serials: c2, sourceLineId: (await linesOf(grR.id))[1].id }] });
  await expectLines("supplier return", ret.id, [c2]);
  await expectLines("…and the receipt still shows the refused unit under its line", grR.id, [c1, c2]);

  console.log("\n  selling at the counter");
  await setRetail(true);
  const sale = await P.postRetailSale({ companyId: co.id, partnerId: cust.id, locationId: wh.id, docDate: DAY, dueDate: DAY,
    paymentType: "CASH", lines: [
      { itemId: phone.id, qty: 1, unitPrice: 1_500_000, serials: [a1[0]] },
      { itemId: phone.id, qty: 2, unitPrice: 1_600_000, serials: [a1[1], a2[0]] }] });
  await expectLines("counter sale", sale.id, [[a1[0]], [a1[1], a2[0]]]);
  const sr = await P.postSalesReturn({ companyId: co.id, partnerId: cust.id, locationId: wh.id, docDate: DAY, sourceDocumentId: sale.id,
    lines: [{ itemId: phone.id, qty: 1, unitPrice: 1_600_000, serials: [a2[0]] }] });
  await expectLines("customer return", sr.id, [[a2[0]]]);

  console.log("\n  delivering and invoicing");
  await setRetail(false);
  const dv = await P.postDelivery({ companyId: co.id, partnerId: cust.id, locationId: wh.id, docDate: DAY,
    lines: [{ itemId: phone.id, qty: 1, serials: [b1[0]] }, { itemId: phone.id, qty: 1, serials: [b2[0]] }] });
  await expectLines("delivery", dv.id, [[b1[0]], [b2[0]]]);
  const dvL = await linesOf(dv.id);
  const siD = await P.postSalesInvoice({ companyId: co.id, partnerId: cust.id, locationId: wh.id, docDate: DAY, dueDate: DAY,
    paymentType: "CREDIT", deliveryId: dv.id, lines: [
      { itemId: phone.id, qty: 1, unitPrice: 1_500_000, serials: [b1[0]], sourceLineId: dvL[0].id },
      { itemId: phone.id, qty: 1, unitPrice: 1_500_000, serials: [b2[0]], sourceLineId: dvL[1].id }] });
  await expectLines("invoice billing that delivery", siD.id, [[b1[0]], [b2[0]]]);

  const siL = await P.postSalesInvoice({ companyId: co.id, partnerId: cust.id, locationId: wh.id, docDate: DAY, dueDate: DAY,
    paymentType: "CREDIT", lines: [
      { itemId: phone.id, qty: 1, unitPrice: 1_500_000 }, { itemId: phone.id, qty: 1, unitPrice: 1_500_000 }] });
  const siLL = await linesOf(siL.id);
  const dvLater = await P.postDelivery({ companyId: co.id, partnerId: cust.id, locationId: wh.id, docDate: DAY, sourceDocumentId: siL.id,
    lines: [{ itemId: phone.id, qty: 1, serials: [b2[1]], sourceLineId: siLL[1].id },
            { itemId: phone.id, qty: 1, serials: [c1[0]], sourceLineId: siLL[0].id }] });
  await expectLines("invoice first, delivered later: under the line each answers", siL.id, [c1, [b2[1]]]);
  await expectLines("…and the delivery itself", dvLater.id, [[b2[1]], c1]);

  const [w1, w2] = [imeis(1), imeis(2)];
  await P.postGoodsReceipt({ companyId: co.id, partnerId: supp.id, locationId: wh.id, docDate: DAY,
    lines: [{ itemId: phone.id, qty: 3, unitCost: 950_000, serials: [...w1, ...w2] }] });
  const swd = await P.postSaleWithDelivery({ companyId: co.id, partnerId: cust.id, locationId: wh.id, docDate: DAY, dueDate: DAY,
    paymentType: "CREDIT", lines: [
      { itemId: phone.id, qty: 2, unitPrice: 1_500_000, serials: w2 },
      { itemId: phone.id, qty: 1, unitPrice: 1_500_000, serials: w1 }] });
  await expectLines("invoice that delivers itself", swd.id, [w2, w1]);

  console.log("\n  serial numbers, not IMEIs");
  await setRetail(true);
  const mac = await item("IL-MAC", "IMEI lines laptop", { tracks_serial: true, identity: "SERIAL" });
  const m1 = ["C02-IL-0001", "C02-IL-0002"], m2 = ["C02-IL-0003"];
  const grM = await P.postGoodsReceipt({ companyId: co.id, partnerId: supp.id, locationId: wh.id, docDate: DAY, lines: [
    { itemId: mac.id, qty: 2, unitCost: 4_000_000, serials: m1 },
    { itemId: phone.id, qty: 1, unitCost: 900_000, serials: ["IL-MIX-1"] },
    { itemId: mac.id, qty: 1, unitCost: 4_100_000, serials: m2 }] });
  await expectLines("receipt of laptops and a phone: each line its own", grM.id, [m1, ["IL-MIX-1"], m2]);
  const saleM = await P.postRetailSale({ companyId: co.id, partnerId: cust.id, locationId: wh.id, docDate: DAY, dueDate: DAY,
    paymentType: "CASH", lines: [{ itemId: mac.id, qty: 1, unitPrice: 5_000_000, serials: [m2[0]] },
                                 { itemId: mac.id, qty: 1, unitPrice: 5_000_000, serials: [m1[1]] }] });
  await expectLines("sale of laptops by serial number", saleM.id, [m2, [m1[1]]]);
  await setRetail(false);

  console.log("\n  moving stock");
  const [t1, t2] = [imeis(1), imeis(1)];
  await P.postGoodsReceipt({ companyId: co.id, partnerId: supp.id, locationId: wh.id, docDate: DAY,
    lines: [{ itemId: phone.id, qty: 2, unitCost: 900_000, serials: [...t1, ...t2] }] });
  const tr = await P.postStockTransfer({ companyId: co.id, fromLocationId: wh.id, toLocationId: wh2.id, docDate: DAY,
    lines: [{ itemId: phone.id, qty: 1, serials: t2 }, { itemId: phone.id, qty: 1, serials: t1 }] });
  await expectLines("stock transfer", tr.id, [t2, t1]);
} catch (e) {
  failures++;
  console.error("  CRASH ", e);
} finally {
  await releaseTestLock(sql);
  await sql.end();
}
console.log(failures ? `\n  ${failures} FAILED` : "\n  all IMEI-line checks passed");
process.exit(failures ? 1 : 0);
