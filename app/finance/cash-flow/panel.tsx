import Link from "next/link";
import { X, ChevronRight, Download, ExternalLink, Search } from "lucide-react";
import { money, shortDate } from "@/lib/format";
import { getCashFlowTransactions, getRelatedDocuments, type CashFlowTransaction } from "@/lib/queries";
import { RelatedDocumentsPanel } from "@/components/related-documents";
import { paginate } from "@/lib/paging";
import { Pager } from "@/components/pager";

type Sp = Record<string, string | undefined>;

/** One line under each statement heading saying what the number holds. */
const ABOUT: Record<string, string> = {
  "Received from customers": "Cash and bank receipts from customers, counter sales paid on the spot included.",
  "Paid to suppliers": "Cash and bank payments to suppliers for goods.",
  "Operating expenses paid": "Expenses paid in cash or from the bank.",
  "Owner contributions / drawings": "Money the owner put in or took out.",
  "Loans and other liabilities": "Loans received or repaid, and other liabilities settled in cash.",
  "Purchase / sale of fixed assets": "Cash spent on, or received for, equipment and other assets.",
  "Other": "Cash movements that fit no other heading.",
};

const TABS = [
  ["tx", "Transactions"],
  ["partner", ""],
  ["method", "By payment method"],
  ["month", "By month"],
] as const;

/**
 * Behind a line of the cash flow statement: the transactions that make it
 * up, read from the same classified cash movements the statement summed, so
 * the panel's total is the line's total. Everything is in the address —
 * line, tab, search, page, selected document — so a drill-down can be
 * bookmarked or sent to someone.
 */
