// Throwaway: a little stock on DEV for looking at the inventory summary.
//   ALLOW_DESTRUCTIVE_TESTS=1 npx tsx scripts/_demo-stock.mjs [--remove]
import postgres from "postgres";
const sql = postgres(process.env.DATABASE_URL, { ssl: "require", prepare: false, max: 1, onnotice: () => {} });
const [co] = await sql`select id, name from company order by created_at limit 1`;
if (!/\bDEV\b/.test(co.name)) throw new Error("DEV only");
const { resetTransactions } = await import("./test-reset.mjs");
if (process.argv.includes("--remove")) {
  await resetTransactions(sql);
  const ids = (await sql`select id from item where serial like 'DEMO%'`).map((r) => r.id);
  await sql`delete from item_price where item_id = any(${ids})`;
  await sql`delete from item_uom where item_id = any(${ids})`;
  await sql`delete from item_reorder where item_id = any(${ids})`.catch(() => {});
  await sql`delete from item where id = any(${ids})`;
  await sql`delete from business_partner where code = 'DEMO-SUP'`;
  console.log("removed", ids.length); await sql.end(); process.exit(0);
}
const P = await import("../lib/posting.ts");
const [loc] = await sql`select id from location where company_id = ${co.id} and is_stock_location and is_active order by code limit 1`;
const [uom] = await sql`select id from uom where company_id = ${co.id} and code = 'PCS'`;
const grp = async (code) => (await sql`select id from item_group where company_id = ${co.id} and code = ${code}`)[0].id;
const [supp] = await sql`insert into business_partner (company_id, code, name, is_supplier) values (${co.id}, 'DEMO-SUP', 'Demo supplier', true) returning id`;
const today = new Date().toISOString().slice(0, 10);
const items = [
  ["IPH", "iPhone 17 Pro 256GB", 6, 4_200_000, true], ["IPH", "iPhone 16 128GB", 2, 2_600_000, true],
  ["AND", "Galaxy S26 Ultra 512GB", 4, 3_900_000, true], ["AND", "Nothing Phone 4 256GB", 3, 1_500_000, true],
  ["ACC", "Anker 65W USB-C Charger", 40, 85_000, false], ["AUD", "AirPods Pro 3", 5, 650_000, true],
];
// The first phone comes in yuan and carries a posted freight landed cost, so
// the cost card has a currency, a rate and a landed line to show.
const L = await import("../lib/landed-cost.ts");
const [user] = await sql`select id from app_user where company_id = ${co.id} order by created_at limit 1`;
const [freight] = await sql`select id from landed_cost_type where company_id = ${co.id} order by (code = 'FREIGHT') desc, code limit 1`;
let n = 0;
for (const [g, name, qty, cost, serial] of items) {
  const fx = n === 0 ? { currency: "CNY", exchangeRate: 600 } : {};
  const [it] = await sql`insert into item (company_id, item_group_id, serial, name, base_uom_id, is_stocked, tracks_serial, identity)
    values (${co.id}, ${await grp(g)}, ${"DEMO" + n++}, ${name}, ${uom.id}, true, ${serial}, ${serial ? (g === "AUD" ? "SERIAL" : "IMEI") : "NONE"}) returning id`;
  const serials = serial ? Array.from({ length: qty }, (_, i) => `DEMO${n}${String(i).padStart(10, "0")}`) : undefined;
  const gr = await P.postGoodsReceipt({ companyId: co.id, partnerId: supp.id, locationId: loc.id, docDate: today, ...fx,
    lines: [{ itemId: it.id, qty, unitCost: fx.currency ? cost / fx.exchangeRate : cost, ...(serials ? { serials } : {}) }] });
  if (fx.currency && freight) {
    const actor = { companyId: co.id, userId: user?.id ?? null };
    const lc = await L.createLandedCost({ ...actor, docDate: today, receiptIds: [gr.id] });
    await L.saveLandedCost({ ...actor, id: lc.id, docDate: today, receiptIds: [gr.id],
      charges: [{ costTypeId: freight.id, amount: 120_000, method: "VALUE" }] });
    await L.calculateLandedCost({ ...actor, id: lc.id });
    await L.postLandedCost({ ...actor, id: lc.id });
  }
}
console.log("seeded", items.length); await sql.end(); process.exit(0);
