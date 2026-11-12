// Sales and cost of sales land together: with the invoice when the goods went
// first, and with the delivery when the invoice went first (0191 — billed and
// not delivered is held in 21303 until the goods leave). Posted inside one transaction that is rolled back,
// so it can run against DEV at any time and leaves nothing behind.
//
//   npx tsx --env-file=.env scripts/check-delivery-entries.mjs
//
// Run it after touching delivery or invoice posting. Either setting of
// ORDERS_AND_DELIVERIES (lib/features.ts) posts through these same paths.
// Cases, dated across a month end (Oct 31 → Nov 2):
//   A  delivered, then invoiced
//   B  invoiced (deliver later), then delivered — the sale and its cost land
//      in the delivery's month, the price held in 21303 until then
//   C  invoiced, cheaper stock sold meanwhile, delivered in two loads — each
//      load earns its share at the cost it actually went out at
//   D  invoiced for later, never delivered, voided — nothing left held
// and throughout, 1090 = delivered-unclaimed − invoiced-ahead.

import postgres from "postgres";

const url = process.env.DATABASE_URL;
const sql = postgres(url, { ssl: url.includes("localhost") ? false : "require",
  prepare: !url.includes("-pooler."), onnotice: () => {}, max: 1 });
const P = await import("../lib/posting.ts");
class Rollback extends Error {}

let bad = 0;
const check = (label, ok, detail = "") => {
  if (!ok) bad++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  " + detail : ""}`);
};
const OCT = "2026-10-31", NOV = "2026-11-02";

