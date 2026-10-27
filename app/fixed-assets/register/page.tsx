import Link from "next/link";
import { canPostFa } from "@/lib/fa-access";
import { Plus } from "lucide-react";
import { requirePermission } from "@/lib/auth";
import { seenLocations } from "@/lib/branch-scope";
import { assetList, faCategories, faBranches, FA_STATUS, FA_STATUS_LABEL } from "@/lib/fixed-assets";
import { DataTable, type DataRow } from "@/components/data-table";
import { Breadcrumbs } from "@/components/breadcrumbs";

export const metadata = { title: "Asset Register" };

const money = (v: string) => Number(v).toLocaleString("en-US", { maximumFractionDigits: 0 });
const life = (m: number) => (m % 12 === 0 ? `${m / 12} yr` : m > 12 ? `${Math.floor(m / 12)} yr ${m % 12} mo` : `${m} mo`);

/**
 * Every asset with what the ledger has carried for it: cost, accumulated
 * depreciation, net book value. Searched, sorted and paged in the table; the
 * accounting figures come from the posted records, never typed here.
 */
export default async function AssetRegister({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const user = await requirePermission("accounting.view");
  const co = user.companyId;
  const canEdit = canPostFa(user);
  const [rows, categories, branches] = await Promise.all([assetList(co, await seenLocations()), faCategories(co), faBranches(co)]);
  const multiBranch = branches.length > 1;

  const data: DataRow[] = rows.map((r) => ({
    key: r.id,
    searchText: [r.code, r.name, r.category, r.branch, r.site, r.serial_no].filter(Boolean).join(" "),
    facet: { status: r.status, category: r.category_id, branch: r.branch_id },
    sort: {
      code: r.code, name: r.name, category: r.category, branch: r.branch, acquired: r.acquisition_date,
      in_service: r.in_service_date ?? "", cost: Number(r.acquisition_cost), residual: Number(r.residual_value),
      life: r.useful_life_months, accumulated: Number(r.accumulated), nbv: Number(r.nbv), status: r.status,
    },
    csv: {
      code: r.code, name: r.name, category: r.category, branch: r.branch, site: r.site ?? "",
      acquired: r.acquisition_date, in_service: r.in_service_date ?? "", cost: r.acquisition_cost,
      residual: r.residual_value, life: r.useful_life_months, method: "Straight line",
      accumulated: r.accumulated, nbv: r.nbv, status: FA_STATUS_LABEL[r.status], journal: r.acquisition_journal_no ?? "",
    },
    node: (
      <tr key={r.id} data-saved={sp.saved === r.id || undefined}>
        <td className="code"><Link href={`/fixed-assets/${r.id}`}>{r.code}</Link></td>
        <td className="wrap"><strong className="fa-name">{r.name}</strong>
          {r.serial_no && <span className="subline">S/N {r.serial_no}</span>}</td>
        <td>{r.category}{r.asset_class === "INTANGIBLE" && <span className="subline">Amortised</span>}</td>
        {multiBranch && <td>{r.branch}</td>}
        <td>{r.site ?? "—"}</td>
        <td className="nowrap">{r.acquisition_date}</td>
        <td className="nowrap">{r.in_service_date ?? "—"}</td>
        <td className="r">{money(r.acquisition_cost)}</td>
        <td className="r">{money(r.residual_value)}</td>
        <td className="r nowrap">{life(r.useful_life_months)}</td>
        <td>Straight line</td>
        <td className="r">{money(r.accumulated)}</td>
        <td className="r"><strong>{money(r.nbv)}</strong></td>
        <td><span className={`fa-status ${r.status.toLowerCase()}`}>{FA_STATUS_LABEL[r.status]}</span></td>
        <td>{r.acquisition_journal_id ? <Link href={`/finance/journal?entry=${r.acquisition_journal_id}`}>{r.acquisition_journal_no}</Link> : "—"}</td>
      </tr>
    ),
  }));

  return (
    <div className="fa">
      <Breadcrumbs trail={[{ label: "Fixed Assets", href: "/fixed-assets" }, { label: "Asset Register" }]} />
      <div className="fa-head">
        <div>
          <h1>Asset Register</h1>
          <p>Every asset, its cost, depreciation to date and net book value.</p>
        </div>
        {canEdit && <Link className="ie-btn primary" href="/fixed-assets/new"><Plus size={15} aria-hidden="true" /> Add asset</Link>}
      </div>

      <section className="card">
        {rows.length === 0 ? (
          <div className="fa-empty">
            <strong>No assets yet</strong>
            <span>Add the shop&apos;s generators, computers, furniture and vehicles. Phones for sale stay in inventory.</span>
            {canEdit && <Link className="ie-btn primary" href="/fixed-assets/new"><Plus size={15} aria-hidden="true" /> Add the first asset</Link>}
          </div>
        ) : (
          <DataTable
            rows={data}
            storageKey="fa-register"
            csvFilename="asset-register.csv"
            searchPlaceholder="Search code, name, serial, location…"
            defaultSort={{ key: "code", dir: "asc" }}
            defaultHidden={["site", "residual", "method", "journal"]}
            filters={[
              { key: "status", allLabel: "All statuses", label: "Status",
                options: FA_STATUS.map((s) => ({ value: s, label: FA_STATUS_LABEL[s] })) },
              { key: "category", allLabel: "All categories", label: "Category",
                options: categories.map((c) => ({ value: c.id, label: c.name })) },
              ...(multiBranch ? [{ key: "branch", allLabel: "All branches", label: "Branch",
                options: branches.map((b) => ({ value: b.id, label: b.name })) }] : []),
            ]}
            columns={[
              { key: "code", label: "Code", sortable: true },
              { key: "name", label: "Asset", sortable: true },
              { key: "category", label: "Category", sortable: true },
              ...(multiBranch ? [{ key: "branch", label: "Branch", sortable: true }] : []),
              { key: "site", label: "Location" },
              { key: "acquired", label: "Acquired", sortable: true },
              { key: "in_service", label: "In service", sortable: true },
              { key: "cost", label: "Cost (MMK)", sortable: true, align: "r" },
              { key: "residual", label: "Residual", sortable: true, align: "r" },
              { key: "life", label: "Useful life", sortable: true, align: "r" },
              { key: "method", label: "Method" },
              { key: "accumulated", label: "Accum. dep.", sortable: true, align: "r" },
              { key: "nbv", label: "Net book value", sortable: true, align: "r" },
              { key: "status", label: "Status", sortable: true },
              { key: "journal", label: "Acquisition journal" },
            ]}
          />
        )}
      </section>
    </div>
  );
}
