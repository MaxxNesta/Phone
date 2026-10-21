import Link from "next/link";
import { getCompany, getImportBatches } from "@/lib/queries";
import { runItemImport } from "@/lib/actions";
import { ItemImport } from "@/components/item-import";
import { HelpHint } from "@/components/help-hint";
import { getTranslations } from "next-intl/server";

export default async function ImportItems() {
  const t = await getTranslations("itemImport");
  const c = await getTranslations("common");
  const company = await getCompany();
  if (!company) return <div className="empty">{c("noCompany")}</div>;

  const batches = (await getImportBatches(company.id)) as unknown as Array<{
    id: string; ref: string; filename: string; row_count: number;
    status: string; created_at: string; items_created: number; documents: number;
  }>;

  return (
    <>
      <div className="page-head">
        <span className="eyebrow">{t("eyebrow")}</span>
        <h1>{t("title")}</h1>
        <HelpHint>
          {t("help")}
        </HelpHint>
        <Link href="/items" className="btn ghost">{t("backToItems")}</Link>
      </div>

      <ItemImport action={runItemImport} />

      <section>
        <div className="card">
          <div className="card-head">
            <h2>{t("pastImports")}</h2>
            <span className="page-sub">{batches.length}</span>
          </div>
          {batches.length === 0 ? (
            <div className="empty">{t("nothingYet")}</div>
          ) : (
            <div className="tablewrap">
              <table>
                <thead>
                  <tr>
                    <th>{t("reference")}</th><th>{t("file")}</th><th>{t("when")}</th>
                    <th className="r">{t("rows")}</th><th className="r">{t("itemsCreated")}</th>
                    <th className="r">{t("documents")}</th><th>{c("status")}</th>
                  </tr>
                </thead>
                <tbody>
                  {batches.map((b) => (
                    <tr key={b.id}>
                      <td className="code">{b.ref}</td>
                      <td className="wrap">{b.filename}</td>
                      <td>{new Date(b.created_at).toLocaleString("en-GB", {
                            day: "2-digit", month: "short", year: "numeric",
                            hour: "2-digit", minute: "2-digit" })}</td>
                      <td className="r">{b.row_count}</td>
                      <td className="r">{b.items_created}</td>
                      <td className="r">{b.documents}</td>
                      <td>
                        <span className={`pill ${b.status === "COMPLETED" ? "ok" : "overdue"}`}>
                          {t.has(`status.${b.status}`) ? t(`status.${b.status}`) : b.status.toLowerCase()}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </>
  );
}
