// Demo flows for Reports → Supply chain on DEV: MacBooks and iPads bought
// from three suppliers and sold to four shops, October–November 2026.
//
//   npx tsx scripts/demo-supply-chain.mjs        (DATABASE_URL or .env — DEV only)
//
// Real documents (bills with goods, credit sales) on existing products and
// partners; nothing is created in master data. Serial numbers start SCDEMO-,
// and the script stops if they already exist, so it never posts twice.
// Void the documents from their pages to take the demo back out.

import { readFileSync, existsSync } from "node:fs";

if (!process.env.DATABASE_URL && existsSync(".env")) {
  for (const line of readFileSync(".env", "utf8").split("\n")) {
    const m = line.match(/^\s*DATABASE_URL\s*=\s*(.+?)\s*$/);
    if (m) { process.env.DATABASE_URL = m[1].replace(/^["']|["']$/g, ""); break; }
  }
}
const P = await import("../lib/posting.ts");
const { sql } = await import("../lib/db.ts");

const [co] = await sql`select id, name from company`;
if (co.name !== "MTK — DEV") { console.error(`Refusing: this is "${co.name}", not MTK — DEV.`); process.exit(1); }
const [seen] = await sql`select 1 from stock_serial where serial like 'SCDEMO-%' limit 1`.catch(() => [null]);
if (seen) { console.log("Demo already posted (SCDEMO- serials exist) — nothing to do."); process.exit(0); }

const one = async (q) => (await q)[0];
const loc = await one(sql`select id from location where company_id = ${co.id} and code = 'MAIN-WH'`);
const partner = async (code) => (await one(sql`select id, name from business_partner where company_id = ${co.id} and code = ${code}`));
const item = async (code) => (await one(sql`select id, name from item where company_id = ${co.id} and code = ${code}`));
const [china, thai, apple] = await Promise.all(["01-001", "01-002", "01-003"].map(partner));
const shops = await sql`select id, name from business_partner where company_id = ${co.id} and is_customer
                         and name in ('Kant Kaw (Flagship)', 'Universal Mobile (MDY)', 'GH Mobile') order by name`;
const [extra] = await sql`select id, name from business_partner where company_id = ${co.id} and is_customer
                           and name not in ('Kant Kaw (Flagship)', 'Universal Mobile (MDY)', 'GH Mobile') order by code limit 1`;
const [gh, kant, uni] = shops; // ordered by name: GH, Kant Kaw, Universal
const mb1 = await item("IPB001"), mb2 = await item("IPB002"), mb4 = await item("IPB004");
const ipC = await item("IPC01"), ipD = await item("IPD001"), ipAir = await item("IPD005");

let n = 0;
const serials = (tag, k) => Array.from({ length: k }, () => `SCDEMO-${tag}-${String(++n).padStart(4, "0")}`);
const stock = new Map(); // item id → serials on the shelf, oldest first

async function buy(date, supp, it, tag, qty, price) {
  const s = serials(tag, qty);
  const r = await P.postPurchaseWithReceipt({ companyId: co.id, partnerId: supp.id, locationId: loc.id, docDate: date, dueDate: null,
    lines: [{ itemId: it.id, qty, unitPrice: price, serials: s }] });
  stock.set(it.id, [...(stock.get(it.id) ?? []), ...s]);
  console.log(`  ${date} ${r.docNo}  ${supp.name.padEnd(14)} → ${qty} × ${it.name}`);
}
async function sell(date, cust, it, qty, price) {
  const s = stock.get(it.id).splice(0, qty);
  const r = await P.postRetailSale({ companyId: co.id, partnerId: cust.id, locationId: loc.id, docDate: date, dueDate: date,
    paymentType: "CREDIT", lines: [{ itemId: it.id, qty, unitPrice: price, serials: s }] });
  console.log(`  ${date} ${r.docNo}  ${it.name} × ${qty} → ${cust.name}`);
}

console.log("Bought:");
await buy("2026-10-03", apple, mb1, "MB", 4, 4_200_000);
await buy("2026-10-06", thai, mb2, "MB", 3, 4_100_000);
await buy("2026-10-09", china, mb4, "MB", 2, 4_050_000);
await buy("2026-10-04", china, ipC, "IP", 6, 1_250_000);
await buy("2026-10-07", thai, ipD, "IP", 4, 1_300_000);
await buy("2026-10-10", apple, ipAir, "IP", 3, 2_400_000);
await buy("2026-11-02", apple, mb1, "MB", 2, 4_150_000);

console.log("Sold:");
await sell("2026-10-12", kant, mb1, 2, 4_600_000);
await sell("2026-10-15", uni, mb2, 2, 4_550_000);
await sell("2026-10-18", gh, mb1, 1, 4_700_000);
await sell("2026-10-20", extra, mb4, 1, 4_500_000);
await sell("2026-11-05", kant, mb1, 2, 4_550_000);
await sell("2026-10-13", gh, ipC, 3, 1_450_000);
await sell("2026-10-16", kant, ipD, 2, 1_500_000);
await sell("2026-10-19", uni, ipC, 2, 1_480_000);
await sell("2026-10-22", extra, ipAir, 1, 2_750_000);
await sell("2026-11-06", uni, ipAir, 1, 2_700_000);

console.log("Done.");
await sql.end();
process.exit(0);
