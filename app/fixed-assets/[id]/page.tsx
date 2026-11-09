import { notFound } from "next/navigation";
import { canPostFa } from "@/lib/fa-access";
import { requirePermission } from "@/lib/auth";
import { seenLocations } from "@/lib/branch-scope";
import { thisMonth } from "@/lib/fa-schedule";
import { loadAssetDetail } from "@/lib/fa-detail";
import { AssetDetail } from "@/components/asset-detail";

export const metadata = { title: "Asset" };

/** One asset: what it is, what it is worth to the ledger, and every month of its life. */
export default async function AssetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requirePermission("accounting.view");
  const d = await loadAssetDetail(user.companyId, await seenLocations(), id);
  if (!d) notFound();
  return <AssetDetail a={d.a} rows={d.rows} journals={d.journals} events={d.events} units={d.units} canPost={canPostFa(user)} now={thisMonth()} />;
}
