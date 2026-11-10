import { BranchScope } from "@/components/branch-scope";
import { PartnerTabs } from "@/components/partner-tabs";
import { seenLocations, scopedBranch } from "@/lib/branch-scope";
import { periodFromParams } from "@/lib/date-range";
import { UrlDateFilter } from "@/components/date-filter";
import Link from "next/link";
import { money, moneyOrTrace, sql } from "@/lib/db";
import { getCompany, getPartnerBalances, openBillsByPartner } from "@/lib/queries";
import { BalanceRow } from "@/components/balance-row";
import { unbilledReceipts, unbilledBySupplier } from "@/lib/unbilled";
import { DataTable, type DataRow } from "@/components/data-table";
import { HelpHint } from "@/components/help-hint";
import { CouriersView } from "./couriers-view";
import { costSection } from "@/lib/courier-payables";
import { getAdvanceBalances } from "@/lib/partner-ledger";

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
      <PartnerTabs side="SUPPLIER" active={couriers ? "couriers" : "list"} section={section} />
    </>
  );
  if (couriers) return <>{head}<CouriersView companyId={company.id} section={section} /></>;

  const [billed, unbilledRows, advances, bills] = await Promise.all([
    getPartnerBalances(company.id, "PURCHASE_INVOICE", await seenLocations(), period) as Promise<any[]>,
    seenLocations().then((locs) => unbilledReceipts(company.id, locs))
      .then((rows) => period ? rows.filter((r) => r.docDate >= period.from && r.docDate < period.to) : rows),
    // Only the branch someone is limited to; everything for everyone else.
    scopedBranch(null).then((b) => getAdvanceBalances(company.id, "SUPPLIER", b)),
    seenLocations().then((locs) => openBillsByPartner(company.id, "PURCHASE_INVOICE", locs)),
  ]);
  // In a chosen period, only the bills posted in it, as the totals beside them.
  const billsOf = (id: string) => (bills.get(id) ?? []).filter((b) => !period || (b.date >= period.from && b.date < period.to));
  const advAppliedOf = (id: string) => billsOf(id).reduce((t, b) => t + b.adv, 0);
  // Paid ahead and not yet set against a bill: shown beside what is owed, and a
  // supplier with only an advance still gets a row — its balance is below zero.
  const advanceOf = (id: string) => advances.get(id) ?? 0;
  // Goods in with no bill yet: not a payable in the books, but owed. Shown
  // beside each supplier's balance, and suppliers owed only that get a row.
  const unbilled = new Map(unbilledBySupplier(unbilledRows).map((u) => [u.partnerId, u]));
  const all: any[] = [
    ...billed,
    ...[...unbilled.values()].filter((u) => !billed.some((b) => b.partner_id === u.partnerId))
      .map((u) => ({ partner_id: u.partnerId, partner_name: u.partnerName, partner_code: u.partnerCode,
                     open_invoices: 0, outstanding: 0, overdue: 0, paid: 0 })),
  ];
  if (advances.size) {
    const known = new Set(all.map((r) => r.partner_id));
    const missing = [...advances.keys()].filter((id) => !known.has(id));
    if (missing.length) {
      for (const p of await sql`select id, code, name from business_partner where id = any(${missing})`) {
        all.push({ partner_id: p.id, partner_name: p.name, partner_code: p.code, open_invoices: 0, outstanding: 0, overdue: 0, paid: 0 });
      }
    }
  }
  const totalAdvance = [...advances.values()].reduce((s, v) => s + v, 0);
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
      adv_applied: advAppliedOf(s.partner_id),
      advance: advanceOf(s.partner_id),
      balance: Number(s.outstanding) - advanceOf(s.partner_id),
    },
    node: (
      <BalanceRow cols={10} bills={billsOf(s.partner_id)} partnerId={s.partner_id} advance={advanceOf(s.partner_id)} kind="pay">
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
        <td className="r">{advAppliedOf(s.partner_id) > 0.005 ? money(advAppliedOf(s.partner_id)) : "—"}</td>
        <td className="r">{advanceOf(s.partner_id) ? <strong className="bal-adv">{money(advanceOf(s.partner_id))}</strong> : "—"}</td>
        <td className="r" style={{ color: Number(s.outstanding) - advanceOf(s.partner_id) < 0 ? "var(--bad)" : undefined }}>
          {money(Number(s.outstanding) - advanceOf(s.partner_id))}
        </td>
        <td className="tight">
          <Link href={`/payables/ledger?partner=${s.partner_id}`} className="btn ghost tiny">Ledger</Link>
        </td>
      </BalanceRow>
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
          <span className="kpi-label">Advance on account</span>
          <span className="kpi-value">{money(totalAdvance)}</span>
          <span className="kpi-note"><Link href="/payables/advances">paid ahead, not yet on a bill</Link></span>
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
              { key: "expand", label: "" },
              { key: "partner_name", label: "Supplier", sortable: true },
              { key: "open_invoices", label: "Invoices", sortable: true, align: "r" },
              { key: "outstanding", label: "Outstanding", sortable: true, align: "r" },
              { key: "overdue", label: "Overdue", sortable: true, align: "r" },
              { key: "unbilled", label: "Received, not billed", sortable: true, align: "r" },
              { key: "adv_applied", label: "Adv. applied", sortable: true, align: "r" },
              { key: "advance", label: "Advance left", sortable: true, align: "r" },
              { key: "balance", label: "Balance", sortable: true, align: "r" },
              { key: "actions", label: "" },
            ]}
            footer={
              <tr>
                <td />
                <td colSpan={2}>Total outstanding</td>
                <td className="r">{moneyOrTrace(totalPayable)}</td>
                <td className="r">{moneyOrTrace(totalOverdue)}</td>
                <td className="r">{money(totalUnbilled)}</td>
                <td className="r">{money(all.reduce((t, r) => t + advAppliedOf(r.partner_id), 0))}</td>
                <td className="r">{money(totalAdvance)}</td>
                <td className="r">{moneyOrTrace(totalPayable - totalAdvance)}</td>
                <td />
              </tr>
            }
          />
        </div>
      </section>
    </>
  );
}
