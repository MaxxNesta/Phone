import type { TransactionSql } from "postgres";
import { sql } from "./db";
import { postJournalVoucher } from "./posting";
import { schedule, toUnits, fromUnits, sum, monthOf, disposalCutoff, type Convention, type Month } from "./fa-engine";


/**
 * Moving an asset between branches, and taking it off the books. Both post an
 * ordinary journal voucher through the posting engine, so the period lock,
 * the balance check and the numbering are the ledger's own.
 */

const asNumber = (u: bigint) => Number(fromUnits(u));

/** The asset with its schedule as the ledger stands, for a given disposal date (or none). */
async function loadOne(tx: TransactionSql, co: string, assetId: string, disposedOn: string | null) {
  const [a] = await tx`
    select f.*, f.acquisition_cost::text as cost, f.residual_value::text as residual,
           to_char(f.in_service_date, 'YYYY-MM-DD') as in_service, to_char(f.acquisition_date, 'YYYY-MM-DD') as acquired, c.asset_account_id, c.accum_account_id, c.name as category,
           (select start_convention from fa_setting where company_id = f.company_id) as company_convention
      from fixed_asset f join fa_category c on c.id = f.category_id
     where f.id = ${assetId} and f.company_id = ${co} for update of f`;
  if (!a) throw new Error("That asset is not in this company.");
  const [estimates, posted] = await Promise.all([
    tx`select to_char(effective_month, 'YYYY-MM') as m, useful_life_months, residual_value::text as residual
         from fa_estimate_change where asset_id = ${assetId}`,
    tx`select to_char(period_month, 'YYYY-MM') as m, sum(amount)::text as amount, bool_or(source = 'OPENING') as opening
         from fa_depreciation where asset_id = ${assetId} and journal_line_id is not null group by 1`,
  ]);
  const engine = { cost: toUnits(a.cost), residual: toUnits(a.residual), lifeMonths: a.useful_life_months, inService: a.in_service,
    convention: (a.start_convention ?? a.company_convention ?? "NEXT_MONTH") as Convention, disposedOn };
  const rows = schedule(engine, {
    estimates: (estimates as any[]).map((e) => ({ from: e.m, lifeMonths: e.useful_life_months, residual: toUnits(e.residual) })),
    posted: new Map((posted as any[]).map((p) => [p.m, toUnits(p.amount)])),
    openingThrough: (posted as any[]).find((p) => p.opening)?.m ?? null,
  });
  const accumulated = sum((posted as any[]).map((p) => toUnits(p.amount)));
  const lastPosted = (posted as any[]).map((p) => p.m as string).sort().at(-1) ?? null;
  return { a, engine, rows, accumulated, lastPosted };
}

async function openPeriod(tx: TransactionSql, co: string, date: string) {
  const [p] = await tx`select status from fiscal_period where company_id = ${co} and ${date}::date between start_date and end_date`;
  if (!p) throw new Error(`No fiscal period covers ${date}.`);
  if (p.status !== "OPEN") throw new Error(`The period for ${date} is ${p.status.toLowerCase().replace("_", " ")}; nothing can post into it.`);
}

// ------------------------------------------------------------- transfer --

