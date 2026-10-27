import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { seenLocations, seenBranches } from "@/lib/branch-scope";
import { faBranches, faCategories, FA_STATUS, FA_STATUS_LABEL, assetList } from "@/lib/fixed-assets";
import {
  registerReport, monthlyReport, accumulatedReport, acquisitionsReport, disposalsReport, reconciliationReport, type ReportFilters,
} from "@/lib/fa-reports";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { AutoApply } from "@/components/auto-apply";
import { DataTable, type DataRow, type Column } from "@/components/data-table";

export const metadata = { title: "Fixed Asset Reports" };

type SP = Record<string, string | undefined>;
const money = (s: string | null | undefined) => (s == null || s === "" ? "—" : Number(s).toLocaleString("en-US", { maximumFractionDigits: 0 }));
const REPORTS = [
  ["register", "Asset Register"], ["monthly", "Monthly Depreciation"], ["accumulated", "Accumulated Depreciation"],
  ["nbv", "Net Book Value"], ["acquisitions", "Acquisitions"], ["disposals", "Disposals"], ["reconciliation", "Reconciliation"],
] as const;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Seven reports on one page, one set of filters, each exported from its own table. */
export default async function FaReports({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const user = await requirePermission("accounting.view");
  const co = user.companyId;
  const report = REPORTS.some(([k]) => k === sp.report) ? sp.report! : "register";
  const today = new Date(Date.now() + 6.5 * 3600_000).toISOString().slice(0, 10);
  const seen = await seenLocations();
  const [branches, categories, assets] = await Promise.all([faBranches(co).then(seenBranches), faCategories(co), assetList(co, seen)]);
  const f: ReportFilters = {
    from: sp.from && DATE.test(sp.from) ? sp.from : `${today.slice(0, 4)}-01-01`,
    to: sp.to && DATE.test(sp.to) ? sp.to : today,
    branches: seen, branchId: branches.some((b) => b.id === sp.branch) ? sp.branch : undefined,
    categoryId: categories.some((c) => c.id === sp.category) ? sp.category : undefined,
    assetId: assets.some((a) => a.id === sp.asset) ? sp.asset : undefined,
    status: FA_STATUS.includes(sp.status as never) ? sp.status : undefined,
  };
  const href = (patch: SP) => { const q = new URLSearchParams(); for (const [k, v] of Object.entries({ ...sp, ...patch })) if (v) q.set(k, v); return `/fixed-assets/reports?${q}`; };
  const assetLink = (id: string, code: string) => <Link href={`/fixed-assets/${id}`} style={{ color: "var(--link)" }}>{code}</Link>;
  const docLink = (id: string | null, no: string | null) => (id ? <Link href={`/documents/${id}`} className="fa-jlink">{no}</Link> : no ?? "—");

  let columns: Column[] = [];
  let rows: DataRow[] = [];
  let note = "";
  let totals: { span: string; cells: Record<string, string> } | undefined;

  if (report === "register" || report === "nbv") {
    const data = await registerReport(co, f);
    note = `Held on ${f.to}: cost, depreciation posted by then, and net book value.`;
    if (report === "register") {
      columns = [{ key: "code", label: "Code", sortable: true }, { key: "name", label: "Asset", sortable: true }, { key: "category", label: "Category", sortable: true },
        { key: "branch", label: "Posting branch", sortable: true }, { key: "acquired", label: "Acquired", sortable: true }, { key: "in_service", label: "In service" },
        { key: "life", label: "Life (mo)", align: "r" }, { key: "cost", label: "Cost", sortable: true, align: "r" }, { key: "residual", label: "Residual", align: "r" },
        { key: "accumulated", label: "Accum. dep.", sortable: true, align: "r" }, { key: "nbv", label: "NBV", sortable: true, align: "r" }, { key: "status", label: "Status" }];
      rows = data.map((r) => ({ key: r.id, searchText: `${r.code} ${r.name} ${r.category}`,
        sort: { code: r.code, name: r.name, category: r.category, branch: r.branch, acquired: r.acquired, cost: Number(r.cost), accumulated: Number(r.accumulated), nbv: Number(r.nbv) },
        csv: { code: r.code, name: r.name, category: r.category, branch: r.branch, acquired: r.acquired, in_service: r.in_service ?? "", life: r.useful_life_months,
               cost: r.cost, residual: r.residual, accumulated: r.accumulated, nbv: r.nbv, status: FA_STATUS_LABEL[r.status as keyof typeof FA_STATUS_LABEL] },
        node: <tr key={r.id}><td>{assetLink(r.id, r.code)}</td><td>{r.name}{r.used_at !== r.branch && <span className="subline">used at {r.used_at}</span>}</td><td>{r.category}</td><td>{r.branch}</td>
          <td className="nowrap">{r.acquired}</td><td className="nowrap">{r.in_service ?? "—"}</td><td className="r">{r.useful_life_months}</td>
          <td className="r">{money(r.cost)}</td><td className="r">{money(r.residual)}</td><td className="r">{money(r.accumulated)}</td><td className="r"><strong>{money(r.nbv)}</strong></td>
          <td><span className={`fa-status ${r.status.toLowerCase()}`}>{FA_STATUS_LABEL[r.status as keyof typeof FA_STATUS_LABEL]}</span></td></tr> }));
    } else {
      // NBV by posting branch and category: the consolidation view.
      const by = new Map<string, { branch: string; category: string; n: number; cost: number; accum: number }>();
      for (const r of data) {
        const k = `${r.branch}|${r.category}`;
        const e = by.get(k) ?? { branch: r.branch, category: r.category, n: 0, cost: 0, accum: 0 };
        e.n++; e.cost += Number(r.cost); e.accum += Number(r.accumulated); by.set(k, e);
      }
      columns = [{ key: "branch", label: "Posting branch", sortable: true }, { key: "category", label: "Category", sortable: true }, { key: "n", label: "Assets", align: "r" },
        { key: "cost", label: "Cost", sortable: true, align: "r" }, { key: "accum", label: "Accum. dep.", align: "r" }, { key: "nbv", label: "NBV", sortable: true, align: "r" }];
      rows = [...by.values()].map((e) => ({ key: `${e.branch}|${e.category}`, searchText: `${e.branch} ${e.category}`,
        sort: { branch: e.branch, category: e.category, cost: e.cost, nbv: e.cost - e.accum },
        csv: { branch: e.branch, category: e.category, n: e.n, cost: e.cost, accum: e.accum, nbv: e.cost - e.accum },
        node: <tr key={`${e.branch}|${e.category}`}><td>{e.branch}</td><td>{e.category}</td><td className="r">{e.n}</td><td className="r">{money(String(e.cost))}</td>
          <td className="r">{money(String(e.accum))}</td><td className="r"><strong>{money(String(e.cost - e.accum))}</strong></td></tr> }));
      const t = [...by.values()].reduce((s, e) => ({ cost: s.cost + e.cost, accum: s.accum + e.accum }), { cost: 0, accum: 0 });
      totals = { span: "Company total", cells: { cost: money(String(t.cost)), accum: money(String(t.accum)), nbv: money(String(t.cost - t.accum)) } };
    }
  } else if (report === "monthly") {
    const data = await monthlyReport(co, f);
    note = `${f.from.slice(0, 7)} to ${f.to.slice(0, 7)}: each asset's month, posted with its journal, or as planned.`;
    columns = [{ key: "month", label: "Month", sortable: true }, { key: "code", label: "Code", sortable: true }, { key: "name", label: "Asset" },
      { key: "branch", label: "Posting branch", sortable: true }, { key: "category", label: "Category" }, { key: "amount", label: "Depreciation", sortable: true, align: "r" },
      { key: "closing", label: "NBV after", align: "r" }, { key: "state", label: "State" }, { key: "journal", label: "Journal" }];
    rows = data.map((r) => ({ key: `${r.id}|${r.month}`, searchText: `${r.code} ${r.name} ${r.month}`, facet: { state: r.state },
      sort: { month: r.month, code: r.code, branch: r.branch, amount: Number(r.amount) },
      csv: { month: r.month, code: r.code, name: r.name, branch: r.branch, category: r.category, amount: r.amount, closing: r.closing, state: r.state === "POSTED" ? "Posted" : "Planned",
             journal: r.journals.map((j) => j.docNo).join(" ") },
      node: <tr key={`${r.id}|${r.month}`}><td className="nowrap">{r.month}</td><td>{assetLink(r.id, r.code)}</td><td>{r.name}</td><td>{r.branch}</td><td>{r.category}</td>
        <td className="r">{money(r.amount)}</td><td className="r">{money(r.closing)}</td>
        <td><span className={`fa-pill ${r.state === "POSTED" ? "posted" : "planned"}`}>{r.state === "POSTED" ? "Posted" : "Planned"}</span></td>
        <td>{r.journals.length ? r.journals.map((j) => <span key={j.docNo}>{docLink(j.docId, j.docNo)}</span>) : "—"}</td></tr> }));
    const posted = data.filter((r) => r.state === "POSTED").reduce((s, r) => s + Number(r.amount), 0);
    const all = data.reduce((s, r) => s + Number(r.amount), 0);
    totals = { span: `Total · posted ${money(String(posted))}`, cells: { amount: money(String(all)) } };
  } else if (report === "accumulated") {
    const data = await accumulatedReport(co, f);
    note = `Posted depreciation: before ${f.from}, during ${f.from} to ${f.to}, written off by disposal, and at ${f.to}.`;
    columns = [{ key: "code", label: "Code", sortable: true }, { key: "name", label: "Asset" }, { key: "branch", label: "Posting branch", sortable: true },
      { key: "opening", label: "Opening", align: "r" }, { key: "period", label: "This period", sortable: true, align: "r" }, { key: "disposed", label: "Disposed", align: "r" }, { key: "closing", label: "Closing", sortable: true, align: "r" }];
    rows = data.map((r) => ({ key: r.id, searchText: `${r.code} ${r.name}`, sort: { code: r.code, branch: r.branch, period: Number(r.period), closing: Number(r.closing) },
      csv: { code: r.code, name: r.name, branch: r.branch, opening: r.opening, period: r.period, disposed: r.disposed, closing: r.closing },
      node: <tr key={r.id}><td>{assetLink(r.id, r.code)}</td><td>{r.name}</td><td>{r.branch}</td><td className="r">{money(r.opening)}</td>
        <td className="r">{money(r.period)}</td><td className="r">{money(r.disposed)}</td><td className="r"><strong>{money(r.closing)}</strong></td></tr> }));
    const s = (k: "opening" | "period" | "disposed" | "closing") => money(String(data.reduce((t, r) => t + Number(r[k]), 0)));
    totals = { span: "Total", cells: { opening: s("opening"), period: s("period"), disposed: s("disposed"), closing: s("closing") } };
  } else if (report === "acquisitions") {
    const data = await acquisitionsReport(co, f);
    note = `Acquired ${f.from} to ${f.to}.`;
    columns = [{ key: "acquired", label: "Acquired", sortable: true }, { key: "code", label: "Code", sortable: true }, { key: "name", label: "Asset" }, { key: "category", label: "Category" },
      { key: "branch", label: "Posting branch" }, { key: "supplier", label: "Supplier" }, { key: "cost", label: "Cost", sortable: true, align: "r" }, { key: "journal", label: "Acquisition journal" }];
    rows = data.map((r) => ({ key: r.id, searchText: `${r.code} ${r.name} ${r.supplier ?? ""}`, sort: { acquired: r.acquired, code: r.code, cost: Number(r.cost) },
      csv: { acquired: r.acquired, code: r.code, name: r.name, category: r.category, branch: r.branch, supplier: r.supplier ?? "", cost: r.cost, journal: r.journal?.doc_no ?? "" },
      node: <tr key={r.id}><td className="nowrap">{r.acquired}</td><td>{assetLink(r.id, r.code)}</td><td>{r.name}</td><td>{r.category}</td><td>{r.branch}</td>
        <td>{r.supplier ?? "—"}</td><td className="r">{money(r.cost)}</td><td>{r.journal ? docLink(r.journal.doc_id, r.journal.doc_no) : <span className="fa-muted">Not linked</span>}</td></tr> }));
    totals = { span: "Total", cells: { cost: money(String(data.reduce((t, r) => t + Number(r.cost), 0))) } };
  } else if (report === "disposals") {
    const data = await disposalsReport(co, f);
    note = `Disposed of ${f.from} to ${f.to}.`;
    columns = [{ key: "date", label: "Date", sortable: true }, { key: "code", label: "Code" }, { key: "name", label: "Asset" }, { key: "branch", label: "Posting branch" },
      { key: "reason", label: "Reason" }, { key: "cost", label: "Cost", align: "r" }, { key: "nbv", label: "NBV", align: "r" }, { key: "proceeds", label: "Proceeds", align: "r" },
      { key: "gain", label: "Gain / (loss)", align: "r" }, { key: "voucher", label: "Voucher" }];
    rows = data.map((r) => ({ key: r.id + r.date, searchText: `${r.code} ${r.name} ${r.reason ?? ""}`, sort: { date: r.date },
      csv: { date: r.date, code: r.code, name: r.name, branch: r.branch, reason: r.reason ?? "", cost: r.cost, nbv: r.nbv ?? "", proceeds: r.proceeds ?? "", gain: r.gain ?? "", voucher: r.voucher ?? "" },
      node: <tr key={r.id + r.date}><td className="nowrap">{r.date}</td><td>{assetLink(r.id, r.code)}</td><td>{r.name}</td><td>{r.branch}</td><td>{r.reason}</td>
        <td className="r">{money(r.cost)}</td><td className="r">{money(r.nbv)}</td><td className="r">{money(r.proceeds)}</td>
        <td className="r" style={{ color: Number(r.gain) < 0 ? "var(--fa-red)" : undefined }}>{money(r.gain)}</td><td>{docLink(r.doc_id, r.voucher)}</td></tr> }));
  } else {
    const data = await reconciliationReport(co, f);
    note = `On ${f.to}: the register against the General Ledger, per account and posting branch. Journals with no branch stay at company level until they are allocated.`;
    columns = [{ key: "account", label: "Account", sortable: true }, { key: "side", label: "Carries" }, { key: "category", label: "Category" }, { key: "branch", label: "Branch", sortable: true },
      { key: "register", label: "Register", align: "r" }, { key: "ledger", label: "General Ledger", align: "r" }, { key: "difference", label: "Difference", sortable: true, align: "r" }];
    rows = data.map((r, i) => ({ key: String(i), searchText: `${r.account} ${r.accountName} ${r.branch}`, facet: { diff: Number(r.difference) === 0 ? "tie" : "differs" },
      sort: { account: r.account, branch: r.branch, difference: Math.abs(Number(r.difference)) },
      csv: { account: `${r.account} ${r.accountName}`, side: r.side, category: r.category, branch: r.branch, register: r.register, ledger: r.ledger, difference: r.difference },
      node: <tr key={i} className={r.companyLevel ? "far-company" : undefined}><td><Link href={`/finance/general-ledger?view=account&to=${f.to}`} className="far-acct">{r.account}</Link> {r.accountName}</td>
        <td>{r.side}</td><td>{r.category}</td><td>{r.branch}</td><td className="r">{money(r.register)}</td><td className="r">{money(r.ledger)}</td>
        <td className="r"><span className={`fa-pill ${Number(r.difference) === 0 ? "posted" : "exception"}`}>{Number(r.difference) === 0 ? "Ties" : money(r.difference)}</span></td></tr> }));
    const t = (k: "register" | "ledger") => money(String(data.filter((r) => r.side === "Accumulated").reduce((s, r) => s + Number(r[k]), 0)));
    totals = { span: "Accumulated depreciation, company", cells: { register: t("register"), ledger: t("ledger") } };
  }

  return (
    <div className="fa">
      <Breadcrumbs trail={[{ label: "Fixed Assets", href: "/fixed-assets" }, { label: "Reports" }]} />
      <div className="fa-head"><div><h1>Fixed Asset Reports</h1><p>{note}</p></div></div>
      <nav className="fac-tabs far-reports" aria-label="Report">
        {REPORTS.map(([k, l]) => <Link key={k} href={href({ report: k === "register" ? undefined : k })} aria-current={report === k ? "page" : undefined}>{l}</Link>)}
      </nav>
      <form method="get" className="fac-bar">
        {sp.report && <input type="hidden" name="report" value={sp.report} />}
        {report !== "register" && report !== "nbv" && report !== "reconciliation" && (
          <input type="date" name="from" defaultValue={f.from} aria-label="From" className="dt-filter" />)}
        <input type="date" name="to" defaultValue={f.to} aria-label={report === "register" || report === "nbv" || report === "reconciliation" ? "As of" : "To"} className="dt-filter" />
        {branches.length > 1 && (
          <select name="branch" defaultValue={sp.branch ?? ""} aria-label="Branch" className={`dt-filter${sp.branch ? " dt-filter-on" : ""}`}>
            <option value="">All branches</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>)}
        <select name="category" defaultValue={sp.category ?? ""} aria-label="Category" className={`dt-filter${sp.category ? " dt-filter-on" : ""}`}>
          <option value="">All categories</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        {report !== "reconciliation" && report !== "nbv" && (
          <select name="asset" defaultValue={sp.asset ?? ""} aria-label="Asset" className={`dt-filter${sp.asset ? " dt-filter-on" : ""}`}>
            <option value="">All assets</option>{assets.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
          </select>)}
        {(report === "register" || report === "accumulated" || report === "monthly") && (
          <select name="status" defaultValue={sp.status ?? ""} aria-label="Status" className={`dt-filter${sp.status ? " dt-filter-on" : ""}`}>
            <option value="">All statuses</option>{FA_STATUS.filter((s) => s !== "DRAFT").map((s) => <option key={s} value={s}>{FA_STATUS_LABEL[s]}</option>)}
          </select>)}
        <AutoApply />
      </form>
      <section className="card">
        {rows.length === 0 ? <div className="fa-empty"><strong>Nothing to report</strong><span>No asset matches these filters.</span></div> : (
          <DataTable key={report} rows={rows} columns={columns} storageKey={`fa-rep-${report}`} csvFilename={`fixed-assets-${report}-${f.to}.csv`}
            searchPlaceholder="Search…" footerCells={totals ? { span: totals.span, cells: totals.cells } : undefined}
            filters={report === "monthly" ? [{ key: "state", allLabel: "Posted and planned", label: "State", options: [{ value: "POSTED", label: "Posted" }, { value: "PLANNED", label: "Planned" }] }]
              : report === "reconciliation" ? [{ key: "diff", allLabel: "All lines", label: "Ties", options: [{ value: "differs", label: "Differences only" }, { value: "tie", label: "Ties" }] }] : undefined} />
        )}
      </section>
    </div>
  );
}
