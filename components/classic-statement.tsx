import type { StatementNode } from "@/lib/report-tree";
import type { Section } from "./statement-table";

/**
 * The income statement as the shop's legacy books lay it out: each section
 * under its name, each account group as a heading with its accounts and a
 * ruled subtotal beneath, the section total, then Gross Profit and the rest.
 * Same figures as the standard view — only the presentation differs.
 *
 * Signs follow the old report: an account shows its own balance, and a cost
 * group's subtotal shows what it takes off profit, in brackets. So Purchase
 * Discounts reads (1,000,000) on its line and 1,000,000 under its group.
 */
const fmt = (n: number) => {
  const s = Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return n < 0 ? `(${s})` : s;
};
const pct = (part: number, whole: number) =>
  whole === 0 ? "" : `${((Math.abs(part) / Math.abs(whole)) * 100).toLocaleString("en-US", { maximumFractionDigits: 2 })} %`;

type Group = { name: string; accounts: StatementNode[]; amount: number };

/** Every group whose children are accounts, in chart order; loose accounts collect under the parent. */
function groupsOf(nodes: StatementNode[], parentName: string): Group[] {
  const out: Group[] = [];
  const loose = nodes.filter((n) => n.children.length === 0);
  if (loose.length) out.push({ name: parentName, accounts: loose, amount: loose.reduce((t, n) => t + n.amount, 0) });
  for (const n of nodes.filter((x) => x.children.length > 0)) out.push(...groupsOf(n.children, n.name));
  return out;
}

export function ClassicStatement({ sections, subtotals, revenue, scope }: {
  sections: Section[];
  subtotals: { after: string; label: string; value: number; strong?: boolean }[];
  revenue: number;
  scope: string;
}) {
  return (
    <section className="card classic-pl">
      <div className="card-head"><h2>Statement</h2><span className="page-sub">{scope}</span></div>
      <div className="tablewrap">
        <table>
          <thead>
            <tr><th>Description</th><th className="r">Account</th><th className="r">Amount</th>
              <th className="r">% of section</th><th className="r">% of revenue</th></tr>
          </thead>
          <tbody>
            {sections.map((s) => {
              // What the section does to profit: revenue adds, everything else takes away.
              const effect = (v: number) => (s.key === "REVENUE" || s.key === "OTHER" ? v : -v);
              return [
                <tr key={`${s.key}-h`} className="cl-section"><td colSpan={5}>{s.label}</td></tr>,
                ...groupsOf(s.nodes, s.label).flatMap((g, gi) => [
                  <tr key={`${s.key}-${gi}-h`} className="cl-group"><td colSpan={5}>{g.name}</td></tr>,
                  ...g.accounts.map((a) => (
                    <tr key={a.id} className="cl-acct">
                      <td>{a.name}</td>
                      <td className="r">{fmt(a.amount)}</td>
                      <td className="r">{fmt(a.amount)}</td>
                      <td className="r">{pct(a.amount, s.total)}</td>
                      <td className="r">{pct(a.amount, revenue)}</td>
                    </tr>
                  )),
                  <tr key={`${s.key}-${gi}-t`} className="cl-subtotal">
                    <td /><td /><td className="r">{fmt(effect(g.amount))}</td><td /><td />
                  </tr>,
                ]),
                <tr key={`${s.key}-t`} className="cl-total">
                  <td>{s.totalLabel}</td><td />
                  <td className="r">{fmt(effect(s.total))}</td>
                  <td className="r">{s.total === 0 ? "" : "100 %"}</td>
                  <td className="r">{pct(s.total, revenue)}</td>
                </tr>,
                ...subtotals.filter((t) => t.after === s.key).map((t) => (
                  <tr key={`${s.key}-${t.label}`} className={`cl-total${t.strong ? " strong" : ""}`}>
                    <td>{t.label}</td><td /><td className="r">{fmt(t.value)}</td><td /><td className="r">{pct(t.value, revenue)}</td>
                  </tr>
                )),
              ];
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