export async function CashFlowPanel({ companyId, range, branchId, sp, lineTotal }: {
  companyId: string;
  range: { from: string; to: string };
  branchId: string | null;
  sp: Sp;
  /** The figure on the statement, to prove the transactions add up to it. */
  lineTotal: number;
}) {
  const category = sp.line!;
  const all = await getCashFlowTransactions(companyId, range.from, range.to, branchId, category);
  const tab = sp.tab === "partner" || sp.tab === "method" || sp.tab === "month" ? sp.tab : "tx";
  const q = (sp.q ?? "").trim().toLowerCase();
  const rows = q
    ? all.filter((t) => [t.docNo, t.entryNo, t.partner, t.method].some((v) => v?.toLowerCase().includes(q)))
    : all;
  const total = all.reduce((s, t) => s + t.amount, 0);
  const matches = Math.abs(total - lineTotal) < 0.01;
  const who = category.startsWith("Received") ? "customer" : category.startsWith("Paid to suppliers") ? "supplier" : "partner";

  const href = (over: Sp) => {
    const merged: Sp = { ...sp, ...over };
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(merged)) if (v) qs.set(k, v);
    return `/finance/cash-flow?${qs.toString()}`;
  };
  const closeHref = href({ line: undefined, tab: undefined, q: undefined, lp: undefined, doc: undefined });
  const exportHref = `/finance/cash-flow/export?${new URLSearchParams(
    Object.entries({ from: range.from, to: range.to, branch: branchId ?? "", line: category })
      .filter(([, v]) => v)).toString()}`;

  const groupBy = (key: (t: CashFlowTransaction) => string) => {
    const m = new Map<string, { count: number; amount: number }>();
    for (const t of rows) {
      const k = key(t);
      const g = m.get(k) ?? { count: 0, amount: 0 };
      g.count += 1; g.amount += t.amount;
      m.set(k, g);
    }
    return [...m.entries()].map(([name, g]) => ({ name, ...g }));
  };
  const groups = tab === "partner"
    ? groupBy((t) => t.partner ?? "—").sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
    : tab === "method"
    ? groupBy((t) => t.method).sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
    : tab === "month"
    ? groupBy((t) => t.date.slice(0, 7)).sort((a, b) => b.name.localeCompare(a.name))
    : [];
  const monthLabel = (ym: string) =>
    new Date(`${ym}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

  const pg = paginate(rows, sp.lp, 10);
  const selected = sp.doc && all.some((t) => t.documentId === sp.doc) ? sp.doc : null;
  const related = selected ? await getRelatedDocuments(selected) : null;
  const selectedTx = selected ? all.find((t) => t.documentId === selected) : null;

  return (
    <aside className="card cfpanel" aria-label={`${category}: transactions`}>
      <div className="cfpanel-head">
        <div>
          <h2>{category}</h2>
          <p className="page-sub">{ABOUT[category] ?? "Cash movements under this heading."}</p>
        </div>
        <Link href={closeHref} scroll={false} className="cfpanel-close" aria-label="Close">
          <X size={18} aria-hidden="true" />
        </Link>
      </div>
      <div className="cfpanel-sum">
        <span className="page-sub">{shortDate(range.from)} – {shortDate(range.to)}</span>
        <strong className={total < 0 ? "neg" : "pos"}>MMK {money(total)}</strong>
      </div>
      {!matches && (
        <p className="hint" style={{ color: "var(--bad)", margin: "0 16px 8px" }}>
          These add to {money(total)}, the statement shows {money(lineTotal)}.
        </p>
      )}

      <nav className="cfpanel-tabs" aria-label="View">
        {TABS.map(([k, label]) => (
          <Link key={k} href={href({ tab: k === "tx" ? undefined : k, lp: undefined })} scroll={false}
            className="cfpanel-tab" data-active={tab === k}>
            {k === "tx" ? `${label} (${rows.length})` : k === "partner" ? `By ${who}` : label}
          </Link>
        ))}
      </nav>

      <div className="cfpanel-tools">
        <form method="get" action="/finance/cash-flow" className="cfpanel-search">
          {Object.entries({ from: range.from, to: range.to, branch: branchId ?? "", line: category, tab: sp.tab ?? "" })
            .filter(([, v]) => v)
            .map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
          <Search size={15} aria-hidden="true" />
          <input name="q" defaultValue={sp.q ?? ""} placeholder={`Search document, ${who}…`} aria-label="Search" />
        </form>
        <a href={exportHref} className="btn ghost cfpanel-export"><Download size={14} aria-hidden="true" /> Export</a>
      </div>

      {tab === "tx" ? (
        <div className="tablewrap">
          <table className="cfpanel-table">
            <thead>
              <tr><th>Date</th><th>Document</th><th>{who[0].toUpperCase() + who.slice(1)}</th><th>Method</th><th className="r">Amount</th><th /></tr>
            </thead>
            <tbody>
              {pg.rows.map((t) => {
                const on = selected !== null && t.documentId === selected;
                return (
                  <tr key={`${t.entryId}-${t.method}`} data-active={on || undefined}>
                    <td>{shortDate(t.date)}</td>
                    <td className="m">
                      {t.documentId
                        ? <Link href={`/documents/${t.documentId}`}>{t.docNo}</Link>
                        : <span>{t.entryNo ?? "Journal"}</span>}
                    </td>
                    <td className="wrap">{t.partner ?? "—"}</td>
                    <td>{t.method}</td>
                    <td className={`r${t.amount < 0 ? " neg" : ""}`}>{money(t.amount)}</td>
                    <td className="tight">
                      {t.documentId && (
                        <Link href={href({ doc: on ? undefined : t.documentId })} scroll={false}
                          className="cfpanel-go" aria-label={`Trace ${t.docNo}`}>
                          <ChevronRight size={16} aria-hidden="true" />
                        </Link>
                      )}
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr><td colSpan={6} className="page-sub">{q ? "Nothing matches that search." : "No transactions in this period."}</td></tr>
              )}
            </tbody>
          </table>
          <div className="cfpanel-pager"><Pager p={pg} params={sp} name="lp" /></div>
        </div>
      ) : (
        <div className="tablewrap">
          <table className="cfpanel-table">
            <thead>
              <tr>
                <th>{tab === "partner" ? who[0].toUpperCase() + who.slice(1) : tab === "method" ? "Paid through" : "Month"}</th>
                <th className="r">Transactions</th><th className="r">Amount</th><th className="r">Share</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <tr key={g.name}>
                  <td className="wrap">
                    <Link href={href({ tab: undefined, q: tab === "month" ? undefined : g.name, lp: undefined })} scroll={false}>
                      {tab === "month" ? monthLabel(g.name) : g.name}
                    </Link>
                  </td>
                  <td className="r">{g.count}</td>
                  <td className={`r${g.amount < 0 ? " neg" : ""}`}>{money(g.amount)}</td>
                  <td className="r">{total !== 0 ? `${((g.amount / total) * 100).toFixed(1)}%` : "—"}</td>
                </tr>
              ))}
              {groups.length === 0 && <tr><td colSpan={4} className="page-sub">No transactions in this period.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {related && selectedTx && (
        <div className="cfpanel-related">
          <div className="cfpanel-related-head">
            <h3>Related documents</h3>
            <a href={`/documents/${selected}`} target="_blank" rel="noopener noreferrer" className="btn ghost tiny">
              <ExternalLink size={13} aria-hidden="true" /> Open in new tab
            </a>
          </div>
          <p className="page-sub" style={{ margin: "0 0 8px" }}>
            {selectedTx.docNo} · {shortDate(selectedTx.date)} · {selectedTx.method} · MMK {money(selectedTx.amount)}
            {selectedTx.entryNo && <> · journal {selectedTx.entryNo}</>}
          </p>
          <RelatedDocumentsPanel related={related} />
          {related.source.length === 0 && related.downstream.length === 0 && (
            <p className="page-sub">Nothing else is linked to this document.</p>
          )}
        </div>
      )}
    </aside>
  );
}
