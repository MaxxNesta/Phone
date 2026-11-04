// Thai's January 2026, from the old system's ledger, posted on DEV through the
// ordinary engine — to check the supplier ledger and the general ledger read as
// the old reports did once payments made ahead of a bill are supplier advances.
//
//   npx tsx scripts/demo-thai-january.mjs            post it
//   npx tsx scripts/demo-thai-january.mjs --remove   take it all back out
//
// DEV only. The bills' lines are not in the old ledger, only their totals, so
// each is one line of a demo item ("ZZDEMO", no IMEI) at the bill's total; the
// item and everything posted here go with --remove.

const { sql } = await import("../lib/db.ts");
const P = await import("../lib/posting.ts");

const [co] = await sql`select id, name from company order by created_at limit 1`;
if (!/\bDEV\b/.test(co.name)) throw new Error("DEV only");
const one = async (q) => (await q)[0];
const thai = await one(sql`select id from business_partner where company_id = ${co.id} and code = '01-002'`);
const acct = async (code) => (await one(sql`select id from account where company_id = ${co.id} and code = ${code}`)).id;
const AYA = await acct("13204"), KBZ = await acct("13202"), YOMA = await acct("13203"), NAN = await acct("13206");

if (process.argv.includes("--remove")) {
  const { resetTransactions } = await import("./test-reset.mjs");
  const other = await sql`select count(*)::int as n from document where company_id = ${co.id} and partner_id is distinct from ${thai.id}`;
  if (other[0].n) throw new Error(`${other[0].n} documents for other partners exist; not resetting`);
  await resetTransactions(sql);
  await sql`delete from item where company_id = ${co.id} and code = 'ZZDEMO'`;
  console.log("removed");
  await sql.end(); process.exit(0);
}

if ((await sql`select count(*)::int as n from document where company_id = ${co.id}`)[0].n) throw new Error("DEV has documents already; run --remove first");

const loc = await one(sql`select id from location where company_id = ${co.id} and code = 'MAIN-WH'`);
const item = await one(sql`
  insert into item (company_id, item_group_id, code, name, base_uom_id, valuation_method, is_stocked, tracks_batch, tracks_expiry,
                    is_active, serial, identity, tracks_serial, code_is_manual, name_is_custom)
  select company_id, item_group_id, 'ZZDEMO', 'ZZ Demo — Thai January bill (old ledger total)', base_uom_id, valuation_method,
         true, false, false, true, 'ZZDEMO', 'NONE', false, true, true
    from item where company_id = ${co.id} and code = 'LTC01'
  on conflict do nothing returning id`) ?? await one(sql`select id from item where company_id = ${co.id} and code = 'ZZDEMO'`);

const addDays = (d, n) => { const t = new Date(d + "T00:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };

/** Paid ahead of any bill: a supplier advance. */
const advance = async (date, cash, amount, ref, memo) => {
  const r = await P.postSupplierPayment({ companyId: co.id, partnerId: thai.id, docDate: date, cashAccountId: cash, allocations: [],
    advance: amount, reference: ref, memo, locationId: loc.id });
  console.log("advance", date, ref, amount, r.docNo);
  return r.id;
};
/** A bill, its goods arriving with it, the old ID kept as the import keeps it. */
const bill = async (date, ref, amount, memo) => {
  const r = await P.postPurchaseWithReceipt({ companyId: co.id, partnerId: thai.id, locationId: loc.id, docDate: date, dueDate: addDays(date, 30),
    memo, reference: null, receivedAt: null, lines: [{ itemId: item.id, qty: 1, unitPrice: amount }] });
  await sql`update document set source_ref = ${ref} where id = ${r.id} or id = (select source_document_id from document where id = ${r.id})`;
  console.log("bill", date, ref, amount, r.docNo);
  return r.id;
};
const apply = async (date, invoiceId, parts) => {
  await P.applyAdvance({ companyId: co.id, invoiceId, docDate: date, allocations: parts.map(([paymentId, amount]) => ({ paymentId, amount })) });
};
const pay = async (date, cash, ref, allocations, memo = null) => {
  const r = await P.postSupplierPayment({ companyId: co.id, partnerId: thai.id, docDate: date, cashAccountId: cash,
    allocations: allocations.map(([invoiceId, amount]) => ({ invoiceId, amount })), reference: ref, memo });
  console.log("payment", date, ref, allocations.reduce((s, a) => s + a[1], 0), r.docNo);
};

// 1 Jan — paid before the bill: 29.12.2025.
const a1 = await advance("2026-01-01", AYA, 76_509_554, "sa25120013", "29.12.2025");
const b1 = await bill("2026-01-07", "s126010015", 76_509_540, "07/01/2026 purchase file");
await apply("2026-01-07", b1, [[a1, 76_509_540]]);                       // 14 left on the advance
const a2 = await advance("2026-01-09", KBZ, 65_051_020, "sa26010001", null);
const b2 = await bill("2026-01-10", "s126010016", 65_051_000, "10/01/2026 purchase file");
await apply("2026-01-10", b2, [[a2, 65_051_000]]);                       // 20 left
// 12 Jan — five payments, each its own, in the old ledger's order.
const a3 = await advance("2026-01-12", AYA, 27_500_000, "sa26010008", null);
const a4 = await advance("2026-01-12", YOMA, 7_170_000, "sa26010006", null);
const a5 = await advance("2026-01-12", KBZ, 13_700_000, "sa26010002", null);
const a6 = await advance("2026-01-12", KBZ, 10_900_000, "sa26010003", null);
const a7 = await advance("2026-01-12", KBZ, 7_098_300, "sa26010004", null);
const b3 = await bill("2026-01-16", "s126010017", 66_368_300, "14/01/2026 purchase file");
await apply("2026-01-16", b3, [[a3, 27_500_000], [a4, 7_170_000], [a5, 13_700_000], [a6, 10_900_000], [a7, 7_098_300]]);
const b4 = await bill("2026-01-23", "s126010021", 23_604_660, "23.1.26");
await apply("2026-01-23", b4, [[a1, 14], [a2, 20]]);                    // the two remnants
const b5 = await bill("2026-01-26", "s126010025", 19_670_550, "26/01/2026");
// 26 Jan — paid against the bills.
await pay("2026-01-26", KBZ, "sa26010005", [[b4, 23_604_626], [b5, 395_374]]);
await pay("2026-01-26", AYA, "sa26010007", [[b5, 5_750_000]]);
const dn = await P.postDebitNote({ companyId: co.id, partnerId: thai.id, docDate: "2026-01-26", sourceDocumentId: b5, amount: 66,
  category: "DISCOUNT", reason: "Purchase discount (old system CBJN sa26010024)", reference: "sa26010024" });
console.log("debit note", dn.docNo ?? dn.id);
await pay("2026-01-26", NAN, null, [[b5, 10_300_000]], "Daw Nan Yu War");
// Paid 66 more than was left on the bill: the 66 waits as an advance for the next one.
const a8 = await advance("2026-01-26", NAN, 3_225_176, null, "Daw Nan Yu War");
await apply("2026-01-26", b5, [[a8, 3_225_110]]);
const b6 = await bill("2026-01-28", "fm26010036", 63_040_700, "9910*786");
await apply("2026-01-28", b6, [[a8, 66]]);
await bill("2026-01-30", "s126020001", 9_179_590, "30/01/2026");

console.log("done");
await sql.end();
