// Throwaway: shop-scale stock on DEV, for measuring the inventory pages.
//   ALLOW_DESTRUCTIVE_TESTS=1 npx tsx scripts/perf-seed.mjs [--remove]
//
// 60 phone models × 4 storages × 6 colours = 1,440 variants, 400 accessories,
// about 10,000 IMEIs across three warehouses through the real posting engine,
// 500 sold and 100 reserved. Everything it makes carries serial PERF… so
// --remove finds it again.
import postgres from "postgres";
const sql = postgres(process.env.DATABASE_URL, { ssl: "require", prepare: false, max: 4, onnotice: () => {} });
const [co] = await sql`select id, name from company order by created_at limit 1`;
if (!/\bDEV\b/.test(co.name) || process.env.ALLOW_DESTRUCTIVE_TESTS !== "1") throw new Error("DEV only, with ALLOW_DESTRUCTIVE_TESTS=1");
const { resetTransactions } = await import("./test-reset.mjs");

if (process.argv.includes("--remove")) {
  await resetTransactions(sql);
  const ids = (await sql`select id from item where serial like 'PERF%'`).map((r) => r.id);
  for (const t of ["item_variant_option", "item_variant_attribute", "item_price", "item_uom", "item_reorder"]) {
    await sql`delete from ${sql(t)} where item_id = any(${ids})`.catch(() => {});
  }
  await sql`delete from item where id = any(${ids}) and parent_item_id is not null`;
  await sql`delete from item where id = any(${ids})`;
  await sql`delete from business_partner where code in ('PERF-SUP', 'PERF-CUS')`;
  console.log("removed", ids.length); await sql.end(); process.exit(0);
}

const P = await import("../lib/posting.ts");
const t0 = Date.now();
const locs = await sql`select id from location where company_id = ${co.id} and is_stock_location and is_active order by code limit 3`;
const [uom] = await sql`select id from uom where company_id = ${co.id} and code = 'PCS'`;
const grp = async (code) => (await sql`select id from item_group where company_id = ${co.id} and code = ${code}`)[0].id;
const attr = async (code) => (await sql`select id from variant_attribute where company_id = ${co.id} and code = ${code}`)[0].id;
const [supp] = await sql`insert into business_partner (company_id, code, name, is_supplier) values (${co.id}, 'PERF-SUP', 'Perf supplier', true) returning id`;
const [cust] = await sql`insert into business_partner (company_id, code, name, is_customer) values (${co.id}, 'PERF-CUS', 'Perf customer', true) returning id`;
const [retail] = await sql`select id from price_level where company_id = ${co.id} order by (code = 'RETAIL') desc limit 1`;
const today = new Date().toISOString().slice(0, 10);
const sto = await attr("STO"), col = await attr("COL");
const stoOpts = (await sql`select id from variant_option where attribute_id = ${sto} order by sort_order limit 4`).map((r) => r.id);
const colOpts = (await sql`select id from variant_option where attribute_id = ${col} order by sort_order limit 6`).map((r) => r.id);
const iph = await grp("IPH"), acc = await grp("ACC");

let n = 0, imei = 0;
const variants = [];
for (let m = 0; m < 60; m++) {
  const [parent] = await sql`insert into item (company_id, item_group_id, serial, code_is_manual, name, base_uom_id, is_stocked, identity)
    values (${co.id}, ${iph}, ${"PERFM" + m}, true, ${"Perf Phone " + m}, ${uom.id}, true, 'IMEI') returning id`;
  await sql`insert into item_variant_attribute ${sql([{ item_id: parent.id, attribute_id: sto, sort_order: 0 }, { item_id: parent.id, attribute_id: col, sort_order: 1 }])}`;
  const rows = [];
  for (const s of stoOpts) for (const c of colOpts) rows.push({ s, c, serial: `PERF${String(n++).padStart(5, "0")}` });
  const made = await sql`insert into item ${sql(rows.map((r) => ({ company_id: co.id, item_group_id: iph, parent_item_id: parent.id,
    serial: r.serial, code_is_manual: true, name: `Perf Phone ${m} ${r.serial}`, base_uom_id: uom.id, is_stocked: true, identity: "IMEI", valuation_method: "FIFO" })))}
    returning id, serial`;
  const id = new Map(made.map((x) => [x.serial, x.id]));
  await sql`insert into item_variant_option ${sql(rows.flatMap((r) => [{ item_id: id.get(r.serial), option_id: r.s }, { item_id: id.get(r.serial), option_id: r.c }]))}`;
  await sql`insert into item_price ${sql(rows.map((r) => ({ company_id: co.id, item_id: id.get(r.serial), price_level_id: retail.id, uom_id: uom.id, currency: "MMK", price: 2_000_000 + m * 1000 })))}`;
  // About 7 units of each variant, split over the warehouses.
  const lines = rows.map((r) => {
    const q = 5 + (n % 5);
    return { itemId: id.get(r.serial), qty: q, unitCost: 1_500_000 + m * 1000,
             serials: Array.from({ length: q }, () => `35${String(imei++).padStart(13, "0")}`) };
  });
  await P.postGoodsReceipt({ companyId: co.id, partnerId: supp.id, locationId: locs[m % locs.length].id, docDate: today, lines });
  variants.push(...lines);
  if (m % 10 === 9) console.log(`  ${m + 1} models, ${imei} IMEIs, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}
const accRows = Array.from({ length: 400 }, (_, i) => ({ company_id: co.id, item_group_id: acc, serial: `PERFA${i}`, code_is_manual: true,
  name: `Perf accessory ${i}`, base_uom_id: uom.id, is_stocked: true, identity: "NONE", valuation_method: "FIFO" }));
const accs = await sql`insert into item ${sql(accRows)} returning id`;
await P.postGoodsReceipt({ companyId: co.id, partnerId: supp.id, locationId: locs[0].id, docDate: today,
  lines: accs.map((a, i) => ({ itemId: a.id, qty: 20 + (i % 30), unitCost: 20_000 + i })) });

// 500 sold, from the first warehouse; 100 reserved.
const onShelf = await sql`select s.serial_no, s.item_id from stock_serial s join stock_lot l on l.id = s.stock_lot_id
  where s.serial_no like '35%' and l.location_id = ${locs[0].id} order by s.serial_no limit 600`;
for (let i = 0; i < 500; i += 25) {
  await P.postRetailSale({ companyId: co.id, partnerId: cust.id, locationId: locs[0].id, docDate: today, dueDate: today,
    paymentType: "CASH", lines: onShelf.slice(i, i + 25).map((u) => ({ itemId: u.item_id, qty: 1, unitPrice: 2_100_000, serials: [u.serial_no] })) });
}
await sql`insert into stock_serial_hold (company_id, serial_id, kind)
  select ${co.id}, s.id, 'RESERVED' from stock_serial s where s.serial_no = any(${onShelf.slice(500, 600).map((u) => u.serial_no)})`;
console.log(`seeded ${n} variants, 400 accessories, ${imei} IMEIs in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
await sql.end(); process.exit(0);
