// Secondhand buyback and trade-in (0209).
//
//   npx tsx scripts/test-secondhand.mjs      (one transaction, rolled back)
//
//   1. cash buyback          2. duplicate active IMEI refused, NRC required
//   3. resale at its own cost; the till's price guard for a used IMEI
//   4. same IMEI bought back again, on credit, history kept
//   5. trade-in with a promotion: discount, clearing nets to zero, cash difference
//   6. old phone worth more: the customer is owed the rest, then paid (partial settlement)
//   7. a genuine customer return is not a buyback
//   8. reversal refused once the bought phone has been resold
//   9. stock ledger and inventory account: no new gap
//  10. void a whole trade-in in one act; refused (and nothing undone) once the old phone is resold

import postgres from "postgres";
const sql = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {} });
const P = await import("../lib/posting.ts");
const S = await import("../lib/secondhand.ts");

let bad = 0;
const check = (label, ok, detail = "") => { if (!ok) bad++; console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  " + detail : ""}`); };
const refused = async (tx, fn) => tx.savepoint(fn).then(() => null, (e) => e.message);
const ROLLBACK = new Error("rollback");

try {
  await sql.begin(async (tx) => {
    const [co] = await tx`select id from company order by created_at limit 1`;
    const [loc] = await tx`select id from location where company_id = ${co.id} and is_stock_location and not is_quarantine and not is_transit and is_active order by code limit 1`;
    const [phone] = await tx`select id, name from item where company_id = ${co.id} and tracks_serial and is_stocked and is_active
        and not exists (select 1 from item c where c.parent_item_id = item.id) order by code limit 1`;
    const [supp] = await tx`select id from business_partner where company_id = ${co.id} and is_supplier order by code limit 1`;
    const [cash] = await tx`select id from account where company_id = ${co.id} and code = '1110'`;
    const today = new Date().toISOString().slice(0, 10);
    const gapNow = async () => (await tx`select coalesce(sum(gl_balance - stock_value), 0)::float as g from v_check_inventory_reconciliation`)[0].g;
    const gapBefore = await gapNow();
    const bal = async (code) => Number((await tx`select coalesce(sum(jl.base_amount), 0)::float as v from journal_line jl
        join account a on a.id = jl.account_id where jl.company_id = ${co.id} and a.code = ${code}`)[0].v);
    const owing = async (id) => Number((await tx`select outstanding from v_open_item where document_id = ${id}`)[0]?.outstanding ?? 0);
    const cost = async (imei) => Number((await tx`select unit_cost from v_stock_serial where company_id = ${co.id} and imei = ${imei}`)[0]?.unit_cost);
    const seller = { kind: "CUSTOMER", name: "Ko Test Seller", phone: "09 400 000 111", nrc: "12/TEST(N)000111" };
    const insp = { grade: "A", batteryPct: 88, activationLock: "REMOVED", checks: { screen: "OK" }, notes: "test" };
    const buy = (imei, price, cashAccountId, s = seller) => S.postSecondhandBuy(tx, { companyId: co.id, locationId: loc.id,
      docDate: today, seller: s, itemId: phone.id, imei, price, inspection: insp, cashAccountId });
    const sell = (imei, price, cashIn) => P.postRetailSale({ companyId: co.id, partnerId: (await0.partnerId), locationId: loc.id,
      docDate: today, dueDate: today, paymentType: cashIn ? "CASH" : "CREDIT", cashIn, cashAccountId: cashIn ? cash.id : null,
      allowOverCreditLimit: true, creditOverrideReason: "test", lines: [{ itemId: phone.id, qty: 1, unitPrice: price, serials: [imei] }] }, tx);
    const await0 = {};
    console.log(`\n  ${phone.name} · rolled back at the end\n`);

    // 1 ---------------------------------------------------------------------
    const cash0 = await bal("1110"), inv0 = await bal("1310");
    const b1 = await buy("TST-SH-0001", 800_000, cash.id);
    await0.partnerId = b1.partnerId;
    check("1. cash buyback: stock +800,000, cash −800,000", (await bal("1310")) - inv0 === 800_000 && (await bal("1110")) - cash0 === -800_000);
    check("   the phone is on the shelf at 800,000", (await cost("TST-SH-0001")) === 800_000);
    check("   bill fully paid, nothing owed", (await owing(b1.billId)) === 0);
    const [p1] = await tx`select is_customer, is_supplier from business_partner where id = ${b1.partnerId}`;
    check("   seller is both customer and supplier", p1.is_customer && p1.is_supplier);

    // 2 ---------------------------------------------------------------------
    const dup = await refused(tx, (sp) => S.postSecondhandBuy(sp, { companyId: co.id, locationId: loc.id, docDate: today,
      seller, itemId: phone.id, imei: "TST-SH-0001", price: 500_000, inspection: insp }));
    check("2. the same IMEI while on the shelf is refused", /in stock already/.test(dup ?? ""), dup ?? "posted");
    const nrc = await refused(tx, (sp) => S.postSecondhandBuy(sp, { companyId: co.id, locationId: loc.id, docDate: today,
      seller: { ...seller, nrc: "" }, itemId: phone.id, imei: "TST-SH-0009", price: 500_000, inspection: insp }));
    check("   an individual seller without NRC is refused", /NRC/.test(nrc ?? ""), nrc ?? "posted");

    // 3 ---------------------------------------------------------------------
    const cogs0 = await bal("5110");
    const s1 = await sell("TST-SH-0001", 950_000, 950_000);
    check("3. resold: cost of sales is its own 800,000", (await bal("5110")) - cogs0 === 800_000);

    // 4 ---------------------------------------------------------------------
    const b2 = await buy("TST-SH-0001", 600_000, null);
    const events = (await tx`select e.event from stock_serial_event e join stock_serial s on s.id = e.serial_id
        where s.serial_no = 'TST-SH-0001' order by e.created_at`).map((r) => r.event);
    check("4. bought back again on credit: a new layer at 600,000", (await cost("TST-SH-0001")) === 600_000);
    check("   history kept (received, sold, reacquired)", events.includes("REACQUIRED") && events.length >= 2, events.join(" → "));
    const [i2] = await tx`select previous_sale_id from secondhand_intake where id = ${b2.intakeId}`;
    check("   linked to the sale it came back from", i2.previous_sale_id === s1.id);
    check("   owed to the seller: 600,000", (await owing(b2.billId)) === 600_000);

    // 5 ---------------------------------------------------------------------
    await P.postGoodsReceipt({ companyId: co.id, partnerId: supp.id, locationId: loc.id, docDate: today,
      lines: [{ itemId: phone.id, qty: 2, unitCost: 1_200_000, serials: ["TST-SH-NEW1", "TST-SH-NEW2"] }] }, tx);
    const clear0 = await bal("1450"), rev0 = await bal("4110"), disc0 = await bal("4190"), cash5 = await bal("1110");
    const t1 = await S.postTradeIn(tx, { companyId: co.id, locationId: loc.id, docDate: today, seller,
      itemId: phone.id, imei: "TST-SH-0002", inspection: { ...insp, grade: "B" },
      inspectedValue: 700_000, topUp: 100_000, newItemId: phone.id, newImei: "TST-SH-NEW1", newPrice: 1_500_000, cashAccountId: cash.id });
    check("5. trade-in: Sales 1,500,000, promotion 100,000 to 4190", (await bal("4110")) - rev0 === -1_500_000 && (await bal("4190")) - disc0 === 100_000);
    check("   old phone on the shelf at its inspected 700,000", (await cost("TST-SH-0002")) === 700_000);
    check("   clearing nets to zero", (await bal("1450")) - clear0 === 0);
    check("   customer paid the 700,000 difference in cash", (await bal("1110")) - cash5 === 700_000 && t1.difference === 700_000);
    check("   sale and bill both settled", (await owing(t1.id)) === 0 && (await owing(t1.billId)) === 0);
    const [link] = await tx`select count(*)::int as n from trade_in where sale_id = ${t1.id}`;
    check("   one trade-in record links them", link.n === 1);

    // 6 ---------------------------------------------------------------------
    const t2 = await S.postTradeIn(tx, { companyId: co.id, locationId: loc.id, docDate: today, seller,
      itemId: phone.id, imei: "TST-SH-0003", inspection: insp, inspectedValue: 1_500_000,
      newItemId: phone.id, newImei: "TST-SH-NEW2", newPrice: 1_300_000, cashAccountId: cash.id });
    check("6. old phone worth 200,000 more: the customer is owed it", (await owing(t2.billId)) === 200_000 && (await owing(t2.id)) === 0);
    await P.postSupplierPayment({ companyId: co.id, partnerId: b1.partnerId, docDate: today, cashAccountId: cash.id,
      locationId: loc.id, allocations: [{ invoiceId: t2.billId, amount: 120_000 }] }, tx);
    check("   part paid: 80,000 still owed", (await owing(t2.billId)) === 80_000);

    // 7 ---------------------------------------------------------------------
    const intakes0 = (await tx`select count(*)::int as n from secondhand_intake where company_id = ${co.id}`)[0].n;
    await P.postSalesReturn({ companyId: co.id, partnerId: b1.partnerId, locationId: loc.id, docDate: today, sourceDocumentId: t1.id,
      lines: [{ itemId: phone.id, qty: 1, unitPrice: 1_500_000, serials: ["TST-SH-NEW1"] }] }, tx);
    const intakes1 = (await tx`select count(*)::int as n from secondhand_intake where company_id = ${co.id}`)[0].n;
    check("7. a customer return puts the phone back without a buyback", intakes1 === intakes0 && (await cost("TST-SH-NEW1")) === 1_200_000);
    const again = await refused(tx, (sp) => S.postSecondhandBuy(sp, { companyId: co.id, locationId: loc.id, docDate: today,
      seller, itemId: phone.id, imei: "TST-SH-NEW1", price: 900_000, inspection: insp }));
    check("   and it cannot then be bought in as well", /in stock already/.test(again ?? ""), again ?? "posted");

    // 8 ---------------------------------------------------------------------
    const voidGr = await refused(tx, (sp) => P.voidDocument({ documentId: b1.receiptId, reason: "test", goodsBack: true }, sp));
    check("8. voiding the first buyback's receipt after resale is refused", !!voidGr, voidGr ?? "voided");

    // 10 --------------------------------------------------------------------
    const clearV = await bal("1450");
    await S.voidTradeIn(tx, { companyId: co.id, saleId: t2.id, reason: "test" });
    const st = async (id) => (await tx`select status from document where id = ${id}`)[0].status;
    check("10. void whole trade-in: sale and bill both reversed", (await st(t2.id)) !== "POSTED" && (await st(t2.billId)) !== "POSTED",
      `${await st(t2.id)} / ${await st(t2.billId)}`);
    const shelf = async (imei) => (await tx`select exists (select 1 from v_stock_serial_available where company_id = ${co.id} and serial_no = ${imei}) as y`)[0].y;
    check("    the new phone is back on the shelf, the old one is gone", (await shelf("TST-SH-NEW2")) && !(await shelf("TST-SH-0003")), `new ${await shelf("TST-SH-NEW2")} old ${await shelf("TST-SH-0003")}`);
    check("    clearing still nets to zero", (await bal("1450")) - clearV === 0);
    await P.postGoodsReceipt({ companyId: co.id, partnerId: supp.id, locationId: loc.id, docDate: today,
      lines: [{ itemId: phone.id, qty: 1, unitCost: 1_000_000, serials: ["TST-SH-NEW3"] }] }, tx);
    const t3 = await S.postTradeIn(tx, { companyId: co.id, locationId: loc.id, docDate: today, seller,
      itemId: phone.id, imei: "TST-SH-0004", inspection: insp, inspectedValue: 400_000,
      newItemId: phone.id, newImei: "TST-SH-NEW3", newPrice: 1_100_000, cashAccountId: cash.id });
    await sell("TST-SH-0004", 500_000, 500_000);
    const blocked = await refused(tx, (sp) => S.voidTradeIn(sp, { companyId: co.id, saleId: t3.id, reason: "test" }));
    check("    once the old phone is resold, the whole void is refused", !!blocked, blocked ?? "voided");
    check("    and nothing was undone", (await st(t3.id)) === "POSTED");

    // 9 ---------------------------------------------------------------------
    const gapAfter = await gapNow();
    check("9. stock ledger and inventory account: no new gap", Math.abs(gapAfter - gapBefore) < 0.01, `${gapBefore} → ${gapAfter}`);

    throw ROLLBACK;
  });
} catch (e) { if (e !== ROLLBACK) { bad++; console.error("  ERROR", e); } }
await sql.end();
console.log(bad ? `\n  ${bad} failed\n` : "\n  all passed — nothing kept\n");
process.exit(bad ? 1 : 0);
