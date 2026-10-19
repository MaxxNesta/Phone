import { getCompany, getPartnerCategories } from "@/lib/queries";
import { createPartnerCategory, updatePartnerCategory,
         setPartnerCategoryActive, deletePartnerCategory } from "@/lib/actions";
import { PartnerCategoryRow } from "@/components/partner-category-row";
import { SimpleForm } from "@/components/simple-form";
import { DataTable, type DataRow } from "@/components/data-table";
import { HelpHint } from "@/components/help-hint";
import { getTranslations } from "next-intl/server";

export default async function PartnerCategories() {
  const company = await getCompany();
  const t = await getTranslations("partnerCats");
  const c = await getTranslations("common");
  const it = await getTranslations("items");
  const f = await getTranslations("itemForm");
  const pt = await getTranslations("partners");
  if (!company) return <div className="empty">{c("noCompany")}</div>;

  const cats = (await getPartnerCategories(company.id)) as unknown as Array<
    Parameters<typeof PartnerCategoryRow>[0]["category"]
  >;
  const filed = cats.reduce((t, c) => t + Number(c.partners), 0);

  const rows: DataRow[] = cats.map((c) => ({
    key: c.id,
    searchText: [c.code, c.name, c.name_my, c.note].filter(Boolean).map(String).join(" "),
    sort: {
      kind: String(c.kind),
      sort_order: Number(c.sort_order),
      code: c.code,
      name: c.name,
      partners: Number(c.partners),
      customers: Number(c.customers),
      is_active: c.is_active ? 1 : 0,
    },
    node: (
      <PartnerCategoryRow
        category={c}
        updateAction={updatePartnerCategory}
        setActiveAction={setPartnerCategoryActive}
        deleteAction={deletePartnerCategory}
      />
    ),
  }));

  return (
    <>
      <div className="page-head">
        <span className="eyebrow">{it("masterData")}</span>
        <h1>{t("title")}</h1>
        <HelpHint>{t("help")}</HelpHint>
      </div>

      <SimpleForm action={createPartnerCategory} submitLabel={t("add")}>
        <div className="card">
          <div className="card-head"><h2>{t("new")}</h2></div>
          <div className="card-body">
            <div className="row">
              <div className="field">
                <label htmlFor="kind">{t("side")}</label>
                <select id="kind" name="kind" defaultValue="CUSTOMER">
                  <option value="CUSTOMER">{t("sideCustomer")}</option>
                  <option value="SUPPLIER">{t("sideSupplier")}</option>
                </select>
                <span className="hint">{t("sideHint")}</span>
              </div>
              <div className="field">
                <label htmlFor="code">{c("code")}</label>
                <input id="code" name="code" type="text" placeholder="SUPER" required />
              </div>
              <div className="field">
                <label htmlFor="name">{c("name")}</label>
                <input id="name" name="name" type="text" placeholder="Supermarket" required />
              </div>
              <div className="field">
                <label htmlFor="name_my">{f("nameBurmese")}</label>
                <input id="name_my" name="name_my" type="text" placeholder="မြန်မာလို အမည်" />
              </div>
              <div className="field">
                <label htmlFor="sort_order">{c("order")}</label>
                <input id="sort_order" name="sort_order" type="number" defaultValue={0} />
                <span className="hint">{t("orderHint")}</span>
              </div>
            </div>
            <div className="field" style={{ marginTop: "1rem" }}>
              <label htmlFor="note">{c("note")}</label>
              <input id="note" name="note" type="text"
                     placeholder={t("notePlaceholder")} />
            </div>
          </div>
        </div>
      </SimpleForm>

      <section>
        <div className="card">
          <div className="card-head">
            <h2>{t("categories")}</h2>
            <span className="page-sub">{t("summary", { n: cats.length, filed })}</span>
          </div>
          <DataTable
            rows={rows}
            emptyLabel={t("none")}
            searchPlaceholder={t("search")}
            defaultSort={{ key: "sort_order", dir: "asc" }}
            columns={[
              { key: "kind", label: t("side"), sortable: true },
              { key: "sort_order", label: "#", sortable: true, align: "r" },
              { key: "code", label: c("code"), sortable: true },
              { key: "name", label: c("category"), sortable: true },
              { key: "note", label: c("note") },
              { key: "customers", label: pt("customers"), sortable: true, align: "r" },
              { key: "suppliers", label: pt("suppliers"), sortable: true, align: "r" },
              { key: "is_active", label: c("status"), sortable: true },
              { key: "actions", label: "" },
            ]}
          />
        </div>
      </section>
    </>
  );
}
