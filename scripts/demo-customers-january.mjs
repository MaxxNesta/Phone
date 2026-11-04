// Four customers' January 2026 from the old Customer Ledger, posted on DEV
// through the ordinary engine — to check the customer ledger reads as the old
// report did, township by township.
//
//   npx tsx scripts/demo-customers-january.mjs            the four customers
//   npx tsx scripts/demo-customers-january.mjs --advance  plus an example customer advance (C0361)
//
// DEV only, after demo-thai-january.mjs (it uses that demo item, ZZDEMO). The
// invoices' lines are not in the old ledger, only their totals, so each is one
// line of the demo item at the invoice's total, to be delivered later — revenue
// only, no stock moved. Taken out with demo-thai-january.mjs --remove, which
// empties every transaction.

const { sql } = await import("../lib/db.ts");
const P = await import("../lib/posting.ts");

const [co] = await sql`select id, name from company order by created_at limit 1`;
if (!/\bDEV\b/.test(co.name)) throw new Error("DEV only");
const one = async (q) => (await q)[0];
const item = await one(sql`select id from item where company_id = ${co.id} and code = 'ZZDEMO'`);
if (!item) throw new Error("Run demo-thai-january.mjs first");
const loc = await one(sql`select id from location where company_id = ${co.id} and code = 'MAIN-WH'`);
const acct = async (code) => (await one(sql`select id from account where company_id = ${co.id} and code = ${code}`)).id;
const MMQR = await acct("13207"), KBZ = await acct("13202"), UAB = await acct("13201");
const cust = async (code) => (await one(sql`select id from business_partner where company_id = ${co.id} and code = ${code}`)).id;

/** A sale, its goods to follow, the old reference kept. */
const sale = async (partner, date, ref, amount, memo) => {
  const r = await P.postSalesInvoice({ companyId: co.id, partnerId: partner, locationId: loc.id, docDate: date, dueDate: date,
    paymentType: "CREDIT", toDeliver: true, memo, lines: [{ itemId: item.id, qty: 1, unitPrice: amount }] });
  await sql`update document set source_ref = ${ref} where id = ${r.id}`;
  console.log("sale", date, ref, amount, r.docNo);
  return r.id;
};
const receipt = async (partner, date, cash, ref, invoiceId, amount, memo) => {
  const r = await P.postCustomerReceipt({ companyId: co.id, partnerId: partner, docDate: date, cashAccountId: cash,
    allocations: [{ invoiceId, amount }], reference: ref, memo });
  console.log("receipt", date, ref, amount, r.docNo);
};

// --advance: an example, not from the old ledger — money taken before the invoice
// (a customer advance), then the invoice, and the advance applied to it.
if (process.argv.includes("--advance")) {
  const ngwe = await cust("C0361");
  const r = await P.postCustomerReceipt({ companyId: co.id, partnerId: ngwe, docDate: "2026-01-20", cashAccountId: KBZ,
    allocations: [], advance: 1_500_000, locationId: loc.id, reference: "demo-adv-1", memo: "Example advance (not from the old ledger)" });
  console.log("advance 2026-01-20", r.docNo);
  const inv = await sale(ngwe, "2026-01-25", "demo-sale-1", 1_500_000, "Example sale against the advance");
  await P.applyAdvance({ companyId: co.id, invoiceId: inv, docDate: "2026-01-25", allocations: [{ paymentId: r.id, amount: 1_500_000 }] });
  console.log("applied");
  await sql.end(); process.exit(0);
}

if (!process.argv.includes("--advance")) {
const htet = await cust("C0265");
const h1 = await sale(htet, "2026-01-11", "c226010058", 2_380_000, "11/01/2026");
await receipt(htet, "2026-01-13", MMQR, "c226010058", h1, 2_380_000, "Htet Wai MMQR Cash နှင့်ရှင်း");
await sale(htet, "2026-01-30", "fm26010005", 5_800_000, null);

const tat = await cust("C0297");
const t1 = await sale(tat, "2026-01-31", "c226020024", 13_010_000, "31.1.26");
await receipt(tat, "2026-01-31", KBZ, "c226020024", t1, 13_010_000, "Tet Nay Woon Mobile KBZ Bank Ac ဝင်");

const zaw = await cust("C0360");
const z1 = await sale(zaw, "2026-01-18", "c226020003", 3_730_000, "18/01/2026");
await receipt(zaw, "2026-01-19", KBZ, "c226020003", z1, 3_730_000, "Mg Zaw Mobile KBZ Bank Ac ဝင်");

const yay = await cust("C0274");
const y1 = await sale(yay, "2026-01-22", "c226020011", 3_250_000, "22.1.26");
await receipt(yay, "2026-01-24", UAB, "c226020011", y1, 3_250_000, "ရေခဲတောင် (မုဒုံ) Mobile UAB Bank AC ဝင်");


console.log("done");
}
await sql.end();
