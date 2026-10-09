import Link from "next/link";
import { X, ChevronRight, Download, ExternalLink, BookOpen } from "lucide-react";
import { money, shortDate } from "@/lib/format";
import { getIndirectDrill, type IndirectStatement, type IndirectLine } from "@/lib/indirect-cash-flow";
import { paginate } from "@/lib/paging";
import { Pager } from "@/components/pager";

type Sp = Record<string, string | undefined>;

const SECTION = [
  ["operating", "Operating activities", "netOperating", "Net cash from operating activities"],
  ["investing", "Investing activities", "netInvesting", "Net cash from investing activities"],
  ["financing", "Financing activities", "netFinancing", "Net cash from financing activities"],
] as const;

/** What a drawer says under its title. */
const ABOUT: Record<string, string> = {
  np: "Profit for the period from the income statement: revenue less cost of sales and expenses, year-end closing left out.",
  dep: "Charges that reduced profit without any cash leaving: added back.",
  noncash: "Investing and financing movements that did not go through cash — an asset bought on credit or with a loan, opening balances entered against equity.",
  "wc:ar": "Reconciliation of accounts receivable to the cash it held back or released.",
  "wc:inv": "Reconciliation of inventory to the cash it absorbed or released.",
  "wc:ap": "Reconciliation of accounts payable to the cash it deferred or paid out.",
  "wc:tax": "Income tax charged but not yet paid in cash.",
  "wc:oca": "Other current operating assets: advances, input tax, prepayments, clearing accounts.",
  "wc:ocl": "Other current operating liabilities: output tax, accruals, customer advances.",
  tax: "Income tax actually paid from cash or bank.",
  "inv:purchase": "Cash and bank actually paid for fixed assets. Assets bought on credit appear here only when paid.",
  "inv:proceeds": "Cash and bank received for fixed assets sold.",
  "inv:other": "Other investing cash and bank movements.",
  "fin:loan_in": "Loans received into cash or bank.",
  "fin:loan_out": "Loans repaid from cash or bank.",
  "fin:capital": "Capital the owners paid in.",
  "fin:dist": "Drawings or dividends paid out.",
  "fin:other": "Other financing cash: opening balances brought in, other equity movements.",
};

const qs = (sp: Sp, over: Sp) => {
  const m: Sp = { ...sp, ...over };
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(m)) if (v) q.set(k, v);
  return `/finance/cash-flow?${q.toString()}`;
};

