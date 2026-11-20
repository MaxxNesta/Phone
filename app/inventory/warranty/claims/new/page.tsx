import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { claimPositionFor } from "@/lib/warranty-claims";
import { OpenClaimForm } from "@/components/warranty-claim-forms";
import { getTranslations } from "next-intl/server";
import { ErpCrumbs } from "@/components/erp-worklist";
import { ClaimCoverage } from "@/components/warranty-claim-coverage";

/** Opening a warranty claim on one phone (0221): its coverage today, then what is wrong. */
export default async function NewClaim({ searchParams }: { searchParams: Promise<{ serial?: string }> }) {
  await requirePermission("inventory.view");
  const t = await getTranslations("inventory");
  const { serial } = await searchParams;
  if (!serial) notFound();
  const pos = await claimPositionFor(serial);
  if (!pos) notFound();

  return (
    <>
      <ErpCrumbs steps={[
        { label: t("war.lookup"), href: "/inventory/warranty" },
        { label: t("claims.title"), href: "/inventory/warranty/claims" },
        { label: t("claims.new") },
      ]} />
      <div className="page-head">
        <h1>{t("claims.new")}</h1>
        <p className="page-sub">{t("claims.newSub")}</p>
      </div>
      <ClaimCoverage pos={pos} t={t} />
      {pos.sale_id
        ? <OpenClaimForm serialId={serial} />
        : <div className="alert">{t("claims.neverSold", { imei: pos.imei })}</div>}
    </>
  );
}
