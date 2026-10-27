import { sql } from "./db";

/**
 * Fixed assets, read side. Money comes back as exact decimal strings from
 * Postgres (numeric) and is only turned into numbers for display; sums are
 * done in SQL.
 */

export const FA_STATUS = ["DRAFT", "ACTIVE", "FULLY_DEPRECIATED", "DISPOSED", "INACTIVE"] as const;
export type FaStatus = (typeof FA_STATUS)[number];
export const FA_STATUS_LABEL: Record<FaStatus, string> = {
  DRAFT: "Draft", ACTIVE: "Active", FULLY_DEPRECIATED: "Fully depreciated", DISPOSED: "Disposed", INACTIVE: "Inactive",
};

export type FaCategory = {
  id: string; code: string; name: string; asset_class: "TANGIBLE" | "INTANGIBLE";
  asset_account: string; accum_account: string; expense_account: string;
  default_life_months: number | null; is_active: boolean;
};

export async function faCategories(co: string): Promise<FaCategory[]> {
  return (await sql`
    select c.id, c.code, c.name, c.asset_class, c.default_life_months, c.is_active,
           a.code || ' · ' || a.name as asset_account, x.code || ' · ' || x.name as accum_account,
           e.code || ' · ' || e.name as expense_account
      from fa_category c
      join account a on a.id = c.asset_account_id
      join account x on x.id = c.accum_account_id
      join account e on e.id = c.expense_account_id
     where c.company_id = ${co}
     order by c.asset_class, c.code`) as unknown as FaCategory[];
}

/** Top-level locations, the branches an asset can belong to. */
export async function faBranches(co: string) {
  return (await sql`select id, code, name from location
                     where company_id = ${co} and parent_id is null and is_active order by code`) as unknown as
    { id: string; code: string; name: string }[];
}

export type AssetRow = {
  id: string; code: string; name: string; status: FaStatus;
  category_id: string; category: string; asset_class: string;
  branch_id: string; branch: string; site: string | null;
  /** Where depreciation posts when it is not the assigned branch. */
  posting_branch_id: string | null; posting_branch: string | null; serial_no: string | null;
  acquisition_date: string; in_service_date: string | null;
  acquisition_cost: string; residual_value: string; useful_life_months: number; method: string;
  start_convention: string | null;
  /** What the ledger carries for it: runs, linked history and corrections. */
  accumulated: string; nbv: string;
  acquisition_journal_id: string | null; acquisition_journal_no: string | null;
  supplier_id: string | null; notes: string | null; posted_months: number;
};

/** Every asset in the branches the reader may see, with what has been posted against it. */
export async function assetList(co: string, branches: string[] | null, id?: string): Promise<AssetRow[]> {
  return (await sql`
    select f.id, f.code, f.name, f.status, f.category_id, c.name as category, c.asset_class,
           f.branch_id, b.name as branch, f.posting_branch_id, pb.name as posting_branch, f.site, f.serial_no, f.supplier_id, f.notes,
           to_char(f.acquisition_date, 'YYYY-MM-DD') as acquisition_date,
           to_char(f.in_service_date, 'YYYY-MM-DD') as in_service_date,
           f.acquisition_cost::text, f.residual_value::text, f.useful_life_months, f.method, f.start_convention,
           coalesce(d.total, 0)::text as accumulated,
           (f.acquisition_cost - coalesce(d.total, 0))::text as nbv,
           coalesce(d.months, 0)::int as posted_months,
           l.journal_entry_id as acquisition_journal_id, l.entry_no as acquisition_journal_no
      from fixed_asset f
      join fa_category c on c.id = f.category_id
      join location b on b.id = f.branch_id
      left join location pb on pb.id = f.posting_branch_id
      left join lateral (
        select sum(amount) as total, count(distinct period_month) as months
          from fa_depreciation where asset_id = f.id and journal_line_id is not null) d on true
      left join lateral (
        select jl.journal_entry_id, je.entry_no
          from fa_journal_link k join journal_line jl on jl.id = k.journal_line_id
          join journal_entry je on je.id = jl.journal_entry_id
         where k.asset_id = f.id and k.kind = 'ACQUISITION' order by je.entry_date limit 1) l on true
     where f.company_id = ${co}
       ${branches ? sql`and (f.branch_id = any(${branches}) or f.posting_branch_id = any(${branches}))` : sql``}
       ${id ? sql`and f.id = ${id}` : sql``}
     order by f.code`) as unknown as AssetRow[];
}

/** The next free code in the FA-0001 series. */
export async function nextAssetCode(co: string) {
  const [r] = await sql`
    select coalesce(max(substring(code from '^FA-(\\d+)$')::int), 0) + 1 as n
      from fixed_asset where company_id = ${co}`;
  return `FA-${String(r.n).padStart(4, "0")}`;
}
