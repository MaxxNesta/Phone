import { getCompany, getItems, getPartners, getSupplierItems } from "@/lib/queries";
import { saveSupplierItem, deleteSupplierItem } from "@/lib/actions";
import { SupplierItemForm, SupplierItemRow } from "@/components/supplier-item-form";
import { HelpHint } from "@/components/help-hint";
import { paginate } from "@/lib/paging";
import { Pager } from "@/components/pager";
import { getTranslations } from "next-intl/server";

/**
 * Purchasing terms, recorded only where they are unusual.
 *
 * Nearly every item comes from its supplier at that supplier's usual
 * speed, and nearly every company will leave this page empty. It exists
 * for the one product that is made to order while everything else sits in
 * a warehouse — the exception that a single figure on the supplier cannot
 * express.
 *
 * Three levels, most specific first:
 *   this item from this supplier  → a row here
 *   this supplier generally       → Partners, on the supplier
 *   knowing nothing               → the company default
 */
export default async function PurchasingTerms({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const company = await getCompany();
  const pu = await getTranslations("purchasing");
  const c = await getTranslations("common");
  const cat = await getTranslations("categories");
  if (!company) return <div className="empty">{c("noCompany")}</div>;

  const [rows, partners, items] = await Promise.all([
    getSupplierItems(company.id) as unknown as Promise<any[]>,
    getPartners(company.id) as unknown as Promise<any[]>,
    getItems(company.id) as unknown as Promise<any[]>,
  ]);

  const suppliers = partners
    .filter((p) => p.is_supplier && p.is_active)
    .map((p) => ({ id: p.id, code: p.code, name: p.name,
                   lead_time_days: p.lead_time_days as number | null }));
  // A product with variants cannot be bought — its variants are.
  const buyable = items
    .filter((i) => i.is_stocked && i.variant_count === 0)
    .map((i) => ({ id: i.id, code: i.code, name: i.name }));

  const pg = paginate(rows, sp.page);
  return (
    <>
      <div className="page-head hero">
        <span className="eyebrow">{cat("eyebrow")}</span>
        <h1>{pu("title")}</h1>
        <HelpHint>{pu("help", { days: company.default_lead_time_days })}</HelpHint>
        <p className="page-sub">{pu("sub")}</p>
      </div>

      <SupplierItemForm
        action={saveSupplierItem}
        suppliers={suppliers}
        items={buyable}
        companyDefault={company.default_lead_time_days}
      />

      {rows.length === 0 ? (
        <div className="empty">
          {pu("noExceptions")}
        </div>
      ) : (
        <section>
          <div className="card">
            <div className="card-head">
              <h2>{pu("exceptions")}</h2>
              <span className="page-sub">{pu("exceptionsSub", { n: rows.length })}</span>
            </div>
            <div className="tablewrap">
              <table>
                <thead>
                  <tr>
                    <th>{pu("itemSupplier")}</th>
                    <th className="r">{pu("usual")}</th>
                    <th className="r">{pu("override")}</th>
                    <th className="r">{pu("effective")}</th>
                    <th>{pu("theirCode")}</th><th>{c("note")}</th><th />
                  </tr>
                </thead>
                <tbody>
                  {pg.rows.map((r) => (
                    <SupplierItemRow
                      key={r.id}
                      row={r}
                      companyDefault={company.default_lead_time_days}
                      remove={deleteSupplierItem}
                    />
                  ))}
                </tbody>
              </table>
              <Pager p={pg} params={sp} />
            </div>
          </div>
        </section>
      )}
    </>
  );
}
