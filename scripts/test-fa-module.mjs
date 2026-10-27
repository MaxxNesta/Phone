// Fixed assets against the real posting engine, on DEV.
//
//   npx tsx scripts/test-fa-module.mjs
//
// Its own assets (codes ZZT-…) at two branches, one used at Branch 2 but
// posting to Head Office. Runs a year of depreciation and checks, at every
// step, that the vouchers are right, that nothing posts twice (concurrently,
// over a manual journal, out of order), that closed periods and broken
// mappings are refused, that transfers and disposals post what they should,
// that branch permissions hold, and that the register ties to the General
// Ledger branch by branch and company-wide.
//
// Destructive like every DEV suite: it resets transactions. It removes only
// the assets it made; the real catalogue and the shop's real assets are not
// touched (it refuses to run if any non-test asset exists).

import assert from "node:assert/strict";
import postgres from "postgres";
import { takeTestLock, releaseTestLock } from "./test-lock.mjs";

const sql = postgres(process.env.DATABASE_URL, { ssl: "require", prepare: false, max: 1, onnotice: () => {} });
const [co] = await sql`select id, name from company order by created_at limit 1`;
if (!/\bDEV\b/.test(co.name)) throw new Error("DEV only");
const real = await sql`select count(*)::int as n from fixed_asset where company_id = ${co.id} and code not like 'ZZT-%' and code not like 'ZZFA-%'`;
if (real[0].n) throw new Error(`Refusing: ${real[0].n} real fixed assets exist on this database.`);
await takeTestLock(sql, "fa-module");

const P = await import("../lib/posting.ts");
const F = await import("../lib/fa-post.ts");
const M = await import("../lib/fa-move.ts");
const R = await import("../lib/fa-reports.ts");
const A = await import("../lib/fa-access.ts");
const { resetTransactions } = await import("./test-reset.mjs");

let passed = 0;
const step = async (name, fn) => { await fn(); passed++; console.log(`  ok  ${name}`); };
const refuses = async (fn, re) => {
  try { await fn(); } catch (e) { assert.match(e.message, re); return; }
  assert.fail(`expected a refusal matching ${re}`);
};
const acc = async (code) => (await sql`select id from account where company_id = ${co.id} and code = ${code}`)[0].id;
const branch = async (name) => (await sql`select id from location where company_id = ${co.id} and parent_id is null and name = ${name}`)[0].id;
const cat = async (code) => (await sql`select id from fa_category where company_id = ${co.id} and code = ${code}`)[0].id;
const [admin] = await sql`select id from app_user where company_id = ${co.id} and role = 'ADMIN' order by created_at limit 1`;
const NOW = "2026-10"; // the posting run's "current month"
const HO = await branch("Head Office"), B2 = await branch("Branch 2");

async function cleanup() {
  // Its own assets and the throwaway demo ones (scripts/_demo-fa.mjs), nothing else.
  const ids = (await sql`select id from fixed_asset where company_id = ${co.id} and (code like 'ZZT-%' or code like 'ZZFA-%')`).map((r) => r.id);
  // Postings first, all at once: the reset truncates journals, runs and asset
  // rows together (a posted row is never deleted one by one).
  await resetTransactions(sql);
  await sql`delete from fa_event where asset_id = any(${ids})`;
  await sql`delete from fa_estimate_change where asset_id = any(${ids})`;
  await sql`delete from fa_journal_link where asset_id = any(${ids})`;
  await sql`delete from fixed_asset where id = any(${ids})`;
}

/** The voucher a run posted: its lines by account code, debit positive. */
async function voucher(runId) {
  const lines = await sql`
    select a.code, jl.base_amount::float as amount, coalesce(l.parent_id, l.id) as branch_id
      from fa_run r join journal_line jl on jl.journal_entry_id = r.journal_entry_id
      join account a on a.id = jl.account_id left join location l on l.id = jl.location_id
     where r.id = ${runId} order by a.code`;
  return Object.fromEntries(lines.map((l) => [l.code, l.amount]));
}
const post = async (branchId, month) => {
  const d = await F.draftRun(co.id, branchId, month, admin.id, "REVIEW", NOW);
  await F.postRun(co.id, d.id, admin.id, NOW);
  return d.id;
};
const linkManual = async (docId, assetId, month, amount) => {
  const [l] = await sql`select jl.id from journal_line jl join document d on d.journal_entry_id = jl.journal_entry_id where d.id = ${docId} and jl.base_amount < 0`;
  await sql`insert into fa_depreciation (company_id, asset_id, period_month, source, amount, journal_line_id, is_link)
            values (${co.id}, ${assetId}, ${month + "-01"}, 'HISTORICAL', ${amount}, ${l.id}, true)`;
};

