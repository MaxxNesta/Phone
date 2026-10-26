import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { sql } from "@/lib/db";
import { assetList, faCategories, faBranches, FA_STATUS_LABEL } from "@/lib/fixed-assets";
import { seenBranches, seenLocations } from "@/lib/branch-scope";
import { saveAsset, setAssetStatus } from "@/lib/fa-actions";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { AssetForm } from "@/components/asset-form";

export const metadata = { title: "Edit asset" };

/** "1250000.0000" → "1250000", "12.5000" → "12.5": the exact figure, without the padding. */
const trimDecimal = (s: string) => (s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s);

export default async function EditAsset({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requirePermission("accounting.post");
  const co = user.companyId;
  const [[a], categories, branches, [setting]] = await Promise.all([
    assetList(co, await seenLocations(), id), faCategories(co), faBranches(co).then(seenBranches),
    sql`select start_convention from fa_setting where company_id = ${co}`,
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
      <AssetForm action={saveAsset} pinned={a.posted_months > 0} companyConvention={setting?.start_convention ?? "NEXT_MONTH"}
        categories={categories.filter((c) => c.is_active || c.id === a.category_id)
          .map((c) => ({ ...c, accounts: `${c.asset_account} · ${c.accum_account} · ${c.expense_account}` }))}
        branches={branches}
        value={{ id: a.id, code: a.code, name: a.name, category_id: a.category_id, branch_id: a.branch_id,
                 site: a.site ?? "", serial_no: a.serial_no ?? "", notes: a.notes ?? "",
                 acquisition_date: a.acquisition_date, in_service_date: a.in_service_date ?? "",
                 acquisition_cost: trimDecimal(a.acquisition_cost), residual_value: trimDecimal(a.residual_value),
                 useful_life_months: String(a.useful_life_months), start_convention: a.start_convention ?? "", status: a.status }} />
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
