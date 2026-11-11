// Three months of trading for Inventory → Replenishment on DEV: purchase
// orders, the goods arriving (late, sometimes), bills matched to them, and
// daily sales at the counter, 12 Aug – today. Plus the planning settings a
// buyer would have set: supplier lead times, minimum orders and packs, a
// min–max item, a manual one and a fixed safety stock.
//
//   npx tsx scripts/demo-replenishment.mjs        (DATABASE_URL or .env — DEV only)
//
// Real documents on existing products and partners; nothing is created in
// master data. Every document carries the memo "RPDEMO", and the script stops
// if any exist, so it never posts twice. Seeded, so a rerun after a wipe
// produces the same history.

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
// --undo takes the demo back out: sales and bills voided, receipts voided,
// orders still open closed. Run it before posting again after a partial run.
if (process.argv.includes("--undo")) {
  const docs = await sql`select id, doc_no, doc_type from document
    where company_id = ${co.id} and memo = 'RPDEMO' and status = 'POSTED' and reverses_document_id is null
    -- Newest first, whatever the type: stock is costed in order, so the last
    -- movement has to come out before the one beneath it.
    order by (doc_type = 'PURCHASE_ORDER'), doc_date desc, created_at desc`;
  for (const d of docs) {
    try {
      if (d.doc_type === "PURCHASE_ORDER") await P.closeOrderRemaining({ companyId: co.id, documentId: d.id, reason: "Demo taken out" });
      else await P.voidDocument({ documentId: d.id, reason: "Demo taken out", goodsBack: true });
      process.stdout.write(".");
    } catch (e) { if (!/nothing outstanding|already closed/i.test(e.message)) console.log(`\n${d.doc_no}: ${e.message}`); }
  }
  console.log("\nUndone.");
  await sql.end(); process.exit(0);
}
// A handful left behind by an interrupted run (sales that later stock drew on
// cannot be voided) is not a posted demo; a full run is hundreds.
const [{ n: seenN }] = await sql`select count(*)::int as n from document where company_id = ${co.id} and memo = 'RPDEMO' and doc_type = 'SALES_INVOICE' and status = 'POSTED'`;
if (seenN >= 20) { console.log("Demo already posted (RPDEMO documents exist) — nothing to do."); process.exit(0); }

const DAYS = 92;
const today = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z");
const dayOf = (d) => new Date(today.getTime() - (DAYS - 1 - d) * 86400000).toISOString().slice(0, 10);

// Seeded randomness: the same history every run.
let seed = 20261111;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const poisson = (l) => { let k = 0, p = 1; const L = Math.exp(-l); do { k++; p *= rnd(); } while (p > L); return k - 1; };

const one = async (q) => (await q)[0];
const loc = await one(sql`select id from location where company_id = ${co.id} and code = 'MAIN-WH'`);
const supp = {};
for (const [k, code] of Object.entries({ china: "01-001", thai: "01-002", apple: "01-003", isq: "01-007" }))
  supp[k] = await one(sql`select id, name from business_partner where company_id = ${co.id} and code = ${code}`);
const customers = await sql`select id from business_partner where company_id = ${co.id} and is_customer and is_active order by code limit 80`;

// Planned lead (what the buyer set) and actual (what the supplier does).
const SUPPLIER = { china: { plan: 14, actual: 17 }, thai: { plan: 7, actual: 7 }, apple: { plan: 3, actual: 3 }, isq: { plan: 5, actual: 6 } };

// code, supplier, cost, price, daily demand (a function of day 0–91), pack, stop reordering N days before today
const PLAN = [
  ["IPC010", "china", 3_650_000, 3_980_000, () => 0.75, 1, 26],     // iPhone 17 Black — buyer missed it: order now
  ["IPC011", "china", 3_650_000, 3_980_000, () => 0.5, 1, 0],
  ["IPC012", "china", 3_650_000, 3_980_000, () => 0.4, 1, 0],
  ["IPC016", "china", 4_750_000, 5_150_000, (d) => 0.35 + d / 400, 1, 0],
  ["IPC018", "china", 5_350_000, 5_790_000, () => 0.55, 1, 22],     // late PO below
  ["IPC019", "china", 5_350_000, 5_790_000, () => 0.4, 1, 22],      // late PO below
  ["IPC022", "china", 6_350_000, 6_850_000, () => (rnd() < 0.12 ? 1.5 : 0), 1, 0], // lumpy
  ["IPA128", "china", 3_900_000, 4_250_000, () => 0.25, 1, 0],
  ["IPC004", "china", 2_850_000, 3_150_000, (d) => Math.max(0.03, 0.45 - d / 180), 1, 0], // fading: excess
  ["IPD001", "thai", 1_300_000, 1_480_000, () => 0.3, 1, 15],       // order now
  ["IPB001", "apple", 4_200_000, 4_650_000, () => (rnd() < 0.08 ? 1 : 0), 1, 0],
  ["NTG01", "isq", 1_150_000, 1_320_000, () => 0.3, 1, 0],
  ["AKL01", "china", 9_000, 15_000, (d) => 3.5 + 1.5 * Math.sin(d / 5), 25, 30], // cable, MOQ 50 pack 25
  ["AKN01", "isq", 45_000, 65_000, () => 1.4, 1, 0],
  ["IPR001", "china", 12_000, 25_000, () => 2, 10, 0],
  ["IPS005", "china", 3_000, 8_000, () => 1, 50, 0],
  ["AP001", "apple", 650_000, 760_000, () => 0.6, 1, 8],            // order now
  ["AP002", "apple", 380_000, 450_000, () => 0.45, 1, 0],
  ["IW004", "apple", 1_150_000, 1_350_000, () => 0.12, 1, 0],       // min–max
  ["MMX01", "isq", 18_000, 30_000, () => 0.2, 1, 0],
  ["ADP01", "china", 22_000, 35_000, () => 2.2, 1, 999],            // 1,490 on the shelf: excess
  ["JFL10", "isq", 28_000, 45_000, (d) => (d < 30 ? 1.2 : 0), 1, 999], // summer fan: no sales since
];