try {
  await cleanup();
  await sql`update fa_setting set posting_mode = 'REVIEW', start_convention = 'NEXT_MONTH' where company_id = ${co.id}`;
  const mk = async (code, name, catCode, branchId, inService, cost, residual, life, postingBranch = null) => (await sql`
    insert into fixed_asset (company_id, code, name, category_id, branch_id, posting_branch_id, acquisition_date, in_service_date,
                             acquisition_cost, residual_value, useful_life_months, status)
    values (${co.id}, ${code}, ${name}, ${await cat(catCode)}, ${branchId}, ${postingBranch}, ${inService}, ${inService}, ${cost}, ${residual}, ${life}, 'ACTIVE')
    returning id`)[0].id;
  const gen = await mk("ZZT-GEN", "Generator", "11301", B2, "2025-04-10", 12_000_000, 600_000, 60);
  const pc = await mk("ZZT-PC", "Computers", "11403", HO, "2025-04-02", 3_900_000, 0, 36);
  // Used at Branch 2, depreciates at Head Office by policy.
  const ac = await mk("ZZT-AC", "Air conditioner", "11404", B2, "2025-05-01", 2_600_000, 100_000, 48, HO);

  // Acquisitions through the ledger, at the branch each depreciates at, and linked.
  const cap = await acc("31105");
  for (const [id, code, amount, at] of [[gen, "11301", 12_000_000, B2], [pc, "11403", 3_900_000, HO], [ac, "11404", 2_600_000, HO]]) {
    const r = await P.postJournalVoucher({ companyId: co.id, docDate: "2025-04-01", locationId: at, memo: `ZZT acquisition ${code}`,
      lines: [{ accountId: await acc(code), amount }, { accountId: cap, amount: -amount }] });
    const [l] = await sql`select jl.id from journal_line jl join document d on d.journal_entry_id = jl.journal_entry_id where d.id = ${r.id} and jl.base_amount > 0`;
    await sql`insert into fa_journal_link (company_id, asset_id, journal_line_id, kind, amount) values (${co.id}, ${id}, ${l.id}, 'ACQUISITION', ${amount})`;
  }

  await step("May 2025: one voucher per branch, grouped by account, exact", async () => {
    const b2 = await voucher(await post(B2, "2025-05"));
    assert.deepEqual(b2, { "12109": -190_000, "66301": 190_000 });
    const ho = await voucher(await post(HO, "2025-05"));
    assert.deepEqual(ho, { "12103": -108_333, "66403": 108_333 }, "the AC starts in June; it posts at Head Office, not Branch 2");
  });

  await step("asset rows tie to the voucher's credit lines", async () => {
    const t = await sql`
      select r.id, (select sum(x.amount) from fa_depreciation x where x.run_id = r.id)::float as rows,
             (select -sum(base_amount) from journal_line where journal_entry_id = r.journal_entry_id and base_amount < 0)::float as credits,
             (select sum(base_amount) from journal_line where journal_entry_id = r.journal_entry_id)::float as net,
             (select count(*) from journal_line jl join account a on a.id = jl.account_id
               where jl.journal_entry_id = r.journal_entry_id and (a.is_cash_account or a.is_bank_account))::int as cash
        from fa_run r where r.company_id = ${co.id} and r.status = 'POSTED'`;
    for (const r of t) { assert.equal(r.rows, r.credits); assert.equal(r.net, 0); assert.equal(r.cash, 0); }
  });

  await step("June 2025, Head Office: the AC (used at Branch 2) lands on Head Office's voucher", async () => {
    const ho = await voucher(await post(HO, "2025-06"));
    assert.deepEqual(ho, { "12103": -108_333, "12104": -52_083, "66403": 108_333, "66404": 52_083 });
  });

  await step("a posted month is not posted again, even by two at once", async () => {
    const [a, b] = await Promise.all([F.draftRun(co.id, B2, "2025-06", admin.id, "REVIEW", NOW), F.draftRun(co.id, B2, "2025-06", admin.id, "REVIEW", NOW)]);
    assert.equal(a.id, b.id);
    const res = await Promise.all([F.postRun(co.id, a.id, admin.id, NOW), F.postRun(co.id, a.id, admin.id, NOW)]);
    assert.equal(res.filter((r) => r.already).length, 1);
    const [{ n }] = await sql`select count(*)::int as n from fa_run where company_id = ${co.id} and branch_id = ${B2} and period_month = '2025-06-01' and status = 'POSTED'`;
    assert.equal(n, 1);
    const again = await F.draftRun(co.id, B2, "2025-06", admin.id, "REVIEW", NOW);
    assert.ok(again.existing);
  });

  await step("months post in order", async () => {
    await refuses(() => F.draftRun(co.id, B2, "2025-08", admin.id, "REVIEW", NOW), /2025-07 is not posted yet/);
  });

  await step("a future month and a closed period are refused", async () => {
    await refuses(() => F.draftRun(co.id, B2, "2027-01", admin.id, "REVIEW", NOW), /still to come/);
    const [p] = await sql`select id from fiscal_period where company_id = ${co.id} and '2025-07-31' between start_date and end_date`;
    await sql`update fiscal_period set status = 'CLOSED' where id = ${p.id}`;
    try { await refuses(() => F.draftRun(co.id, B2, "2025-07", admin.id, "REVIEW", NOW), /is closed/); }
    finally { await sql`update fiscal_period set status = 'OPEN' where id = ${p.id}`; }
  });

  await step("a category whose account cannot be posted to is refused", async () => {
    const id = await acc("12109");
    await sql`update account set is_active = false where id = ${id}`;
    try { await refuses(() => F.draftRun(co.id, B2, "2025-07", admin.id, "REVIEW", NOW), /12109 is inactive/); }
    finally { await sql`update account set is_active = true where id = ${id}`; }
  });

  await step("manual depreciation not yet linked blocks the month; linked, it is never posted again", async () => {
    const r = await P.postJournalVoucher({ companyId: co.id, docDate: "2025-07-31", locationId: B2, memo: "ZZT July by hand",
      lines: [{ accountId: await acc("66301"), amount: 190_000 }, { accountId: await acc("12109"), amount: -190_000 }] });
    await refuses(() => F.draftRun(co.id, B2, "2025-07", admin.id, "REVIEW", NOW), /by hand in 2025-07 and is not linked/);
    await linkManual(r.id, gen, "2025-07", 190_000);
    await refuses(() => F.draftRun(co.id, B2, "2025-07", admin.id, "REVIEW", NOW), /Nothing is left to depreciate/);
  });

  await step("a journal line cannot be linked for more than it carries", async () => {
    const [l] = await sql`select journal_line_id as id from fa_depreciation where asset_id = ${gen} and period_month = '2025-07-01'`;
    await refuses(() => sql.begin(async (tx) => {
      await tx`set constraints all immediate`;
      await tx`insert into fa_depreciation (company_id, asset_id, period_month, source, amount, journal_line_id, is_link)
               values (${co.id}, ${pc}, '2025-07-01', 'HISTORICAL', 1, ${l.id}, true)`;
    }), /its links to assets would come to/);
  });

  await step("posted depreciation is never edited or deleted", async () => {
    await refuses(() => sql`update fa_depreciation set amount = 1 where source = 'RUN' and asset_id = ${pc} and period_month = '2025-05-01'`, /not edited/);
    await refuses(() => sql`delete from fa_depreciation where source = 'RUN' and asset_id = ${pc} and period_month = '2025-05-01'`, /not deleted/);
  });

  await step("transfer moves cost and accumulated depreciation between branches, history kept", async () => {
    await post(HO, "2025-07");
    const { docNo } = await M.transferAsset(co.id, admin.id, { assetId: gen, toBranchId: HO, date: "2025-08-05", note: "ZZT" });
    assert.ok(docNo);
    const gl = await sql`
      select a.code, coalesce(l.parent_id, l.id) as b, sum(jl.base_amount)::float as bal
        from journal_line jl join account a on a.id = jl.account_id left join location l on l.id = jl.location_id
       where jl.company_id = ${co.id} and a.code in ('11301', '12109') group by 1, 2`;
    const at = (code, b) => gl.find((g) => g.code === code && g.b === b)?.bal ?? 0;
    assert.equal(at("11301", B2), 0); assert.equal(at("11301", HO), 12_000_000);
    assert.equal(at("12109", B2), 0); assert.equal(at("12109", HO), -570_000);
    const [g] = await sql`select branch_id, posting_branch_id from fixed_asset where id = ${gen}`;
    assert.equal(g.branch_id, HO); assert.equal(g.posting_branch_id, null);
  });

  await step("August posts at the generator's new branch", async () => {
    const ho = await voucher(await post(HO, "2025-08"));
    assert.equal(ho["66301"], 190_000);
    assert.equal(ho["66403"], 108_333);
    const b2 = await sql`select count(*)::int as n from fa_run where company_id = ${co.id} and branch_id = ${B2} and period_month = '2025-08-01'`;
    assert.equal(b2[0].n, 0);
  });

  await step("disposal waits for depreciation to the cutoff, then posts cost, accumulated, proceeds and gain", async () => {
    const [s] = await sql`select gain_account_id, loss_account_id from fa_setting where company_id = ${co.id}`;
    await sql`update fa_setting set gain_account_id = ${await acc("41301")}, loss_account_id = ${await acc("66101")} where company_id = ${co.id}`;
    try {
      const cash = await acc("13101");
      await refuses(() => M.disposeAsset(co.id, admin.id, { assetId: pc, date: "2025-10-15", reason: "ZZT sold", proceeds: "3500000", proceedsAccountId: cash }),
        /through 2025-09 is not all posted/);
      await post(HO, "2025-09");
      const p = await M.disposalPreview(co.id, { assetId: pc, date: "2025-10-15", proceeds: "3500000", proceedsAccountId: cash });
      assert.equal(p.accumulated, "541665.0000");                  // May–Sep: 108,333 × 5
      assert.equal(p.nbv, "3358335.0000");
      assert.equal(p.gain, "141665.0000");
      const { docNo } = await M.disposeAsset(co.id, admin.id, { assetId: pc, date: "2025-10-15", reason: "ZZT sold", proceeds: "3500000", proceedsAccountId: cash });
      const lines = await sql`select a.code, jl.base_amount::float as v from document d join journal_line jl on jl.journal_entry_id = d.journal_entry_id
                                join account a on a.id = jl.account_id where d.doc_no = ${docNo} order by a.code`;
      assert.deepEqual(Object.fromEntries(lines.map((l) => [l.code, l.v])), { "11403": -3_900_000, "12103": 541_665, "13101": 3_500_000, "41301": -141_665 });
      // October: no depreciation for a disposed asset.
      const ho = await voucher(await post(HO, "2025-10"));
      assert.equal(ho["66403"], undefined);
    } finally {
      await sql`update fa_setting set gain_account_id = ${s.gain_account_id}, loss_account_id = ${s.loss_account_id} where company_id = ${co.id}`;
    }
  });

  await step("branch permissions: company accountant posts any branch, branch accountant only theirs, branch manager views", async () => {
    const companyAcct = { id: admin.id, companyId: co.id, role: "ACCOUNTANT", branchId: null, seesAllBranches: true };
    const branchAcct = { id: admin.id, companyId: co.id, role: "ACCOUNTANT", branchId: B2, seesAllBranches: false };
    const branchMgr = { id: admin.id, companyId: co.id, role: "MANAGER", branchId: HO, seesAllBranches: false };
    const owner = { id: admin.id, companyId: co.id, role: "ADMIN", branchId: null, seesAllBranches: false };
    await A.assertFaBranch(companyAcct, HO, B2);
    await A.assertFaBranch(owner, HO, B2);
    await A.assertFaBranch(branchAcct, B2);
    await refuses(() => A.assertFaBranch(branchAcct, HO), /not one you are authorised for/);
    assert.equal(A.canPostFa(branchMgr), false);
    await refuses(() => A.assertFaBranch(branchMgr, HO), /views this branch/);
  });

  await step("the register ties to the General Ledger, branch by branch and company-wide", async () => {
    const rows = await R.reconciliationReport(co.id, { from: "2025-04-01", to: "2025-10-31", branches: null });
    const ours = rows.filter((r) => ["11301", "11403", "11404", "12109", "12103", "12104"].includes(r.account));
    assert.ok(ours.length >= 6);
    for (const r of ours) assert.equal(r.difference, "0.0000", `${r.account} ${r.branch}: register ${r.register}, ledger ${r.ledger}`);
    // Company-wide is the sum of branches: accumulated on the ledger equals all depreciation recorded.
    const [{ dep }] = await sql`select coalesce(sum(x.amount), 0)::float as dep from fa_depreciation x join fixed_asset f on f.id = x.asset_id
                                 where f.code like 'ZZT-%' and f.status <> 'DISPOSED' and x.journal_line_id is not null`;
    const accum = ours.filter((r) => r.side === "Accumulated").reduce((s, r) => s + Number(r.ledger), 0);
    assert.equal(accum, dep);
  });

  console.log(`\nfa-module: ${passed} passed`);
} finally {
  await cleanup().catch((e) => console.error("cleanup:", e.message));
  await releaseTestLock(sql).catch(() => {});
  await sql.end();
}
process.exit(0);
