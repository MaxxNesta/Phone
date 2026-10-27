import { sql } from "./db";
import { loadSchedules } from "./fa-schedule";
import { fromUnits, toUnits, monthOf, sum } from "./fa-engine";

/**
 * The fixed-asset reports. Every figure is either the register, a posted
 * journal, or the engine's plan for a month not yet posted (labelled so).
 * Branch is the posting branch: a company total is the sum of branches, with
 * company-level history shown on its own line rather than spread over them.
 */

export type ReportFilters = { from: string; to: string; branches: string[] | null; branchId?: string; categoryId?: string; assetId?: string; status?: string };

const COMPANY_LEVEL = "Company level (no branch)";

/** Asset rows with cost, and depreciation posted on or before a date, by asset. */
async function base(co: string, f: ReportFilters) {
  const branchSet = f.branchId ? [f.branchId] : f.branches;
  const assets = await sql`
    select f.id, f.code, f.name, f.status, c.name as category, c.asset_class,
           coalesce(f.posting_branch_id, f.branch_id) as branch_id, coalesce(pb.name, b.name) as branch, b.name as used_at,
           to_char(f.acquisition_date, 'YYYY-MM-DD') as acquired, to_char(f.in_service_date, 'YYYY-MM-DD') as in_service,
           to_char(f.disposed_on, 'YYYY-MM-DD') as disposed_on, f.acquisition_cost::text as cost, f.residual_value::text as residual,
           f.useful_life_months, sp.name as supplier, c.asset_account_id, c.accum_account_id
      from fixed_asset f join fa_category c on c.id = f.category_id join location b on b.id = f.branch_id
      left join location pb on pb.id = f.posting_branch_id left join business_partner sp on sp.id = f.supplier_id
     where f.company_id = ${co} and f.status <> 'DRAFT'
       ${branchSet ? sql`and coalesce(f.posting_branch_id, f.branch_id) = any(${branchSet})` : sql``}
       ${f.categoryId ? sql`and f.category_id = ${f.categoryId}` : sql``}
       ${f.assetId ? sql`and f.id = ${f.assetId}` : sql``}
       ${f.status ? sql`and f.status = ${f.status}` : sql``}
     order by f.code`;
  const ids = (assets as any[]).map((a) => a.id);
  const dep = ids.length ? await sql`
    select x.asset_id, to_char(x.period_month, 'YYYY-MM') as month, x.source, x.amount::text as amount,
           to_char(je.entry_date, 'YYYY-MM-DD') as date, d.id as doc_id, coalesce(d.doc_no, je.entry_no) as doc_no
      from fa_depreciation x join journal_line jl on jl.id = x.journal_line_id
      join journal_entry je on je.id = jl.journal_entry_id left join document d on d.id = je.source_id
     where x.asset_id = any(${ids})` : [];
  return { assets: assets as any[], dep: dep as any[] };
}

const postedBy = (dep: any[], id: string, on: (d: any) => boolean) => sum(dep.filter((d) => d.asset_id === id && on(d)).map((d) => toUnits(d.amount)));
const held = (a: any, on: string) => a.acquired <= on && !(a.disposed_on && a.disposed_on <= on);

/** Asset Register and Net Book Value, as of the end date. */
export async function registerReport(co: string, f: ReportFilters) {
  const { assets, dep } = await base(co, f);
  return assets.filter((a) => held(a, f.to)).map((a) => {
    const accum = postedBy(dep, a.id, (d) => d.date <= f.to);
    return { ...a, accumulated: fromUnits(accum), nbv: fromUnits(toUnits(a.cost) - accum) };
  });
}

