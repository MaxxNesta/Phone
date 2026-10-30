import { BranchScope } from "@/components/branch-scope";
import { seenLocations } from "@/lib/branch-scope";
import { periodFromParams } from "@/lib/date-range";
import { UrlDateFilter } from "@/components/date-filter";
import Link from "next/link";
import { money, moneyOrTrace } from "@/lib/db";
import { getCompany, getPartnerBalances } from "@/lib/queries";
import { unbilledReceipts, unbilledBySupplier } from "@/lib/unbilled";
import { DataTable, type DataRow } from "@/components/data-table";
import { HelpHint } from "@/components/help-hint";
import { CouriersView } from "./couriers-view";
import { costSection } from "@/lib/courier-payables";

const TABS: Array<["" | "current" | "overdue" | "partial", string]> = [
  ["", "All"],
  ["current", "Current"],
  ["overdue", "Overdue"],
  ["partial", "Partially Paid"],
];

export default async function Payables({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; date?: string; from?: string; to?: string; view?: string }>;
}) {
  const sp = await searchParams;
  const couriers = sp.view === "couriers";
  const { status } = sp;
  // Invoices posted in the chosen period only; the tabs keep the period.
  const period = periodFromParams(sp);
  const keep = new URLSearchParams(Object.entries({ date: sp.date, from: sp.from, to: sp.to })
    .filter(([, v]) => v) as [string, string][]);
  const tabHref = (value: string) => {
    const q = new URLSearchParams(keep);
    if (value) q.set("status", value);
    return q.size ? `/payables?${q}` : "/payables";
  };
  const company = await getCompany();
  if (!company) return <div className="empty">No company found.</div>;
  const section = await costSection(company.id);

  // Two kinds of creditor: suppliers billing goods, and couriers owed for
  // bringing them in. Each its own tab, same page.
  const head = (
    <>
      <div className="page-head">
        <span className="eyebrow">Purchases</span>
        <h1>Payables</h1>
        <BranchScope />
        <HelpHint>
          {couriers
            ? `${section === "Landed costs" ? "Import cost" : "Carriage inward"} bills recorded as Pay later: what was charged for bringing goods in, what has been paid, and what is still open. Each bill is paid on its own or all together.`
            : "What you owe each supplier, rolled up from their open bills — not a balance kept on the supplier, so it can never drift from the invoices behind it."}
        </HelpHint>
      </div>
      <div className="vtabs pay-tabs" role="tablist" aria-label="Payables">
        <Link href="/payables" role="tab" aria-selected={!couriers} className={!couriers ? "on" : undefined}>Suppliers</Link>
        <Link href="/payables?view=couriers" role="tab" aria-selected={couriers} className={couriers ? "on" : undefined}>{section}</Link>
      </div>
    </>
  );
  if (couriers) return <>{head}<CouriersView companyId={company.id} section={section} /></>;

  const [billed, unbilledRows] = await Promise.all([
    getPartnerBalances(company.id, "PURCHASE_INVOICE", await seenLocations(), period) as Promise<any[]>,
    seenLocations().then((locs) => unbilledReceipts(company.id, locs))
      .then((rows) => period ? rows.filter((r) => r.docDate >= period.from && r.docDate < period.to) : rows),
  ]);
  // Goods in with no bill yet: not a payable in the books, but owed. Shown
  // beside each supplier's balance, and suppliers owed only that get a row.
  const unbilled = new Map(unbilledBySupplier(unbilledRows).map((u) => [u.partnerId, u]));
  const all: any[] = [
    ...billed,
    ...[...unbilled.values()].filter((u) => !billed.some((b) => b.partner_id === u.partnerId))
      .map((u) => ({ partner_id: u.partnerId, partner_name: u.partnerName, partner_code: u.partnerCode,
                     open_invoices: 0, outstanding: 0, overdue: 0, paid: 0 })),
  ];
  const unbilledOf = (id: string) => unbilled.get(id)?.value ?? 0;
  const totalUnbilled = [...unbilled.values()].reduce((s, u) => s + u.value, 0);

  const rowState = (r: any) => {
    // A remnant below the currency's smallest unit is not a debt anybody can
    // settle, so it is not overdue — it would otherwise sit in this tab
    // showing "0" and reading as an empty list with a row in it.
    if (r.overdue_material) return "overdue";
    if (Number(r.paid) > 0 && Number(r.outstanding) > 0) return "partial";
    return "current";
  };

  const suppliers = status ? all.filter((r) => rowState(r) === status) : all;

  const totalPayable = all.reduce((s, r) => s + Number(r.outstanding), 0);
  const totalOverdue = all.reduce((s, r) => s + Number(r.overdue ?? 0), 0);
  const totalDueSoon = all.reduce((s, r) => s + Number(r.due_soon ?? 0), 0);

  const rows: DataRow[] = suppliers.map((s) => ({
    key: s.partner_id,
    searchText: [s.partner_code, s.partner_name].filter(Boolean).join(" "),
    sort: {
      partner_name: s.partner_name ?? "",
      open_invoices: Number(s.open_invoices),
      outstanding: Number(s.outstanding),
      overdue: Number(s.overdue ?? 0),
      unbilled: unbilledOf(s.partner_id),
    },
    node: (
      <tr className="link">
        <td className="wrap">
          <strong>{s.partner_name}</strong>
          <div className="m" style={{ color: "var(--muted)" }}>{s.partner_code}</div>
        </td>
        <td className="r">{s.open_invoices}</td>
        <td className="r">{money(s.outstanding)}</td>
        <td className="r" style={{ color: Number(s.overdue) > 0 ? "var(--bad)" : undefined }}>
          {Number(s.overdue) > 0 ? money(s.overdue) : "—"}
        </td>
        <td className="r" style={{ color: unbilledOf(s.partner_id) > 0 ? "var(--warn)" : undefined }}>
          {unbilledOf(s.partner_id) > 0 ? money(unbilledOf(s.partner_id)) : "—"}
        </td>
        <td className="tight">
          <Link href={`/purchases/invoices?supplier=${s.partner_id}`} className="btn ghost tiny">View</Link>
        </td>
      </tr>
    ),
  }));

  return (
    <>
      {head}

      <div className="kpis">
        <div className="kpi">
          <span className="kpi-label">Total Payable</span>
          <span className="kpi-value">{moneyOrTrace(totalPayable)}</span>
        </div>
        <div className="kpi">
          <span className="kpi-label">Overdue</span>
          <span className="kpi-value" style={{ color: totalOverdue > 0 ? "var(--bad)" : undefined }}>
            {moneyOrTrace(totalOverdue)}
          </span>
        </div>
        <div className="kpi">
          <span className="kpi-label">Due Soon</span>
          <span className="kpi-value">{money(totalDueSoon)}</span>
          <span className="kpi-note">within 7 days</span>
        </div>
        <div className="kpi">
          <span className="kpi-label">Received, not billed</span>
          <span className="kpi-value" style={{ color: totalUnbilled > 0 ? "var(--warn)" : undefined }}>{money(totalUnbilled)}</span>
          <span className="kpi-note"><Link href="/purchases/received-not-invoiced">goods in awaiting their invoice</Link></span>
        </div>
      </div>

      <div className="flow">
        {TABS.map(([value, label]) => (
          <Link
            key={value}
            href={tabHref(value)}
            className={`flow-node ${(status ?? "") === value ? "here" : ""}`}
          >
            {label}
          </Link>
        ))}
      </div>

      <section>
        <div className="card">
          <div className="card-head">
            <h2>Suppliers</h2>
            <span className="actions">
              <UrlDateFilter />
              <span className="page-sub">{suppliers.length} with a balance</span>
              <Link href="/payables/pay" className="btn">Pay supplier</Link>
            </span>
          </div>
          <DataTable
            rows={rows}
            emptyLabel="Nothing outstanding"
            searchPlaceholder="Search suppliers…"
            defaultSort={{ key: "outstanding", dir: "desc" }}
            columns={[
              { key: "partner_name", label: "Supplier", sortable: true },
              { key: "open_invoices", label: "Invoices", sortable: true, align: "r" },
              { key: "outstanding", label: "Outstanding", sortable: true, align: "r" },
              { key: "overdue", label: "Overdue", sortable: true, align: "r" },
              { key: "unbilled", label: "Received, not billed", sortable: true, align: "r" },
              { key: "actions", label: "" },
            ]}
            footer={
              <tr>
                <td colSpan={2}>Total outstanding</td>
                <td className="r">{moneyOrTrace(totalPayable)}</td>
                <td className="r">{moneyOrTrace(totalOverdue)}</td>
                <td className="r">{money(totalUnbilled)}</td>
                <td />
              </tr>
            }
          />
        </div>
      </section>
    </>
  );
}
