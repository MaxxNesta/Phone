// An invoice billing delivered phones is costed at the phones it bills.
//
//   ./node_modules/.bin/tsx scripts/test-invoice-cost-by-imei.mjs
//
// Before: an invoice billing part of a delivery claimed the delivery's layers
// oldest first, whichever handset it billed. Now it names its IMEIs and claims
// exactly those; billing part without naming them is refused; billing all of
// them still needs no names. Also checks that cost of sales is recognised
// once — a phone cannot be claimed twice, a void releases its claim, and the
// delivery's own entry and dates are left alone.
//
// Runs inside one transaction that is always rolled back: nothing is written.

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
if (!process.env.DATABASE_URL && existsSync(join(root, ".env"))) {
  for (const line of readFileSync(join(root, ".env"), "utf8").split("\n")) {
    const m = line.match(/^\s*DATABASE_URL\s*=\s*(.+?)\s*$/);
    if (m) { process.env.DATABASE_URL = m[1].replace(/^["']|["']$/g, ""); break; }
  }
}
const url = process.env.DATABASE_URL;
const sql = postgres(url, { ssl: url.includes("localhost") ? false : "require",
  prepare: !url.includes("-pooler."), onnotice: () => {}, max: 2 });
const P = await import("../lib/posting.ts");

let bad = 0;
const check = (label, ok, detail = "") => {
  if (!ok) bad++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? "   " + detail : ""}`);
};
const near = (a, b) => Math.abs(a - b) < 0.01;
const fmt = (n) => Number(n).toLocaleString("en-US", { maximumFractionDigits: 4 });
const luhn = (body) => {
  let sum = 0;
  for (let i = 0; i < 14; i++) { let d = Number(body[13 - i]); if (i % 2 === 0) { d *= 2; if (d > 9) d -= 9; } sum += d; }
  return body + ((10 - (sum % 10)) % 10);
};
class Rollback extends Error {}
const A = 2_000_000, B = 2_150_000, C = 2_100_000;

try {
  await sql.begin(async (tx) => {
    const [co] = await tx`select id, name from company order by created_at limit 1`;
    const [loc] = await tx`select id from location where company_id = ${co.id} and is_stock_location and is_active order by code limit 1`;
    const [supp] = await tx`select id from business_partner where company_id = ${co.id} and is_supplier and is_active order by code limit 1`;
    const [cust] = await tx`select id from business_partner where company_id = ${co.id} and is_customer and is_active and credit_limit is null order by code limit 1`;
    const [grp] = await tx`select id from item_group where company_id = ${co.id} order by code limit 1`;
    const [uom] = await tx`select id from uom where company_id = ${co.id} order by code limit 1`;
    const [held] = await tx`select fn_system_account(${co.id}, 'SHIPPED_NOT_INVOICED') as a`;
    const today = new Date().toISOString().slice(0, 10);
    const stamp = String(Date.now()).slice(-7);
    console.log(`\n  ${co.name} — one transaction, rolled back at the end`);

    let n = 0, k = 0;
    const newItem = async (phone) => {
      const [it] = await tx`
        insert into item (company_id, item_group_id, serial, name, base_uom_id, is_stocked, tracks_serial, identity)
        values (${co.id}, ${grp.id}, ${"ICI" + stamp + n++}, 'Invoice-by-IMEI test', ${uom.id}, true, ${phone}, ${phone ? "IMEI" : "NONE"})
        returning id`;
      const [cogs] = await tx`select fn_resolve_account_for_item(${co.id}, 'COGS', ${it.id}) as a`;
      return { id: it.id, cogs: cogs.a };
    };
    const imei = () => luhn("35" + stamp + String(k++).padStart(5, "0"));
    const gl = async (docId, account) => {
      const [r] = await tx`
        select coalesce(sum(jl.base_amount), 0)::float as v
          from journal_line jl join journal_entry je on je.id = jl.journal_entry_id
         where je.source_id = ${docId} and jl.account_id = ${account}`;
      return r.v;
    };
    const unclaimed = async (deliveryId) => {
      const [r] = await tx`select coalesce(sum(value_unclaimed), 0)::float as v from v_delivery_cost_unclaimed where document_id = ${deliveryId}`;
      return r.v;
    };
    const entries = async (docId) => tx`
      select je.entry_date::text as d, (select coalesce(sum(base_amount), 0)::float from journal_line where journal_entry_id = je.id and base_amount > 0) as dr
        from journal_entry je where je.source_id = ${docId} order by je.created_at`;
    // Three phones at three costs, delivered together.
    const threeDelivered = async (it) => {
      const sn = [imei(), imei(), imei()];
      await P.postGoodsReceipt({ companyId: co.id, partnerId: supp.id, locationId: loc.id, docDate: today,
        lines: [[A, sn[0]], [B, sn[1]], [C, sn[2]]].map(([cost, s]) => ({ itemId: it.id, qty: 1, unitCost: cost, serials: [s] })) }, tx);
      const dv = await P.postDelivery({ companyId: co.id, partnerId: cust.id, locationId: loc.id, docDate: today,
        lines: [{ itemId: it.id, qty: 3, serials: sn }] }, tx);
      return { sn, dv };
    };
    const invoice = (it, dv, qty, serials) => P.postSalesInvoice({
      companyId: co.id, partnerId: cust.id, locationId: loc.id, docDate: today, dueDate: today,
      paymentType: "CREDIT", deliveryId: dv.id,
      lines: [{ itemId: it.id, qty, unitPrice: 2_500_000, ...(serials ? { serials } : {}) }],
    }, tx);
    const scenario = async (title, fn) => {
      console.log(`\n  ${title}`);
      try { await tx.savepoint(fn); } catch (e) { check("posted", false, e.message); }
    };
    const refused = async (label, fn, pattern) => {
      let err = null;
      try { await tx.savepoint(fn); } catch (e) { err = e; }
      check(label, !!err && pattern.test(err.message), err ? err.message : "it posted");
    };

    await scenario("1. Deliver A, B, C (2,000,000 · 2,150,000 · 2,100,000); bill B alone, then A and C", async () => {
      const it = await newItem(true);
      const { sn: [a, b, c], dv } = await threeDelivered(it);
      const dvEntries = await entries(dv.id);
      const first = await invoice(it, dv, 1, [b]);
      check("billing B costs 2,150,000", near(await gl(first.id, it.cogs), B), fmt(await gl(first.id, it.cogs)));
      check("and takes 2,150,000 out of the holding account", near(await gl(first.id, held.a), -B), fmt(await gl(first.id, held.a)));
      check("A and C still wait in the holding account: 4,100,000", near(await unclaimed(dv.id), A + C), fmt(await unclaimed(dv.id)));
      await refused("billing B a second time is refused", () => invoice(it, dv, 1, [b]), /billed already/);
      const second = await invoice(it, dv, 2, [a, c]);
      check("billing A and C costs 4,100,000", near(await gl(second.id, it.cogs), A + C), fmt(await gl(second.id, it.cogs)));
      check("nothing left waiting", near(await unclaimed(dv.id), 0), fmt(await unclaimed(dv.id)));
      check("cost of sales across both invoices = what the delivery relieved (6,250,000)",
        near((await gl(first.id, it.cogs)) + (await gl(second.id, it.cogs)), A + B + C));
      const after = await entries(dv.id);
      check("the delivery's own entry is untouched: same count, date and amount",
        after.length === dvEntries.length && after.every((e, i) => e.d === dvEntries[i].d && near(e.dr, dvEntries[i].dr)),
        after.map((e) => `${e.d} ${fmt(e.dr)}`).join("; "));
      const [inv] = await entries(first.id);
      check("the invoice's entry is dated the invoice's date", inv?.d === today, inv?.d);
    });

    await scenario("2. Billing part of a delivery of phones without naming them", async () => {
      const it = await newItem(true);
      const { sn, dv } = await threeDelivered(it);
      await refused("is refused, asking which ones", () => invoice(it, dv, 1), /Say which ones, by IMEI/);
      await refused("naming fewer IMEIs than the quantity is refused", () => invoice(it, dv, 2, [sn[0]]), /Name one for each phone/);
      await refused("naming a phone that is not on the delivery is refused", () => invoice(it, dv, 1, [imei()]), /not on the delivery/);
      check("nothing was claimed by the refusals", near(await unclaimed(dv.id), A + B + C), fmt(await unclaimed(dv.id)));
    });

    await scenario("3. Billing every phone without naming them still works, and is exact", async () => {
      const it = await newItem(true);
      const { dv } = await threeDelivered(it);
      const si = await invoice(it, dv, 3);
      check("cost of sales 6,250,000", near(await gl(si.id, it.cogs), A + B + C), fmt(await gl(si.id, it.cogs)));
      check("nothing left waiting", near(await unclaimed(dv.id), 0));
    });

    await scenario("4. Void the invoice for B, then bill B again", async () => {
      const it = await newItem(true);
      const { sn: [, b], dv } = await threeDelivered(it);
      const first = await invoice(it, dv, 1, [b]);
      await P.voidDocument({ documentId: first.id, reason: "test" }, tx);
      check("the void puts B's 2,150,000 back in the holding account", near(await unclaimed(dv.id), A + B + C), fmt(await unclaimed(dv.id)));
      const again = await invoice(it, dv, 1, [b]);
      check("billing B again costs 2,150,000 once more", near(await gl(again.id, it.cogs), B), fmt(await gl(again.id, it.cogs)));
      const [net] = await tx`
        select coalesce(sum(jl.base_amount), 0)::float as v
          from journal_line jl join journal_entry je on je.id = jl.journal_entry_id
         where jl.account_id = ${it.cogs} and je.source_id in (
           select id from document where id = ${first.id} or reverses_document_id = ${first.id} or id = ${again.id})`;
      check("cost of sales net of the void: 2,150,000, recognised once", near(net.v, B), fmt(net.v));
    });

    await scenario("5. Invoice first, goods later: the delivery claims the phones it actually sent", async () => {
      const it = await newItem(true);
      const sn = [imei(), imei(), imei()];
      await P.postGoodsReceipt({ companyId: co.id, partnerId: supp.id, locationId: loc.id, docDate: today,
        lines: [[A, sn[0]], [B, sn[1]], [C, sn[2]]].map(([cost, s]) => ({ itemId: it.id, qty: 1, unitCost: cost, serials: [s] })) }, tx);
      const si = await P.postSalesInvoice({ companyId: co.id, partnerId: cust.id, locationId: loc.id, docDate: today, dueDate: today,
        paymentType: "CREDIT", toDeliver: true, lines: [{ itemId: it.id, qty: 1, unitPrice: 2_500_000 }] }, tx);
      const dv = await P.postDelivery({ companyId: co.id, partnerId: cust.id, locationId: loc.id, docDate: today,
        sourceDocumentId: si.id, lines: [{ itemId: it.id, qty: 1, serials: [sn[1]] }] }, tx);
      check("cost of sales is B's 2,150,000", near(await gl(dv.id, it.cogs), B), fmt(await gl(dv.id, it.cogs)));
      check("nothing waits in the holding account", near(await unclaimed(dv.id), 0));
    });

    await scenario("6. Untracked goods billed in part: unchanged, oldest layer first", async () => {
      const it = await newItem(false);
      // Two receipts arriving an hour apart. Two lines of one receipt would tie
      // on arrival time, and the order between them is not what this checks.
      await P.postGoodsReceipt({ companyId: co.id, partnerId: supp.id, locationId: loc.id, docDate: today,
        receivedAt: `${today}T08:00:00Z`, lines: [{ itemId: it.id, qty: 5, unitCost: 100 }] }, tx);
      await P.postGoodsReceipt({ companyId: co.id, partnerId: supp.id, locationId: loc.id, docDate: today,
        receivedAt: `${today}T09:00:00Z`, lines: [{ itemId: it.id, qty: 5, unitCost: 200 }] }, tx);
      const dv = await P.postDelivery({ companyId: co.id, partnerId: cust.id, locationId: loc.id, docDate: today,
        lines: [{ itemId: it.id, qty: 10 }] }, tx);
      const si = await invoice(it, dv, 6);
      check("6 billed: 5 × 100 + 1 × 200 = 700", near(await gl(si.id, it.cogs), 700), fmt(await gl(si.id, it.cogs)));
    });

    await scenario("7. A sales order for three phones, delivered against the order, billed from the order", async () => {
      const it = await newItem(true);
      const sn = [imei(), imei(), imei()];
      await P.postGoodsReceipt({ companyId: co.id, partnerId: supp.id, locationId: loc.id, docDate: today,
        lines: [[A, sn[0]], [B, sn[1]], [C, sn[2]]].map(([cost, s]) => ({ itemId: it.id, qty: 1, unitCost: cost, serials: [s] })) }, tx);
      const so = await P.postSalesOrder({ companyId: co.id, partnerId: cust.id, locationId: loc.id, docDate: today, dueDate: today,
        lines: [{ itemId: it.id, qty: 3, unitPrice: 2_500_000 }] }, tx);
      const [sol] = await tx`select id from document_line where document_id = ${so.id}`;
      const dv = await P.postDelivery({ companyId: co.id, partnerId: cust.id, locationId: loc.id, docDate: today,
        sourceDocumentId: so.id, lines: [{ itemId: it.id, qty: 3, sourceLineId: sol.id, serials: sn }] }, tx);
      // Raised from the order, not from the delivery: no deliveryId. The
      // engine finds the delivery through the order line.
      const fromOrder = (qty, serials) => P.postSalesInvoice({
        companyId: co.id, partnerId: cust.id, locationId: loc.id, docDate: today, dueDate: today, paymentType: "CREDIT",
        lines: [{ itemId: it.id, qty, unitPrice: 2_500_000, sourceLineId: sol.id, ...(serials ? { serials } : {}) }],
      }, tx);
      await refused("billing one of the order's three phones without naming it is refused", () => fromOrder(1), /Say which ones, by IMEI/);
      const one = await fromOrder(1, [sn[1]]);
      check("billing IMEI-B from the order costs 2,150,000", near(await gl(one.id, it.cogs), B), fmt(await gl(one.id, it.cogs)));
      const rest = await fromOrder(2);
      check("billing the remaining two without names takes exactly them: 4,100,000", near(await gl(rest.id, it.cogs), A + C), fmt(await gl(rest.id, it.cogs)));
      check("nothing left waiting", near(await unclaimed(dv.id), 0));
    });

    await scenario("8. A retail counter sale filled from an order that has an earlier, unbilled delivery", async () => {
      const it = await newItem(true);
      const sn = [imei(), imei(), imei()];
      await P.postGoodsReceipt({ companyId: co.id, partnerId: supp.id, locationId: loc.id, docDate: today,
        lines: [[A, sn[0]], [B, sn[1]], [C, sn[2]]].map(([cost, s]) => ({ itemId: it.id, qty: 1, unitCost: cost, serials: [s] })) }, tx);
      const so = await P.postSalesOrder({ companyId: co.id, partnerId: cust.id, locationId: loc.id, docDate: today, dueDate: today,
        lines: [{ itemId: it.id, qty: 3, unitPrice: 2_500_000 }] }, tx);
      const [sol] = await tx`select id from document_line where document_id = ${so.id}`;
      const first = await P.postDelivery({ companyId: co.id, partnerId: cust.id, locationId: loc.id, docDate: today,
        sourceDocumentId: so.id, lines: [{ itemId: it.id, qty: 1, sourceLineId: sol.id, serials: [sn[0]] }] }, tx);
      // The phone handed over now is C; A went out earlier and is not billed
      // here. Retail mode, as the shop runs: the invoice moves its own stock.
      const sale = await P.postRetailSale({
        companyId: co.id, partnerId: cust.id, locationId: loc.id, docDate: today, dueDate: today, paymentType: "CREDIT",
        lines: [{ itemId: it.id, qty: 1, unitPrice: 2_500_000, sourceLineId: sol.id, serials: [sn[2]] }],
      }, tx);
      check("the invoice is costed at the phone handed over (C, 2,100,000), not the earlier one",
        near(await gl(sale.id, it.cogs), C), fmt(await gl(sale.id, it.cogs)));
      check("A's 2,000,000 still waits on the earlier delivery", near(await unclaimed(first.id), A), fmt(await unclaimed(first.id)));
    });

    const [rec] = await tx`select coalesce(sum(difference), 0)::float as d from v_check_inventory_reconciliation where company_id = ${co.id}`;
    console.log("");
    check("company: Inventory GL − stock ledger", near(rec.d, 0), fmt(rec.d));
    throw new Rollback();
  });
} catch (e) {
  if (!(e instanceof Rollback)) { bad++; console.error("\n  CRASH", e); }
}
const [left] = await sql`select count(*)::int as n from item where name = 'Invoice-by-IMEI test'`;
console.log(`\n  rolled back: ${left.n === 0 ? "yes" : `NO — ${left.n} test items remain`}`);
console.log(`  ${bad === 0 ? "all checks passed" : `${bad} check(s) failed`}\n`);
await sql.end();
process.exit(bad === 0 ? 0 : 1);