/** Each asset month in the range: posted (with its journal) or planned. */
export async function monthlyReport(co: string, f: ReportFilters) {
  const sched = await loadSchedules(co, { branches: f.branchId ? [f.branchId] : f.branches, assetId: f.assetId, categoryId: f.categoryId });
  const { dep } = await base(co, f);
  const from = monthOf(f.from), to = monthOf(f.to);
  return sched.filter((a) => (!f.branchId || a.postBranchId === f.branchId) && (!f.status || a.status === f.status))
    .flatMap((a) => a.rows.filter((r) => r.month >= from && r.month <= to && r.amount !== 0n).map((r) => {
      const js = dep.filter((d) => d.asset_id === a.id && d.month === r.month);
      return { id: a.id, code: a.code, name: a.name, category: a.category, branch: a.postBranch, month: r.month,
               amount: fromUnits(r.amount), state: r.state, opening: fromUnits(r.opening), closing: fromUnits(r.closing),
               journals: js.map((j) => ({ docId: j.doc_id, docNo: j.doc_no, source: j.source })) };
    }));
}

/** Opening accumulated, the period's depreciation, disposals, closing, per asset. */
export async function accumulatedReport(co: string, f: ReportFilters) {
  const { assets, dep } = await base(co, f);
  return assets.filter((a) => a.acquired <= f.to).map((a) => {
    const opening = postedBy(dep, a.id, (d) => d.date < f.from);
    const period = postedBy(dep, a.id, (d) => d.date >= f.from && d.date <= f.to);
    const out = a.disposed_on && a.disposed_on >= f.from && a.disposed_on <= f.to ? opening + period : 0n;
    return { ...a, opening: fromUnits(opening), period: fromUnits(period), disposed: fromUnits(out), closing: fromUnits(opening + period - out) };
  }).filter((r) => r.opening !== "0.0000" || r.period !== "0.0000" || r.closing !== "0.0000" || r.status === "ACTIVE");
}

export async function acquisitionsReport(co: string, f: ReportFilters) {
  const { assets } = await base(co, f);
  const ids = assets.map((a) => a.id);
  const links = ids.length ? await sql`
    select k.asset_id, d.id as doc_id, coalesce(d.doc_no, je.entry_no) as doc_no from fa_journal_link k
      join journal_line jl on jl.id = k.journal_line_id join journal_entry je on je.id = jl.journal_entry_id
      left join document d on d.id = je.source_id where k.asset_id = any(${ids}) and k.kind = 'ACQUISITION'` : [];
  return assets.filter((a) => a.acquired >= f.from && a.acquired <= f.to)
    .map((a) => ({ ...a, journal: (links as any[]).find((l) => l.asset_id === a.id) ?? null }));
}

export async function disposalsReport(co: string, f: ReportFilters) {
  const branchSet = f.branchId ? [f.branchId] : f.branches;
  return (await sql`
    select f.id, f.code, f.name, c.name as category, coalesce(pb.name, b.name) as branch, to_char(e.event_date, 'YYYY-MM-DD') as date,
           f.acquisition_cost::text as cost, e.detail->>'reason' as reason, e.detail->>'nbv' as nbv,
           e.detail->>'proceeds' as proceeds, e.detail->>'gain' as gain, e.detail->>'voucher' as voucher,
           (select d.id from document d where d.company_id = f.company_id and d.doc_no = e.detail->>'voucher' limit 1) as doc_id
      from fa_event e join fixed_asset f on f.id = e.asset_id join fa_category c on c.id = f.category_id
      join location b on b.id = f.branch_id left join location pb on pb.id = f.posting_branch_id
     where e.company_id = ${co} and e.event_type = 'DISPOSED' and e.event_date between ${f.from} and ${f.to}
       ${branchSet ? sql`and coalesce(f.posting_branch_id, f.branch_id) = any(${branchSet})` : sql``}
       ${f.categoryId ? sql`and f.category_id = ${f.categoryId}` : sql``}
       ${f.assetId ? sql`and f.id = ${f.assetId}` : sql``}
     order by e.event_date`) as any[];
}

