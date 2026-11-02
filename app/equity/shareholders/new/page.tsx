import { requirePermission } from "@/lib/auth";
import { createShareholderAction } from "@/lib/share-actions";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { ShareholderForm } from "@/components/share-transfer-form";

export const metadata = { title: "New shareholder" };

export default async function NewShareholder() {
  await requirePermission("accounting.post");
  return (
    <div className="ie">
      <Breadcrumbs trail={[{ label: "Shareholders", href: "/equity/shareholders" }, { label: "New shareholder" }]} />
      <header className="ie-title"><h1>New shareholder</h1></header>
      <ShareholderForm action={createShareholderAction} />
    </div>
  );
}