try {
  await sql.begin(async (tx) => {
    const [co] = await tx`select id from company order by created_at limit 1`;
    const [loc] = await tx`select id from location where company_id = ${co.id} and is_stock_location and is_active order by code limit 1`;
    const [grp] = await tx`select id from item_group where company_id = ${co.id} limit 1`;
    const [uom] = await tx`select id from uom where company_id = ${co.id} limit 1`;
    const [item] = await tx`insert into item (company_id, item_group_id, code, name, base_uom_id, serial, is_stocked)
      values (${co.id}, ${grp.id}, 'CHK-DLV', 'Delivery probe', ${uom.id}, 'CHK-DLV', true) returning id`;
    const [cust] = await tx`insert into business_partner (company_id, code, name, is_customer)
      values (${co.id}, 'CHK-C', 'Probe customer', true) returning id`;
    const [supp] = await tx`insert into business_partner (company_id, code, name, is_supplier)
      values (${co.id}, 'CHK-S', 'Probe supplier', true) returning id`;
    const base = { companyId: co.id, partnerId: cust.id, locationId: loc.id };
    const [held] = await tx`select a.id, a.code from account a where a.id = fn_system_account(${co.id}, 'SHIPPED_NOT_INVOICED')`;

    const entry = async (label, docId) => {
      const rows = await tx`
        select a.code, a.name, jl.base_amount::numeric as amt
          from document d join journal_line jl on jl.journal_entry_id = d.journal_entry_id
          join account a on a.id = jl.account_id
         where d.id = ${docId} order by jl.base_amount desc`;
      console.log(`\n  ${label}`);
      for (const r of rows) {
        const v = Number(r.amt);
        console.log(`    ${v > 0 ? "Dr" : "   Cr"} ${r.code} ${r.name}`.padEnd(52) + Math.abs(v).toLocaleString());
      }
    };
    const one = async (q) => Number((await q)[0].v);
    const heldBal = () => one(tx`select coalesce(sum(base_amount), 0)::numeric as v from journal_line where account_id = ${held.id}`);
    const unclaimed = () => one(tx`select coalesce(sum(value_unclaimed), 0)::numeric as v from v_delivery_cost_unclaimed where company_id = ${co.id}`);
    const ahead = () => one(tx`select coalesce(sum(value_ahead), 0)::numeric as v from v_invoice_cost_booked_ahead where company_id = ${co.id}`);
    const [bnd] = await tx`select a.id from account a where a.id = fn_system_account(${co.id}, 'BILLED_NOT_DELIVERED')`;
    const unearned = () => one(tx`select coalesce(sum(base_amount), 0)::numeric as v from journal_line where account_id = ${bnd.id}`);
    const reconciles = async () => {
      const [h, u, a] = [await heldBal(), await unclaimed(), await ahead()];
      check(`${held.code} = delivered unclaimed − invoiced ahead`, Math.abs(h - (u - a)) < 0.0001, `${h} = ${u} − ${a}`);
    };

    /* Sales and cost by month for one case: entries written since it began. */
    let before = [];
    const startCase = async () => {
      before = (await tx`select id from journal_entry where company_id = ${co.id}`).map((r) => r.id);
    };
    const month = async (from, to) => {
      const [r] = await tx`
        select coalesce(-sum(jl.base_amount) filter (where a.code like '4%'), 0)::numeric as rev,
               coalesce(sum(jl.base_amount) filter (where a.code like '5%'), 0)::numeric as cost
          from journal_line jl join account a on a.id = jl.account_id
          join journal_entry je on je.id = jl.journal_entry_id
         where a.company_id = ${co.id} and je.entry_date between ${from}::date and ${to}::date
           and je.id <> all(${before})`;
      return { rev: Number(r.rev), cost: Number(r.cost) };
    };
    const byMonth = async (label, want) => {
      const oct = await month("2026-10-01", OCT), nov = await month("2026-11-01", "2026-11-30");
      console.log(`\n  ${label}\n    October:  sales ${oct.rev}, cost ${oct.cost}\n    November: sales ${nov.rev}, cost ${nov.cost}`);
      check("by month as expected", JSON.stringify([oct, nov]) === JSON.stringify(want));
    };

    // 10 at 1,000 then 5 at 1,300: FIFO takes the 1,000s first.
    await P.postGoodsReceipt({ companyId: co.id, partnerId: supp.id, locationId: loc.id, docDate: "2026-10-01",
      lines: [{ itemId: item.id, qty: 10, unitCost: 1000 }] }, tx);
    await P.postGoodsReceipt({ companyId: co.id, partnerId: supp.id, locationId: loc.id, docDate: "2026-10-02",
      lines: [{ itemId: item.id, qty: 5, unitCost: 1300 }] }, tx);
    const sell = (date, qty, extra = {}) => P.postSalesInvoice({ ...base, docDate: date, dueDate: date,
      paymentType: "CREDIT", ...extra, lines: [{ itemId: item.id, qty, unitPrice: 1500 }] }, tx);
    const lineOf = async (docId) => (await tx`select id from document_line where document_id = ${docId}`)[0].id;
    const deliverFor = async (date, inv, qty) => P.postDelivery({ ...base, docDate: date, sourceDocumentId: inv.id,
      lines: [{ itemId: item.id, qty, sourceLineId: await lineOf(inv.id) }] }, tx);

    console.log("\n=== A. Delivered Oct 31, invoiced Nov 2 (2 units) ===");
    await startCase();
    const dv = await P.postDelivery({ ...base, docDate: OCT, lines: [{ itemId: item.id, qty: 2, unitPrice: 1500 }] }, tx);
    await entry(`Delivery ${dv.docNo}`, dv.id);
    await reconciles();
    const ia = await sell(NOV, 2, { deliveryId: dv.id });
    await entry(`Invoice ${ia.docNo}`, ia.id);
    await byMonth("A by month", [{ rev: 0, cost: 0 }, { rev: 3000, cost: 2000 }]);
    await reconciles();

    console.log("\n=== B. Invoiced Oct 31 (deliver later), delivered Nov 2 (2 units) ===");
    await startCase();
    const unearnedBefore = await unearned();
    const ib = await sell(OCT, 2, { toDeliver: true });
    await entry(`Invoice ${ib.docNo}`, ib.id);
    check("invoice holds its 3,000 as billed, not delivered", (await unearned()) === unearnedBefore - 3000, `${await unearned()}`);
    check("and books no cost ahead", (await ahead()) === 0, `${await ahead()}`);
    await reconciles();
    const db = await deliverFor(NOV, ib, 2);
    await entry(`Delivery ${db.docNo}`, db.id);
    // The goods left in November, so that is when the sale and its cost happened.
    await byMonth("B by month", [{ rev: 0, cost: 0 }, { rev: 3000, cost: 2000 }]);
    check("the delivery releases what was held", (await unearned()) === unearnedBefore, `${await unearned()}`);
    check("nothing left booked ahead", (await ahead()) === 0, `${await ahead()}`);
    await reconciles();

    console.log("\n=== C. Invoiced 4 Oct 31, cheaper stock sold meanwhile, delivered 1 + 3 on Nov 2 ===");
    await startCase();
    const ic = await sell(OCT, 4, { toDeliver: true });
    await entry(`Invoice ${ic.docNo} (estimate: 4 of the 6 left at 1,000)`, ic.id);
    // A walk-in takes 5 of the 6 at 1,000, so C's goods leave at 1,000 + 3 × 1,300.
    const dw = await P.postDelivery({ ...base, docDate: OCT, lines: [{ itemId: item.id, qty: 5, unitPrice: 1500 }] }, tx);
    await sell(OCT, 5, { deliveryId: dw.id });
    await reconciles();
    const c1 = await deliverFor(NOV, ic, 1);
    await entry(`Delivery ${c1.docNo} (1 unit)`, c1.id);
    await reconciles();
    const c2 = await deliverFor(NOV, ic, 3);
    await entry(`Delivery ${c2.docNo} (3 units, the last)`, c2.id);
    // Oct: only the walk-in, 7,500 / 5,000. Nov: C's 6,000 when its goods left,
    // at what they actually cost — 1,000 + 3 × 1,300.
    await byMonth("C by month", [{ rev: 7500, cost: 5000 }, { rev: 6000, cost: 4900 }]);
    check("nothing left booked ahead", (await ahead()) === 0, `${await ahead()}`);
    check(`${held.code} is empty`, (await heldBal()) === 0, `${await heldBal()}`);

    console.log("\n=== D. Invoiced 1 for later, never delivered, voided ===");
    const heldBefore = await heldBal();
    const iv = await sell(OCT, 1, { toDeliver: true });
    const unearnedD = await unearned();
    check("held as billed, not delivered, while it stands", (await unearned()) < unearnedBefore, `${await unearned()}`);
    await P.voidDocument({ documentId: iv.id, reason: "check" }, tx);
    check("void releases nothing to Sales and leaves nothing held", (await unearned()) === unearnedBefore, `${await unearned()} (was ${unearnedD})`);
    check(`void puts ${held.code} back`, (await heldBal()) === heldBefore, `${await heldBal()}`);
    await reconciles();

    throw new Rollback();
  });
} catch (e) {
  if (!(e instanceof Rollback)) { console.error(e); bad++; }
}
console.log(bad ? `\n${bad} FAILED (rolled back)` : "\nAll good (rolled back, nothing kept)");
await sql.end();
process.exit(bad ? 1 : 0);
