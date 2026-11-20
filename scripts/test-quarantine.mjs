// Quarantine (0218, docs/06 D-P7): stock held apart that nobody can sell.
// A broken phone received with the rest, or a faulty one a customer brought
// back, waits there at its cost until it goes to the supplier, is written
// off, or is checked and released.
//
//   npx tsx scripts/test-quarantine.mjs
//
// Destructive like every suite here: it empties transactions on whatever
// DATABASE_URL points at. Never run it against pilot or production.

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

const P = await import("../lib/posting.ts");

const url = process.env.DATABASE_URL;
const local = url.includes("localhost") || url.includes("127.0.0.1");
const pooled = url.includes("-pooler.");
const sql = postgres(url, { ssl: local ? false : "require", prepare: !pooled, onnotice: () => {}, max: 1 });

await takeTestLock(sql, "test-quarantine.mjs");
let failures = 0;
const check = (label, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
};
const n = (v) => Number(v ?? 0);
const r2 = (v) => Math.round(n(v) * 100) / 100;
const refuses = async (label, fn, pattern) => {
  try {
    await fn();
    check(label, false, "posted, expected a refusal");
  } catch (e) {
    check(label, !pattern || pattern.test(e.message), e.message.slice(0, 120));
  }
};

try {
  const [co] = await sql`select id from company order by created_at limit 1`;
  await resetTransactions(sql);
  await sql`update company set retail_mode = true where id = ${co.id}`;

  const [wh] = await sql`
    select id, parent_id from location
     where company_id = ${co.id} and is_stock_location and not is_quarantine and parent_id is not null
     order by code limit 1`;

  const party = async (code, name, cols) => {
    const [f] = await sql`select id from business_partner where company_id=${co.id} and code=${code}`;
    if (f) return f;
    return (await sql`insert into business_partner ${sql({ company_id: co.id, code, name, ...cols })}
      returning id`)[0];
  };
  const supp = await party("QR-S", "Quarantine Supplier", { is_supplier: true });
  const cust = await party("QR-C", "Quarantine Customer", { is_customer: true, payment_terms_days: 30 });

  const [grp] = await sql`select id from item_group where company_id = ${co.id} limit 1`;
  const [uom] = await sql`select id from uom where company_id = ${co.id} limit 1`;
  const ensureItem = async (serial, name, cols = {}) => {
    const [f] = await sql`select id from item where company_id = ${co.id} and serial = ${serial}`;
    if (f) { await sql`update item set ${sql(cols)} where id = ${f.id}`.catch(() => {}); return f; }
    return (await sql`insert into item ${sql({ company_id: co.id, item_group_id: grp.id,
      code: serial, serial, name, base_uom_id: uom.id, is_stocked: true, ...cols })} returning id`)[0];
  };
  const phone = await ensureItem("QR-PHONE", "Quarantine test phone",
    { tracks_serial: true, warranty_months: 12, supplier_warranty_months: 12 });
  const charger = await ensureItem("QR-CHARGER", "Quarantine test charger", { tracks_serial: false });

  const DAY = (await sql`select to_char(current_date,'YYYY-MM-DD') as d`)[0].d;
  const bal = async (code) => r2((await sql`
    select coalesce(sum(jl.base_amount), 0) as v from journal_line jl
      join account a on a.id = jl.account_id
     where a.company_id = ${co.id} and a.code = ${code}`)[0].v);
  const unit = async (imei) => (await sql`select * from v_stock_serial where imei = ${imei}`)[0];
  const onHand = async (itemId, locationId) => n((await sql`
    select coalesce(sum(qty_on_hand), 0) as q from v_stock_on_hand
     where item_id = ${itemId} and location_id = ${locationId}`)[0].q);

  const sell = (lines, locationId = wh.id) => P.postRetailSale({
    companyId: co.id, partnerId: cust.id, locationId, docDate: DAY, dueDate: DAY,
    paymentType: "CASH", lines,
  });
  const move = (from, to, lines, memo = null) => P.postStockTransfer({
    companyId: co.id, fromLocationId: from, toLocationId: to, docDate: DAY, memo, lines,
  });

  console.log("\n  the quarantine location");
  const [{ q: qid }] = await sql`select fn_quarantine_location(${wh.id}) as q`;
  const [{ q: qid2 }] = await sql`select fn_quarantine_location(${wh.id}) as q`;
  const [qloc] = await sql`select * from location where id = ${qid}`;
  check("one per branch, made on first use and found after", qid === qid2);
  check("a stock location under the branch, marked quarantine",
    qloc.is_stock_location && qloc.is_quarantine && qloc.parent_id === wh.parent_id);
  await refuses("a second quarantine in the same branch is refused",
    () => sql`insert into location (company_id, parent_id, code, name, is_stock_location, is_quarantine)
              values (${co.id}, ${wh.parent_id}, 'QR-DUP', 'Dup', true, true)`, /unique|duplicate/i);
  await refuses("quarantine must hold stock",
    () => sql`update location set is_stock_location = false where id = ${qid}`, /quarantine_is_a_warehouse/);

  console.log("\n  stock goes in on purpose");
  await P.postGoodsReceipt({
    companyId: co.id, partnerId: supp.id, locationId: wh.id, docDate: DAY,
    lines: [
      { itemId: phone.id, qty: 3, unitCost: 1_000_000, serials: ["QR-IMEI-1", "QR-IMEI-2", "QR-IMEI-3"] },
      { itemId: charger.id, qty: 10, unitCost: 10_000 },
    ],
  });
  const stockBefore = await bal("1310");
  await refuses("into quarantine without a reason is refused",
    () => move(wh.id, qid, [{ itemId: phone.id, qty: 1, serials: ["QR-IMEI-1"] }]), /what is wrong/);
  await move(wh.id, qid, [
    { itemId: phone.id, qty: 1, serials: ["QR-IMEI-1"] },
    { itemId: charger.id, qty: 2 },
  ], "Screen cracked; chargers do not charge");
  check("the phone is in quarantine, at its own cost", (await unit("QR-IMEI-1"))?.location_id === qid);
  check("chargers counted there", (await onHand(charger.id, qid)) === 2 && (await onHand(charger.id, wh.id)) === 8);
  check("quarantine is still stock: inventory value unchanged", (await bal("1310")) === stockBefore);
  const [sellable] = await sql`
    select coalesce(sum(qty_on_hand) filter (where not is_quarantine), 0)::float as s,
           coalesce(sum(qty_on_hand) filter (where is_quarantine), 0)::float as q
      from v_stock_on_hand where item_id = ${charger.id}`;
  check("stock on hand tells sellable from quarantine", sellable.s === 8 && sellable.q === 2);

  console.log("\n  nothing is sold from it");
  await refuses("scanning a quarantined IMEI at the shop says why",
    () => sell([{ itemId: phone.id, qty: 1, unitPrice: 1_500_000, serials: ["QR-IMEI-1"] }]), /quarantine/);
  await refuses("a sale dated at the quarantine location is refused",
    () => sell([{ itemId: charger.id, qty: 1, unitPrice: 20_000 }], qid), /quarantine/);
  await refuses("a sales order dated there is refused",
    () => P.postSalesOrder({ companyId: co.id, partnerId: cust.id, locationId: qid, docDate: DAY,
      lines: [{ itemId: charger.id, qty: 1, unitPrice: 20_000 }] }), /quarantine/);
  const s1 = await sell([{ itemId: phone.id, qty: 1, unitPrice: 1_500_000, serials: ["QR-IMEI-2"] }]);
  await refuses("the database refuses stock leaving it on a sale, whatever the document says",
    () => sql.begin(async (tx) => {
      await tx`insert into stock_movement (company_id, item_id, location_id, movement_date, qty, document_id)
               values (${co.id}, ${charger.id}, ${qid}, current_date, -1, ${s1.id})`;
      throw new Error("not refused");
    }), /quarantine/);
  check("the good phones still sell", !!s1.id);
  await refuses("the till cannot oversell from sellable stock by counting quarantine",
    () => sell([{ itemId: charger.id, qty: 9, unitPrice: 20_000 }]), /not enough/i);

  console.log("\n  released on purpose");
  await refuses("out of quarantine without a reason is refused",
    () => move(qid, wh.id, [{ itemId: charger.id, qty: 2 }]), /released from quarantine/);
  await move(qid, wh.id, [{ itemId: charger.id, qty: 2 }], "Tested: charge fine, was a bad cable");
  check("released chargers are back on the shelf", (await onHand(charger.id, wh.id)) === 10 && (await onHand(charger.id, qid)) === 0);
  // A release made in error goes back by a transfer back, with its reason.
  await move(wh.id, qid, [{ itemId: charger.id, qty: 2 }], "Released by mistake: not yet tested");
  check("a mistaken release goes back into quarantine",
    (await onHand(charger.id, wh.id)) === 8 && (await onHand(charger.id, qid)) === 2);
  await move(qid, wh.id, [{ itemId: charger.id, qty: 2 }], "Retested: fine");
  await sell([{ itemId: charger.id, qty: 9, unitPrice: 20_000 }]);
  check("released stock sells", (await onHand(charger.id, wh.id)) === 1);

  console.log("\n  reconciliation");
  check("trial balance balances", r2((await sql`select coalesce(sum(base_amount),0) v from journal_line jl
    join journal_entry je on je.id = jl.journal_entry_id where je.company_id = ${co.id}`)[0].v) === 0);
  const [layers] = await sql`select coalesce(sum(value_on_hand),0)::float v from v_stock_on_hand where company_id = ${co.id}`;
  check("inventory GL equals the valued stock, quarantine included", r2(layers.v) === (await bal("1310")),
    `${r2(layers.v)} vs ${await bal("1310")}`);
} catch (e) {
  failures++;
  console.error("  CRASH ", e);
} finally {
  await releaseTestLock(sql);
  await sql.end();
}
console.log(failures ? `\n  ${failures} FAILED` : "\n  all quarantine checks passed");
process.exit(failures ? 1 : 0);
