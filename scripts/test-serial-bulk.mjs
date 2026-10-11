// A goods receipt line of thousands of phones posts.
//
//   ./node_modules/.bin/tsx scripts/test-serial-bulk.mjs
//
// A line's IMEIs are inserted together, nine values each, and Postgres takes at
// most 65,534 parameters in one statement: a line of more than about 7,280
// phones failed outright. Found by load testing; the inserts now go in chunks.

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
const url = process.env.DATABASE_URL;
const sql = postgres(url, { ssl: url.includes("localhost") ? false : "require",
  prepare: !url.includes("-pooler."), onnotice: () => {}, max: 4 });

await takeTestLock(sql, "test-serial-bulk.mjs");
const P = await import("../lib/posting.ts");

let bad = 0;
const check = (label, ok, detail = "") => {
  if (!ok) bad++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  " + detail : ""}`);
};
const N = 8000; // over the old ceiling of ~7,280

try {
  const [co] = await sql`select id, name from company order by created_at limit 1`;
  const [loc] = await sql`select id from location where company_id = ${co.id} and is_stock_location and is_active order by code limit 1`;
  const [supp] = await sql`select id from business_partner where company_id = ${co.id} and is_supplier order by code limit 1`;
  const [grp] = await sql`select id from item_group where company_id = ${co.id} order by code limit 1`;
  const [uom] = await sql`select id from uom where company_id = ${co.id} order by code limit 1`;
  console.log(`\n  ${co.name}\n`);
  await resetTransactions(sql);

  let [item] = await sql`select id from item where company_id = ${co.id} and serial = 'BULK1'`;
  if (!item) [item] = await sql`
    insert into item (company_id, item_group_id, serial, name, base_uom_id, is_stocked, tracks_serial, identity)
    values (${co.id}, ${grp.id}, 'BULK1', 'Bulk phone', ${uom.id}, true, true, 'IMEI') returning id`;

  const luhn = (body) => {
    let sum = 0;
    for (let i = 0; i < 14; i++) { let d = Number(body[13 - i]); if (i % 2 === 0) { d *= 2; if (d > 9) d -= 9; } sum += d; }
    return body + ((10 - (sum % 10)) % 10);
  };
  const stamp = String(Date.now()).slice(-7);
  const imeis = Array.from({ length: N }, (_, i) => luhn("86" + stamp + String(i).padStart(5, "0")));
  const today = new Date().toISOString().slice(0, 10);

  console.log(`  one receipt line of ${N} phones\n`);
  let gr = null, err = null;
  try {
    gr = await sql.begin((tx) => P.postGoodsReceipt({
      companyId: co.id, partnerId: supp.id, locationId: loc.id, docDate: today,
      lines: [{ itemId: item.id, qty: N, unitCost: 100, serials: imeis }],
    }, tx));
  } catch (e) { err = e; }
  check("it posts", !!gr, err ? err.message : gr.docNo);
  if (gr) {
    const [s] = await sql`select count(*)::int n from stock_serial where item_id = ${item.id} and serial_no = any(${imeis})`;
    check(`  all ${N} phones recorded, once each`, s.n === N, String(s.n));
    const [e] = await sql`select count(*)::int n from stock_serial_event ev join stock_serial ss on ss.id = ev.serial_id
                            where ss.item_id = ${item.id} and ev.event = 'RECEIVED' and ev.document_id = ${gr.id}`;
    check(`  each with its RECEIVED event`, e.n === N, String(e.n));
    const [q] = await sql`select coalesce(sum(qty_on_hand), 0)::int q from v_stock_on_hand where item_id = ${item.id}`;
    check(`  and ${N} on hand`, q.q === N, String(q.q));
  }
} catch (e) {
  bad++;
  console.error("\n  CRASH", e);
} finally {
  await resetTransactions(sql).catch(() => {});
  await sql`update item set is_active = false where serial = 'BULK1'`.catch(() => {});
  await releaseTestLock(sql).catch(() => {});
  await sql.end();
}
console.log(bad ? `\n  ${bad} FAILED\n` : "\n  all passed\n");
process.exit(bad ? 1 : 0);
