import { sql } from "@/lib/db";
import { currentUser, can } from "@/lib/auth";
import { createBrand, updateBrand, deactivateBrand, activateBrand, deleteBrand } from "@/lib/actions";
import { AddBrandForm } from "@/components/brand-form";
import { BrandRow } from "@/components/brand-row";
import { DataTable, type DataRow } from "@/components/data-table";
import { HelpHint } from "@/components/help-hint";

export default async function Brands() {
  const [co] = await sql`select id from company order by created_at limit 1`;
  if (!co) return <div className="empty">No company found.</div>;

  const brands = (await sql`
    select b.id, b.code, b.name, b.name_my, b.is_active, count(i.id)::int as items
      from brand b
      left join item i on i.brand_id = b.id
     where b.company_id = ${co.id}
     group by b.id
     order by b.name`) as any[];

  const rows: DataRow[] = brands.map((b) => ({
    key: b.id,
    searchText: [b.code, b.name, b.name_my].filter(Boolean).join(" "),
    sort: { code: b.code, name: b.name, items: Number(b.items), is_active: b.is_active ? 1 : 0 },
    node: (
      <BrandRow
        brand={b}
        updateAction={updateBrand}
        deactivateAction={deactivateBrand}
        activateAction={activateBrand}
        deleteAction={deleteBrand}
      />
    ),
  }));

  return (
    <>
      <div className="page-head hero">
        <span className="eyebrow">Settings · Catalogue</span>
        <h1>Brands</h1>
        <HelpHint>
          A flat list, on purpose &mdash; the same brand shows up under many
          different categories, so it doesn&rsquo;t belong on the category
          tree itself.
        </HelpHint>
        <p className="page-sub">The makers products are filed under.</p>
      </div>

      {/* Owner only: the shop sells Apple, and another brand is asked twice. */}
      {can((await currentUser())!, "brands.manage") && <AddBrandForm action={createBrand} />}

      <section>
        <div className="card">
          <div className="card-head">
            <h2>Brands</h2>
            <span className="page-sub">{brands.length}</span>
          </div>

          {brands.length === 0 ? (
            <div className="empty">
              Nothing yet. Add a brand, or leave items unbranded &mdash; it&rsquo;s optional.
            </div>
          ) : (
            <DataTable
              rows={rows}
              emptyLabel="No brands"
              searchPlaceholder="Search brands…"
              defaultSort={{ key: "name", dir: "asc" }}
              columns={[
                { key: "code", label: "Code", sortable: true },
                { key: "name", label: "Name", sortable: true },
                { key: "items", label: "Items", sortable: true, align: "r" },
                { key: "is_active", label: "Status", sortable: true },
                { key: "actions", label: "" },
              ]}
            />
          )}
        </div>
      </section>
    </>
  );
}
