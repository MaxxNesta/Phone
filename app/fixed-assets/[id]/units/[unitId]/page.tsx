import { notFound } from "next/navigation";
import { canPostFa } from "@/lib/fa-access";
import { requirePermission } from "@/lib/auth";
import { seenLocations } from "@/lib/branch-scope";
import { thisMonth } from "@/lib/fa-schedule";
import { loadAssetDetail } from "@/lib/fa-detail";
import { unitSchedule } from "@/lib/fa-units";
import { AssetDetail } from "@/components/asset-detail";

export const metadata = { title: "Asset unit" };

/**
 * One unit of a group: the asset page itself, with the unit's share of the
 * cost and of every month (lib/fa-units.ts), so its units always add up.
 */
export default async function UnitPage({ params }: { params: Promise<{ id: string; unitId: string }> }) {
  const { id, unitId } = await params;
  const user = await requirePermission("accounting.view");
  const d = await loadAssetDetail(user.companyId, await seenLocations(), id);
  if (!d) notFound();
  const own = d.units.filter((u) => u.assetId === id);
  const index = own.findIndex((u) => u.id === unitId);
  if (index < 0) notFound();
  const rows = unitSchedule(d.rows, own.map((u) => u.cost), index, d.cost);
  return <AssetDetail a={d.a} rows={rows} journals={d.journals} events={d.events} units={d.units} unit={own[index]} canPost={canPostFa(user)} now={thisMonth()} />;
}
