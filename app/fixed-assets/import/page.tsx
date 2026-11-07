import { requirePermission } from "@/lib/auth";
import { HelpHint } from "@/components/help-hint";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { FaImport } from "@/components/fa-import";
import { faCategories } from "@/lib/fixed-assets";

export const metadata = { title: "Import assets" };

export default async function ImportAssets() {
  const user = await requirePermission("accounting.view");
  const cats = await faCategories(user.companyId);
  return (
    <div className="ie">
      <Breadcrumbs trail={[{ label: "Fixed Assets", href: "/fixed-assets" }, { label: "Asset Register", href: "/fixed-assets/register" }, { label: "Import" }]} />
      <header className="ie-title">
        <h1>Import assets <HelpHint label="About importing assets">The asset register pasted from Excel. Each row is read, matched to a category, and its months compared with MTK&apos;s own schedule. A preview for now: nothing is saved or posted.</HelpHint></h1>
        <p>Paste the register to see what each row becomes and where the file and MTK disagree.</p>
      </header>
      <FaImport categories={cats.filter((c) => c.is_active).map((c) => ({ id: c.id, name: c.name, group: c.report_group }))} />
    </div>
  );
}
