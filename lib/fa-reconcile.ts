import { sql } from "./db";

/**
 * The journal lines a fixed asset can be reconciled to: posted lines on an
 * asset account (acquisitions) or an accumulated-depreciation account (the
 * depreciation history), with how much of each is already tied to assets.
 *
 * This module's own vouchers are not offered: their lines are linked when
 * they post, and linking them again would count a month twice.
 */

export type ReconLine = {
  id: string; date: string; entryNo: string; docId: string | null; docNo: string | null; docType: string | null;
  memo: string | null; reference: string | null;
  accountId: string; accountCode: string; accountName: string; role: "ASSET" | "ACCUM";
  branch: string | null;
  /** Signed, debit positive. */
  amount: string;
  allocated: string; remaining: string;
};

export type ReconFilters = {
  accountId?: string; from?: string; to?: string; month?: string; amount?: string; q?: string;
  /** Only lines with something left to allocate. */
  open?: boolean;
};

export async function reconLines(co: string, f: ReconFilters, lineId?: string): Promise<ReconLine[]> {
  const like = f.q ? `%${f.q.trim()}%` : null;
  const amt = f.amount && /^\d+(\.\d+)?$/.test(f.amount.replace(/,/g, "")) ? f.amount.replace(/,/g, "") : null;
  const monthFrom = f.month && /^\d{4}-\d{2}$/.test(f.month) ? `${f.month}-01` : null;
  return (await sql`
    with fa_accounts as (
      select asset_account_id as id, 'ASSET' as role from fa_category where company_id = ${co}
      union select accum_account_id, 'ACCUM' from fa_category where company_id = ${co}
    ),
    used as (
      select journal_line_id as id, sum(abs(amount)) as amount from fa_depreciation where company_id = ${co} and journal_line_id is not null group by 1
      union all
      select journal_line_id, sum(amount) from fa_journal_link where company_id = ${co} group by 1
    )
    select jl.id, to_char(je.entry_date, 'YYYY-MM-DD') as date, je.entry_no as "entryNo", d.id as "docId", d.doc_no as "docNo",
           d.doc_type as "docType", coalesce(d.memo, je.memo) as memo, d.reference,
           a.id as "accountId", a.code as "accountCode", a.name as "accountName", fa.role,
           b.name as branch,
           jl.base_amount::text as amount,
           coalesce((select sum(u.amount) from used u where u.id = jl.id), 0)::text as allocated,
           (abs(jl.base_amount) - coalesce((select sum(u.amount) from used u where u.id = jl.id), 0))::text as remaining
      from journal_line jl
      join journal_entry je on je.id = jl.journal_entry_id
      join account a on a.id = jl.account_id
      join (select distinct id, role from fa_accounts) fa on fa.id = jl.account_id
      left join document d on d.id = je.source_id
      left join location l on l.id = jl.location_id
      left join location b on b.id = coalesce(l.parent_id, l.id)
     where jl.company_id = ${co}
       and (d.id is null or d.status = 'POSTED')
       and not exists (select 1 from fa_run r where r.document_id = d.id)
       ${lineId ? sql`and jl.id = ${lineId}` : sql``}
       ${f.accountId ? sql`and jl.account_id = ${f.accountId}` : sql``}
       ${f.from ? sql`and je.entry_date >= ${f.from}` : sql``}
       ${f.to ? sql`and je.entry_date <= ${f.to}` : sql``}
       ${monthFrom ? sql`and date_trunc('month', je.entry_date) = ${monthFrom}::date` : sql``}
       ${amt ? sql`and abs(jl.base_amount) = ${amt}::numeric` : sql``}
       ${like ? sql`and (je.entry_no ilike ${like} or d.doc_no ilike ${like} or d.reference ilike ${like}
                         or d.memo ilike ${like} or je.memo ilike ${like})` : sql``}
       ${f.open ? sql`and abs(jl.base_amount) > coalesce((select sum(u.amount) from used u where u.id = jl.id), 0)` : sql``}
     order by je.entry_date desc, je.entry_no, jl.line_no
     limit 300`) as unknown as ReconLine[];
}

/** What is already tied to one line: depreciation months, acquisitions, corrections. */
export async function lineAllocations(co: string, lineId: string) {
  return (await sql`
    select 'DEP' as type, x.id, x.source as kind, f.id as asset_id, f.code, f.name, to_char(x.period_month, 'YYYY-MM') as month, x.amount::text as amount
      from fa_depreciation x join fixed_asset f on f.id = x.asset_id
     where x.company_id = ${co} and x.journal_line_id = ${lineId}
    union all
    select 'LINK', k.id, k.kind, f.id, f.code, f.name, null, k.amount::text
      from fa_journal_link k join fixed_asset f on f.id = k.asset_id
     where k.company_id = ${co} and k.journal_line_id = ${lineId}
     order by 4, 7`) as unknown as { type: "DEP" | "LINK"; id: string; kind: string; asset_id: string; code: string; name: string; month: string | null; amount: string }[];
}

/**
 * What does not reconcile: a month whose linked history differs from what the
 * schedule expected, and an asset month carried by more than one journal.
 */
export async function reconIssues(co: string) {
  const [unlinked] = await sql`
    select count(*)::int as n, coalesce(sum(abs(jl.base_amount)), 0)::text as amount
      from journal_line jl join journal_entry je on je.id = jl.journal_entry_id
      left join document d on d.id = je.source_id
     where jl.company_id = ${co}
       and jl.account_id in (select accum_account_id from fa_category where company_id = ${co})
       and jl.base_amount < 0
       and not exists (select 1 from fa_run r where r.document_id = d.id)
       and not exists (select 1 from fa_depreciation x where x.journal_line_id = jl.id)
       and not exists (select 1 from fa_journal_link k where k.journal_line_id = jl.id)`;
  return { unlinked: unlinked as { n: number; amount: string } };
}
