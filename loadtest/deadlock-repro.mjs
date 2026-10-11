// Deadlock reproduction — DEV ONLY. Sales and payments on one customer, nothing
// else: W workers loop for S seconds, each either posting a cash sale to the
// customer or a credit sale followed by a receipt against it. Every deadlock is
// recorded with Postgres's own report (detail + where), so the lock order can
// be read off rather than guessed.
//
//   npx tsx loadtest/deadlock-repro.mjs            (W=12, S=90)
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const url = process.env.DATABASE_URL
  ?? readFileSync(".env", "utf8").match(/^\s*DATABASE_URL\s*=\s*"?(.+?)"?\s*$/m)[1];
process.env.DATABASE_URL = url;
if (!url.includes("ep-winter-leaf")) { console.error("Not the dev database — refusing."); process.exit(1); }

const { sql } = await import("../lib/db.ts");
const P = await import("../lib/posting.ts");
const W = Number(process.env.W ?? 12), S = Number(process.env.S ?? 90);
const TAG = "DL" + new Date().toISOString().replace(/\D/g, "").slice(2, 12);

const [co] = await sql`select id from company order by created_at limit 1`;
const [wh] = await sql`select id from location where company_id = ${co.id} and code = 'MAIN-WH'`;
const [cash] = await sql`select id from account where company_id = ${co.id} and code = '1000'`;
const [uom] = await sql`select id from uom where company_id = ${co.id} order by code limit 1`;
const [grp] = await sql`select id from item_group where company_id = ${co.id} and parent_id is null order by name limit 1`;
const [cust] = await sql`insert into business_partner (company_id, code, name, is_customer, payment_terms_days)
  values (${co.id}, ${TAG + "-C"}, ${TAG + " customer"}, true, 30) returning id`;
const [supp] = await sql`insert into business_partner (company_id, code, name, is_supplier)
  values (${co.id}, ${TAG + "-S"}, ${TAG + " supplier"}, true) returning id`;
const [item] = await sql`insert into item (company_id, item_group_id, code, serial, name, base_uom_id, is_stocked)
  values (${co.id}, ${grp.id}, ${TAG + "-I"}, ${TAG + "-I"}, ${TAG + " item"}, ${uom.id}, true) returning id`;
const today = new Date().toISOString().slice(0, 10);
await sql.begin((tx) => P.postGoodsReceipt({ companyId: co.id, partnerId: supp.id, locationId: wh.id, docDate: today,
  memo: `DEADLOCK ${TAG}`, lines: [{ itemId: item.id, qty: 100000, unitCost: 100 }] }, tx));

// A void puts stock back only when nothing has drawn on the item since, so in
// void mode each worker sells its own item.
const own = [];
if ((process.env.MODE ?? "post") === "void") {
  for (let w = 0; w < W; w++) {
    const [it] = await sql`insert into item (company_id, item_group_id, code, serial, name, base_uom_id, is_stocked)
      values (${co.id}, ${grp.id}, ${TAG + "-I" + w}, ${TAG + "-I" + w}, ${TAG + " item " + w}, ${uom.id}, true) returning id`;
    own.push(it.id);
  }
  await sql.begin((tx) => P.postGoodsReceipt({ companyId: co.id, partnerId: supp.id, locationId: wh.id, docDate: today,
    memo: `DEADLOCK ${TAG}`, lines: own.map((itemId) => ({ itemId, qty: 100000, unitCost: 100 })) }, tx));
}
const sale = (cashIn, itemId = item.id) => sql.begin((tx) => P.postRetailSale({
  companyId: co.id, partnerId: cust.id, locationId: wh.id, docDate: today, dueDate: today,
  paymentType: cashIn ? "CASH" : "CREDIT", memo: `DEADLOCK ${TAG}`,
  lines: [{ itemId, qty: 1, unitPrice: 1000 }], cashIn, cashAccountId: cashIn ? cash.id : null,
}, tx));
const receipt = (invoiceId) => sql.begin((tx) => P.postCustomerReceipt({
  companyId: co.id, partnerId: cust.id, docDate: today, cashAccountId: cash.id, locationId: wh.id,
  allocations: [{ invoiceId, amount: 1000 }], memo: `DEADLOCK ${TAG}`,
}, tx));

// MODE=void: cash sales beside voids of counter sales (invoice, delivery and
// receipt reversed together) and corrections of credit invoices.
const MODE = process.env.MODE ?? "post";
const voidIt = (id) => sql.begin((tx) => P.voidDocument({ documentId: id, reason: TAG, goodsBack: true }, tx));
const amend = (id, itemId) => sql.begin((tx) => P.amendInvoice({ companyId: co.id, documentId: id, reason: TAG, invoice: {
  companyId: co.id, partnerId: cust.id, locationId: wh.id, docDate: today, dueDate: today, memo: `DEADLOCK ${TAG}`,
  lines: [{ itemId, qty: 1, unitPrice: 1100 }] } }, tx));
const deadlocks = [];
const counts = { cashSale: 0, creditSale: 0, receipt: 0, void: 0, amend: 0, other: 0 };
const stop = Date.now() + S * 1000;
const record = (op, e) => {
  if (e?.code === "40P01") deadlocks.push({ op, at: new Date().toISOString(), detail: e.detail, where: e.where, message: e.message });
  else { counts.other++; console.warn(op, e?.message); }
};
await Promise.all(Array.from({ length: W }, async (_, w) => {
  while (Date.now() < stop) {
    if (MODE === "void" && w % 3 > 0) {
      let inv;
      try { inv = await sale(w % 3 === 1 ? 1000 : 0, own[w]); counts[w % 3 === 1 ? "cashSale" : "creditSale"]++; }
      catch (e) { record("sale", e); continue; }
      if (w % 3 === 1) { try { await voidIt(inv.id); counts.void++; } catch (e) { record("void", e); } }
      else { try { await amend(inv.id, own[w]); counts.amend++; } catch (e) { record("amend", e); } }
      continue;
    }
    if (w % 2 === 0) {
      try { await sale(1000); counts.cashSale++; } catch (e) { record("cash sale", e); }
    } else {
      let inv;
      try { inv = await sale(0); counts.creditSale++; } catch (e) { record("credit sale", e); continue; }
      try { await receipt(inv.id); counts.receipt++; } catch (e) { record("receipt", e); }
    }
  }
}));

mkdirSync("loadtest/results", { recursive: true });
writeFileSync("loadtest/results/deadlocks.json", JSON.stringify({ tag: TAG, workers: W, seconds: S, counts, deadlocks }, null, 1));
console.log(`${TAG}: ${W} workers × ${S}s — posted`, counts, `— deadlocks ${deadlocks.length}`);
for (const d of deadlocks.slice(0, 4)) console.log(`\n[${d.op}] ${d.detail}\n  where: ${(d.where || "").split("\n").slice(0, 3).join(" | ")}`);
await sql`update business_partner set is_active = false where code like ${TAG + "%"}`;
await sql`update item set is_active = false where serial like ${TAG + "-I%"}`;
await sql.end();
