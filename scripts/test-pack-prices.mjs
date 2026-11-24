// Pack prices by level, dated (0236).
//
//   npx tsx scripts/test-pack-prices.mjs      (one transaction, rolled back)
//
//   1. a box and a pack each have a price at every level
//   2. a price change is a new dated row: last month's 10,000 stays beside this month's 12,000
//   3. the product page's pack price (v_item_pack) is today's at the default level; a future one waits
//   5. removing a price keeps the ones before it; the sale falls back
//   4. listPrice: a unit's own price at the level; else the level's piece price × the pack;
//      else the pack's default price; a piece with no price at the level takes any level's

import postgres from "postgres";
const sql = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {} });
const { listPrice } = await import("../components/unit-toggle.tsx");

let bad = 0;
const check = (label, ok, detail = "") => { if (!ok) bad++; console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  " + detail : ""}`); };
const ROLLBACK = new Error("rollback");

try {
  await sql.begin(async (tx) => {
    const [co] = await tx`select id from company order by created_at limit 1`;
    const [grp] = await tx`select id from item_group where company_id = ${co.id} order by code limit 1`;
    const uom = async (code) => (await tx`insert into uom (company_id, code, name) values (${co.id}, ${code}, ${code}) returning id`)[0].id;
    const PCS = await uom("TPCS"), PACK = await uom("TPACK"), BOX = await uom("TBOX6");
    const [item] = await tx`insert into item (company_id, item_group_id, serial, code, name, base_uom_id, is_stocked)
        values (${co.id}, ${grp.id}, 'TPP1', 'TPP1', 'Test cable', ${PCS}, true) returning id`;
    await tx`insert into item_uom (company_id, item_id, uom_id, factor) values
        (${co.id}, ${item.id}, ${PACK}, 6), (${co.id}, ${item.id}, ${BOX}, 36)`;
    const [def] = await tx`select fn_default_price_level(${co.id}) as id`;
    const [wh] = await tx`insert into price_level (company_id, code, name, sort_order) values (${co.id}, 'TWHS', 'Test wholesale', 99) returning id`;
    const price = (lvl, u, p, from) => tx`insert into item_price (company_id, item_id, price_level_id, uom_id, currency, price, valid_from)
        values (${co.id}, ${item.id}, ${lvl}, ${u}, 'MMK', ${p}, ${from}::date)`;
    const [{ today, last, next }] = await tx`select fn_shop_today()::text as today, (fn_shop_today() - 30)::text as last,
                                                    (fn_shop_today() + 7)::text as next`;

    // 1 + 2. Default level: piece 3,000; pack 10,000 last month, 12,000 from today, 13,000 next week.
    await price(def.id, PCS, 3000, last);
    await price(def.id, PACK, 10000, last);
    await price(def.id, PACK, 12000, today);
    await price(def.id, PACK, 13000, next);
    await price(def.id, BOX, 65000, last);
    // Wholesale: its own box price, and a piece price but no pack price.
    await price(wh.id, BOX, 60000, last);
    await price(wh.id, PCS, 2500, last);

    const hist = await tx`select price::float as p, valid_from::text as d from item_price
        where item_id = ${item.id} and price_level_id = ${def.id} and uom_id = ${PACK} order by valid_from`;
    check("1. box and pack priced at each level", (await tx`select count(distinct (price_level_id, uom_id))::int n from item_price where item_id = ${item.id}`)[0].n === 5);
    check("2. last month's pack price stays 10,000 beside today's 12,000",
      hist.map((h) => h.p).join(",") === "10000,12000,13000", hist.map((h) => `${h.d} ${h.p}`).join(" · "));

    // 3. The product page's "Sells at": today's, not next week's.
    const packs = await tx`select uom_id, sale_price::float as p from v_item_pack where item_id = ${item.id} and not standard`;
    const at = (u) => packs.find((x) => x.uom_id === u)?.p;
    check("3. pack sells at today's 12,000 (13,000 waits for next week)", at(PACK) === 12000, String(at(PACK)));
    check("   box sells at 65,000", at(BOX) === 65000, String(at(BOX)));

    // 4. listPrice, as the sales invoice and order call it, with today's rows.
    const rows = await tx`select distinct on (price_level_id, uom_id) item_id, price_level_id, uom_id, price
        from item_price where item_id = ${item.id} and valid_from <= fn_shop_today()
        order by price_level_id, uom_id, valid_from desc`;
    const it = { id: item.id, base_uom_id: PCS, packs: packs.map((x) => ({ uomId: x.uom_id, code: "", factor: x.uom_id === BOX ? 36 : 6, price: x.p })) };
    check("4. default level: pack 12,000, box 65,000, piece 3,000",
      listPrice(rows, it, def.id, PACK) === 12000 && listPrice(rows, it, def.id, BOX) === 65000 && listPrice(rows, it, def.id, null) === 3000);
    check("   wholesale: its own box price 60,000", listPrice(rows, it, wh.id, BOX) === 60000);
    check("   wholesale pack, no pack price there: its piece 2,500 × 6 = 15,000", listPrice(rows, it, wh.id, PACK) === 15000,
      String(listPrice(rows, it, wh.id, PACK)));
    const noPiece = rows.filter((r) => !(r.price_level_id === wh.id && r.uom_id === PCS));
    check("   without a wholesale piece price: the pack's default 12,000", listPrice(noPiece, it, wh.id, PACK) === 12000);
    check("   a level with nothing: the piece takes any level's 3,000", listPrice(noPiece, it, "00000000-0000-0000-0000-000000000000", null) === 3000);

    // 5. Removing a price (0237): no price from today, last month's row kept, the sale falls back.
    await price(def.id, BOX, null, today);
    const boxRows = await tx`select price::float as p from item_price
        where item_id = ${item.id} and price_level_id = ${def.id} and uom_id = ${BOX} order by valid_from`;
    check("5. box price removed today: 65,000 kept in the history, then none", boxRows.map((r) => r.p).join(",") === "65000,",
      JSON.stringify(boxRows.map((r) => r.p)));
    const [vp] = await tx`select sale_price from v_item_pack where item_id = ${item.id} and uom_id = ${BOX}`;
    check("   the product page shows no box price", vp.sale_price === null);
    const live = await tx`select * from (select distinct on (price_level_id, uom_id) item_id, price_level_id, uom_id, price
        from item_price where item_id = ${item.id} and valid_from <= fn_shop_today()
        order by price_level_id, uom_id, valid_from desc) c where c.price is not null`;
    const it2 = { ...it, packs: it.packs.map((x) => (x.uomId === BOX ? { ...x, price: null } : x)) };
    check("   a box sells at the piece price × 36 = 108,000", listPrice(live, it2, def.id, BOX) === 108000, String(listPrice(live, it2, def.id, BOX)));

    throw ROLLBACK;
  });
} catch (e) {
  if (e !== ROLLBACK) { console.error(e); bad++; }
}
await sql.end();
console.log(bad ? `\n  ${bad} failed` : "\n  all passed (rolled back)");
process.exit(bad ? 1 : 0);