const items = {};
for (const [code] of PLAN) {
  const it = await one(sql`select id, name, tracks_serial from item where company_id = ${co.id} and code = ${code}`);
  if (!it) { console.error(`Missing item ${code}`); process.exit(1); }
  items[code] = it;
}

// Luhn-valid IMEIs (15 digits) or plain serials, never colliding with real ones.
// Numbered on from the last demo IMEI already recorded, so a rerun after an
// undo never reuses one (a serial, once received, is known for good).
const [{ top }] = await sql`select coalesce(max(substr(serial_no, 7, 8)::int), 0) as top from stock_serial where serial_no ~ '^359871[0-9]{9}$'`;
let imeiN = Number(top);
const imei = () => {
  const body = "35" + "9871" + String(++imeiN).padStart(8, "0");
  let s = 0;
  for (let i = 0; i < 14; i++) { let d = Number(body[i]); if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; } s += d; }
  return body + ((10 - (s % 10)) % 10);
};

// ---- simulate: what the shop would have done, day by day
const events = []; // { day, kind: "po" | "gr" | "sale", ... }
for (const [code, sk, cost, price, demand, pack, stopBefore] of PLAN) {
  const s = SUPPLIER[sk];
  let onHand = 0;
  const pipeline = []; // { arrive, qty, po }
  for (let d = 0; d < DAYS; d++) {
    for (const p of pipeline.filter((p) => p.arrive === d)) { onHand += p.qty; events.push({ day: d, kind: "gr", code, sk, cost, qty: p.qty, po: p.po }); }
    const mean = demand(d);
    const want = mean > 0 ? poisson(mean) : 0;
    const sold = code === "ADP01" ? want : Math.min(want, onHand); // ADP01 sells from the 1,490 already there
    if (sold > 0) { if (code !== "ADP01") onHand -= sold; events.push({ day: d, kind: "sale", code, price, qty: sold }); }
    // What the buyer believes it sells: the lumpy ones at their long-run average.
    const avg = code === "IPC022" ? 0.18 : code === "IPB001" ? 0.08 : Math.max(0.05, mean);
    const onOrder = pipeline.filter((p) => p.arrive > d).reduce((t, p) => t + p.qty, 0);
    const buying = d < DAYS - stopBefore && !["ADP01", "JFL10"].includes(code);
    if (buying && onHand + onOrder < avg * (s.plan + 10)) {
      const qty = Math.max(pack, Math.ceil((avg * (s.plan + 50)) / pack) * pack);
      const po = { id: events.length };
      pipeline.push({ arrive: d + s.actual + (rnd() < 0.3 ? 1 : 0), qty, po });
      events.push({ day: d, kind: "po", code, sk, cost, qty, po, due: d + s.plan });
    }
  }
  if (code === "JFL10") { // bought for the summer, before the window
    events.push({ day: 0, kind: "po", code, sk, cost, qty: 60, po: { id: "jfl" }, due: 0 });
    events.push({ day: 0, kind: "gr", code, sk, cost, qty: 60, po: { id: "jfl" } });
  }
}
// Late: ordered three weeks ago, due last week, still not here. On time: due next week.
const late = (code, day) => { const p = PLAN.find((x) => x[0] === code); events.push({ day, kind: "po", code, sk: p[1], cost: p[2], qty: code === "AKN01" ? 30 : 8, po: { id: "late" + code }, due: day + SUPPLIER[p[1]].plan }); };
late("IPC018", DAYS - 23); late("IPC019", DAYS - 23); late("AKN01", DAYS - 10);
{ const p = PLAN.find((x) => x[0] === "IPC016"); events.push({ day: DAYS - 4, kind: "po", code: "IPC016", sk: "china", cost: p[2], qty: 10, po: { id: "ontime" }, due: DAYS - 4 + 14 }); }

// Sales sorted after receipts on the same day; one invoice per customer visit of up to three lines.
const rank = { po: 0, gr: 1, sale: 2 };
events.sort((a, b) => a.day - b.day || rank[a.kind] - rank[b.kind]);

