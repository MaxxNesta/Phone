import { BranchScope } from "@/components/branch-scope";
import { seenLocations } from "@/lib/branch-scope";
import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { warrantyLookup, warrantiesEnding } from "@/lib/phone";
import { shortDate } from "@/lib/format";
import { paginate } from "@/lib/paging";
import { Pager } from "@/components/pager";
import { getTranslations } from "next-intl/server";

export async function generateMetadata() {
  return { title: (await getTranslations("inventory"))("war.title") };
}

const STATE: Record<string, [string, string]> = {
  ACTIVE: ["war.stActive", "ok"], ENDING: ["war.stEnding", "warn"], EXPIRED: ["war.stExpired", "reversed"],
};

export default async function Warranty({ searchParams }: { searchParams: Promise<{ q?: string; ending?: string; page?: string }> }) {
  const user = await requirePermission("inventory.view");
  const t = await getTranslations("inventory");
  const c = await getTranslations("common");
  const sp = await searchParams;
  const { q, ending } = sp;
  // Phones sold at other branches stay out of view for someone who sees only their own.
  const locs = await seenLocations();
  const rows = q ? await warrantyLookup(user.companyId, q, locs)
    : await warrantiesEnding(user.companyId, Number(ending) || 30, locs);

  const pg = paginate(rows, sp.page);
  return (
    <>
      <div className="page-head hero">
        <h1>{t("war.lookup")}</h1>
        <BranchScope />
        <p className="page-sub">{t("war.sub")}</p>
      </div>
      <form className="card filters" method="get">
        <div className="card-body filter-row">
          <div className="field">
            <label htmlFor="wq">{t("war.field")}</label>
            <input id="wq" name="q" defaultValue={q ?? ""} autoFocus placeholder={t("war.scan")} />
          </div>
          <button className="btn">{t("war.lookupBtn")}</button>
        </div>
      </form>

      <div className="card" style={{ overflowX: "auto" }}>
        <div className="card-head">
          <h2>{q ? t("war.resultsFor", { q }) : t("war.ending", { n: Number(ending) || 30 })}</h2>
        </div>
        <table>
          <thead>
            <tr><th>{c("imei")}</th><th>{t("war.model")}</th><th>{t("war.customer")}</th><th>{t("war.invoice")}</th><th>{t("war.sold")}</th><th>{t("war.warranty")}</th><th>{t("war.expires")}</th><th>{c("status")}</th></tr>
          </thead>
          <tbody>
            {pg.rows.map((r: any) => {
              const st = r.warranty_state ? STATE[r.warranty_state] : null;
              return (
                <tr key={r.serial_id}>
                  <td className="m"><Link href={`/inventory/phones/${r.serial_id}`}>{r.imei}</Link></td>
                  <td>{r.item_name}</td>
                  <td>{r.customer_name ?? "—"}</td>
                  <td>{r.out_document_id ? <Link href={`/documents/${r.out_document_id}`}>{r.out_doc_no}</Link> : "—"}</td>
                  <td>{r.out_date ? shortDate(r.out_date) : "—"}</td>
                  <td>{r.warranty_months ? t("war.months", { n: r.warranty_months }) : "—"}</td>
                  <td>{r.warranty_expiry ? shortDate(r.warranty_expiry) : "—"}</td>
                  <td>{st ? <span className={`pill ${st[1]}`}>{t(st[0])}</span> : (r.status ?? "").replace(/_/g, " ").toLowerCase() || "—"}</td>
                </tr>
              );
            })}
            {rows.length === 0 && <tr><td colSpan={8} className="page-sub">{q ? t("war.nothingFound") : t("war.noneEnding")}</td></tr>}
          </tbody>
        </table>
        <Pager p={pg} params={sp} />
      </div>
      <p className="page-sub">
        {t("war.note")}
      </p>
    </>
  );
}
