import { notFound } from "next/navigation";
import { requireFaPoster } from "@/lib/fa-access";
import { sql } from "@/lib/db";
import { assetList, faCategories, faBranches, FA_STATUS_LABEL } from "@/lib/fixed-assets";
import { seenBranches, seenLocations } from "@/lib/branch-scope";
import { saveAsset, setAssetStatus, changeEstimate } from "@/lib/fa-actions";
import { loadSchedules, thisMonth } from "@/lib/fa-schedule";
import { addMonths } from "@/lib/fa-engine";
import { EstimateForm } from "@/components/estimate-form";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { AssetForm } from "@/components/asset-form";

export const metadata = { title: "Edit asset" };

/** "1250000.0000" → "1250000", "12.5000" → "12.5": the exact figure, without the padding. */
const trimDecimal = (s: string) => (s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s);

export default async function EditAsset({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireFaPoster();
  const co = user.companyId;
  const seen = await seenLocations();
  const [[a], categories, branches, [setting], [s], estimates] = await Promise.all([
    assetList(co, seen, id), faCategories(co), faBranches(co).then(seenBranches),
    sql`select start_convention from fa_setting where company_id = ${co}`,
    loadSchedules(co, { branches: seen, assetId: id }),
    sql`select to_char(effective_month, 'YYYY-MM') as m, useful_life_months, residual_value::text as residual, reason
          from fa_estimate_change where asset_id = ${id} order by effective_month`,
  ]);
  if (!a) notFound();
  const statusForm = (to: string, label: string, warn = false) => (
    <form action={setAssetStatus}>
      <input type="hidden" name="id" value={a.id} />
      <input type="hidden" name="to" value={to} />
      <button className={`ie-btn${warn ? " fa-warn" : ""}`}>{label}</button>
    </form>
  );
  return (
    <div className="ie">
      <Breadcrumbs trail={[{ label: "Fixed Assets" }, { label: "Asset Register", href: "/fixed-assets/register" }, { label: a.code }]} />
      <AssetForm action={saveAsset} companyName={(await sql`select name from company where id = ${co}`)[0].name} pinned={a.posted_months > 0} companyConvention={setting?.start_convention ?? "SAME_MONTH"}
        categories={categories.filter((c) => c.is_active || c.id === a.category_id)
          .map((c) => ({ ...c, accounts: `${c.asset_account} · ${c.accum_account} · ${c.expense_account}` }))}
        branches={branches}
        value={{ id: a.id, code: a.code, name: a.name, category_id: a.category_id, branch_id: a.branch_id,
                 site: a.site ?? "", serial_no: a.serial_no ?? "", notes: a.notes ?? "",
                 acquisition_date: a.acquisition_date, in_service_date: a.in_service_date ?? "",
                 acquisition_cost: trimDecimal(a.acquisition_cost), residual_value: trimDecimal(a.residual_value),
                 useful_life_months: String(a.useful_life_months), start_convention: a.start_convention ?? "", posting_branch_id: a.posting_branch_id ?? "", status: a.status,
                 quantity: trimDecimal(a.quantity), depreciation_start: a.depreciation_start ?? "",
                 opening_accumulated: a.opening_accumulated ? trimDecimal(a.opening_accumulated) : "", opening_through: a.opening_through ?? "" }} />
      {(a.status === "ACTIVE" || a.status === "INACTIVE") && (() => {
        // A new life or residual from a month on: its own section and its own save, apart from the record above.
        const rows = s?.rows ?? [];
        const lastPosted = rows.filter((r) => r.state === "POSTED").at(-1)?.month;
        const latest = (estimates as any[]).at(-1);
        const monthLong = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });
        return (
          <section className="ie-card fa-estimate-card">
            <h3>Change of estimate</h3>
            <EstimateForm action={changeEstimate} assetId={a.id} life={latest?.useful_life_months ?? a.useful_life_months}
              residual={String(Number(latest?.residual ?? a.residual_value))}
              from={lastPosted ? addMonths(lastPosted, 1) : (rows[0]?.month ?? thisMonth())} />
            {(estimates as any[]).length > 0 && (
              <ul className="fa-est-list">{(estimates as any[]).map((e) => (
                <li key={e.m}><strong>From {monthLong(e.m)}</strong>: {e.useful_life_months} months, residual {Number(e.residual).toLocaleString("en-US")}<span>{e.reason}</span></li>))}
              </ul>
            )}
          </section>
        );
      })()}
      <section className="ie-card fa-status-card">
        <h3>Status: {FA_STATUS_LABEL[a.status]}</h3>
        <div className="fa-status-actions">
          {a.status === "ACTIVE" && statusForm("INACTIVE", "Make inactive")}
          {a.status === "INACTIVE" && statusForm("ACTIVE", "Make active again")}
          {a.status === "DRAFT" && a.posted_months === 0 && statusForm("DELETE", "Delete draft", true)}
        </div>
        <p className="ie-note">Inactive assets are kept on the register but not depreciated. Disposal and transfer come with their own screens.</p>
      </section>
    </div>
  );
}
