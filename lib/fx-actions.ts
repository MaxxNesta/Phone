"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { sql } from "./db";
import { requirePermission } from "./auth";
import { postFxRevaluation, voidFxRevaluation, planFxRevaluation } from "./posting";

/** Rates typed on the form, one field per currency: rate_CNY, rate_USD … */
function ratesFrom(fd: FormData): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of fd.entries()) {
    const m = /^rate_([A-Z]{3})$/.exec(k);
    if (m && Number(v) > 0) out[m[1]] = Number(v);
  }
  return out;
}

/** Posts the month-end revaluation (0223) at the rates shown on the preview. */
export async function postFxRevaluationAction(_prev: unknown, fd: FormData): Promise<{ error: string } | void> {
  const user = await requirePermission("accounting.post");
  const periodEnd = String(fd.get("period_end") ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(periodEnd)) return { error: "Choose the month end." };
  try {
    await postFxRevaluation({ companyId: user.companyId, periodEnd, rates: ratesFrom(fd), userId: user.id });
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  revalidatePath("/finance/fx-revaluation");
  revalidatePath("/");
  redirect(`/finance/fx-revaluation?period=${periodEnd}`);
}

/** Voids a run so the month can be revalued again. */
export async function voidFxRevaluationAction(_prev: unknown, fd: FormData): Promise<{ error: string } | void> {
  const user = await requirePermission("accounting.post");
  const id = String(fd.get("revaluation_id") ?? "");
  const reason = String(fd.get("reason") ?? "");
  let period = "";
  try {
    await voidFxRevaluation({ companyId: user.companyId, revaluationId: id, reason, userId: user.id });
    const [r] = await sql`select period_end::text as p from fx_revaluation where id = ${id}`;
    period = String(r?.p ?? "");
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  revalidatePath("/finance/fx-revaluation");
  revalidatePath("/");
  redirect(`/finance/fx-revaluation?period=${period}`);
}

/**
 * The month end that should have been revalued and has not, if any: last
 * month's, when foreign balances were open at it. For the reminder on the
 * dashboard and the revaluation page.
 */
export async function fxRevaluationDue(): Promise<{ periodEnd: string } | null> {
  const user = await requirePermission("accounting.view");
  const [{ pe }] = await sql`select (date_trunc('month', fn_shop_today()) - interval '1 day')::date::text as pe`;
  const [done] = await sql`
    select 1 from fx_revaluation where company_id = ${user.companyId} and period_end = ${pe}::date and status = 'POSTED'`;
  if (done) return null;
  // Most shops never buy in a foreign currency: answer them without reading the ledger.
  const [fc] = await sql`
    select 1 from journal_line jl join company c on c.id = jl.company_id
     where jl.company_id = ${user.companyId} and jl.currency <> c.base_currency limit 1`;
  if (!fc) return null;
  const plan = await planFxRevaluation({ companyId: user.companyId, periodEnd: pe });
  return plan.lines.length > 0 || plan.missingRates.length > 0 ? { periodEnd: String(pe) } : null;
}
