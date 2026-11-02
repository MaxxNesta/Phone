// Shareholders and share transfers against the real engine. DEV only;
// test shareholders are named "ZZ …" and removed, transactions emptied after.
//   npx tsx scripts/test-shares.mjs
import assert from "node:assert/strict";
import postgres from "postgres";
const sql = postgres(process.env.DATABASE_URL, { ssl: "require", prepare: false, max: 1, onnotice: () => {} });
const [co] = await sql`select id, name from company order by created_at limit 1`;
if (!/\bDEV\b/.test(co.name)) throw new Error("DEV only");
const [{ n: docs }] = await sql`select count(*)::int n from document`;
if (docs) throw new Error("DEV has transactions; this test empties them, so it will not run");
const { resetTransactions } = await import("./test-reset.mjs");
const S = await import("../lib/shares.ts");
const acct = async (code) => (await sql`select id from account where company_id = ${co.id} and code = ${code}`)[0].id;
const [equity, bank] = [await acct("31104"), await acct("13202")];
const base = { companyId: co.id, userId: null, shareType: "EQUITY", equityAccountId: equity, remarks: null };
const issue = (to, from, n, date = "2026-01-15") => S.postShareTransfer({ ...base, type: "ISSUE", date, fromShareholderId: null, toShareholderId: to, noOfShares: n, fromNo: from, rate: 10, assetAccountId: bank });
const holds = async (id) => (await S.listShareholders(co.id)).find((s) => s.id === id);

const made = [];
try {
  const elena = await S.createShareholder(co.id, { name: "ZZ Elena Brooks", isCompany: false }); made.push(elena.id);
  const marcus = await S.createShareholder(co.id, { name: "ZZ Marcus Lee", isCompany: false }); made.push(marcus.id);
  const horizon = await S.createShareholder(co.id, { name: "ZZ Horizon Ventures LLC", isCompany: true }); made.push(horizon.id);
  assert.equal((await holds(elena.id)).equity, 0, "a new shareholder holds nothing");
  assert.equal((await holds(elena.id)).folio_no, null, "no folio before the first shares");

  const i1 = await issue(elena.id, 1, 6000);
  await issue(marcus.id, 6001, 4000);
  await issue(horizon.id, 10001, 1000);
  assert.equal((await holds(elena.id)).equity, 6000);
  assert.match((await holds(elena.id)).folio_no, /^FN\d{5}$/, "folio given on the first issue");
  const j = await sql`select a.code, jl.base_amount::float amt from share_transfer t join journal_line jl on jl.journal_entry_id = t.journal_entry_id join account a on a.id = jl.account_id where t.id = ${i1.id} order by a.code`;
  assert.deepEqual(j.map((x) => [x.code, x.amt]), [["13202", 60000], ["31104", -60000]], "issue: Dr bank, Cr capital");

  await assert.rejects(() => issue(marcus.id, 5000, 10), /already issued/, "an issue cannot reuse numbers");

  // Elena → Horizon, 1,000 shares, 30 June.
  const tr = await S.postShareTransfer({ ...base, type: "TRANSFER", date: "2026-06-30", fromShareholderId: elena.id, toShareholderId: horizon.id, noOfShares: 1000, fromNo: 1, rate: 10, assetAccountId: null });
  assert.equal((await holds(elena.id)).equity, 5000);
  assert.equal((await holds(horizon.id)).equity, 2000);
  assert.equal((await sql`select journal_entry_id from share_transfer where id = ${tr.id}`)[0].journal_entry_id, null, "a transfer posts nothing");
  await assert.rejects(() => S.postShareTransfer({ ...base, type: "TRANSFER", date: "2026-07-01", fromShareholderId: elena.id, toShareholderId: marcus.id, noOfShares: 10, fromNo: 1, rate: 10, assetAccountId: null }), /holds/, "cannot transfer numbers already given away");

  // Buy back 500 from Marcus.
  await S.postShareTransfer({ ...base, type: "PURCHASE", date: "2026-08-01", fromShareholderId: marcus.id, toShareholderId: null, noOfShares: 500, fromNo: 6001, rate: 12, assetAccountId: bank });
  assert.equal((await holds(marcus.id)).equity, 3500);

  // The transfer depends on Elena's issue, so the issue cannot be cancelled; the transfer can.
  await assert.rejects(() => S.cancelShareTransfer(co.id, i1.id, "2026-09-01"), /cannot be cancelled/);
  await S.cancelShareTransfer(co.id, tr.id, "2026-09-01");
  assert.equal((await holds(elena.id)).equity, 6000, "cancelling gives the shares back");
  assert.equal((await holds(horizon.id)).equity, 1000);
  const [{ b }] = await sql`select coalesce(sum(jl.base_amount), 0)::float b from journal_line jl join account a on a.id = jl.account_id where a.code = '31104'`;
  assert.equal(b, -(60000 + 40000 + 10000 - 6000), "capital: three issues less the buy-back at 12");
  console.log("shares: all checks pass");
} finally {
  await resetTransactions(sql);
  if (made.length) await sql`delete from shareholder where id = any(${made})`;
  await sql.end();
}
