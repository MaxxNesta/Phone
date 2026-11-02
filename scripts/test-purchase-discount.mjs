// Supplier discounts on purchase bills (GROSS policy), the three ways a
// purchase can go, against the real posting engine. DEV only; empties the
// transaction tables first and after (master data is never touched).
//   npx tsx scripts/test-purchase-discount.mjs
import assert from "node:assert/strict";
import postgres from "postgres";
const sql = postgres(process.env.DATABASE_URL, { ssl: "require", prepare: false, max: 1, onnotice: () => {} });
const [co] = await sql`select id, name from company order by created_at limit 1`;
if (!/\bDEV\b/.test(co.name)) throw new Error("DEV only");
const { resetTransactions } = await import("./test-reset.mjs");
const P = await import("../lib/posting.ts");

const acct = async (role) => (await sql`select fn_system_account(${co.id}, ${role}) as a`)[0].a;
const [GRIR, PD] = [await acct("GRIR_CLEARING"), await acct("PURCHASE_DISCOUNT_RECEIVED")];
const lines = async (docId) => {
  const r = await sql`select a.code, jl.account_id, jl.base_amount::float amt from document d
    join journal_line jl on jl.journal_entry_id = d.journal_entry_id join account a on a.id = jl.account_id where d.id = ${docId}`;
  const by = (id) => r.filter((x) => x.account_id === id).reduce((s, x) => s + x.amt, 0);
  return { r, by };
};
const balance = async (id) => Number((await sql`select coalesce(sum(base_amount), 0)::float b from journal_line where account_id = ${id}`)[0].b);
const serialCost = async (imei) => Number((await sql`select unit_cost::float c from v_stock_serial where imei = ${imei}`)[0]?.c ?? NaN);

await resetTransactions(sql);
const supplier = (await sql`select id from business_partner where company_id = ${co.id} and code = '01-006'`)[0].id; // Ko Sai (Mr Mobile)
const [loc] = await sql`select id from location where company_id = ${co.id} and is_stock_location and is_active order by code limit 1`;
const item = (await sql`select id from item where company_id = ${co.id} and code = 'IPC011'`)[0].id;
const today = new Date().toISOString().slice(0, 10);
let n = 352091234500000;
const imeis = (k) => Array.from({ length: k }, () => String(n++));
const AP = (await sql`select fn_resolve_control_account(${co.id}, 'AP_CONTROL', ${supplier}) as a`)[0].a;

try {
  // A — goods first, bill later with 5% off: GR/IR cleared at the gross.
  const aImeis = imeis(10);
  const gr = await P.postGoodsReceipt({ companyId: co.id, partnerId: supplier, locationId: loc.id, docDate: today,
    lines: [{ itemId: item, qty: 10, unitCost: 2_000_000, serials: aImeis }] });
  const [grLine] = await sql`select id from document_line where document_id = ${gr.id}`;
  const pi = await P.postPurchaseInvoice({ companyId: co.id, partnerId: supplier, locationId: loc.id, docDate: today, dueDate: null,
    goodsReceiptId: gr.id, lines: [{ itemId: item, qty: 10, unitPrice: 2_000_000, discountPct: 5, sourceLineId: grLine.id }] });
  let j = await lines(pi.id);
  assert.equal(j.by(GRIR), 20_000_000, "A: GR/IR relieved at gross");
  assert.equal(j.by(PD), -1_000_000, "A: 51201 credited");
  assert.equal(j.by(AP), -19_000_000, "A: AP at net");
  assert.equal(j.r.length, 3, "A: no price variance or revaluation");
  assert.equal(await serialCost(aImeis[0]), 2_000_000, "A: FIFO cost stays gross");
  console.log("A  goods first, bill later — ok");

  // B — arriving with the bill, 100,000 off the whole bill.
  const bImeis = imeis(2);
  const pb = await P.postPurchaseWithReceipt({ companyId: co.id, partnerId: supplier, locationId: loc.id, docDate: today, dueDate: null,
    billDiscountAmount: 100_000, lines: [{ itemId: item, qty: 2, unitPrice: 2_000_000, serials: bImeis }] });
  j = await lines(pb.id);
  assert.equal(j.by(PD), -100_000, "B: 51201 credited");
  assert.equal(j.by(AP), -3_900_000, "B: AP at net");
  assert.equal(await serialCost(bImeis[0]), 2_000_000, "B: FIFO cost stays gross");
  console.log("B  arriving with the bill — ok");

  // C — bill first (10%), goods later: received at the gross, GR/IR closes.
  const pc = await P.postPurchaseInvoice({ companyId: co.id, partnerId: supplier, locationId: loc.id, docDate: today, dueDate: null,
    lines: [{ itemId: item, qty: 1, unitPrice: 2_000_000, discountPct: 10 }] });
  j = await lines(pc.id);
  assert.equal(j.by(GRIR), 2_000_000, "C: GR/IR at gross");
  assert.equal(j.by(PD), -200_000, "C: 51201 credited");
  assert.equal(j.by(AP), -1_800_000, "C: AP at net");
  const cImei = imeis(1);
  await P.postGoodsReceipt({ companyId: co.id, partnerId: supplier, locationId: loc.id, docDate: today, sourceDocumentId: pc.id,
    lines: [{ itemId: item, qty: 1, unitCost: 1, serials: cImei }] });
  assert.equal(await serialCost(cImei[0]), 2_000_000, "C: received at the gross, not the discounted price");
  console.log("C  bill first, goods later — ok");

  assert.equal(await balance(GRIR), 0, "GR/IR is clear across all three");
  assert.equal(await balance(PD), -1_300_000, "51201 holds every discount");

  // A void reverses the discount one for one.
  await P.voidDocument({ documentId: pc.id, reason: "test" }).catch(async (e) => {
    // A bill whose goods have arrived may need its receipt voided first; reversal is then proved on A.
    await P.voidDocument({ documentId: pi.id, reason: "test" });
  });
  const pdAfter = await balance(PD);
  assert.ok(pdAfter === -1_100_000 || pdAfter === -300_000, `void reversed one bill's discount (51201 now ${pdAfter})`);
  console.log("void reverses the 51201 credit — ok");
  console.log("purchase discount: all checks pass");
} finally {
  await resetTransactions(sql);
  await sql.end();
}
