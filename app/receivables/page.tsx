import { BranchScope } from "@/components/branch-scope";
import { seenLocations, scopedBranch } from "@/lib/branch-scope";
import { periodFromParams } from "@/lib/date-range";
import { UrlDateFilter } from "@/components/date-filter";
import Link from "next/link";
import { money, moneyOrTrace, sql } from "@/lib/db";
import { getCompany, getPartnerBalances, openBillsByPartner } from "@/lib/queries";
import { BalanceRow } from "@/components/balance-row";
import { getAdvanceBalances } from "@/lib/partner-ledger";
import { DataTable, type DataRow } from "@/components/data-table";
import { HelpHint } from "@/components/help-hint";

const TABS: Array<["" | "current" | "overdue" | "partial", string]> = [
  ["", "All"],
  ["current", "Current"],
  ["overdue", "Overdue"],
  ["partial", "Partially Paid"],
];

export default async function Receivables({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; date?: string; from?: string; to?: string }>;
}) {
  const sp = await searchParams;
  const { status } = sp;
  // Invoices posted in the chosen period only; the tabs keep the period.
  const period = periodFromParams(sp);
  const keep = new URLSearchParams(Object.entries({ date: sp.date, from: sp.from, to: sp.to })
    .filter(([, v]) => v) as [string, string][]);
  const tabHref = (value: string) => {
    const q = new URLSearchParams(keep);
    if (value) q.set("status", value);
    return q.size ? `/receivables?${q}` : "/receivables";
  };
  const company = await getCompany();
  if (!company) return <div className="empty">No company found.</div>;

  const locs = await seenLocations();
  const [billed, advances, bills] = await Promise.all([
    getPartnerBalances(company.id, "SALES_INVOICE", locs, period) as Promise<any[]>,
    scopedBranch(null).then((b) => getAdvanceBalances(company.id, "CUSTOMER", b)),
    openBillsByPartner(company.id, "SALES_INVOICE", locs),
  ]);
  const advanceOf = (id: string) => advances.get(id) ?? 0;
  const billsOf = (id: string) => (bills.get(id) ?? []).filter((b) => !period || (b.date >= period.from && b.date < period.to));
  const advAppliedOf = (id: string) => billsOf(id).reduce((t, b) => t + b.adv, 0);
  // A customer with only money on account still gets a row: it is owed back or waiting for an invoice.
  const all: any[] = [...billed];
  const missing = [...advances.keys()].filter((id) => !billed.some((r) => r.partner_id === id));
  if (missing.length) {
    for (const p of await sql`select id, code, name from business_partner where id = any(${missing})`) {
      all.push({ partner_id: p.id, partner_name: p.name, partner_code: p.code, open_invoices: 0, outstanding: 0, overdue: 0, paid: 0 });
    }
  }
  const totalAdvance = [...advances.values()].reduce((s, v) => s + v, 0);

  const rowState = (r: any) => {
    // A remnant below the currency's smallest unit is not a debt anybody can
    // settle, so it is not overdue — it would otherwise sit in this tab
    // showing "0" and reading as an empty list with a row in it.
    if (r.overdue_material) return "overdue";
    if (Number(r.paid) > 0 && Number(r.outstanding) > 0) return "partial";
    return "current";
  };

  const customers = status ? all.filter((r) => rowState(r) === status) : all;

  const totalReceivable = all.reduce((s, r) => s + Number(r.outstanding), 0);
  const totalOverdue = all.reduce((s, r) => s + Number(r.overdue ?? 0), 0);
  const totalDueSoon = all.reduce((s, r) => s + Number(r.due_soon ?? 0), 0);

  const rows: DataRow[] = customers.map((c) => ({
    key: c.partner_id,
    searchText: [c.partner_code, c.partner_name].filter(Boolean).join(" "),
    sort: {
      partner_name: c.partner_name ?? "",
      open_invoices: Number(c.open_invoices),
      outstanding: Number(c.outstanding),
      overdue: Number(c.overdue ?? 0),
      credit_limit: Number(c.credit_limit ?? 0),
      adv_applied: advAppliedOf(c.partner_id),
      advance: advanceOf(c.partner_id),
    },
    node: (
      <BalanceRow cols={9} bills={billsOf(c.partner_id)} partnerId={c.partner_id} advance={advanceOf(c.partner_id)} kind="receive">
        <td className="wrap">
          <strong>{c.partner_name}</strong>
          <div className="m" style={{ color: "var(--muted)" }}>{c.partner_code}</div>
        </td>
        <td className="r">{c.open_invoices}</td>
        <td className="r">{moneyOrTrace(c.outstanding)}</td>
        <td className="r" style={{ color: Number(c.overdue) > 0 ? "var(--bad)" : undefined }}>
          {Number(c.overdue) !== 0 ? moneyOrTrace(c.overdue) : "—"}
        </td>
        <td className="r">{advAppliedOf(c.partner_id) > 0.005 ? money(advAppliedOf(c.partner_id)) : "—"}</td>
        <td className="r">{advanceOf(c.partner_id) ? <strong className="bal-adv">{money(advanceOf(c.partner_id))}</strong> : "—"}</td>
        <td className="r">{c.credit_limit != null ? money(c.credit_limit) : "—"}</td>
        <td className="tight">
          <Link href={`/receivables/ledger?partner=${c.partner_id}`} className="btn ghost tiny">Ledger</Link>
        </td>
      </BalanceRow>
    ),
  }));

  return (
    <>
      <div className="page-head">
        <span className="eyebrow">Sales</span>
        <h1>Receivables</h1>
        <BranchScope />
        <HelpHint>
          What each customer owes, rolled up from their open invoices — not a
          balance kept on the customer, so it can never drift from the invoices
          behind it.
        </HelpHint>
      </div>
      <div className="vtabs pay-tabs" role="tablist" aria-label="Receivables">
        <Link href="/receivables" role="tab" aria-selected className="on">Customers</Link>
        <Link href="/receivables/ledger" role="tab" aria-selected={false}>Customer ledger</Link>
        <Link href="/receivables/advances" role="tab" aria-selected={false}>Advances</Link>
      </div>

      <div className="kpis">
        <div className="kpi">
          <span className="kpi-label">Total Receivable</span>
          <span className="kpi-value">{moneyOrTrace(totalReceivable)}</span>
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
          <span className="kpi-note"><Link href="/receivables/advances">taken ahead, not yet on an invoice</Link></span>
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
            <h2>Customers</h2>
            <span className="actions">
              <UrlDateFilter />
              <span className="page-sub">{customers.length} with a balance</span>
              <Link href="/receivables/receive" className="btn">Receive payment</Link>
            </span>
          </div>
          <DataTable
            rows={rows}
            emptyLabel="Nothing outstanding"
            searchPlaceholder="Search customers…"
            defaultSort={{ key: "outstanding", dir: "desc" }}
            columns={[
              { key: "expand", label: "" },
              { key: "partner_name", label: "Customer", sortable: true },
              { key: "open_invoices", label: "Invoices", sortable: true, align: "r" },
              { key: "outstanding", label: "Outstanding", sortable: true, align: "r" },
              { key: "overdue", label: "Overdue", sortable: true, align: "r" },
              { key: "adv_applied", label: "Adv. applied", sortable: true, align: "r" },
              { key: "advance", label: "Advance left", sortable: true, align: "r" },
              { key: "credit_limit", label: "Credit Limit", sortable: true, align: "r" },
              { key: "actions", label: "" },
            ]}
            footer={
              <tr>
                <td />
                <td colSpan={2}>Total outstanding</td>
                <td className="r">{moneyOrTrace(totalReceivable)}</td>
                <td className="r">{moneyOrTrace(totalOverdue)}</td>
                <td className="r">{money(all.reduce((t, r) => t + advAppliedOf(r.partner_id), 0))}</td>
                <td className="r">{money(totalAdvance)}</td>
                <td colSpan={2} />
              </tr>
            }
          />
        </div>
      </section>
    </>
  );
}
