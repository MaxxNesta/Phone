import { BranchScope } from "@/components/branch-scope";
import { seenRows, seenLocations, scopedBranch } from "@/lib/branch-scope";
import Link from "next/link";
import { getCompany, getNegativeStock } from "@/lib/queries";
import { reconcileNegativeStockAction } from "@/lib/actions";
import { ReconcileStock } from "@/components/reconcile-stock";
import { money } from "@/lib/format";
import { HelpHint } from "@/components/help-hint";
import { getTranslations } from "next-intl/server";

export default async function NegativeStock() {
  const t = await getTranslations("inventory");
  const c = await getTranslations("common");
  const n = await getTranslations("nav");
  const company = await getCompany();
  if (!company) return <div className="empty">{c("noCompany")}</div>;

  const rows = (await seenRows((await getNegativeStock(company.id)) as unknown as Record<string, unknown>[])) as unknown as Parameters<
    typeof ReconcileStock
  >[0]["rows"];
  const today = new Date().toISOString().slice(0, 10);
  const totalValue = rows.reduce((s, r) => s + Number(r.outstanding_value), 0);

  return (
    <>
      <div className="page-head">
        <span className="eyebrow">{n("inventory")}</span>
        <h1>{t("neg.title")}</h1>
        <BranchScope />
        <HelpHint>
          {t("neg.help")}
        </HelpHint>
      </div>

      {rows.length === 0 ? (
        <div className="empty">
          {t("neg.nothing")}{" "}
          <Link href="/items/stock" style={{ color: "var(--link)" }}>{t("neg.seeStock")}</Link>
        </div>
      ) : (
        <>
          <div className="kpis" style={{ marginBottom: "0.75rem" }}>
            <div className="kpi">
              <span className="kpi-label">{t("neg.linesPending")}</span>
              <span className="kpi-value">{rows.length}</span>
            </div>
            <div className="kpi">
              <span className="kpi-label">{t("neg.valueOwed")}</span>
              <span className="kpi-value">{money(totalValue)}</span>
              <span className="kpi-note">{t("neg.valueNote")}</span>
            </div>
          </div>

          <ReconcileStock action={reconcileNegativeStockAction} rows={rows} today={today} />

          <div className="card" style={{ marginTop: "1rem" }}>
            <div className="card-body">
              <span className="page-sub">
                {t("neg.footnote")}
              </span>
            </div>
          </div>
        </>
      )}
    </>
  );
}