export async function transferAsset(co: string, userId: string, input: { assetId: string; toBranchId: string; date: string; note: string | null }) {
  return sql.begin(async (tx) => {
    const { a, accumulated, lastPosted } = await loadOne(tx, co, input.assetId, null);
    if (!["ACTIVE", "INACTIVE", "FULLY_DEPRECIATED"].includes(a.status)) throw new Error("Only an asset in service can be transferred.");
    if (a.branch_id === input.toBranchId) throw new Error("It is already at that branch.");
    // Cost and depreciation sit where it posts; after the move it posts where it is used.
    const fromPost = (a.posting_branch_id ?? a.branch_id) as string;
    const [to] = await tx`select id, name from location where id = ${input.toBranchId} and company_id = ${co} and parent_id is null and is_active`;
    if (!to) throw new Error("Choose the branch it moves to.");
    if (input.date < (a.in_service ?? a.acquired)) throw new Error("It cannot move before it was in service.");
    // A month already posted at the old branch after the move would leave its
    // depreciation in the wrong branch; that is a correction, not a transfer.
    if (lastPosted && lastPosted > monthOf(input.date)) {
      throw new Error(`Depreciation is posted at the old branch up to ${lastPosted}; date the transfer in or after that month.`);
    }
    const [draft] = await tx`select 1 from fa_depreciation where asset_id = ${a.id} and journal_line_id is null limit 1`;
    if (draft) throw new Error("A depreciation draft is waiting for this asset; post or discard it first.");
    await openPeriod(tx, co, input.date);

    // Cost and accumulated depreciation leave one branch and arrive at the
    // other, on the same accounts: the original cost and history are kept.
    const cost = toUnits(a.cost);
    const lines = [
      ...(cost > 0n ? [{ accountId: a.asset_account_id, amount: asNumber(cost), locationId: input.toBranchId },
                       { accountId: a.asset_account_id, amount: -asNumber(cost), locationId: fromPost }] : []),
      ...(accumulated > 0n ? [{ accountId: a.accum_account_id, amount: asNumber(accumulated), locationId: fromPost },
                              { accountId: a.accum_account_id, amount: -asNumber(accumulated), locationId: input.toBranchId }] : []),
    ];
    let voucher: { id: string; docNo: string } | null = null;
    if (lines.length && fromPost !== input.toBranchId) {
      voucher = await postJournalVoucher({
        companyId: co, docDate: input.date, locationId: fromPost, lines,
        memo: `Transfer of ${a.code} ${a.name} to ${to.name}`, reference: `FA-TRF ${a.code}`,
      }, tx);
      const jl = await tx`select jl.id, jl.base_amount::text as amount from journal_line jl join document d on d.journal_entry_id = jl.journal_entry_id where d.id = ${voucher.id}`;
      await tx`insert into fa_journal_link ${tx((jl as any[]).map((l) => ({
        company_id: co, asset_id: a.id, journal_line_id: l.id, kind: "OTHER", amount: l.amount.replace("-", ""), created_by: userId, note: "Transfer" })))}`;
    }
    await tx`update fixed_asset set branch_id = ${input.toBranchId}, posting_branch_id = null, updated_at = now() where id = ${a.id}`;
    await tx`insert into fa_event (company_id, asset_id, event_type, event_date, from_branch_id, to_branch_id, created_by, detail)
             values (${co}, ${a.id}, 'TRANSFERRED', ${input.date}, ${a.branch_id}, ${input.toBranchId}, ${userId},
                     ${tx.json({ note: input.note, voucher: voucher?.docNo ?? null, cost: fromUnits(cost), accumulated: fromUnits(accumulated) })})`;
    return { docNo: voucher?.docNo ?? null };
  });
}

// ------------------------------------------------------------- disposal --

export type DisposalPreview = {
  cutoff: Month | null; cost: string; accumulated: string; nbv: string; proceeds: string; gain: string;
  lines: { accountId: string; code: string; name: string; debit: string; credit: string }[];
  blockers: string[];
};