// ---- post
const serials = new Map(); // item code → serials on the shelf, oldest first
const poLine = new Map();  // po.id → { orderId, lineId }
let counts = { po: 0, gr: 0, bill: 0, sale: 0 }, billFail = 0;
const memo = "RPDEMO";

let day = -1, basket = [];
const flush = async () => {
  if (!basket.length) return;
  const cust = customers[Math.floor(rnd() * customers.length)];
  await P.postRetailSale({
    companyId: co.id, partnerId: cust.id, locationId: loc.id, docDate: dayOf(day), dueDate: dayOf(day), memo,
    paymentType: "CREDIT", allowOverCreditLimit: true, creditOverrideReason: "Demo history",
    lines: basket.map((l) => ({ itemId: items[l.code].id, qty: l.qty, unitPrice: l.price,
      ...(items[l.code].tracks_serial ? { serials: serials.get(l.code).splice(0, l.qty) } : {}) })),
  });
  counts.sale++; basket = [];
};

for (const e of events) {
  if (e.day !== day) { await flush(); day = e.day; if (day % 10 === 0) console.log(`  ${dayOf(day)} …`, counts); }
  const it = items[e.code];
  if (e.kind === "po") {
    const r = await P.postPurchaseOrder({ companyId: co.id, partnerId: supp[e.sk].id, locationId: loc.id, memo,
      docDate: dayOf(e.day), dueDate: dayOf(e.due),
      lines: [{ itemId: it.id, qty: e.qty, unitPrice: e.cost }] });
    const [line] = await sql`select id from document_line where document_id = ${r.id} limit 1`;
    poLine.set(e.po.id, { orderId: r.id, lineId: line.id });
    counts.po++;
  } else if (e.kind === "gr") {
    const src = poLine.get(e.po.id);
    const s = it.tracks_serial ? Array.from({ length: e.qty }, imei) : undefined;
    const gr = await P.postGoodsReceipt({ companyId: co.id, partnerId: supp[e.sk].id, locationId: loc.id, docDate: dayOf(e.day), memo,
      lines: [{ itemId: it.id, qty: e.qty, unitCost: e.cost, sourceLineId: src?.lineId ?? null, ...(s ? { serials: s } : {}) }] });
    if (s) serials.set(e.code, [...(serials.get(e.code) ?? []), ...s]);
    counts.gr++;
    // The supplier's bill, matched to the receipt (three-way: order, receipt, bill).
    try {
      const [gl] = await sql`select id from document_line where document_id = ${gr.id} limit 1`;
      await P.postPurchaseInvoice({ companyId: co.id, partnerId: supp[e.sk].id, locationId: loc.id, docDate: dayOf(e.day),
        dueDate: dayOf(Math.min(e.day + 30, DAYS - 1)), memo, lines: [{ itemId: it.id, qty: e.qty, unitPrice: e.cost, sourceLineId: gl.id }] });
      counts.bill++;
    } catch (err) { if (billFail++ === 0) console.log("  (bill not matched:", err.message, ")"); }
  } else {
    basket.push(e);
    if (basket.length >= 3 + Math.floor(rnd() * 4)) await flush(); // a shop's order: three to six lines
  }
}
await flush();

// ---- the settings a buyer would have made
await sql`update business_partner set lead_time_days = v.d from (values
  (${supp.china.id}::uuid, 14), (${supp.thai.id}::uuid, 7), (${supp.apple.id}::uuid, 3), (${supp.isq.id}::uuid, 5)) v(id, d)
  where business_partner.id = v.id`;
const si = async (code, sk, lead, moq, mult) => sql`
  insert into supplier_item (company_id, supplier_id, item_id, lead_time_days, moq, order_multiple)
  values (${co.id}, ${supp[sk].id}, ${items[code].id}, ${lead}, ${moq}, ${mult})
  on conflict (company_id, supplier_id, item_id) do update set lead_time_days = excluded.lead_time_days, moq = excluded.moq, order_multiple = excluded.order_multiple`;
await si("AKL01", "china", null, 50, 25);
await si("IPR001", "china", null, null, 10);
await si("IPS005", "china", null, 100, 50);
await si("AKN01", "isq", null, 10, null);
await si("IPC022", "china", 21, null, null);
const rp = async (code, method, min, max, safety) => sql`
  insert into item_reorder (company_id, item_id, location_id, method, min_qty, max_qty, safety_qty)
  values (${co.id}, ${items[code].id}, ${loc.id}, ${method}, ${min}, ${max}, ${safety})
  on conflict (company_id, item_id, location_id) do update set method = excluded.method, min_qty = excluded.min_qty, max_qty = excluded.max_qty, safety_qty = excluded.safety_qty`;
await rp("IW004", "MINMAX", 3, 8, null);
await rp("IPB001", "MINMAX", 1, 3, null);
await rp("IPC018", "AUTO", null, null, 4);
await rp("MMX01", "MANUAL", null, null, null);

console.log("Done.", counts);
await sql.end();
process.exit(0);
