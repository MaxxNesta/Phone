import Link from "next/link";
import { getCompany, getPartners } from "@/lib/queries";
import { sql } from "@/lib/db";
import { updatePartner, deactivatePartner, activatePartner, deletePartner } from "@/lib/actions";
import { PartnerRow } from "@/components/partner-row";
import { CustomerRow } from "@/components/customer-row";
import { CustomerPanelProvider } from "@/components/customer-panel";
import { DataTable, type DataRow } from "@/components/data-table";
import { HelpHint } from "@/components/help-hint";
import { getTranslations } from "next-intl/server";

export default async function Partners({
  searchParams,
}: {
  searchParams: Promise<{ role?: string; category?: string }>;
}) {
  const company = await getCompany();
  const t = await getTranslations("partners");
  const c = await getTranslations("common");
  const it = await getTranslations("items");
  if (!company) return <div className="empty">{c("noCompany")}</div>;

  const { role, category } = await searchParams;
  const all = (await getPartners(company.id)) as any[];
  const currencies = await sql`select code, name from currency order by code`;
  // The price columns this company keeps, so a customer can be put on one.
  const priceLevels = (await sql`
    select id, name from price_level where company_id = ${company.id} order by sort_order`
  ) as unknown as { id: string; name: string }[];
  const allCategories = (await sql`
    select id, name, kind from partner_category
     where company_id = ${company.id} and is_active order by sort_order, name`
  ) as unknown as { id: string; name: string; kind: string }[];
  const categories = allCategories.filter((c) => c.kind === "CUSTOMER");
  const supplierCategories = allCategories.filter((c) => c.kind === "SUPPLIER");

  // Customers and Suppliers in the nav are filtered views of this same
  // table, not separate lists — the same company is routinely both, and
  // splitting the data would mean reconciling one partner against itself.
  const byRole =
    role === "customer" ? all.filter((p) => p.is_customer)
    : role === "supplier" ? all.filter((p) => p.is_supplier)
    : all;

  /* ?category=<id> narrows to one kind of trade, and ?category=none to the
     ones nobody has classified — the second is the useful one while the
     field is still being filled in. */
  const partners =
    category === "none"
      ? byRole.filter((p) => (role === "supplier" ? !p.supplier_category_id : !p.category_id))
    : category
      ? byRole.filter((p) => p.category_id === category || p.supplier_category_id === category)
    : byRole;
  const uncategorised = byRole.filter((p) =>
    role === "supplier" ? !p.supplier_category_id : !p.category_id).length;
  // The filter bar offers the side being looked at.
  const filterCats = role === "supplier" ? supplierCategories : categories;

  if (role === "customer") {
    const cp = await getTranslations("customerPanel");
    const customers = byRole;
    const creditKind = (p: any) =>
      p.credit_limit === null ? "UNLIMITED"
      : Number(p.credit_limit) === 0 ? "NONE"
      : Number(p.available ?? p.credit_limit) < 0 ? "OVER" : "LIMIT";
    const distinct = (vals: (string | null)[]) =>
      [...new Set(vals.filter((v): v is string => !!v))].sort((a, b) => a.localeCompare(b));
    const crows: DataRow[] = customers.map((p) => ({
      key: p.id,
      searchText: [p.code, p.name, p.name_my, p.company_name, p.member_card_id, p.region,
                   p.township, p.phone, p.contact_person].filter(Boolean).join(" "),
      facet: {
        status: p.is_active ? "active" : "inactive",
        category: p.category_id ?? "none",
        credit: creditKind(p),
        region: p.region ?? "",
        township: p.township ?? "",
        price_level: p.price_level_id ?? "default",
        terms: String(Number(p.payment_terms_days)),
      },
      sort: {
        customer: p.code,
        company: p.company_name ?? "",
        location: `${p.township ?? ""} ${p.region ?? ""}`.trim(),
        price_level: p.price_level_name ?? "",
        outstanding: Number(p.outstanding),
        // Closest to the limit first when sorted descending; unlimited last.
        credit: p.credit_limit === null ? Number.MAX_SAFE_INTEGER : Number(p.available ?? p.credit_limit),
        status: p.is_active ? 1 : 0,
      },
      node: (
        <CustomerRow partner={p} deactivateAction={deactivatePartner}
          activateAction={activatePartner} deleteAction={deletePartner} />
      ),
    }));
    const termDays = [...new Set(customers.map((p) => Number(p.payment_terms_days)))].sort((a, b) => a - b);
    return (
      <>
        <datalist id="currency-codes">
          {currencies.map((c: any) => <option key={c.code} value={c.code}>{c.name}</option>)}
        </datalist>
        <CustomerPanelProvider customers={customers} priceLevels={priceLevels}
          categories={categories} updateAction={updatePartner}>
          <div className="page-head">
            <span className="eyebrow">{it("masterData")}</span>
            <h1>{t("customers")}</h1>
            <HelpHint>{t("filteredHelp")}</HelpHint>
          </div>
          <section>
            <div className="card">
              <div className="card-head">
                <span className="page-sub">{t("records", { n: customers.length })}</span>
                <span className="actions">
                  <Link href="/partners/new" className="btn">{t("newPartner")}</Link>
                </span>
              </div>
              <DataTable
                rows={crows}
                emptyLabel={t("noPartners")}
                searchPlaceholder={cp("searchCustomers")}
                defaultSort={{ key: "customer", dir: "asc" }}
                tableClassName="dt-compact ctable"
                storageKey="partners:customers:v2"
                initialFilters={category ? { category } : {}}
                filters={[
                  { key: "status", label: c("status"), allLabel: cp("allStatuses"),
                    options: [{ value: "active", label: t("activeLower") }, { value: "inactive", label: t("inactiveLower") }] },
                  { key: "category", label: c("category"), allLabel: cp("allCategories"),
                    options: [...categories.map((x) => ({ value: x.id, label: x.name })),
                              { value: "none", label: t("notCategorised") }] },
                  { key: "credit", label: cp("creditStatus"), allLabel: cp("allCredit"),
                    options: [{ value: "LIMIT", label: cp("withinLimit") }, { value: "OVER", label: cp("overLimit") },
                              { value: "NONE", label: cp("noCredit") }, { value: "UNLIMITED", label: cp("unlimited") }] },
                  { key: "region", label: t("region"), allLabel: cp("allRegions"), more: true,
                    options: distinct(customers.map((p) => p.region)).map((v) => ({ value: v, label: v })) },
                  { key: "township", label: t("township"), allLabel: cp("allTownships"), more: true,
                    options: distinct(customers.map((p) => p.township)).map((v) => ({ value: v, label: v })) },
                  { key: "price_level", label: t("priceLevel"), allLabel: cp("allPriceLevels"), more: true,
                    options: [{ value: "default", label: t("default") },
                              ...priceLevels.map((l) => ({ value: l.id, label: l.name }))] },
                  { key: "terms", label: t("terms"), allLabel: cp("allTerms"), more: true,
                    options: termDays.map((d) => ({ value: String(d), label: d === 0 ? t("noCreditAllowed") : t("days", { n: d }) })) },
                ]}
                columns={[
                  { key: "customer", label: cp("customer"), sortable: true },
                  { key: "company", label: cp("company"), sortable: true },
                  { key: "location", label: cp("location"), sortable: true },
                  { key: "price_level", label: t("priceLevel"), sortable: true },
                  { key: "outstanding", label: t("outstanding"), sortable: true, align: "r" },
                  { key: "credit", label: cp("credit"), sortable: true, align: "r" },
                  { key: "status", label: c("status"), sortable: true },
                  { key: "actions", label: "" },
                ]}
              />
            </div>
          </section>
        </CustomerPanelProvider>
      </>
    );
  }

  const rows: DataRow[] = partners.map((p) => ({
    key: p.id,
    searchText: [p.code, p.name, p.name_my, p.company_name, p.member_card_id, p.region, p.township].filter(Boolean).join(" "),
    sort: {
      code: p.code,
      name: p.name,
      company_name: p.company_name ?? "",
      member: p.member_card_id ?? "",
      role: `${p.is_customer ? t("customer") : ""} ${p.is_supplier ? t("supplier") : ""}`.trim(),
      region: p.region ?? "",
      township: p.township ?? "",
      price_level: p.price_level_name ?? "",
      category: (role === "supplier" ? p.supplier_category_name : p.category_name) ?? "",
      payment_terms_days: Number(p.payment_terms_days),
      outstanding: Number(p.outstanding),
      // Sorting by what is left of a limit puts whoever is closest to it at
      // the top. Customers with no limit sort last rather than first, since
      // "not set" is not the same as "nothing left".
      credit_limit: p.credit_limit === null ? -1 : Number(p.credit_limit),
      available: p.credit_limit === null
        ? Number.MAX_SAFE_INTEGER
        : Number(p.available ?? p.credit_limit),
      is_active: p.is_active ? 1 : 0,
    },
    node: (
      <PartnerRow
        partner={p}
        priceLevels={priceLevels}
        categories={categories}
        supplierCategories={supplierCategories}
        updateAction={updatePartner}
        deactivateAction={deactivatePartner}
        activateAction={activatePartner}
        deleteAction={deletePartner}
      />
    ),
  }));

  return (
    <>
      {/* One list of codes for every row's currency field. */}
      <datalist id="currency-codes">
        {currencies.map((c: any) => <option key={c.code} value={c.code}>{c.name}</option>)}
      </datalist>
      <div className="page-head">
        <span className="eyebrow">{it("masterData")}</span>
        <h1>{role === "customer" ? t("customers") : role === "supplier" ? t("suppliers") : t("businessPartners")}</h1>
        <HelpHint>
          {role
            ? t("filteredHelp")
            : t("allHelp")}
        </HelpHint>
      </div>

      <section>
        <div className="card">
          <div className="card-head">
            <h2>{role === "customer" ? t("customers") : role === "supplier" ? t("suppliers") : t("partners")}</h2>
            <span className="actions">
              {/* Only offered once categories exist, and the uncategorised
                  count is shown because a classification half filled in is
                  worse than none — it looks complete on a report. */}
              {filterCats.length > 0 && (
                <span className="page-sub">
                  <Link href={role ? `/partners?role=${role}` : "/partners"}
                        style={{ color: !category ? "var(--brand)" : "inherit" }}>
                    {c("all")}
                  </Link>
                  {filterCats.map((c) => (
                    <span key={c.id}>
                      {" · "}
                      <Link href={`/partners?${role ? `role=${role}&` : ""}category=${c.id}`}
                            style={{ color: category === c.id ? "var(--brand)" : "inherit" }}>
                        {c.name}
                      </Link>
                    </span>
                  ))}
                  {uncategorised > 0 && (
                    <>
                      {" · "}
                      <Link href={`/partners?${role ? `role=${role}&` : ""}category=none`}
                            style={{ color: category === "none" ? "var(--brand)" : "inherit" }}>
                        {t("notCategorisedN", { n: uncategorised })}
                      </Link>
                    </>
                  )}
                </span>
              )}
              <span className="page-sub">{t("records", { n: partners.length })}</span>
              <Link href="/partners/new" className="btn">{t("newPartner")}</Link>
            </span>
          </div>
          <DataTable
            rows={rows}
            emptyLabel={t("noPartners")}
            searchPlaceholder={t("searchPartners")}
            defaultSort={{ key: "code", dir: "asc" }}
            tableClassName="dt-compact"
            storageKey={`partners:${role ?? "all"}`}
            defaultHidden={role === "customer" ? ["price_level", "outstanding"] : []}
            columns={[
              { key: "code", label: c("code"), sortable: true },
              { key: "name", label: c("name"), sortable: true },
              { key: "company_name", label: t("companyName"), sortable: true },
              ...(role !== "supplier" ? [{ key: "member", label: t("memberCard"), sortable: true }] : []),
              ...(!role ? [{ key: "role", label: t("role"), sortable: true }] : []),
              { key: "region", label: t("region"), sortable: true },
              { key: "township", label: t("township"), sortable: true },
              { key: "price_level", label: t("priceLevel"), sortable: true },
              { key: "category", label: c("category"), sortable: true },
              { key: "payment_terms_days", label: t("terms"), sortable: true, align: "r" },
              { key: "outstanding", label: t("outstanding"), sortable: true, align: "r" },
              { key: "credit_limit", label: t("creditLimit"), sortable: true, align: "r" },
              { key: "available", label: t("leftToSpend"), sortable: true, align: "r" },
              { key: "is_active", label: c("status"), sortable: true },
              { key: "actions", label: "" },
            ]}
          />
        </div>
      </section>
    </>
  );
}
