import { sql } from "@/lib/db";
import { HelpHint } from "@/components/help-hint";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { FaImport } from "@/components/fa-import";
import { faCategories, faBranches } from "@/lib/fixed-assets";
import { requireFaPoster } from "@/lib/fa-access";
import { seenBranches } from "@/lib/branch-scope";
import type { Convention } from "@/lib/fa-engine";

export const metadata = { title: "Import assets" };

export default async function ImportAssets() {
  const user = await requireFaPoster();
  const co = user.companyId;
  const [cats, branches, existing, [setting]] = await Promise.all([
    faCategories(co), faBranches(co).then(seenBranches),
    sql`select code, name, acquisition_cost::float as cost, to_char(acquisition_date, 'YYYY-MM-DD') as acquired from fixed_asset where company_id = ${co}`,
    sql`select start_convention from fa_setting where company_id = ${co}`,
  ]);
  const code = (s: string) => s.split(" · ")[0];
  return (
    <div className="ie">
      <Breadcrumbs trail={[{ label: "Fixed Assets", href: "/fixed-assets" }, { label: "Asset Register", href: "/fixed-assets/register" }, { label: "Import" }]} />
      <header className="ie-title">
        <h1>Import assets <HelpHint label="About importing assets">The asset register pasted from Excel. Each row is reviewed against the chart, the branches, the assets already registered and MTK&apos;s own schedule, then imported as a real asset whose depreciation comes from the engine. Nothing is posted: purchases are linked afterwards in Journal Reconciliation.</HelpHint></h1>
      </header>
      <FaImport
        categories={cats.filter((c) => c.is_active).map((c) => ({ id: c.id, name: c.name, group: c.heading,
          accounts: `${code(c.asset_account)} · ${code(c.accum_account)} · ${code(c.expense_account)}` }))}
        branches={branches.map((b) => ({ id: b.id, name: b.name }))}
        existing={existing as never}
        convention={(setting?.start_convention ?? "SAME_MONTH") as Convention}
        defaultBranchId={branches.length === 1 ? branches[0].id : null} />
    </div>
  );
}
