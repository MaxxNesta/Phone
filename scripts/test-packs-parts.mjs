// Packs and part numbers (0213), for a spare-parts shop.
//
//   npx tsx scripts/test-packs-parts.mjs      (one transaction, rolled back)
//
//   1. bought in boxes of 10: stock counts pieces, cost per piece
//   2. sold in a box at the box's own price
//   3. customer returns a box: 10 pieces back, line reads "1 BOX"
//   4. a box goes back to the supplier: 10 pieces out
//   5. part numbers match with dashes and spaces ignored
//   6. priceInUnit: pack price, piece × size, buying scales
//   7. litres: oil counted in L, bought in 200 L drums and 4 L cans, sold by the can and loose (2.5 L)
//   8. metres and feet: hose counted in M, sold in FT (1 FT = 0.3048 M)
//   9. the till's price guard reads a pack line per stock unit and honours a pack's own price

import postgres from "postgres";
const sql = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {} });
const P = await import("../lib/posting.ts");
const { priceInUnit } = await import("../components/unit-toggle.tsx");
const { priceProblem } = await import("../lib/price-guard.ts");

let bad = 0;
const check = (label, ok, detail = "") => { if (!ok) bad++; console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  " + detail : ""}`); };
const ROLLBACK = new Error("rollback");

try {
  await sql.begin(async (tx) => {
    const [co] = await tx`select id from company order by created_at limit 1`;
    const [loc] = await tx`select id from location where company_id = ${co.id} and is_stock_location and is_active order by code limit 1`;
    const [item] = await tx`select id, code, base_uom_id from item where company_id = ${co.id} and is_stocked and is_active
        and not tracks_serial and coalesce(identity, 'NONE') = 'NONE' and not tracks_batch
        and not exists (select 1 from item c where c.parent_item_id = item.id) order by code limit 1`;
    const [supp] = await tx`select id from business_partner where company_id = ${co.id} and is_supplier order by code limit 1`;
    const [cust] = await tx`select id from business_partner where company_id = ${co.id} and is_customer order by code limit 1`;
    let [box] = await tx`select id from uom where company_id = ${co.id} and id <> ${item.base_uom_id} order by code limit 1`;
    if (!box) [box] = await tx`insert into uom (company_id, code, name) values (${co.id}, 'TBOX', 'Test box') returning id`;
    await tx`delete from item_uom where item_id = ${item.id}`;
    await tx`insert into item_uom (company_id, item_id, uom_id, factor, sale_price) values (${co.id}, ${item.id}, ${box.id}, 10, 45000)`;
    const today = new Date().toISOString().slice(0, 10);
    const onHand = async () => Number((await tx`select fn_qty_on_hand(${co.id}, ${item.id}, ${loc.id}) as q`)[0].q);
    const bal = async (code) => Number((await tx`select coalesce(sum(jl.base_amount), 0)::float as v from journal_line jl
        join account a on a.id = jl.account_id where jl.company_id = ${co.id} and a.code = ${code}`)[0].v);
    const line = async (docId) => (await tx`select entered_qty::float q, entered_uom_id u, conversion_factor::float f,
        base_qty::float b, unit_price::float p from document_line where document_id = ${docId} order by line_no limit 1`)[0];
    console.log(`\n  ${item.code} in boxes of 10 · rolled back at the end\n`);

    // 1 ---------------------------------------------------------------------
    const q0 = await onHand();
    const bill = await P.postPurchaseWithReceipt({ companyId: co.id, partnerId: supp.id, locationId: loc.id, docDate: today,
      dueDate: today, lines: [{ itemId: item.id, qty: 3, uomId: box.id, unitPrice: 30000 }] }, tx);
    const [lot] = await tx`select unit_cost::float c from stock_movement
        where document_id = (select source_document_id from document where id = ${bill.id}) and item_id = ${item.id}`;
    check("1. 3 boxes bought: +30 pieces on hand", (await onHand()) - q0 === 30, `${(await onHand()) - q0}`);
    if (lot) check("   cost per piece 3,000", lot.c === 3000, `${lot.c}`);

    // 2 ---------------------------------------------------------------------
    const rev0 = await bal("4110");
    const sale = await P.postRetailSale({ companyId: co.id, partnerId: cust.id, locationId: loc.id, docDate: today, dueDate: today,
      paymentType: "CREDIT", allowOverCreditLimit: true, creditOverrideReason: "test",
      lines: [{ itemId: item.id, qty: 1, uomId: box.id, unitPrice: 45000 }] }, tx);
    const sl = await line(sale.id);
    check("2. 1 box sold: −10 pieces", (await onHand()) - q0 === 20);
    check("   sales 45,000 and the line reads 1 box of 10", (await bal("4110")) - rev0 === -45000 && sl.q === 1 && sl.f === 10 && sl.b === 10,
      JSON.stringify(sl));

    // 3 ---------------------------------------------------------------------
    const ret = await P.postSalesReturn({ companyId: co.id, partnerId: cust.id, locationId: loc.id, docDate: today,
      sourceDocumentId: sale.id, lines: [{ itemId: item.id, qty: 1, uomId: box.id, unitPrice: 45000 }] }, tx);
    const rl = await line(ret.id);
    check("3. customer returns 1 box: +10 pieces", (await onHand()) - q0 === 30);
    check("   return line: 1 box, factor 10, base 10, 45,000 a box", rl.q === 1 && rl.u === box.id && rl.f === 10 && rl.b === 10 && rl.p === 45000,
      JSON.stringify(rl));
    const [rv] = await tx`select gross_total::float g from document where id = ${ret.id}`;
    check("   the customer owes 45,000 less", rv.g === 45000, `${rv.g}`);

    // 4 ---------------------------------------------------------------------
    const pr = await P.postPurchaseReturn({ companyId: co.id, partnerId: supp.id, locationId: loc.id, docDate: today,
      sourceDocumentId: bill.id, lines: [{ itemId: item.id, qty: 1, uomId: box.id, unitPrice: 30000 }] }, tx);
    const pl = await line(pr.id);
    check("4. 1 box back to the supplier: −10 pieces", (await onHand()) - q0 === 20);
    check("   return line: 1 box, base 10, 30,000 a box", pl.q === 1 && pl.f === 10 && pl.b === 10 && pl.p === 30000, JSON.stringify(pl));

    // 5 ---------------------------------------------------------------------
    await tx`delete from item_part_number where item_id = ${item.id}`;
    await tx`insert into item_part_number (company_id, item_id, part_no, kind) values (${co.id}, ${item.id}, '04465-0K240', 'OEM')`;
    const hit = async (q) => (await tx`select count(*)::int n from item_part_number where company_id = ${co.id} and item_id = ${item.id}
        and norm like '%' || upper(regexp_replace(${q}::text, '[^A-Za-z0-9]', '', 'g')) || '%'`)[0].n === 1;
    check("5. part number found as typed, without dashes, in part", await hit("04465-0K240") && await hit("044650k240") && await hit("0k24"));
    const dupe = await tx.savepoint((sp) => sp`insert into item_part_number (company_id, item_id, part_no, kind)
        values (${co.id}, ${item.id}, '04465 0K240', 'OEM')`).then(() => null, (e) => e.message);
    check("   the same number twice on one item is refused", !!dupe);

    // 6 ---------------------------------------------------------------------
    const packs = [{ uomId: "BOX", code: "BOX", factor: 10, price: 45000 }, { uomId: "SET", code: "SET", factor: 4, price: null }];
    check("6. selling: box takes its own price", priceInUnit(packs, null, "BOX", 5000, 5000) === 45000);
    check("   selling: a set with no price is piece × 4", priceInUnit(packs, null, "SET", 5000, 5000) === 20000);
    check("   selling: back to pieces is the list price", priceInUnit(packs, "BOX", null, 45000, 5000) === 5000);
    check("   buying: a typed piece cost scales to the box", priceInUnit(packs, null, "BOX", 3000, null) === 30000);

    // 7 ---------------------------------------------------------------------
    const [grp] = await tx`select id from item_group where company_id = ${co.id} order by code limit 1`;
    const uom = async (code, name) => (await tx`insert into uom (company_id, code, name) values (${co.id}, ${code}, ${name})
        on conflict (company_id, code) do update set name = excluded.name returning id`)[0].id;
    const L = await uom("TL", "Litre"), DRUM = await uom("TDRUM", "Drum"), CAN = await uom("TCAN", "Can");
    const M = await uom("TM", "Metre"), FT = await uom("TFT", "Foot");
    const mk = async (serial, name, base) => (await tx`insert into item (company_id, item_group_id, serial, code, name, base_uom_id, is_stocked)
        values (${co.id}, ${grp.id}, ${serial}, ${serial}, ${name}, ${base}, true) returning id`)[0].id;
    const oil = await mk("TOIL1", "Engine oil 5W-30", L);
    await tx`insert into item_uom (company_id, item_id, uom_id, factor, sale_price) values
        (${co.id}, ${oil}, ${DRUM}, 200, null), (${co.id}, ${oil}, ${CAN}, 4, 60000)`;
    const qty = async (id) => Number((await tx`select fn_qty_on_hand(${co.id}, ${id}, ${loc.id}) as q`)[0].q);
    const oilBill = await P.postPurchaseWithReceipt({ companyId: co.id, partnerId: supp.id, locationId: loc.id, docDate: today,
      dueDate: today, lines: [{ itemId: oil, qty: 2, uomId: DRUM, unitPrice: 2_000_000 }] }, tx);
    const [oc] = await tx`select unit_cost::float c from stock_movement
        where document_id = (select source_document_id from document where id = ${oilBill.id}) and item_id = ${oil}`;
    check("7. 2 drums of oil bought: 400 L at 10,000 a litre", (await qty(oil)) === 400 && oc.c === 10000, `${await qty(oil)} L @ ${oc.c}`);
    await P.postRetailSale({ companyId: co.id, partnerId: cust.id, locationId: loc.id, docDate: today, dueDate: today,
      paymentType: "CREDIT", allowOverCreditLimit: true, creditOverrideReason: "test",
      lines: [{ itemId: oil, qty: 3, uomId: CAN, unitPrice: 60000 }, { itemId: oil, qty: 2.5, unitPrice: 16000 }] }, tx);
    check("   3 cans and 2.5 L loose sold: 385.5 L left", (await qty(oil)) === 385.5, `${await qty(oil)}`);

    // 8 ---------------------------------------------------------------------
    const hose = await mk("THOSE1", "Fuel hose 8mm", M);
    await tx`insert into item_uom (company_id, item_id, uom_id, factor) values (${co.id}, ${hose}, ${FT}, 0.3048)`;
    await P.postPurchaseWithReceipt({ companyId: co.id, partnerId: supp.id, locationId: loc.id, docDate: today,
      dueDate: today, lines: [{ itemId: hose, qty: 50, unitPrice: 10000 }] }, tx);
    const cogs0 = await bal("5110");
    const hs = await P.postRetailSale({ companyId: co.id, partnerId: cust.id, locationId: loc.id, docDate: today, dueDate: today,
      paymentType: "CREDIT", allowOverCreditLimit: true, creditOverrideReason: "test",
      lines: [{ itemId: hose, qty: 10, uomId: FT, unitPrice: priceInUnit([{ uomId: FT, code: "FT", factor: 0.3048 }], null, FT, 10000, 10000) }] }, tx);
    const hl = await line(hs.id);
    check("8. 10 FT sold from 50 M: 46.952 M left", (await qty(hose)) === 46.952, `${await qty(hose)}`);
    check("   line reads 10 FT at 3,048 a foot, 3.048 M out", hl.q === 10 && hl.p === 3048 && hl.b === 3.048, JSON.stringify(hl));
    check("   cost of sales 30,480 (3.048 M × 10,000)", (await bal("5110")) - cogs0 === 30480, `${(await bal("5110")) - cogs0}`);
    const back = await P.postSalesReturn({ companyId: co.id, partnerId: cust.id, locationId: loc.id, docDate: today,
      sourceDocumentId: hs.id, lines: [{ itemId: hose, qty: 5, uomId: FT, unitPrice: 3048 }] }, tx);
    check("   5 FT returned: 48.476 M on hand", (await qty(hose)) === 48.476, `${await qty(hose)} (${back.docNo})`);

    // 9 ---------------------------------------------------------------------
    const seller = { role: "SALES" };
    const facts = async () => new Map([[item.id, { name: "box item", price: 5000, cost: 3000 }], [hose, { name: "hose", price: 10000, cost: 10000 }]]);
    const guard = (lines) => priceProblem(seller, co.id, lines, null, facts, tx);
    check("9. a box at its own 45,000 passes (not held to 12 × 5,000)", (await guard([{ itemId: item.id, unitPrice: 45000, uomId: box.id }])) === null);
    check("   a box at 30,000 needs a manager", (await guard([{ itemId: item.id, unitPrice: 30000, uomId: box.id }]))?.key === "priceNeedsManager");
    check("   a foot of hose at 3,048 passes (10,000 a metre)", (await guard([{ itemId: hose, unitPrice: 3048, uomId: FT }])) === null);
    check("   a foot at 2,000 needs a manager", (await guard([{ itemId: hose, unitPrice: 2000, uomId: FT }])) !== null);
    check("   a piece at 5,000 still passes as before", (await guard([{ itemId: item.id, unitPrice: 5000 }])) === null);

    throw ROLLBACK;
  });
} catch (e) {
  if (e !== ROLLBACK) { console.error(e); bad++; }
}
await sql.end();
console.log(bad ? `\n  ${bad} failed\n` : "\n  all passed (rolled back)\n");
process.exit(bad ? 1 : 0);