/** The statement: sections, subtotals, a chevron on every line with a story. */
export function IndirectStatementView({ st, sp, range }: { st: IndirectStatement; sp: Sp; range: { from: string; to: string } }) {
  const row = (l: IndirectLine) => {
    const open = sp.line === l.key;
    const label = <>{l.label}{l.drill && <ChevronRight size={15} aria-hidden="true" />}</>;
    return (
      <tr key={l.key} className={`cf-row${l.bold ? " cf-sub" : ""}${l.indent ? " cf-indent" : ""}`} data-active={open || undefined}>
        <td className="wrap">
          {l.drill
            ? <Link href={qs(sp, { line: open ? undefined : l.key, lp: undefined, q: undefined })} scroll={false} className="cf-line">{label}</Link>
            : <span className={l.bold ? "" : "cf-group"}>{l.label}</span>}
        </td>
        <td className={`r${l.amount < 0 ? " cf-neg" : ""}`} style={{ fontWeight: l.bold || !l.indent ? 600 : 400 }}>{money(l.amount)}</td>
      </tr>
    );
  };
  return (
    <div className="tablewrap">
      <table className="cf-table">
        {SECTION.map(([k, label, totalKey, totalLabel]) => (
          <tbody key={k} className={`cf-section cf-${k}`}>
            <tr className="cf-head"><td colSpan={2}>{label}{k === "operating" && <span className="page-sub"> (indirect method)</span>}</td></tr>
            {st[k].map(row)}
            <tr className="cf-total"><td>{totalLabel}</td><td className={`r${st[totalKey] < 0 ? " cf-neg" : ""}`}>{money(st[totalKey])}</td></tr>
          </tbody>
        ))}
        <tfoot>
          <tr className="cf-total"><td>Net increase / (decrease) in cash</td><td className="r">{money(st.netChange)}</td></tr>
          <tr><td>Cash and bank at beginning of period ({shortDate(range.from)})</td><td className="r">{money(st.beginningCash)}</td></tr>
          <tr className="cf-total"><td>Cash and bank at end of period ({shortDate(range.to)})</td><td className="r">{money(st.endingCash)}</td></tr>
          <tr>
            <td style={{ color: Math.abs(st.difference) > 0.01 ? "var(--bad)" : "var(--muted)" }}>
              {Math.abs(st.difference) > 0.01 ? "Unexplained difference" : "Reconciliation difference"}
            </td>
            <td className="r" style={{ color: Math.abs(st.difference) > 0.01 ? "var(--bad)" : "var(--muted)" }}>{money(st.difference)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

/** The drawer for one indirect line. */
export async function IndirectPanel({ companyId, range, branchId, sp }: {
  companyId: string; range: { from: string; to: string }; branchId: string | null; sp: Sp;
}) {
  const key = sp.line!;
  const d = await getIndirectDrill(companyId, range.from, range.to, branchId, key);
  if (!d) return null;
  const q = (sp.q ?? "").trim().toLowerCase();
  const rows = q ? d.rows.filter((r) => [r.docNo, r.entryNo, r.partner, r.description, r.account]
    .some((v) => v?.toLowerCase().includes(q))) : d.rows;
  const pg = paginate(rows, sp.lp, 10);
  const closeHref = qs(sp, { line: undefined, lp: undefined, q: undefined });
  const exportHref = `/finance/cash-flow/export?${new URLSearchParams(Object.entries({
    method: "indirect", from: range.from, to: range.to, branch: branchId ?? "", line: key,
  }).filter(([, v]) => v)).toString()}`;
  const gl = (accountIds?: string) => `/finance/general-ledger?${new URLSearchParams(Object.entries({
    from: range.from, to: range.to, account: accountIds ?? "",
  }).filter(([, v]) => v)).toString()}`;
  const wc = Boolean(d.balances);
  const np = key === "np";

  return (
    <aside className="card cfpanel" aria-label={d.title}>
      <div className="cfpanel-head">
        <div>
          <h2>{d.title}</h2>
          <p className="page-sub">{ABOUT[key] ?? ""}</p>
        </div>
        <Link href={closeHref} scroll={false} className="cfpanel-close" aria-label="Close"><X size={18} aria-hidden="true" /></Link>
      </div>
      <div className="cfpanel-sum">
        <span className="page-sub">{shortDate(range.from)} – {shortDate(range.to)}</span>
        <strong className={d.total < 0 ? "neg" : "pos"}>MMK {money(d.total)}</strong>
      </div>

      {d.balances && (
        <table className="cfpanel-bal">
          <tbody>
            <tr><td>Opening balance ({shortDate(range.from)})</td><td className="r">{money(d.balances.opening)}</td></tr>
            <tr><td>Closing balance ({shortDate(range.to)})</td><td className="r">{money(d.balances.closing)}</td></tr>
            <tr><td>{d.balances.change >= 0 ? "Increase" : "Decrease"}</td><td className="r">{money(Math.abs(d.balances.change))}</td></tr>
            <tr className="cfpanel-bal-adj">
              <td>Cash flow adjustment ({d.balances.adjustment < 0 ? "uses cash" : "releases cash"})</td>
              <td className={`r${d.balances.adjustment < 0 ? " neg" : ""}`}>{money(d.balances.adjustment)}</td>
            </tr>
          </tbody>
        </table>
      )}

      <div className="cfpanel-tools">
        <form method="get" action="/finance/cash-flow" className="cfpanel-search">
          {Object.entries({ method: "indirect", from: range.from, to: range.to, branch: branchId ?? "", line: key })
            .filter(([, v]) => v).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
          <input name="q" defaultValue={sp.q ?? ""} placeholder={np ? "Search account…" : "Search document, partner…"} aria-label="Search" />
        </form>
        <a href={exportHref} className="btn ghost cfpanel-export"><Download size={14} aria-hidden="true" /> Export</a>
      </div>

      <div className="tablewrap">
        <table className="cfpanel-table">
          <thead>
            {np ? (
              <tr><th>Account</th><th>Type</th><th className="r">Amount</th></tr>
            ) : (
              <tr><th>Date</th><th>Document</th><th>Partner</th><th>Description</th>
                <th className="r">{wc ? "Change" : "Amount"}</th>{wc && <th className="r">Balance</th>}<th /></tr>
            )}
          </thead>
          <tbody>
            {pg.rows.map((r, i) => np ? (
              <tr key={i}>
                <td className="wrap">{r.description}</td>
                <td className="page-sub">{(r.account ?? "").toLowerCase()}</td>
                <td className={`r${r.amount < 0 ? " neg" : ""}`}>{money(r.amount)}</td>
              </tr>
            ) : (
              <tr key={`${r.entryId}-${i}`}>
                <td>{shortDate(r.date)}</td>
                <td className="m">{r.documentId ? <Link href={`/documents/${r.documentId}`}>{r.docNo}</Link> : (r.entryNo ?? "—")}</td>
                <td className="wrap">{r.partner ?? "—"}</td>
                <td className="wrap">{r.description ?? "—"}</td>
                <td className={`r${r.amount < 0 ? " neg" : ""}`}>{money(r.amount)}</td>
                {wc && <td className="r">{money(r.balance ?? 0)}</td>}
                <td className="tight">
                  <Link href={`/finance/general-ledger/${r.entryId}`} className="cfpanel-go" title={`Journal entry ${r.entryNo ?? ""}`}
                    aria-label="Open journal entry"><BookOpen size={14} aria-hidden="true" /></Link>
                </td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={7} className="page-sub">{q ? "Nothing matches that search." : "Nothing in this period."}</td></tr>}
          </tbody>
        </table>
        <div className="cfpanel-pager"><Pager p={pg} params={sp} name="lp" /></div>
      </div>

      {d.accounts && d.accounts.length > 0 && (
        <div className="cfpanel-related">
          <div className="cfpanel-related-head">
            <h3>Related accounts</h3>
            <a href={gl(d.accounts.map((a) => a.id).join(","))} className="btn ghost tiny">
              <ExternalLink size={13} aria-hidden="true" /> Open in ledger
            </a>
          </div>
          <table className="cfpanel-table">
            <thead><tr><th>Account</th><th className="r">Opening</th><th className="r">Closing</th><th className="r">Change</th></tr></thead>
            <tbody>
              {d.accounts.map((a) => (
                <tr key={a.id}>
                  <td className="wrap"><Link href={gl(a.id)}>{a.code} {a.name}</Link></td>
                  <td className="r">{money(a.opening)}</td>
                  <td className="r">{money(a.closing)}</td>
                  <td className="r">{money(a.change)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {np && (
        <div className="cfpanel-related">
          <Link href={`/finance/income-statement?from=${range.from}&to=${range.to}`} className="btn ghost tiny">
            <ExternalLink size={13} aria-hidden="true" /> Open income statement
          </Link>
        </div>
      )}
    </aside>
  );
}
