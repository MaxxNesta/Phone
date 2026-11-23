// A small, labelled set of discounts and free goods on DEV, so the two
// "Discounts & free goods" reports have something to show.
//
//   npx tsx scripts/demo-discounts.mjs          post it (once; refuses a second time)
//   npx tsx scripts/demo-discounts.mjs --undo   retire the two demo items
//
// Two demo items of its own (DFDEMO-PHONE 1,000,000, DFDEMO-CASE 50,000 on
// the list), so no real product's price or stock is touched. Every document
// carries reference DFDEMO. DEV only: refuses any company not named "DEV".
//
//   purchases  receipt at 900,000 then a bill 5% off (net: the cost drops),
//              a later 100,000 discount note, a bill of 5 cases + 1 free
//   sales      2 phones 10% off, a phone with a free case (IFRS 15 split),
//              a 50,000 discount note afterwards, a standalone giveaway

import postgres from "postgres";
const sql = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {} });
const P = await import("../lib/posting.ts");

const [co] = await sql`select id, name from company order by created_at limit 1`;
if (!/DEV/.test(co.name)) { console.error(`Refusing: "${co.name}" is not a DEV company.`); process.exit(1); }

if (process.argv.includes("--undo")) {
  const r = await sql`update item set is_active = false where company_id = ${co.id} and code like '%DFDEMO-%' returning code`;
  console.log(`retired ${r.length} demo items; their documents stay until DEV's transactions are next emptied`);
  await sql.end(); process.exit(0);
}
if ((await sql`select 1 from document where company_id = ${co.id} and reference = 'DFDEMO' limit 1`).length) {
  console.error("Already posted (documents with reference DFDEMO exist)."); process.exit(1);
}

const today = new Date().toISOString().slice(0, 10);
const ref = { reference: "DFDEMO" };
await sql.begin(async (tx) => {
  const [loc] = await tx`select id from location where company_id = ${co.id} and is_stock_location and not is_quarantine and not is_transit and is_active order by code limit 1`;
  const [uom] = await tx`select id from uom where company_id = ${co.id} order by code limit 1`;
  const [grp] = await tx`select g.id from item_group g where g.company_id = ${co.id}
      and not exists (select 1 from account_determination d where d.item_group_id = g.id and d.role = 'REVENUE') order by g.code limit 1`;
  const [cust] = await tx`select id from business_partner where company_id = ${co.id} and is_customer order by code limit 1`;
  const [supp] = await tx`select id from business_partner where company_id = ${co.id} and is_supplier order by code limit 1`;
  const [lvl] = await tx`select id from price_level where company_id = ${co.id} order by (code = 'RETAIL') desc, sort_order, code limit 1`;
  const [promo] = await tx`select id from foc_reason where company_id = ${co.id} and applies_to = 'SALE' and code = 'PROMOTION'`;
  const [supFoc] = await tx`select id from foc_reason where company_id = ${co.id} and applies_to = 'PURCHASE' limit 1`;

  const item = async (code, name, price) => {
    const [i] = await tx`select id from item where company_id = ${co.id} and (code = ${code} or code like '%-' || ${code})`;
    const id = i?.id ?? (await tx`insert into item (company_id, item_group_id, code, serial, name, base_uom_id, is_stocked)
        values (${co.id}, ${grp.id}, ${code}, ${code}, ${name}, ${uom.id}, true) returning id`)[0].id;
    await tx`update item set is_active = true where id = ${id}`;
    await tx`insert into item_price (company_id, item_id, price_level_id, uom_id, currency, price, valid_from)
             values (${co.id}, ${id}, ${lvl.id}, ${uom.id}, 'MMK', ${price}, ${today}::date) on conflict do nothing`;
    return id;
  };
  const phone = await item("DFDEMO-PHONE", "Demo phone (discounts report)", 1_000_000);
  const kase = await item("DFDEMO-CASE", "Demo case (discounts report)", 50_000);
  const base = { companyId: co.id, locationId: loc.id, docDate: today, ...ref };

  // Purchases.
  const gr = await P.postGoodsReceipt({ ...base, partnerId: supp.id,
    lines: [{ itemId: phone, qty: 10, unitCost: 900_000 }, { itemId: kase, qty: 10, unitCost: 15_000 }] }, tx);
  const grLines = await tx`select id from document_line where document_id = ${gr.id} order by line_no`;
  const bill = await P.postPurchaseInvoice({ ...base, partnerId: supp.id, dueDate: null, goodsReceiptId: gr.id,
    lines: [{ itemId: phone, qty: 10, unitPrice: 900_000, discountPct: 5, sourceLineId: grLines[0].id },
            { itemId: kase, qty: 10, unitPrice: 15_000, sourceLineId: grLines[1].id }] }, tx);
  await P.postDebitNote({ companyId: co.id, partnerId: supp.id, docDate: today, sourceDocumentId: bill.id,
    amount: 100_000, category: "DISCOUNT", reason: "Volume rebate agreed after billing (demo)", ...ref }, tx);
  const bill2 = await P.postPurchaseInvoice({ ...base, partnerId: supp.id, dueDate: null,
    lines: [{ itemId: kase, qty: 5, unitPrice: 15_000 }, { itemId: kase, qty: 1, unitPrice: 0, focReasonId: supFoc.id }] }, tx);
  await P.postGoodsReceipt({ ...base, partnerId: supp.id, sourceDocumentId: bill2.id,
    lines: [{ itemId: kase, qty: 6, unitCost: 0 }] }, tx);

  // Sales.
  const sale = (lines) => P.postSalesInvoice({ ...base, partnerId: cust.id, dueDate: today, paymentType: "CREDIT",
    allowOverCreditLimit: true, creditOverrideReason: "demo", issueStock: true, lines }, tx);
  const s1 = await sale([{ itemId: phone, qty: 2, unitPrice: 1_000_000, discountPct: 10 }]);
  await sale([{ itemId: phone, qty: 1, unitPrice: 1_000_000 }, { itemId: kase, qty: 1, unitPrice: 0, focReasonId: promo.id }]);
  await P.postCreditNote({ companyId: co.id, partnerId: cust.id, docDate: today, sourceDocumentId: s1.id,
    amount: 50_000, category: "DISCOUNT", reason: "Loyalty discount after the sale (demo)", ...ref }, tx);
  await P.postDelivery({ ...base, partnerId: cust.id, lines: [{ itemId: kase, qty: 1, unitPrice: 0, focReasonId: promo.id }] }, tx);
});
console.log("posted: see Sales → Discounts & free goods, and Purchases → Discounts & free goods");
await sql.end();
