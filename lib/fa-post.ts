import type { TransactionSql } from "postgres";
import { sql } from "./db";
import { postJournalVoucher } from "./posting";
import { schedule, toUnits, fromUnits, sum, monthOf, type Convention, type Month } from "./fa-engine";

/**
 * A branch's depreciation for a month, from draft to the ledger.
 *
 * Draft: every active asset of the branch with depreciation planned for the
 * month gets a RUN row (no journal yet) under one fa_run. The one-live-run
 * index means a second draft for the same branch and month cannot exist.
 *
 * Post: the draft is recalculated and must still agree to the kyat, then one
 * journal voucher goes through the ordinary posting engine (period lock,
 * balance, numbering, branch) with a debit per expense account and a credit
 * per accumulated-depreciation account. Each asset row is pointed at the
 * credit line that carries it, and the lines must add up to the rows exactly
 * before anything commits. Depreciation never touches cash or bank.
 *
 * Both steps hold an advisory lock on (company, branch, month) for the
 * length of their transaction, so two people pressing Post together get one
 * voucher, and the second is told it is already posted.
 */

const lastDay = (m: Month) => {
  const [y, mo] = m.split("-").map(Number);
  return `${m}-${String(new Date(Date.UTC(y, mo, 0)).getUTCDate()).padStart(2, "0")}`;
};
const lock = (tx: TransactionSql, co: string, branchId: string, month: Month) =>
  tx`select pg_advisory_xact_lock(hashtextextended(${`fa-run:${co}:${branchId}:${month}`}, 0))`;

type Planned = { assetId: string; code: string; amount: bigint; opening: bigint; closing: bigint;
                 expenseAccountId: string; accumAccountId: string; residual: bigint; lastPlanned: boolean;
                 /** An earlier month of this asset still waiting to be posted. */
                 earlierOpen: Month | null };

/** What the branch should depreciate for the month, from the same engine every screen uses. */
async function planned(tx: TransactionSql, co: string, branchId: string, month: Month): Promise<Planned[]> {
  const [setting] = await tx`select start_convention from fa_setting where company_id = ${co}`;
  const fallback = (setting?.start_convention ?? "NEXT_MONTH") as Convention;
  const assets = await tx`
    select f.id, f.code, f.acquisition_cost::text as cost, f.residual_value::text as residual, f.useful_life_months,
           f.start_convention, to_char(f.in_service_date, 'YYYY-MM-DD') as in_service, to_char(f.disposed_on, 'YYYY-MM-DD') as disposed_on,
           c.expense_account_id, c.accum_account_id
      from fixed_asset f join fa_category c on c.id = f.category_id
     where f.company_id = ${co} and f.branch_id = ${branchId} and f.status = 'ACTIVE'
     order by f.code
       for update of f`;
  if (assets.length === 0) return [];
  const ids = (assets as any[]).map((a) => a.id);
  const [estimates, posted] = await Promise.all([
    tx`select asset_id, to_char(effective_month, 'YYYY-MM') as m, useful_life_months, residual_value::text as residual
         from fa_estimate_change where asset_id = any(${ids})`,
    tx`select asset_id, to_char(period_month, 'YYYY-MM') as m, sum(amount)::text as amount, bool_or(source = 'OPENING') as opening
         from fa_depreciation where asset_id = any(${ids}) and journal_line_id is not null group by 1, 2`,
  ]);
  const out: Planned[] = [];
  for (const a of assets as any[]) {
    const rows = schedule(
      { cost: toUnits(a.cost), residual: toUnits(a.residual), lifeMonths: a.useful_life_months, inService: a.in_service,
        convention: (a.start_convention ?? fallback) as Convention, disposedOn: a.disposed_on },
      { estimates: (estimates as any[]).filter((e) => e.asset_id === a.id)
          .map((e) => ({ from: e.m, lifeMonths: e.useful_life_months, residual: toUnits(e.residual) })),
        posted: new Map((posted as any[]).filter((p) => p.asset_id === a.id).map((p) => [p.m, toUnits(p.amount)])),
        openingThrough: (posted as any[]).find((p) => p.asset_id === a.id && p.opening)?.m ?? null });
    const r = rows.find((x) => x.month === month);
    if (!r || r.state !== "PLANNED" || r.amount <= 0n) continue;
    const earlier = rows.find((x) => x.month < month && x.state === "PLANNED" && x.amount > 0n);
    out.push({ assetId: a.id, code: a.code, amount: r.amount, opening: r.opening, closing: r.closing,
               expenseAccountId: a.expense_account_id, accumAccountId: a.accum_account_id, residual: r.residual,
               lastPlanned: rows.at(-1)!.month === month, earlierOpen: earlier?.month ?? null });
  }
  return out;
}

