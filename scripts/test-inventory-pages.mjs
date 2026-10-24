// The inventory pages' paged reads: what a page shows adds up to the whole.
//
//   ALLOW_DESTRUCTIVE_TESTS=1 ./node_modules/.bin/tsx scripts/test-inventory-pages.mjs
//
// IMEI Inventory pages in SQL: two pages must not overlap, their total must
// be every unit the filter matches, and the four counts on top must agree
// with the units themselves. Inventory Summary folds two codes of one
// configuration into a row and must still count each unit once.

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
const sql = postgres(url, { ssl: url.includes("localhost") ? false : "require", prepare: false, onnotice: () => {}, max: 4 });

let bad = 0;
const check = (label, ok, detail = "") => {
  if (!ok) bad++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? "   " + detail : ""}`);
};
const made = { items: [], attrs: [] };
try {
  const [co] = await sql`select id, name from company order by created_at limit 1`;
  if (!/\bDEV\b/i.test(String(co.name)) || process.env.ALLOW_DESTRUCTIVE_TESTS !== "1") {
    throw new Error(`Run against a DEV database with ALLOW_DESTRUCTIVE_TESTS=1 ("${co.name}").`);
  }
  await takeTestLock(sql, "test-inventory-pages.mjs");
  await resetTransactions(sql);
  const P = await import("../lib/posting.ts");
  const Ph = await import("../lib/phone.ts");

  const [loc] = await sql`select id from location where company_id = ${co.id} and is_stock_location and is_active order by code limit 1`;
  const party = async (code, cols) => (await sql`select id from business_partner where company_id = ${co.id} and code = ${code}`)[0]
    ?? (await sql`insert into business_partner ${sql({ company_id: co.id, code, name: code, ...cols })} returning id`)[0];
  const supp = await party("INVP-S", { is_supplier: true });
  const cust = await party("INVP-C", { is_customer: true, payment_terms_days: 30 });
  const [grp] = await sql`select id from item_group where company_id = ${co.id} and parent_id is null order by code limit 1`;
  const [uom] = await sql`select id from uom where company_id = ${co.id} order by code limit 1`;
  const DAY = (await sql`select to_char(current_date,'YYYY-MM-DD') as d`)[0].d;
  const stamp = String(Date.now()).slice(-6);

  // Two codes for one configuration: 42MM / Black and 42 / Black.
  const attr = async (code, name, opts) => {
    const [a] = await sql`insert into variant_attribute (company_id, code, name, sort_order) values (${co.id}, ${code + stamp}, ${name}, 90) returning id`;
    made.attrs.push(a.id);
    const ids = {};
    for (const [i, o] of opts.entries()) ids[o] = (await sql`insert into variant_option (company_id, attribute_id, code, name, sort_order)
      values (${co.id}, ${a.id}, ${"O" + i}, ${o}, ${i}) returning id`)[0].id;
    return ids;
  };
  const size = await attr("ISZ", "Pages size", ["42MM", "42"]);
  const colour = await attr("ICL", "Pages colour", ["Black"]);
  const [model] = await sql`insert into item (company_id, item_group_id, serial, name, base_uom_id, is_stocked)
    values (${co.id}, ${grp.id}, ${"INVM" + stamp}, 'Pages Watch', ${uom.id}, true) returning id`;
  made.items.push(model.id);
  const variant = async (code, s) => {
    const [v] = await sql`insert into item (company_id, item_group_id, parent_item_id, serial, code_is_manual, name, base_uom_id, is_stocked, identity)
      values (${co.id}, ${grp.id}, ${model.id}, ${code + stamp}, true, ${"Pages Watch " + s}, ${uom.id}, true, 'IMEI') returning id`;
    made.items.push(v.id);
    await sql`insert into item_variant_option (item_id, option_id) values (${v.id}, ${size[s]}), (${v.id}, ${colour.Black})`;
    return v;
  };
  const a = await variant("PW1", "42MM");
  const b = await variant("PW7", "42");
  const sn = (k) => `INVP${stamp}${String(k).padStart(4, "0")}`;
  await P.postGoodsReceipt({ companyId: co.id, partnerId: supp.id, locationId: loc.id, docDate: DAY, lines: [
    { itemId: a.id, qty: 30, unitCost: 100, serials: Array.from({ length: 30 }, (_, i) => sn(i)) },
    { itemId: b.id, qty: 20, unitCost: 120, serials: Array.from({ length: 20 }, (_, i) => sn(100 + i)) },
  ] });
  await P.postRetailSale({ companyId: co.id, partnerId: cust.id, locationId: loc.id, docDate: DAY, dueDate: DAY, paymentType: "CASH",
    lines: [0, 1, 2].map((i) => ({ itemId: a.id, qty: 1, unitPrice: 200, serials: [sn(i)] })) });
  await sql`insert into stock_serial_hold (company_id, serial_id, kind)
    select ${co.id}, id, 'RESERVED' from stock_serial where serial_no in (${sn(10)}, ${sn(11)})`;

  console.log("\n  IMEI Inventory, paged in SQL");
  const p1 = await Ph.phoneStock(co.id, { page: 1, size: 25 });
  const p2 = await Ph.phoneStock(co.id, { page: 2, size: 25 });
  const p3 = await Ph.phoneStock(co.id, { page: 3, size: 25 });
  const ids = [...p1, ...p2, ...p3].map((r) => r.serial_id);
  check("50 units across the pages, total 50", p1.total === 50 && ids.length === 50, `total ${p1.total}, rows ${ids.length}`);
  check("no unit on two pages", new Set(ids).size === ids.length);
  const inStock = await Ph.phoneStock(co.id, { status: "IN_STOCK", page: 1, size: 25 });
  check("in stock: 50 − 3 sold − 2 reserved = 45", inStock.total === 45, String(inStock.total));
  const search = await Ph.phoneStock(co.id, { q: sn(105), page: 1, size: 25 });
  check("searching one IMEI finds that unit", search.total === 1 && search[0].imei === sn(105));
  const byCode = await Ph.phoneStock(co.id, { q: "PW7" + stamp, page: 1, size: 25 });
  check("searching an item code finds its units", byCode.total === 20, String(byCode.total));

  console.log("\n  the counts on top");
  const k = await Ph.serialKpis(co.id);
  check("total, in stock, reserved and sold agree with the units",
    k.total === 50 && k.available === 45 && k.reserved === 2 && k.sold === 3, JSON.stringify({ total: k.total, available: k.available, reserved: k.reserved, sold: k.sold }));

  console.log("\n  Inventory Summary, one configuration under two codes");
  const s = await Ph.inventorySummary(co.id, { combine: true, modelId: model.id });
  const row = s.rows.find((r) => r.codes?.includes("PW1" + stamp));
  check("one row for both codes", s.rows.length === 1 && row?.codes.length === 2, JSON.stringify(row?.codes));
  check("on hand once: 27 + 20 = 47", Number(row?.qty) === 47, String(row?.qty));
  check("value once: 27 × 100 + 20 × 120 = 5,100", Math.abs(Number(row?.value) - 5100) < 0.01, String(row?.value));
  const apart = await Ph.inventorySummary(co.id, { modelId: model.id });
  check("unfolded, the two rows add up to the same", apart.rows.length === 2
    && apart.rows.reduce((t, r) => t + Number(r.qty), 0) === 47);

  console.log(bad === 0 ? "\n  all checks passed\n" : `\n  ${bad} FAILED\n`);
  process.exitCode = bad === 0 ? 0 : 1;
} catch (e) {
  console.error("\n  error:", e.stack ?? e.message, "\n");
  process.exitCode = 1;
} finally {
  await resetTransactions(sql).catch(() => {});
  if (made.items.length) {
    await sql`delete from item_variant_option where item_id = any(${made.items})`.catch(() => {});
    await sql`delete from item where id = any(${made.items}) and parent_item_id is not null`.catch(() => {});
    await sql`delete from item where id = any(${made.items})`.catch(() => {});
  }
  if (made.attrs.length) {
    await sql`delete from variant_option where attribute_id = any(${made.attrs})`.catch(() => {});
    await sql`delete from variant_attribute where id = any(${made.attrs})`.catch(() => {});
  }
  await sql`delete from business_partner where code in ('INVP-S', 'INVP-C')`.catch(() => {});
  await releaseTestLock(sql);
  await sql.end({ timeout: 5 });
}