/** What a disposal on a date would post, and what stops it, before anyone posts it. */
export async function disposalPreview(co: string, input: { assetId: string; date: string; proceeds: string; proceedsAccountId: string | null }, outer?: TransactionSql): Promise<DisposalPreview> {
  const run = async (tx: TransactionSql) => {
    const { a, engine, rows, accumulated, lastPosted } = await loadOne(tx, co, input.assetId, input.date);
    const blockers: string[] = [];
    if (!["ACTIVE", "INACTIVE", "FULLY_DEPRECIATED"].includes(a.status)) blockers.push("Only an asset in service can be disposed of.");
    const cut = disposalCutoff(engine)?.month ?? null;
    const owed = rows.filter((r) => r.state === "PLANNED" && r.amount > 0n && cut && r.month <= cut);
    if (owed.length) blockers.push(`Depreciation through ${cut} is not all posted (${owed[0].month} is next). Post it in the calendar first.`);
    if (lastPosted && cut && lastPosted > cut) blockers.push(`Depreciation is posted up to ${lastPosted}, after the disposal; date it later or correct those months.`);
    const [draft] = await tx`select 1 from fa_depreciation where asset_id = ${a.id} and journal_line_id is null limit 1`;
    if (draft) blockers.push("A depreciation draft is waiting for this asset; post or discard it first.");
    const proceeds = toUnits(input.proceeds || "0");
    if (proceeds > 0n && !input.proceedsAccountId) blockers.push("Choose the account the proceeds go to.");
    const cost = toUnits(a.cost), nbv = cost - accumulated, gain = proceeds - nbv;
    const [s] = await tx`select gain_account_id, loss_account_id from fa_setting where company_id = ${co}`;
    const glAccount = gain > 0n ? s?.gain_account_id : gain < 0n ? s?.loss_account_id : null;
    if (gain !== 0n && !glAccount) blockers.push(`Set the ${gain > 0n ? "gain" : "loss"} on disposal account in Fixed Asset Settings.`);

    const raw: { accountId: string; amount: bigint }[] = [
      ...(accumulated > 0n ? [{ accountId: a.accum_account_id, amount: accumulated }] : []),
      ...(proceeds > 0n && input.proceedsAccountId ? [{ accountId: input.proceedsAccountId, amount: proceeds }] : []),
      { accountId: a.asset_account_id, amount: -cost },
      ...(gain !== 0n && glAccount ? [{ accountId: glAccount, amount: -gain }] : []),
    ].filter((l) => l.amount !== 0n);
    const ids = [...new Set(raw.map((l) => l.accountId))];
    const names = new Map((await tx`select id, code, name from account where id = any(${ids})`).map((r: any) => [r.id, r]));
    return {
      cutoff: cut, cost: fromUnits(cost), accumulated: fromUnits(accumulated), nbv: fromUnits(nbv), proceeds: fromUnits(proceeds), gain: fromUnits(gain),
      lines: raw.map((l) => ({ accountId: l.accountId, code: names.get(l.accountId)?.code ?? "?", name: names.get(l.accountId)?.name ?? "?",
        debit: l.amount > 0n ? fromUnits(l.amount) : "0", credit: l.amount < 0n ? fromUnits(-l.amount) : "0" })),
      blockers,
    };
  };
  if (outer) return run(outer);
  // Read-only: the asset lock is held only for the length of the preview.
  return sql.begin(run);
}

export async function disposeAsset(co: string, userId: string, input: { assetId: string; date: string; reason: string; proceeds: string; proceedsAccountId: string | null }) {
  return sql.begin(async (tx) => {
    const p = await disposalPreview(co, input, tx);
    if (p.blockers.length) throw new Error(p.blockers[0]);
    await openPeriod(tx, co, input.date);
    if (input.proceedsAccountId) {
      const [acc] = await tx`select is_postable, is_active, is_control from account where id = ${input.proceedsAccountId} and company_id = ${co}`;
      if (!acc || !acc.is_postable || !acc.is_active || acc.is_control) throw new Error("The proceeds account must be an active, postable account that is not a control account.");
    }
    const [a] = await tx`select code, name, coalesce(posting_branch_id, branch_id) as branch_id from fixed_asset where id = ${input.assetId}`;
    const lines = p.lines.map((l) => ({ accountId: l.accountId, amount: l.debit !== "0" ? Number(l.debit) : -Number(l.credit) }));
    const voucher = await postJournalVoucher({
      companyId: co, docDate: input.date, locationId: a.branch_id, lines,
      memo: `Disposal of ${a.code} ${a.name}: ${input.reason}`, reference: `FA-DSP ${a.code}`,
    }, tx);
    const jl = await tx`select jl.id, jl.account_id, jl.base_amount::text as amount from journal_line jl
                          join document d on d.journal_entry_id = jl.journal_entry_id where d.id = ${voucher.id}`;
    const [cat] = await tx`select c.asset_account_id, c.accum_account_id from fixed_asset f join fa_category c on c.id = f.category_id where f.id = ${input.assetId}`;
    const mine = (jl as any[]).filter((l) => l.account_id === cat.asset_account_id || l.account_id === cat.accum_account_id);
    if (mine.length) await tx`insert into fa_journal_link ${tx(mine.map((l) => ({
      company_id: co, asset_id: input.assetId, journal_line_id: l.id, kind: "DISPOSAL", amount: l.amount.replace("-", ""), created_by: userId })))}`;
    await tx`update fixed_asset set status = 'DISPOSED', disposed_on = ${input.date}, updated_at = now() where id = ${input.assetId}`;
    await tx`insert into fa_event (company_id, asset_id, event_type, event_date, created_by, detail)
             values (${co}, ${input.assetId}, 'DISPOSED', ${input.date}, ${userId},
                     ${tx.json({ reason: input.reason, proceeds: p.proceeds, nbv: p.nbv, gain: p.gain, voucher: voucher.docNo })})`;
    return { docNo: voucher.docNo };
  });
}