/** Everything that must hold before a month can be drafted or posted. */
async function checks(tx: TransactionSql, co: string, branchId: string, month: Month, now: Month, rows: Planned[]) {
  if (month > now) throw new Error(`${month} is still to come; a month posts once it has begun.`);
  if (rows.length === 0) throw new Error("Nothing is left to depreciate at this branch for that month.");
  // Months post in order, so the schedule never runs ahead of a gap.
  const gap = rows.map((r) => r.earlierOpen).filter(Boolean).sort()[0];
  if (gap) throw new Error(`${gap} is not posted yet for some of these assets; post it first.`);
  const date = lastDay(month);
  const [p] = await tx`select status from fiscal_period where company_id = ${co} and ${date}::date between start_date and end_date`;
  if (!p) throw new Error(`No fiscal period covers ${date}. Set the year up before posting.`);
  if (p.status !== "OPEN") throw new Error(`The period for ${month} is ${p.status.toLowerCase().replace("_", " ")}; nothing can post into it.`);
  const accounts = [...new Set(rows.flatMap((r) => [r.expenseAccountId, r.accumAccountId]))];
  const bad = await tx`select code from account where id = any(${accounts}) and not (is_active and is_postable)`;
  if (bad.length) throw new Error(`Account ${(bad as any[]).map((b) => b.code).join(", ")} is inactive or not postable; fix the category mapping first.`);
  const money = await tx`select code from account where id = any(${accounts}) and (is_cash_account or is_bank_account)`;
  if (money.length) throw new Error(`Account ${(money as any[]).map((b) => b.code).join(", ")} is a cash or bank account; depreciation never moves money.`);
  const [b] = await tx`select id from location where id = ${branchId} and company_id = ${co} and parent_id is null`;
  if (!b) throw new Error("That branch is not in this company.");
}

export async function draftRun(co: string, branchId: string, month: Month, userId: string, mode: "REVIEW" | "MANUAL", now: Month) {
  return sql.begin(async (tx) => {
    await lock(tx, co, branchId, month);
    const [live] = await tx`select id, status from fa_run where company_id = ${co} and branch_id = ${branchId}
                              and period_month = ${month + "-01"} and status in ('DRAFT', 'POSTED')`;
    if (live) return { id: live.id as string, status: live.status as string, existing: true };
    const rows = await planned(tx, co, branchId, month);
    await checks(tx, co, branchId, month, now, rows);
    const total = sum(rows.map((r) => r.amount));
    const [run] = await tx`
      insert into fa_run (company_id, branch_id, period_month, mode, status, total, created_by)
      values (${co}, ${branchId}, ${month + "-01"}, ${mode}, 'DRAFT', ${fromUnits(total)}, ${userId}) returning id`;
    await tx`insert into fa_depreciation ${tx(rows.map((r) => ({
      company_id: co, asset_id: r.assetId, period_month: `${month}-01`, source: "RUN", amount: fromUnits(r.amount),
      opening_nbv: fromUnits(r.opening), closing_nbv: fromUnits(r.closing), run_id: run.id, created_by: userId,
    })))}`;
    return { id: run.id as string, status: "DRAFT", existing: false };
  });
}

/** Discards a draft. Its rows carry no journal, so they go with it. */
export async function cancelRun(co: string, runId: string) {
  return sql.begin(async (tx) => {
    const [r] = await tx`select status from fa_run where id = ${runId} and company_id = ${co} for update`;
    if (!r) throw new Error("That run is not in this company.");
    if (r.status !== "DRAFT") throw new Error("Only a draft can be discarded; a posted run is corrected, not undone.");
    await tx`delete from fa_depreciation where run_id = ${runId} and journal_line_id is null`;
    await tx`update fa_run set status = 'CANCELLED' where id = ${runId}`;
  });
}

