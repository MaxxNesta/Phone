// Landed cost: charges spread onto the phones of posted goods receipts.
//
//   ALLOW_DESTRUCTIVE_TESTS=1 ./node_modules/.bin/tsx scripts/test-landed-cost.mjs
//
// Destructive, like the other posting suites: it empties the transaction
// tables of the DEV database first, because the concurrency and rollback
// checks need real, separate transactions that a rolled-back harness cannot
// give.

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
  prepare: !url.includes("-pooler."), onnotice: () => {}, max: 6 });

let bad = 0;
const check = (label, ok, detail = "") => {
  if (!ok) bad++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? "   " + detail : ""}`);
};
const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.01;
const fmt = (n) => Number(n).toLocaleString("en-US", { maximumFractionDigits: 4 });
const refused = async (fn, pattern) => {
  try { await fn(); return { ok: false, msg: "it went through" }; }
  catch (e) { return { ok: pattern ? pattern.test(e.message) : true, msg: e.message }; }
};
const luhn = (body) => {
  let sum = 0;
  for (let i = 0; i < 14; i++) { let d = Number(body[13 - i]); if (i % 2 === 0) { d *= 2; if (d > 9) d -= 9; } sum += d; }
  return body + ((10 - (sum % 10)) % 10);
};

try {
  const [co] = await sql`select id, name from company order by created_at limit 1`;
  if (!/\bDEV\b/i.test(String(co.name)) || process.env.ALLOW_DESTRUCTIVE_TESTS !== "1") {
    throw new Error(`This suite empties the transaction tables. Run it against a DEV database with ALLOW_DESTRUCTIVE_TESTS=1 ("${co.name}").`);
  }
  await takeTestLock(sql, "test-landed-cost.mjs");
  await resetTransactions(sql);

  const P = await import("../lib/posting.ts");
  const L = await import("../lib/landed-cost.ts");

  const locs = await sql`select id, name from location where company_id = ${co.id} and is_stock_location and is_active order by code limit 2`;
  const [loc, loc2] = locs;
  const [supp] = await sql`select id from business_partner where company_id = ${co.id} and is_supplier and is_active order by code limit 1`;
  const [cust] = await sql`select id from business_partner where company_id = ${co.id} and is_customer and is_active and credit_limit is null order by code limit 1`;
  const [grp] = await sql`select id from item_group where company_id = ${co.id} and identity = 'IMEI' order by code limit 1`;
  const [accGrp] = await sql`select id from item_group where company_id = ${co.id} and identity = 'NONE' order by code limit 1`;
  const [uom] = await sql`select id from uom where company_id = ${co.id} order by code limit 1`;
  const [user] = await sql`select id from app_user where company_id = ${co.id} order by created_at limit 1`;
  const [clearing] = await sql`select fn_system_account(${co.id}, 'LANDED_COST_CLEARING') as a`;
  const [misc] = await sql`select id from account where company_id = ${co.id} and code = '66121'`;
  const types = Object.fromEntries((await sql`select code, id from landed_cost_type where company_id = ${co.id}`).map((t) => [t.code, t.id]));
  const today = new Date().toISOString().slice(0, 10);
  const stamp = String(Date.now()).slice(-7);
  const actor = { companyId: co.id, userId: user?.id ?? null };
  console.log(`\n  ${co.name}\n`);

  let n = 0, k = 0;
  const item = async (name, phone = true) => {
    const [it] = await sql`
      insert into item (company_id, item_group_id, serial, name, base_uom_id, is_stocked, tracks_serial, identity)
      values (${co.id}, ${phone ? grp.id : accGrp.id}, ${"LC" + stamp + n++}, ${name}, ${uom.id}, true, ${phone}, ${phone ? "IMEI" : "NONE"})
      returning id`;
    const [inv] = await sql`select fn_resolve_account_for_item(${co.id}, 'INVENTORY', ${it.id}, null, ${loc.id}) as a`;
    const [cogs] = await sql`select fn_resolve_account_for_item(${co.id}, 'COGS', ${it.id}) as a`;
    return { id: it.id, inv: inv.a, cogs: cogs.a };
  };
  const imei = () => luhn("35" + stamp + String(k++).padStart(5, "0"));
  const receive = async (lines, at = loc) => P.postGoodsReceipt({ companyId: co.id, partnerId: supp.id, locationId: at.id, docDate: today,
    lines: lines.map(([it, costs, extra]) => {
      const sn = costs.map(() => imei());
      return { itemId: it.id, qty: costs.length, unitCost: costs[0], serials: it.phone === false ? undefined : sn, ...(extra ?? {}) };
    }) });
  // Receive one line per distinct cost so each phone's price is its own.
  const receiveEach = async (pairs, at = loc) => {
    const out = [];
    const lines = pairs.map(([it, cost]) => { const s = imei(); out.push(s); return { itemId: it.id, qty: 1, unitCost: cost, serials: [s] }; });
    const gr = await P.postGoodsReceipt({ companyId: co.id, partnerId: supp.id, locationId: at.id, docDate: today, lines });
    return { gr, sn: out };
  };
  const serialId = async (sn) => (await sql`select id from stock_serial where serial_no = ${sn}`)[0].id;
  const costOf = async (sn) => (await sql`select unit_cost::float as c from v_stock_serial where imei = ${sn}`)[0].c;
  const lotOf = async (sn) => (await sql`select stock_lot_id as l from stock_serial where serial_no = ${sn}`)[0].l;
  const glFor = async (docId, account) => (await sql`
    select coalesce(sum(jl.base_amount), 0)::float as v from journal_line jl join journal_entry je on je.id = jl.journal_entry_id
     where je.source_id = ${docId} and jl.account_id = ${account}`)[0].v;
  const balanced = async (docId) => (await sql`
    select coalesce(sum(jl.base_amount), 0)::float as v from journal_line jl join journal_entry je on je.id = jl.journal_entry_id
     where je.source_id = ${docId}`)[0].v;
  const reconciled = async () => {
    const [r] = await sql`select coalesce(sum(difference), 0)::float as d from v_check_inventory_reconciliation where company_id = ${co.id}`;
    return r.d;
  };
  const allocOf = async (lcId) => sql`
    select s.serial_no, sum(a.amount)::float as amount from landed_cost_allocation a join stock_serial s on s.id = a.serial_id
     where a.landed_cost_id = ${lcId} group by s.serial_no order by s.serial_no`;
  const charge = (code, amount, method, extra = {}) => ({ costTypeId: types[code], amount, method, ...extra });
  // Draft → save → (ack) → calculate → post, as the screen does it.
  const landed = async (receiptIds, charges, { post = true, ack = false } = {}) => {
    const lc = await L.createLandedCost({ ...actor, docDate: today, receiptIds });
    await L.saveLandedCost({ ...actor, id: lc.id, docDate: today, receiptIds, charges });
    if (ack) await L.acknowledgeExcluded({ ...actor, id: lc.id });
    await L.calculateLandedCost({ ...actor, id: lc.id });
    if (post) await L.postLandedCost({ ...actor, id: lc.id });
    return lc;
  };
  const scenario = async (title, fn) => {
    console.log(`\n  ${title}`);
    try { await fn(); } catch (e) { check("ran", false, e.stack?.split("\n").slice(0, 3).join(" | ")); }
  };

  await scenario("1. One receipt, three phones at the same cost, freight by purchase value", async () => {
    const it = await item("Phone A");
    const { gr, sn } = await receiveEach([[it, 1_000_000], [it, 1_000_000], [it, 1_000_000]]);
    const lc = await landed([gr.id], [charge("FREIGHT", 90_000, "VALUE")]);
    const a = await allocOf(lc.id);
    check("each phone gets 30,000", a.every((r) => near(r.amount, 30_000)), a.map((r) => r.amount).join(", "));
    for (const s of sn) check(`  ${s.slice(-4)}: 1,000,000 + 30,000 = 1,030,000`, near(await costOf(s), 1_030_000), fmt(await costOf(s)));
    check("Dr Inventory 90,000", near(await glFor(lc.id, it.inv), 90_000), fmt(await glFor(lc.id, it.inv)));
    check("Cr Landed Cost Clearing 90,000", near(await glFor(lc.id, clearing.a), -90_000));
    check("the entry balances", near(await balanced(lc.id), 0));
    check("inventory reconciles", near(await reconciled(), 0), fmt(await reconciled()));
  });

  await scenario("2. Mixed variants by purchase value, one shared receipt line of two", async () => {
    const pro = await item("Phone Pro"), base = await item("Phone Base");
    const s1 = imei(), s2 = imei(), s3 = imei();
    const gr = await P.postGoodsReceipt({ companyId: co.id, partnerId: supp.id, locationId: loc.id, docDate: today, lines: [
      { itemId: pro.id, qty: 2, unitCost: 3_000_000, serials: [s1, s2] },
      { itemId: base.id, qty: 1, unitCost: 1_000_000, serials: [s3] } ] });
    const sharedLot = await lotOf(s1);
    const lc = await landed([gr.id], [charge("DUTY", 700_000, "VALUE")]);
    const a = Object.fromEntries((await allocOf(lc.id)).map((r) => [r.serial_no, r.amount]));
    check("Pro phones 300,000 each, Base 100,000 (3:3:1 of 700,000)", near(a[s1], 300_000) && near(a[s2], 300_000) && near(a[s3], 100_000), JSON.stringify(a));
    check("each Pro phone moved off the shared layer onto its own", (await lotOf(s1)) !== sharedLot && (await lotOf(s2)) !== sharedLot && (await lotOf(s1)) !== (await lotOf(s2)));
    const splits = await sql`select qty::float as q, total_cost::float as v, kind from stock_movement where document_id = ${lc.id} and kind is not null`;
    check("the split is marked COST_LAYER_SPLIT, nets to zero quantity and value",
      splits.length === 4 && splits.every((m) => m.kind === "COST_LAYER_SPLIT") && near(splits.reduce((t, m) => t + m.q, 0), 0) && near(splits.reduce((t, m) => t + m.v, 0), 0),
      `${splits.length} movements`);
    const [moved] = await sql`select count(*)::int n from stock_movement where document_id = ${lc.id} and kind is not null and location_id <> ${loc.id}`;
    check("and stays in the same warehouse", moved.n === 0);
    check("costs: 3,300,000 · 3,300,000 · 1,100,000", near(await costOf(s1), 3_300_000) && near(await costOf(s3), 1_100_000));
    check("inventory reconciles", near(await reconciled(), 0));
  });

  await scenario("3. Equal per phone, and the rounding remainder", async () => {
    const it = await item("Phone Eq"), it2 = await item("Phone Eq2");
    const { gr, sn } = await receiveEach([[it, 900_000], [it2, 1_200_000], [it, 900_000]]);
    const lc = await landed([gr.id], [charge("CLEARANCE", 100, "EQUAL")]);
    const a = await allocOf(lc.id);
    const amounts = a.map((r) => r.amount).sort((x, y) => y - x);
    check("100 over 3 phones is 34 · 33 · 33, whole kyat, adding to 100", amounts.join(",") === "34,33,33", amounts.join(","));
    const again = await landed([gr.id], [charge("CLEARANCE", 100, "EQUAL")], { post: false });
    const b = (await allocOf(again.id)).map((r) => `${r.serial_no}:${r.amount}`).join(" ");
    check("the same inputs give the same answer", b === a.map((r) => `${r.serial_no}:${r.amount}`).join(" "));
    await L.deleteLandedCost({ ...actor, id: again.id });
  });

  await scenario("4. Manual by product variant", async () => {
    const x = await item("Phone MX"), y = await item("Phone MY");
    const { gr, sn } = await receiveEach([[x, 1_000_000], [x, 1_000_000], [y, 1_000_000]]);
    const lc = await L.createLandedCost({ ...actor, docDate: today, receiptIds: [gr.id] });
    const save = (amounts) => L.saveLandedCost({ ...actor, id: lc.id, docDate: today, receiptIds: [gr.id],
      charges: [charge("HANDLING", 50_000, "MANUAL", { manual: [{ itemId: x.id, amount: amounts[0] }, { itemId: y.id, amount: amounts[1] }] })] });
    await save([30_000, 10_000]);
    const r = await refused(() => L.calculateLandedCost({ ...actor, id: lc.id }), /must equal it exactly/);
    check("variants adding to 40,000 of a 50,000 charge are refused", r.ok, r.msg);
    await save([30_001, 19_999]);
    await L.calculateLandedCost({ ...actor, id: lc.id });
    const a = Object.fromEntries((await allocOf(lc.id)).map((q) => [q.serial_no, q.amount]));
    check("variant X's 30,001 divided evenly over its 2 phones: 15,001 · 15,000", [a[sn[0]], a[sn[1]]].sort().join(",") === "15000,15001", JSON.stringify(a));
    check("variant Y's phone gets 19,999", near(a[sn[2]], 19_999));
    check("the method is named Manual by product variant", L.METHOD_LABEL.MANUAL === "Manual by product variant");
    await L.postLandedCost({ ...actor, id: lc.id });
  });

  await scenario("5. Several receipts and several charge types on one landed cost", async () => {
    const it = await item("Phone Multi");
    const g1 = await receiveEach([[it, 1_000_000]]), g2 = await receiveEach([[it, 2_000_000]]);
    const lc = await landed([g1.gr.id, g2.gr.id], [charge("FREIGHT", 30_000, "VALUE"), charge("LOCAL", 10_000, "EQUAL")]);
    const a = Object.fromEntries((await allocOf(lc.id)).map((q) => [q.serial_no, q.amount]));
    check("freight 10,000 / 20,000 by value, local 5,000 each", near(a[g1.sn[0]], 15_000) && near(a[g2.sn[0]], 25_000), JSON.stringify(a));
    const [t] = await sql`select sum(amount)::float as v from landed_cost_allocation where landed_cost_id = ${lc.id}`;
    check("total allocated = total charges (40,000)", near(t.v, 40_000));
    const [w] = await sql`select count(*)::int n from landed_cost_receipt where landed_cost_id = ${lc.id}`;
    check("both receipts are on it", w.n === 2);
  });

  await scenario("6. A bill is spread once", async () => {
    const it = await item("Phone Src");
    const { gr } = await receiveEach([[it, 1_000_000]]);
    const jv = await P.postJournalVoucher({ companyId: co.id, docDate: today, memo: "Freight bill",
      lines: [{ accountId: clearing.a, amount: 40_000, locationId: loc.id }, { accountId: misc.id, amount: -40_000, locationId: loc.id }] });
    const [jl] = await sql`select jl.id from journal_line jl join journal_entry je on je.id = jl.journal_entry_id
                            where je.source_id = ${jv.id} and jl.account_id = ${clearing.a}`;
    const src = { costTypeId: types.FREIGHT, method: "VALUE", sourceJournalLineId: jl.id };
    const first = await landed([gr.id], [src]);
    const [c] = await sql`select currency, fc_amount::float f, base_amount::float b, exchange_rate::float r from landed_cost_charge where landed_cost_id = ${first.id}`;
    check("the linked bill's kyat is taken as it is: 40,000 MMK at rate 1", c.currency === "MMK" && near(c.b, 40_000) && near(c.r, 1), JSON.stringify(c));
    const again = await L.createLandedCost({ ...actor, docDate: today, receiptIds: [gr.id] });
    const r = await refused(() => L.saveLandedCost({ ...actor, id: again.id, docDate: today, receiptIds: [gr.id], charges: [src] }), /spread once/);
    check("a second landed cost using the same bill is refused", r.ok, r.msg);
    check("clearing is back to zero for that bill", near((await glFor(jv.id, clearing.a)) + (await glFor(first.id, clearing.a)), 0));
    await L.deleteLandedCost({ ...actor, id: again.id });
  });

  await scenario("7. Sold, on the shelf, and moved to another warehouse", async () => {
    const it = await item("Phone Mix");
    const { gr, sn: [kept, sold, moved] } = await receiveEach([[it, 1_000_000], [it, 1_000_000], [it, 1_000_000]]);
    const sale = await P.postRetailSale({ companyId: co.id, partnerId: cust.id, locationId: loc.id, docDate: today, dueDate: today,
      paymentType: "CREDIT", lines: [{ itemId: it.id, qty: 1, unitPrice: 1_500_000, serials: [sold] }] });
    if (loc2) await P.postStockTransfer({ companyId: co.id, fromLocationId: loc.id, toLocationId: loc2.id, docDate: today,
      lines: [{ itemId: it.id, qty: 1, serials: [moved] }] });
    const lc = await landed([gr.id], [charge("FREIGHT", 60_000, "EQUAL")]);
    const t = Object.fromEntries((await sql`select s.serial_no, p.treatment, p.location_id from landed_cost_posting p join stock_serial s on s.id = p.serial_id where p.landed_cost_id = ${lc.id}`).map((r) => [r.serial_no, r]));
    check("the phone on the shelf: inventory", t[kept].treatment === "INVENTORY");
    check("the sold phone: cost of sales", t[sold].treatment === "COGS");
    if (loc2) check("the transferred phone: inventory, at the warehouse it is in now", t[moved].treatment === "INVENTORY" && t[moved].location_id === loc2.id);
    check("Dr Inventory 40,000, Dr Cost of sales 20,000", near(await glFor(lc.id, it.inv), 40_000) && near(await glFor(lc.id, it.cogs), 20_000),
      `${fmt(await glFor(lc.id, it.inv))} / ${fmt(await glFor(lc.id, it.cogs))}`);
    check("the sold phone's own sale is untouched", near(await glFor(sale.id, it.cogs), 1_000_000));
    check("inventory reconciles", near(await reconciled(), 0), fmt(await reconciled()));
  });

  await scenario("8. Reversal restores, and the phone keeps its own layer", async () => {
    const it = await item("Phone Rev");
    const s1 = imei(), s2 = imei();
    const gr = await P.postGoodsReceipt({ companyId: co.id, partnerId: supp.id, locationId: loc.id, docDate: today,
      lines: [{ itemId: it.id, qty: 2, unitCost: 1_000_000, serials: [s1, s2] }] });
    const shared = await lotOf(s1);
    const lc = await landed([gr.id], [charge("FREIGHT", 20_000, "EQUAL")]);
    const own = await lotOf(s1);
    const r = await refused(() => L.saveLandedCost({ ...actor, id: lc.id, docDate: today, receiptIds: [gr.id], charges: [] }), /cannot be changed/);
    check("a posted landed cost cannot be edited", r.ok, r.msg);
    const nr = await refused(() => L.reverseLandedCost({ ...actor, id: lc.id, reason: "" }), /Say why/);
    check("a reversal needs a reason", nr.ok);
    const rev = await L.reverseLandedCost({ ...actor, id: lc.id, reason: "Wrong freight bill" });
    check("costs back to 1,000,000", near(await costOf(s1), 1_000_000) && near(await costOf(s2), 1_000_000), `${await costOf(s1)}, ${await costOf(s2)}`);
    check("the phone stays on its own layer, not merged back", (await lotOf(s1)) === own && own !== shared);
    check("the reversal's entry is the exact opposite", near(await glFor(rev.id, it.inv), -20_000) && near(await glFor(rev.id, clearing.a), 20_000));
    const [d] = await sql`select status, reversed_by_document_id from document where id = ${lc.id}`;
    const [h] = await sql`select reversal_reason, reversed_at is not null as at from landed_cost where document_id = ${lc.id}`;
    check("the original is REVERSED, linked, with who/when/why kept", d.status === "REVERSED" && d.reversed_by_document_id === rev.id && h.reversal_reason === "Wrong freight bill" && h.at);
    const again = await landed([gr.id], [charge("FREIGHT", 10_000, "EQUAL")]);
    check("a later landed cost reuses the phone's own layer (split once)", (await lotOf(s1)) === own);
    const [splits] = await sql`select count(*)::int n from stock_movement where document_id = ${again.id} and kind = 'COST_LAYER_SPLIT'`;
    check("and makes no new split", splits.n === 0);
    check("inventory reconciles", near(await reconciled(), 0));
  });

  await scenario("9. Sold → landed cost → customer return → resale", async () => {
    const it = await item("Phone Ret");
    const { gr, sn: [s] } = await receiveEach([[it, 1_000_000]]);
    const sale = await P.postRetailSale({ companyId: co.id, partnerId: cust.id, locationId: loc.id, docDate: today, dueDate: today,
      paymentType: "CREDIT", lines: [{ itemId: it.id, qty: 1, unitPrice: 1_500_000, serials: [s] }] });
    const lc = await landed([gr.id], [charge("FREIGHT", 50_000, "VALUE")]);
    check("landed cost to cost of sales: 50,000", near(await glFor(lc.id, it.cogs), 50_000));
    const ret = await P.postSalesReturn({ companyId: co.id, partnerId: cust.id, locationId: loc.id, docDate: today, sourceDocumentId: sale.id,
      lines: [{ itemId: it.id, qty: 1, unitPrice: 1_500_000, serials: [s] }] });
    check("the phone comes back at 1,050,000", near(await costOf(s), 1_050_000), fmt(await costOf(s)));
    check("the return takes 1,050,000 out of cost of sales", near(await glFor(ret.id, it.cogs), -1_050_000), fmt(await glFor(ret.id, it.cogs)));
    const resale = await P.postRetailSale({ companyId: co.id, partnerId: cust.id, locationId: loc.id, docDate: today, dueDate: today,
      paymentType: "CREDIT", lines: [{ itemId: it.id, qty: 1, unitPrice: 1_600_000, serials: [s] }] });
    check("the resale costs 1,050,000", near(await glFor(resale.id, it.cogs), 1_050_000), fmt(await glFor(resale.id, it.cogs)));
    check("inventory reconciles", near(await reconciled(), 0), fmt(await reconciled()));
  });

  await scenario("10. Return before the landed cost posts", async () => {
    const it = await item("Phone Pre");
    const { gr, sn: [s] } = await receiveEach([[it, 1_000_000]]);
    const sale = await P.postRetailSale({ companyId: co.id, partnerId: cust.id, locationId: loc.id, docDate: today, dueDate: today,
      paymentType: "CREDIT", lines: [{ itemId: it.id, qty: 1, unitPrice: 1_500_000, serials: [s] }] });
    await P.postSalesReturn({ companyId: co.id, partnerId: cust.id, locationId: loc.id, docDate: today, sourceDocumentId: sale.id,
      lines: [{ itemId: it.id, qty: 1, unitPrice: 1_500_000, serials: [s] }] });
    const lc = await landed([gr.id], [charge("FREIGHT", 50_000, "VALUE")]);
    check("the returned phone is on the shelf, so inventory: 50,000", near(await glFor(lc.id, it.inv), 50_000) && near(await glFor(lc.id, it.cogs), 0));
    check("its cost is 1,050,000", near(await costOf(s), 1_050_000));
  });

  await scenario("11. Reversal after the phone came back", async () => {
    const it = await item("Phone RevRet");
    const { gr, sn: [s] } = await receiveEach([[it, 1_000_000]]);
    const sale = await P.postRetailSale({ companyId: co.id, partnerId: cust.id, locationId: loc.id, docDate: today, dueDate: today,
      paymentType: "CREDIT", lines: [{ itemId: it.id, qty: 1, unitPrice: 1_500_000, serials: [s] }] });
    const lc = await landed([gr.id], [charge("FREIGHT", 50_000, "VALUE")]);
    await P.postSalesReturn({ companyId: co.id, partnerId: cust.id, locationId: loc.id, docDate: today, sourceDocumentId: sale.id,
      lines: [{ itemId: it.id, qty: 1, unitPrice: 1_500_000, serials: [s] }] });
    const rev = await L.reverseLandedCost({ ...actor, id: lc.id, reason: "Test" });
    check("the reversal takes the 50,000 from inventory, where it now is", near(await glFor(rev.id, it.inv), -50_000) && near(await glFor(rev.id, it.cogs), 0));
    check("the phone is back to 1,000,000", near(await costOf(s), 1_000_000), fmt(await costOf(s)));
    check("inventory reconciles", near(await reconciled(), 0), fmt(await reconciled()));
  });

  await scenario("12. A sale voided after the landed cost posted", async () => {
    const it = await item("Phone Void");
    const { gr, sn: [s] } = await receiveEach([[it, 1_000_000]]);
    const sale = await P.postRetailSale({ companyId: co.id, partnerId: cust.id, locationId: loc.id, docDate: today, dueDate: today,
      paymentType: "CREDIT", lines: [{ itemId: it.id, qty: 1, unitPrice: 1_500_000, serials: [s] }] });
    await landed([gr.id], [charge("FREIGHT", 50_000, "VALUE")]);
    const v = await P.voidDocument({ documentId: sale.id, reason: "test", goodsBack: true });
    check("the phone is back at 1,050,000", near(await costOf(s), 1_050_000), fmt(await costOf(s)));
    const [rv] = await sql`select reversed_by_document_id as id from document where id = ${sale.id}`;
    check("the landed 50,000 comes out of cost of sales", near(await glFor(rv.id, it.cogs), -1_050_000), fmt(await glFor(rv.id, it.cogs)));
    check("inventory reconciles", near(await reconciled(), 0), fmt(await reconciled()));
  });

  await scenario("13. Several landed costs on one phone", async () => {
    const it = await item("Phone Many");
    const { gr, sn: [s] } = await receiveEach([[it, 1_000_000]]);
    const a = await landed([gr.id], [charge("FREIGHT", 40_000, "VALUE")]);
    await landed([gr.id], [charge("DUTY", 25_000, "VALUE")]);
    check("1,000,000 + 40,000 + 25,000 = 1,065,000", near(await costOf(s), 1_065_000), fmt(await costOf(s)));
    await L.reverseLandedCost({ ...actor, id: a.id, reason: "Test" });
    check("reversing the first leaves the second: 1,025,000", near(await costOf(s), 1_025_000), fmt(await costOf(s)));
    const later = await L.createLandedCost({ ...actor, docDate: today, receiptIds: [gr.id] });
    const [w] = await sql`select count(*)::int n from landed_cost_receipt r join document d on d.id = r.landed_cost_id
                           where r.receipt_id = ${gr.id} and d.status = 'POSTED' and d.id <> ${later.id}`;
    check("the receipt shows its earlier landed costs (1 still posted)", w.n === 1, String(w.n));
    await L.deleteLandedCost({ ...actor, id: later.id });
  });

  await scenario("14. Two people post the same landed cost at once", async () => {
    const it = await item("Phone Race");
    const { gr } = await receiveEach([[it, 1_000_000], [it, 1_000_000]]);
    const lc = await landed([gr.id], [charge("FREIGHT", 20_000, "EQUAL")], { post: false });
    const results = await Promise.allSettled([1, 2, 3].map(() => L.postLandedCost({ ...actor, id: lc.id })));
    const ok = results.filter((r) => r.status === "fulfilled").length;
    check("exactly one posts; the others are refused", ok === 1, results.map((r) => r.status === "fulfilled" ? "posted" : r.reason.message.slice(0, 40)).join(" | "));
    const [e] = await sql`select count(*)::int n from journal_entry where source_id = ${lc.id}`;
    check("one journal entry", e.n === 1);
    check("Dr Inventory 20,000 once", near(await glFor(lc.id, it.inv), 20_000));
  });

  await scenario("15. A posting that fails leaves nothing behind", async () => {
    const it = await item("Phone Fail");
    const s1 = imei(), s2 = imei();
    const gr = await P.postGoodsReceipt({ companyId: co.id, partnerId: supp.id, locationId: loc.id, docDate: today,
      lines: [{ itemId: it.id, qty: 2, unitCost: 1_000_000, serials: [s1, s2] }] });
    const shared = await lotOf(s1);
    const lc = await landed([gr.id], [charge("FREIGHT", 20_000, "EQUAL")], { post: false });
    const r = await refused(() => sql.begin(async (tx) => {
      await L.postLandedCost({ ...actor, id: lc.id }, tx);
      throw new Error("injected failure after posting");
    }), /injected/);
    check("the failure surfaced", r.ok, r.msg);
    check("no split: the phone is still on the shared layer", (await lotOf(s1)) === shared);
    const [m] = await sql`select count(*)::int n from stock_movement where document_id = ${lc.id}`;
    const [j] = await sql`select count(*)::int n from journal_entry where source_id = ${lc.id}`;
    const [d] = await sql`select status from document where id = ${lc.id}`;
    check("no movements, no journal, still a draft", m.n === 0 && j.n === 0 && d.status === "DRAFT", `${m.n} / ${j.n} / ${d.status}`);
    await L.postLandedCost({ ...actor, id: lc.id });
    check("and it posts cleanly afterwards", (await sql`select status from document where id = ${lc.id}`)[0].status === "POSTED");
  });

  await scenario("16. Controls", async () => {
    const it = await item("Phone Ctl");
    const acc = { ...(await item("Phone case", false)), phone: false };
    const { gr } = await receiveEach([[it, 1_000_000]]);
    const draftGr = await sql`select id from document where doc_type = 'GOODS_RECEIPT' and status <> 'POSTED' limit 1`;
    const other = await refused(() => L.createLandedCost({ companyId: "00000000-0000-0000-0000-000000000000", userId: null, docDate: today, receiptIds: [gr.id] }), /not a goods receipt of this company/);
    check("another company cannot use this company's receipt", other.ok, other.msg);
    const lc = await L.createLandedCost({ ...actor, docDate: today, receiptIds: [gr.id] });
    const cross = await refused(() => L.calculateLandedCost({ companyId: "00000000-0000-0000-0000-000000000000", userId: null, id: lc.id }), /not found/);
    check("nor open its landed cost", cross.ok, cross.msg);
    const noRate = await refused(() => L.saveLandedCost({ ...actor, id: lc.id, docDate: today, receiptIds: [gr.id],
      charges: [charge("FREIGHT", 1_000, "VALUE", { currency: "CNY" })] }), /exchange rate/);
    check("a yuan charge with no rate is refused, not taken as kyat", noRate.ok, noRate.msg);
    await L.saveLandedCost({ ...actor, id: lc.id, docDate: today, receiptIds: [gr.id],
      charges: [charge("FREIGHT", 1_000, "VALUE", { currency: "CNY", exchangeRate: 520.5, rateDate: today })] });
    const [c] = await sql`select currency, fc_amount::float f, exchange_rate::float r, base_amount::float b, rate_date::text d, rate_entered_by from landed_cost_charge where landed_cost_id = ${lc.id}`;
    check("with a rate: 1,000 CNY × 520.5 = 520,500 MMK, rate date and who typed it kept",
      c.currency === "CNY" && near(c.f, 1_000) && near(c.r, 520.5) && near(c.b, 520_500) && c.d === today && (c.rate_entered_by === actor.userId), JSON.stringify(c));
    await L.deleteLandedCost({ ...actor, id: lc.id });

    // Accessories on the receipt.
    const mixed = await P.postGoodsReceipt({ companyId: co.id, partnerId: supp.id, locationId: loc.id, docDate: today, lines: [
      { itemId: it.id, qty: 1, unitCost: 1_000_000, serials: [imei()] }, { itemId: acc.id, qty: 10, unitCost: 5_000 } ] });
    const lc2 = await L.createLandedCost({ ...actor, docDate: today, receiptIds: [mixed.id] });
    await L.saveLandedCost({ ...actor, id: lc2.id, docDate: today, receiptIds: [mixed.id], charges: [charge("FREIGHT", 10_000, "VALUE")] });
    const ack = await refused(() => L.calculateLandedCost({ ...actor, id: lc2.id }), /Confirm that the charges go to the IMEI-tracked phones only/);
    check("a receipt with accessories needs the acknowledgement", ack.ok, ack.msg);
    await L.acknowledgeExcluded({ ...actor, id: lc2.id });
    await L.calculateLandedCost({ ...actor, id: lc2.id });
    const [a] = await sql`select count(*)::int n, sum(amount)::float v from landed_cost_allocation where landed_cost_id = ${lc2.id}`;
    check("then the whole 10,000 goes to the one phone", a.n === 1 && near(a.v, 10_000));
    const ex = await sql`select 1 from landed_cost_allocation a join item i on i.id = a.item_id where a.landed_cost_id = ${lc2.id} and not i.tracks_serial`;
    check("and nothing to the cases", ex.length === 0);
    const uncal = await L.createLandedCost({ ...actor, docDate: today, receiptIds: [gr.id] });
    const nc = await refused(() => L.postLandedCost({ ...actor, id: uncal.id }), /Calculate/);
    check("posting before calculating is refused", nc.ok, nc.msg);
    await L.deleteLandedCost({ ...actor, id: uncal.id });
    await L.deleteLandedCost({ ...actor, id: lc2.id });
  });

  await scenario("17. A supplier's price correction after a split follows the phone", async () => {
    const it = await item("Phone PPV");
    const s1 = imei(), s2 = imei();
    const gr = await P.postGoodsReceipt({ companyId: co.id, partnerId: supp.id, locationId: loc.id, docDate: today,
      lines: [{ itemId: it.id, qty: 2, unitCost: 1_000_000, serials: [s1, s2] }] });
    await landed([gr.id], [charge("FREIGHT", 20_000, "EQUAL")]);
    const [line] = await sql`select id from document_line where document_id = ${gr.id}`;
    const pi = await P.postPurchaseInvoice({ companyId: co.id, partnerId: supp.id, locationId: loc.id, docDate: today, dueDate: today,
      goodsReceiptId: gr.id, lines: [{ itemId: it.id, qty: 2, unitPrice: 1_100_000, sourceLineId: line.id }] });
    check("both phones, on their own layers, go up 100,000: 1,110,000", near(await costOf(s1), 1_110_000) && near(await costOf(s2), 1_110_000), `${await costOf(s1)}, ${await costOf(s2)}`);
    check("all of it to inventory, none to cost of sales", near(await glFor(pi.id, it.inv), 200_000) && near(await glFor(pi.id, it.cogs), 0),
      `${fmt(await glFor(pi.id, it.inv))} / ${fmt(await glFor(pi.id, it.cogs))}`);
    check("inventory reconciles", near(await reconciled(), 0), fmt(await reconciled()));
  });

  await scenario("18. The split never reads as stock coming or going", async () => {
    const Q = await import("../lib/queries.ts");
    const rows = await Q.getStockMovements(co.id, null);
    const splitIds = new Set((await sql`select id from stock_movement where kind = 'COST_LAYER_SPLIT'`).map((r) => r.id));
    check("there are splits to leave out", splitIds.size > 0, String(splitIds.size));
    check("the movements report leaves them out", !rows.some((r) => splitIds.has(r.id)));
    const [j] = await sql`select count(*)::int n from journal_line jl join journal_entry je on je.id = jl.journal_entry_id
                           join stock_movement sm on sm.document_id = je.source_id where sm.kind = 'COST_LAYER_SPLIT'
                            and jl.base_amount <> 0 and jl.account_id in (select account_id from account_determination where role = 'COGS')`;
    check("and no cost of sales was posted for it", j.n === 0);
  });

  // ---- delivered but not invoiced: cost of sales waits for the invoice (D8) ----
  const [held] = await sql`select fn_system_account(${co.id}, 'SHIPPED_NOT_INVOICED') as a`;
  // 1090 in the ledger against what the view says is waiting there.
  const heldTies = async () => {
    const [g] = await sql`select coalesce(sum(base_amount), 0)::float as v from journal_line where account_id = ${held.a}`;
    const [v] = await sql`select coalesce(sum(value_unclaimed), 0)::float as v from v_delivery_cost_unclaimed where company_id = ${co.id}`;
    return { ok: near(g.v, v.v), detail: `1090 ${fmt(g.v)}, waiting ${fmt(v.v)}` };
  };
  const deliver = (it, sn) => P.postDelivery({ companyId: co.id, partnerId: cust.id, locationId: loc.id, docDate: today,
    lines: [{ itemId: it.id, qty: 1, serials: [sn] }] });
  const bill = (it, dv, sn) => P.postSalesInvoice({ companyId: co.id, partnerId: cust.id, locationId: loc.id, docDate: today,
    dueDate: today, paymentType: "CREDIT", deliveryId: dv.id, lines: [{ itemId: it.id, qty: 1, unitPrice: 1_500_000, serials: [sn] }] });

  await scenario("19. Delivered, not invoiced: the landed cost waits in 1090, then goes to cost of sales with the invoice", async () => {
    const it = await item("Phone Held");
    const { gr, sn: [s] } = await receiveEach([[it, 1_000_000]]);
    const dv = await deliver(it, s);
    const lc = await landed([gr.id], [charge("FREIGHT", 50_000, "VALUE")]);
    check("Dr 1090 50,000, nothing to cost of sales", near(await glFor(lc.id, held.a), 50_000) && near(await glFor(lc.id, it.cogs), 0),
      `${fmt(await glFor(lc.id, held.a))} / ${fmt(await glFor(lc.id, it.cogs))}`);
    const [t] = await sql`select treatment from landed_cost_posting where landed_cost_id = ${lc.id}`;
    check("recorded as HOLDING", t?.treatment === "HOLDING", t?.treatment);
    let tie = await heldTies(); check("1090 = what waits there", tie.ok, tie.detail);
    const si = await bill(it, dv, s);
    check("the invoice moves 1,050,000 from 1090 to cost of sales", near(await glFor(si.id, it.cogs), 1_050_000) && near(await glFor(si.id, held.a), -1_050_000),
      `${fmt(await glFor(si.id, it.cogs))} / ${fmt(await glFor(si.id, held.a))}`);
    tie = await heldTies(); check("1090 = what waits there", tie.ok, tie.detail);
    check("inventory reconciles", near(await reconciled(), 0));
  });

  await scenario("20. Customer return before invoicing: the whole cost leaves 1090 for inventory", async () => {
    const it = await item("Phone HeldRet");
    const { gr, sn: [s] } = await receiveEach([[it, 1_000_000]]);
    const dv = await deliver(it, s);
    await landed([gr.id], [charge("FREIGHT", 50_000, "VALUE")]);
    const ret = await P.postSalesReturn({ companyId: co.id, partnerId: cust.id, locationId: loc.id, docDate: today,
      sourceDocumentId: dv.id, lines: [{ itemId: it.id, qty: 1, unitPrice: 0, serials: [s] }] });
    check("the phone is back at 1,050,000", near(await costOf(s), 1_050_000), fmt(await costOf(s)));
    check("Dr Inventory 1,050,000 / Cr 1090 1,050,000", near(await glFor(ret.id, it.inv), 1_050_000) && near(await glFor(ret.id, held.a), -1_050_000),
      `${fmt(await glFor(ret.id, it.inv))} / ${fmt(await glFor(ret.id, held.a))}`);
    check("and nothing from cost of sales, which never had it", near(await glFor(ret.id, it.cogs), 0), fmt(await glFor(ret.id, it.cogs)));
    const [w] = await sql`select count(*)::int n from v_delivery_cost_unclaimed where document_id = ${dv.id}`;
    check("the delivery no longer waits for an invoice", w.n === 0);
    const tie = await heldTies(); check("1090 = what waits there", tie.ok, tie.detail);
    check("inventory reconciles", near(await reconciled(), 0), fmt(await reconciled()));
  });

  await scenario("21. Invoice voided while the delivery stands: the whole cost goes back to 1090", async () => {
    const it = await item("Phone InvVoid");
    const { gr, sn: [s] } = await receiveEach([[it, 1_000_000]]);
    const dv = await deliver(it, s);
    await landed([gr.id], [charge("FREIGHT", 50_000, "VALUE")]);          // while waiting: 1090
    const si = await bill(it, dv, s);                                         // 1,050,000 to cost of sales
    const duty = await landed([gr.id], [charge("DUTY", 20_000, "VALUE")]); // after invoicing: cost of sales
    await P.voidDocument({ documentId: si.id, reason: "test" });
    const [rv] = await sql`select reversed_by_document_id as id from document where id = ${si.id}`;
    check("the void takes 1,070,000 out of cost of sales (both landed costs)", near(await glFor(rv.id, it.cogs), -1_070_000), fmt(await glFor(rv.id, it.cogs)));
    check("and puts it back in 1090", near(await glFor(rv.id, held.a), 1_070_000), fmt(await glFor(rv.id, held.a)));
    check("cost of sales for this phone nets to nothing: invoice + later duty + void",
      near((await glFor(si.id, it.cogs)) + (await glFor(duty.id, it.cogs)) + (await glFor(rv.id, it.cogs)), 0),
      `${fmt(await glFor(si.id, it.cogs))} + ${fmt(await glFor(duty.id, it.cogs))} + ${fmt(await glFor(rv.id, it.cogs))}`);
    const tie = await heldTies(); check("1090 = what waits there (1,070,000 for this phone)", tie.ok, tie.detail);
    const [v] = await sql`select value_unclaimed::float v from v_delivery_cost_unclaimed where document_id = ${dv.id}`;
    check("the delivery waits again at 1,070,000", near(v?.v, 1_070_000), fmt(v?.v));
    const again = await bill(it, dv, s);
    check("billing it again moves 1,070,000 to cost of sales", near(await glFor(again.id, it.cogs), 1_070_000), fmt(await glFor(again.id, it.cogs)));
  });

  await scenario("22. Invoice and delivery both reversed: the whole cost back in inventory", async () => {
    const it = await item("Phone BothVoid");
    const { gr, sn: [s] } = await receiveEach([[it, 1_000_000]]);
    const dv = await deliver(it, s);
    await landed([gr.id], [charge("FREIGHT", 50_000, "VALUE")]);
    const si = await bill(it, dv, s);
    await P.voidDocument({ documentId: si.id, reason: "test" });
    await P.voidDocument({ documentId: dv.id, reason: "test", goodsBack: true });
    check("the phone is in stock at 1,050,000", near(await costOf(s), 1_050_000), fmt(await costOf(s)));
    const [st] = await sql`select status from v_stock_serial where imei = ${s}`;
    check("in stock", st.status === "IN_STOCK", st.status);
    const [w] = await sql`select count(*)::int n from v_delivery_cost_unclaimed where document_id = ${dv.id}`;
    check("nothing waits in 1090 for it", w.n === 0);
    const tie = await heldTies(); check("1090 = what waits there", tie.ok, tie.detail);
    check("inventory reconciles", near(await reconciled(), 0), fmt(await reconciled()));
  });

  await scenario("23. A landed-cost reversal comes from wherever the cost is now", async () => {
    const it = await item("Phone RevHeld");
    const a = await receiveEach([[it, 1_000_000]]), b = await receiveEach([[it, 1_000_000]]);
    const dvA = await deliver(it, a.sn[0]);
    const lcA = await landed([a.gr.id], [charge("FREIGHT", 50_000, "VALUE")]);
    const revA = await L.reverseLandedCost({ ...actor, id: lcA.id, reason: "test" });
    check("still waiting: the reversal credits 1090", near(await glFor(revA.id, held.a), -50_000) && near(await glFor(revA.id, it.cogs), 0),
      `${fmt(await glFor(revA.id, held.a))} / ${fmt(await glFor(revA.id, it.cogs))}`);
    const dvB = await deliver(it, b.sn[0]);
    const lcB = await landed([b.gr.id], [charge("FREIGHT", 50_000, "VALUE")]);
    await bill(it, dvB, b.sn[0]);
    const revB = await L.reverseLandedCost({ ...actor, id: lcB.id, reason: "test" });
    check("invoiced since: the reversal credits cost of sales, where the cost went", near(await glFor(revB.id, it.cogs), -50_000) && near(await glFor(revB.id, held.a), 0),
      `${fmt(await glFor(revB.id, it.cogs))} / ${fmt(await glFor(revB.id, held.a))}`);
    const tie = await heldTies(); check("1090 = what waits there", tie.ok, tie.detail);
    check("inventory reconciles", near(await reconciled(), 0));
  });

  await scenario("24. Untracked goods returned against a delivery nobody has invoiced", async () => {
    const it = { ...(await item("Cable", false)), phone: false };
    await P.postGoodsReceipt({ companyId: co.id, partnerId: supp.id, locationId: loc.id, docDate: today,
      lines: [{ itemId: it.id, qty: 20, unitCost: 100 }] });
    const dv = await P.postDelivery({ companyId: co.id, partnerId: cust.id, locationId: loc.id, docDate: today,
      lines: [{ itemId: it.id, qty: 6 }] });
    const ret = await P.postSalesReturn({ companyId: co.id, partnerId: cust.id, locationId: loc.id, docDate: today,
      sourceDocumentId: dv.id, lines: [{ itemId: it.id, qty: 2, unitPrice: 0 }] });
    check("2 back before billing: Dr Inventory 200 / Cr 1090 200", near(await glFor(ret.id, it.inv), 200) && near(await glFor(ret.id, held.a), -200),
      `${fmt(await glFor(ret.id, it.inv))} / ${fmt(await glFor(ret.id, held.a))}`);
    check("nothing from cost of sales", near(await glFor(ret.id, it.cogs), 0), fmt(await glFor(ret.id, it.cogs)));
    const [w] = await sql`select coalesce(sum(qty_unclaimed), 0)::float q, coalesce(sum(value_unclaimed), 0)::float v from v_delivery_cost_unclaimed where document_id = ${dv.id}`;
    check("the delivery waits for 4, worth 400", near(w.q, 4) && near(w.v, 400), `${w.q} / ${fmt(w.v)}`);
    let tie = await heldTies(); check("1090 = what waits there", tie.ok, tie.detail);
    const si = await P.postSalesInvoice({ companyId: co.id, partnerId: cust.id, locationId: loc.id, docDate: today, dueDate: today,
      paymentType: "CREDIT", deliveryId: dv.id, lines: [{ itemId: it.id, qty: 4, unitPrice: 300 }] });
    check("billing the 4 that stayed moves 400 to cost of sales", near(await glFor(si.id, it.cogs), 400), fmt(await glFor(si.id, it.cogs)));

    // Part billed, then a return bigger than what is still waiting.
    const dv2 = await P.postDelivery({ companyId: co.id, partnerId: cust.id, locationId: loc.id, docDate: today,
      lines: [{ itemId: it.id, qty: 5 }] });
    await P.postSalesInvoice({ companyId: co.id, partnerId: cust.id, locationId: loc.id, docDate: today, dueDate: today,
      paymentType: "CREDIT", deliveryId: dv2.id, lines: [{ itemId: it.id, qty: 3, unitPrice: 300 }] });
    const ret2 = await P.postSalesReturn({ companyId: co.id, partnerId: cust.id, locationId: loc.id, docDate: today,
      sourceDocumentId: dv2.id, lines: [{ itemId: it.id, qty: 4, unitPrice: 0 }] });
    check("4 back after 3 were billed: the 2 unbilled from 1090 (200), the 2 billed from cost of sales (200)",
      near(await glFor(ret2.id, held.a), -200) && near(await glFor(ret2.id, it.cogs), -200) && near(await glFor(ret2.id, it.inv), 400),
      `1090 ${fmt(await glFor(ret2.id, held.a))}, COGS ${fmt(await glFor(ret2.id, it.cogs))}, Inv ${fmt(await glFor(ret2.id, it.inv))}`);
    const [w2] = await sql`select count(*)::int n from v_delivery_cost_unclaimed where document_id = ${dv2.id}`;
    check("nothing of that delivery is left waiting", w2.n === 0);
    tie = await heldTies(); check("1090 = what waits there", tie.ok, tie.detail);
    check("inventory reconciles", near(await reconciled(), 0), fmt(await reconciled()));
  });

  console.log("");
  check("company: Inventory GL = stock ledger at the end", near(await reconciled(), 0), fmt(await reconciled()));
  const [ub] = await sql`select count(*)::int n from v_check_unbalanced_entries where company_id = ${co.id}`;
  check("no unbalanced journal entries", ub.n === 0);
  console.log(bad === 0 ? "\n  all checks passed\n" : `\n  ${bad} FAILED\n`);
  process.exitCode = bad === 0 ? 0 : 1;
} catch (e) {
  console.error("\n  error:", e.stack ?? e.message, "\n");
  process.exitCode = 1;
} finally {
  await releaseTestLock(sql);
  await sql.end({ timeout: 5 });
}
