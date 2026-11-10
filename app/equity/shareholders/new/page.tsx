import { requirePermission } from "@/lib/auth";
import { createShareholderAction } from "@/lib/share-actions";
import { equityAccounts } from "@/lib/shares";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { ShareholderForm } from "@/components/share-transfer-form";

export const metadata = { title: "New shareholder" };

export default async function NewShareholder() {
  const u = await requirePermission("accounting.post");
  return (
    <div className="ie">
      <Breadcrumbs trail={[{ label: "Shareholders", href: "/equity/shareholders" }, { label: "New shareholder" }]} />
      <header className="ie-title"><h1>New shareholder</h1></header>
      <ShareholderForm action={createShareholderAction} equityAccounts={await equityAccounts(u.companyId)} />
    </div>
  );
}