export async function postRun(co: string, runId: string, userId: string, now: Month) {
  return sql.begin(async (tx) => {
    const [head] = await tx`select branch_id, to_char(period_month, 'YYYY-MM') as month from fa_run where id = ${runId} and company_id = ${co}`;
    if (!head) throw new Error("That run is not in this company.");
    await lock(tx, co, head.branch_id, head.month);
    const [run] = await tx`
      select r.id, r.status, r.total::text as total, d.doc_no, b.name as branch
        from fa_run r join location b on b.id = r.branch_id left join document d on d.id = r.document_id
       where r.id = ${runId} for update of r`;
    // Someone else posted it while this request waited on the lock.
    if (run.status === "POSTED") return { docNo: run.doc_no as string, already: true };
    if (run.status !== "DRAFT") throw new Error(`This run is ${run.status.toLowerCase()}.`);

    const drafted = await tx`select id, asset_id, amount::text as amount from fa_depreciation where run_id = ${runId}`;
    const rows = await planned(tx, co, head.branch_id, head.month);
    await checks(tx, co, head.branch_id, head.month, now, rows);
    // The draft must still be what the engine says now, asset by asset.
    const want = new Map(rows.map((r) => [r.assetId, r.amount]));
    const same = (drafted as any[]).length === rows.length
      && (drafted as any[]).every((d) => want.get(d.asset_id) === toUnits(d.amount));
    if (!same) throw new Error("The assets or amounts changed since this draft was made. Discard it and prepare the month again.");

    // A debit per expense account, a credit per accumulated-depreciation account.
    const debit = new Map<string, bigint>(), credit = new Map<string, bigint>();
    for (const r of rows) {
      debit.set(r.expenseAccountId, (debit.get(r.expenseAccountId) ?? 0n) + r.amount);
      credit.set(r.accumAccountId, (credit.get(r.accumAccountId) ?? 0n) + r.amount);
    }
    const total = sum(rows.map((r) => r.amount));
    // The voucher takes numbers; a four-decimal figure survives the trip, and
    // the tie-out below compares the lines back to the rows exactly.
    const asNumber = (u: bigint) => Number(fromUnits(u));
    const monthName = new Date(`${head.month}-01T00:00:00Z`).toLocaleString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
    const doc = await postJournalVoucher({
      companyId: co, docDate: lastDay(head.month), locationId: head.branch_id,
      memo: `Depreciation ${monthName}, ${run.branch} (${rows.length} asset${rows.length === 1 ? "" : "s"})`,
      reference: `FA-DEP ${head.month}`,
      lines: [
        ...[...debit.entries()].map(([accountId, u]) => ({ accountId, amount: asNumber(u) })),
        ...[...credit.entries()].map(([accountId, u]) => ({ accountId, amount: -asNumber(u) })),
      ],
    }, tx);

    // Each asset row onto the credit line of its accumulated-depreciation account.
    const [entry] = await tx`select journal_entry_id from document where id = ${doc.id}`;
    const lines = await tx`select id, account_id, base_amount::text as amount from journal_line where journal_entry_id = ${entry.journal_entry_id}`;
    const lineFor = new Map((lines as any[]).filter((l) => l.amount.startsWith("-")).map((l) => [l.account_id, l]));
    for (const [accountId, u] of credit) {
      const l = lineFor.get(accountId);
      if (!l || toUnits(l.amount) !== -u) throw new Error("The voucher does not match the asset rows; nothing was posted.");
    }
    const byAsset = new Map(rows.map((r) => [r.assetId, r]));
    for (const d of drafted as any[]) {
      await tx`update fa_depreciation set journal_line_id = ${lineFor.get(byAsset.get(d.asset_id)!.accumAccountId).id} where id = ${d.id}`;
    }
    // The ledger and the subledger agree, line by line, before commit.
    const [tie] = await tx`
      select coalesce(sum(x.amount), 0)::text as rows, (select -sum(base_amount) from journal_line
              where journal_entry_id = ${entry.journal_entry_id} and base_amount < 0)::text as credits
        from fa_depreciation x where x.run_id = ${runId}`;
    if (toUnits(tie.rows) !== total || toUnits(tie.credits) !== total) throw new Error("The voucher and the asset rows do not add up; nothing was posted.");

    await tx`update fa_run set status = 'POSTED', document_id = ${doc.id}, journal_entry_id = ${entry.journal_entry_id},
               approved_by = ${userId}, posted_at = now() where id = ${runId}`;
    await tx`insert into fa_event ${tx(rows.map((r) => ({
      company_id: co, asset_id: r.assetId, event_type: "DEPRECIATION_POSTED", event_date: lastDay(head.month), created_by: userId,
      detail: { month: head.month, amount: fromUnits(r.amount), voucher: doc.docNo },
    })))}`;
    // An asset down to its residual with nothing more planned has finished.
    const done = rows.filter((r) => r.lastPlanned && r.closing <= r.residual).map((r) => r.assetId);
    if (done.length) await tx`update fixed_asset set status = 'FULLY_DEPRECIATED', updated_at = now() where id = any(${done})`;
    return { docNo: doc.docNo, already: false };
  });
}

/** Months up to now with depreciation still to post, per branch: what the popup offers. */
export async function readyToPost(co: string, branches: string[] | null, now: Month) {
  const { loadSchedules } = await import("./fa-schedule");
  const assets = (await loadSchedules(co, { branches })).filter((a) => a.status === "ACTIVE");
  const by = new Map<string, { branchId: string; branch: string; month: Month; amount: bigint; assets: number }>();
  for (const a of assets) for (const r of a.rows) {
    if (r.state !== "PLANNED" || r.amount <= 0n || r.month > now) continue;
    const k = `${a.branchId}|${r.month}`;
    const e = by.get(k) ?? { branchId: a.branchId, branch: a.branch, month: r.month, amount: 0n, assets: 0 };
    e.amount += r.amount; e.assets++;
    by.set(k, e);
  }
  // Only months that can post: their last day falls in an open period.
  const months = [...new Set([...by.values()].map((e) => e.month))];
  const open = new Set(months.length ? ((await sql`
    select m from unnest(${months}::text[]) m
     where exists (select 1 from fiscal_period p where p.company_id = ${co} and p.status = 'OPEN'
                     and ((m || '-01')::date + interval '1 month - 1 day')::date between p.start_date and p.end_date)`) as any[]).map((r) => r.m) : []);
  return [...by.values()].filter((e) => open.has(e.month))
    .sort((x, y) => x.month.localeCompare(y.month) || x.branch.localeCompare(y.branch));
}

export const currentMonth = () => monthOf(new Date(Date.now() + 6.5 * 3600_000).toISOString().slice(0, 10));
