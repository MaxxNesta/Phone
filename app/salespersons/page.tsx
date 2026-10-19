import { getCompany, getSalesmen, getLocations } from "@/lib/queries";
import { createSalesman, updateSalesman, deleteSalesman, deactivateSalesman, activateSalesman } from "@/lib/actions";
import { AddSalesmanForm } from "@/components/salesman-form";
import { SalesmanRow } from "@/components/salesman-row";
import { DataTable, type DataRow } from "@/components/data-table";
import { HelpHint } from "@/components/help-hint";
import { getTranslations } from "next-intl/server";

export default async function Salespersons() {
  const company = await getCompany();
  const s = await getTranslations("salespersons");
  const c = await getTranslations("common");
  const l = await getTranslations("locations");
  const pt = await getTranslations("partners");
  if (!company) return <div className="empty">{c("noCompany")}</div>;

  const [salesmen, locations] = (await Promise.all([
    getSalesmen(company.id),
    getLocations(company.id),
  ])) as unknown as [
    Array<{
      id: string; code: string; name: string; name_my: string | null;
      phone: string | null; location_id: string | null; location_name: string | null;
      commission_pct: string; is_active: boolean;
    }>,
    Array<{ id: string; code: string; name: string }>,
  ];

  const rows: DataRow[] = salesmen.map((s) => ({
    key: s.id,
    searchText: [s.code, s.name, s.name_my, s.phone, s.location_name].filter(Boolean).join(" "),
    sort: {
      code: s.code,
      name: s.name,
      phone: s.phone ?? "",
      location_name: s.location_name ?? "",
      commission_pct: Number(s.commission_pct),
    },
    node: (
      <SalesmanRow
        salesman={s}
        locations={locations}
        updateAction={updateSalesman}
        deleteAction={deleteSalesman}
        deactivateAction={deactivateSalesman}
        activateAction={activateSalesman}
      />
    ),
  }));

  return (
    <>
      <div className="page-head hero">
        <span className="eyebrow">{l("eyebrow")}</span>
        <h1>{s("title")}</h1>
        <HelpHint>
          Staff who get credited on a sale. Commission is reported on here,
          not paid automatically &mdash; paying it out is a payroll matter.
        </HelpHint>
        <p className="page-sub">{s("sub")}</p>
      </div>

      <AddSalesmanForm action={createSalesman} locations={locations} />

      <section>
        <div className="card">
          <div className="card-head">
            <h2>{s("title")}</h2>
            <span className="page-sub">{salesmen.length}</span>
          </div>

          {salesmen.length === 0 ? (
            <div className="empty">{s("noneYet")}</div>
          ) : (
            <DataTable
              rows={rows}
              emptyLabel={s("none")}
              searchPlaceholder={s("search")}
              defaultSort={{ key: "code", dir: "asc" }}
              columns={[
                { key: "code", label: c("code"), sortable: true },
                { key: "name", label: c("name"), sortable: true },
                { key: "phone", label: pt("phone"), sortable: true },
                { key: "location_name", label: s("branch"), sortable: true },
                { key: "commission_pct", label: s("commissionShort"), sortable: true, align: "r" },
                { key: "actions", label: "" },
              ]}
            />
          )}
        </div>
      </section>
    </>
  );
}
