import { BranchScope } from "@/components/branch-scope";
import { seenRows } from "@/lib/branch-scope";
import { getCompany, getLocations } from "@/lib/queries";
import { sql } from "@/lib/db";
import { HelpHint } from "@/components/help-hint";
import { PlanWorkbench, type PlanRowLite, type PlanOpenLine } from "@/components/plan-workbench";
import { draftOrdersFromPlan, savePlanning } from "@/lib/actions";
import { loadPlan } from "@/lib/replenish-data";
import { currentUser } from "@/lib/auth";
import { can } from "@/lib/auth-core";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { requireFeature } from "@/lib/plans";

/**
 * Replenishment planning: what to buy and by when, what is sitting, what is
 * late. Every figure is worked out from the ledger when the page loads
 * (lib/replenish explains the model); nothing is stored but the settings a
 * buyer chooses.
 */

const WINDOWS = [30, 60, 90] as const;
const COVERS = [14, 30, 60] as const;
const iso = (d: unknown) => (d ? (d instanceof Date ? d.toISOString() : String(d)).slice(0, 10) : null);

export default async function Replenishment({
  searchParams,
}: {
  searchParams: Promise<{ window?: string; cover?: string; location?: string }>;
}) {
  const sp = await searchParams;
  const t = await getTranslations("plan");
  const c = await getTranslations("common");
  const n = await getTranslations("nav");
  const company = await getCompany();
  if (!company) return <div className="empty">{c("noCompany")}</div>;
  // Gating, not security (lib/plans.ts): the top package only.
  if (!requireFeature(company.plan, "replenishment")) notFound();
  const user = await currentUser();
  const seeCost = can(user, "cost.view");

  const windowDays = WINDOWS.includes(Number(sp.window) as never) ? Number(sp.window) : 30;
  const coverDays = COVERS.includes(Number(sp.cover) as never) ? Number(sp.cover) : 30;

  const locations = (await seenRows(await getLocations(company.id) as unknown as Record<string, unknown>[], "id"))
    .filter((l) => l.is_stock_location) as unknown as { id: string; code: string; name: string }[];
  const chosen = sp.location && locations.some((l) => l.id === sp.location) ? sp.location : null;

  const [plan, categories] = await Promise.all([
    loadPlan(company.id, { windowDays, coverDays, location: chosen, fallbackLeadDays: company.default_lead_time_days }),
    sql`select id, name from item_group where company_id = ${company.id} and is_active order by name` as unknown as Promise<{ id: string; name: string }[]>,
  ]);
  // Yangon's today, the same day the demand query counts from.
  const today = new Date(Date.now() + 6.5 * 3600000).toISOString().slice(0, 10);

  // The photo URL the catalogue uses, from the version getItems already read.
  const photoOf = new Map(plan.items.filter((i) => i.photo_version).map((i) => [i.id as string, `/items/${i.id}/photo?v=${i.photo_version}`]));
  const rows: PlanRowLite[] = plan.rows.map(({ variant: _v, urgency: _u, ...r }) => ({ ...r, photo: photoOf.get(r.id) ?? null }));
  const openLines: PlanOpenLine[] = plan.openLines.map((l) => ({
    orderId: l.order_id, docNo: l.doc_no, supplier: l.supplier, itemId: l.item_id,
    outstanding: Number(l.outstanding), docDate: iso(l.doc_date)!, dueDate: iso(l.due_date),
  }));

  const href = (over: Record<string, string | undefined>) => {
    const q = new URLSearchParams();
    const v = { window: windowDays !== 30 ? String(windowDays) : undefined, cover: coverDays !== 30 ? String(coverDays) : undefined,
                location: chosen ?? undefined, ...over };
    for (const [k, x] of Object.entries(v)) if (x) q.set(k, x);
    const s = q.toString();
    return `/inventory/replenishment${s ? `?${s}` : ""}`;
  };
  const assumptions = [
    { label: t("demandOver"), options: WINDOWS.map((w) => ({ label: t("nDays", { n: w }), href: href({ window: w === 30 ? undefined : String(w) }), on: w === windowDays })) },
    { label: t("coverFor"), options: COVERS.map((cv) => ({ label: t("nDays", { n: cv }), href: href({ cover: cv === 30 ? undefined : String(cv) }), on: cv === coverDays })) },
    ...(locations.length > 1 ? [{ label: c("warehouse"), options: [
      { label: t("allWarehouses"), href: href({ location: undefined }), on: !chosen },
      ...locations.map((l) => ({ label: l.name || l.code, href: href({ location: l.id }), on: chosen === l.id })),
    ] }] : []),
  ];

  return (
    <>
      <div className="page-head">
        <span className="eyebrow">{n("inventory")}</span>
        <h1>{t("title")}</h1>
        <BranchScope />
        <HelpHint>{t("help")}</HelpHint>
      </div>
      <PlanWorkbench
        rows={rows} openLines={openLines} categories={categories} today={today} seeCost={seeCost}
        windowDays={windowDays} coverDays={coverDays} assumptions={assumptions}
        planLocationId={chosen ?? (locations.length === 1 ? locations[0].id : null)}
        createOrders={draftOrdersFromPlan} savePlanning={savePlanning}
      />
    </>
  );
}