/**
 * The subledger against the General Ledger, per account and branch, as of
 * the end date. The register's side: cost of what is held, and depreciation
 * posted for it. The ledger's side: the account's balance by the branch on
 * its lines; lines with no branch are company level, on a line of their own.
 * A difference is shown, never smoothed over.
 */
export async function reconciliationReport(co: string, f: ReportFilters) {
  const { assets, dep } = await base(co, { ...f, status: undefined });
  const cats = await sql`
    select c.id, c.name, a.id as asset_account_id, a.code as asset_code, a.name as asset_name,
           x.id as accum_account_id, x.code as accum_code, x.name as accum_name
      from fa_category c join account a on a.id = c.asset_account_id join account x on x.id = c.accum_account_id
     where c.company_id = ${co} ${f.categoryId ? sql`and c.id = ${f.categoryId}` : sql``}`;
  const accountIds = (cats as any[]).flatMap((c) => [c.asset_account_id, c.accum_account_id]);
  const branchSet = f.branchId ? [f.branchId] : f.branches;
  const gl = accountIds.length ? await sql`
    select jl.account_id, coalesce(l.parent_id, l.id) as branch_id, coalesce(bp.name, l.name) as branch,
           sum(jl.base_amount)::text as balance
      from journal_line jl join journal_entry je on je.id = jl.journal_entry_id
      left join location l on l.id = jl.location_id left join location bp on bp.id = l.parent_id
     where jl.company_id = ${co} and jl.account_id = any(${accountIds}) and je.entry_date <= ${f.to}
       ${branchSet ? sql`and coalesce(l.parent_id, l.id) = any(${branchSet})` : sql``}
     group by 1, 2, 3` : [];
  const rows: any[] = [];
  const key = (acc: string, br: string | null) => `${acc}|${br ?? "-"}`;
  const reg = new Map<string, { branch: string; amount: bigint }>();
  for (const a of assets) {
    const c = (cats as any[]).find((x) => x.asset_account_id === a.asset_account_id);
    if (!c) continue;
    const inBooks = a.acquired <= f.to && !(a.disposed_on && a.disposed_on <= f.to);
    if (inBooks) {
      const k = key(a.asset_account_id, a.branch_id);
      reg.set(k, { branch: a.branch, amount: (reg.get(k)?.amount ?? 0n) + toUnits(a.cost) });
      const ak = key(a.accum_account_id, a.branch_id);
      reg.set(ak, { branch: a.branch, amount: (reg.get(ak)?.amount ?? 0n) + postedBy(dep, a.id, (d) => d.date <= f.to) });
    }
  }
  const glBy = new Map((gl as any[]).map((g) => [key(g.account_id, g.branch_id), g]));
  const keys = new Set([...reg.keys(), ...glBy.keys()]);
  for (const k of keys) {
    const [acc, br] = k.split("|");
    const c = (cats as any[]).find((x) => x.asset_account_id === acc || x.accum_account_id === acc);
    if (!c) continue;
    const isAsset = c.asset_account_id === acc;
    const g = glBy.get(k);
    const register = reg.get(k)?.amount ?? 0n;
    // Accumulated depreciation is a credit balance; both sides read as positive.
    const ledger = g ? (isAsset ? toUnits(g.balance) : -toUnits(g.balance)) : 0n;
    rows.push({ account: isAsset ? c.asset_code : c.accum_code, accountName: isAsset ? c.asset_name : c.accum_name,
      side: isAsset ? "Cost" : "Accumulated", category: c.name,
      branch: br === "-" ? COMPANY_LEVEL : reg.get(k)?.branch ?? g?.branch ?? "?", companyLevel: br === "-",
      register: fromUnits(register), ledger: fromUnits(ledger), difference: fromUnits(ledger - register) });
  }
  return rows.sort((x, y) => x.account.localeCompare(y.account) || Number(x.companyLevel) - Number(y.companyLevel) || x.branch.localeCompare(y.branch));
}
