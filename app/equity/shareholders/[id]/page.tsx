import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { updateShareholderAction } from "@/lib/share-actions";
import { equityAccounts, getShareholder } from "@/lib/shares";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { ShareholderForm } from "@/components/share-transfer-form";

export const metadata = { title: "Edit shareholder" };

export default async function EditShareholder({ params }: { params: Promise<{ id: string }> }) {
  const u = await requirePermission("accounting.post");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [h, accounts] = await Promise.all([getShareholder(u.companyId, id), equityAccounts(u.companyId)]);
  if (!h) notFound();
  return (
    <div className="ie">
      <Breadcrumbs trail={[{ label: "Shareholders", href: "/equity/shareholders" }, { label: h.name }]} />
      <header className="ie-title"><h1>{h.code} · {h.name}</h1></header>
      <ShareholderForm action={updateShareholderAction} equityAccounts={accounts} initial={h as never} />
    </div>
  );
}
