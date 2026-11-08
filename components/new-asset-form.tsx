import { sql } from "@/lib/db";
import { faCategories, faBranches, nextAssetCode } from "@/lib/fixed-assets";
import { seenBranches } from "@/lib/branch-scope";
import { saveAsset } from "@/lib/fa-actions";
import { AssetForm } from "@/components/asset-form";

/** A blank asset form with its categories, branches and next code: Add asset, and the empty Asset Register. */
export async function NewAssetForm({ co, heading = true }: { co: string; heading?: boolean }) {
  const [categories, branches, code, [setting], [company]] = await Promise.all([
    faCategories(co), faBranches(co).then(seenBranches), nextAssetCode(co),
    sql`select start_convention from fa_setting where company_id = ${co}`,
    sql`select name from company where id = ${co}`,
  ]);
  return (
    <AssetForm action={saveAsset} companyName={company.name} pinned={false} companyConvention={setting?.start_convention ?? "SAME_MONTH"} heading={heading}
      categories={categories.filter((c) => c.is_active).map((c) => ({ ...c, accounts: `${c.asset_account} · ${c.accum_account} · ${c.expense_account}` }))}
      branches={branches}
      value={{ code, name: "", category_id: "", branch_id: branches.length === 1 ? branches[0].id : "", site: "", serial_no: "",
               notes: "", acquisition_date: "", in_service_date: "", acquisition_cost: "", residual_value: "0",
               useful_life_months: "", start_convention: "", posting_branch_id: "", status: "DRAFT",
               quantity: "1", depreciation_start: "", opening_accumulated: "", opening_through: "" }} />
  );
}
