import { requireFaPoster } from "@/lib/fa-access";
import { sql } from "@/lib/db";
import { faCategories, faBranches, nextAssetCode } from "@/lib/fixed-assets";
import { seenBranches } from "@/lib/branch-scope";
import { saveAsset } from "@/lib/fa-actions";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { AssetForm } from "@/components/asset-form";

export const metadata = { title: "Add asset" };

export default async function NewAsset() {
  const user = await requireFaPoster();
  const co = user.companyId;
  const [categories, branches, code, [setting]] = await Promise.all([
    faCategories(co), faBranches(co).then(seenBranches), nextAssetCode(co),
    sql`select start_convention from fa_setting where company_id = ${co}`,
  ]);
  return (
    <div className="ie">
      <Breadcrumbs trail={[{ label: "Fixed Assets" }, { label: "Asset Register", href: "/fixed-assets/register" }, { label: "Add asset" }]} />
      <AssetForm action={saveAsset} companyName={(await sql`select name from company where id = ${co}`)[0].name} pinned={false} companyConvention={setting?.start_convention ?? "NEXT_MONTH"}
        categories={categories.filter((c) => c.is_active).map((c) => ({ ...c, accounts: `${c.asset_account} · ${c.accum_account} · ${c.expense_account}` }))}
        branches={branches}
        value={{ code, name: "", category_id: "", branch_id: branches.length === 1 ? branches[0].id : "", site: "", serial_no: "",
                 notes: "", acquisition_date: "", in_service_date: "", acquisition_cost: "", residual_value: "0",
                 useful_life_months: "", start_convention: "", posting_branch_id: "", status: "DRAFT" }} />
    </div>
  );
}
