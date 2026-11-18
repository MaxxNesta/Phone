import Link from "next/link";
import { Banknote, TrendingUp, Wallet, Users, Truck, Package, AlertTriangle, Check } from "lucide-react";
import { getCompany, getHealth } from "@/lib/queries";
import { seenLocations } from "@/lib/branch-scope";
import { hasModule } from "@/lib/plans";
import { money } from "@/lib/format";
import { resolvePeriod } from "@/lib/period";
import { executiveData, type Pl } from "@/lib/executive";
import { Stat, compact } from "@/components/stat";
import { RankedBarChart } from "@/components/charts";
import { PeriodPicker } from "@/components/period-picker";
import { HelpHint } from "@/components/help-hint";

const gp = (p: Pl) => p.rev - p.cogs;
const net = (p: Pl) => p.rev - p.cogs - p.exp;
const pct = (part: number, whole: number) => (whole ? `${((part / whole) * 100).toFixed(1)}%` : "—");
function delta(now: number, before: number, upIsGood = true) {
  if (!before) return null;
  const c = ((now - before) / Math.abs(before)) * 100;
  return { text: `${c >= 0 ? "▲" : "▼"} ${Math.abs(c).toFixed(1)}%`, good: (c >= 0) === upIsGood };
}
const d0 = (n: number | null) => (n == null ? "—" : `${Math.round(n)}`);

/**
 * The owner's page (Management Reports add-on): is the business making money,
 * where is the cash, what is owed both ways, and which branch carries it.
 * Profit is the general ledger's, so it agrees with the income statement.
 */
export default async function Executive({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const company = await getCompany();
  if (!company) return <div className="empty">No company found.</div>;

  const head = (
    <div className="page-head hero">
      <span className="eyebrow">Management Reports</span>
      <h1>Executive dashboard</h1>
      <HelpHint>Profit from the general ledger (it agrees with the income statement), cash and what is owed as they stand now, and each branch side by side.</HelpHint>
    </div>
  );
  if (!hasModule(company, "management")) {
    return <>{head}<div className="card"><div className="card-body">
      <p><strong>Management Reports is an add-on</strong> for the Standard and Advanced packages.</p>
      <p className="page-sub">Turn it on under Settings → Package & modules.</p>
    </div></div></>;
  }
  // Company totals are everyone's figures: shown only to someone who sees every branch.
  if (await seenLocations()) {
    return <>{head}<div className="alert">The executive dashboard covers the whole company, so it needs access to every branch.</div></>;
  }

  const period = resolvePeriod(sp.p ?? "1m");
  const [d, health] = await Promise.all([executiveData(company.id, period.from, period.to), getHealth(company.id)]);
  const spark = (f: (p: Pl) => number) => d.trend.map(f);
  const prev = "vs the period before";
  const issues = [
    d.arOverdueN > 0 && { href: "/finance/aging", text: `${d.arOverdueN} overdue invoice${d.arOverdueN === 1 ? "" : "s"} · ${compact(d.arOverdue)} MMK` },
    d.apDue7 > 0 && { href: "/payables", text: `${compact(d.apDue7)} MMK to suppliers due within 7 days` },
    d.negativeLines > 0 && { href: "/inventory/negative-stock", text: `${d.negativeLines} stock line${d.negativeLines === 1 ? "" : "s"} below zero` },
    health.trialBalance !== 0 && { href: "/ledger", text: `Trial balance off by ${money(health.trialBalance)}` },
    health.unbalanced > 0 && { href: "/finance/journal", text: `${health.unbalanced} unbalanced journal entr${health.unbalanced === 1 ? "y" : "ies"}` },
    health.inventoryBreaks > 0 && { href: "/finance/inventory-cogs", text: `Inventory and the ledger differ in ${health.inventoryBreaks} place${health.inventoryBreaks === 1 ? "" : "s"}` },
  ].filter(Boolean) as { href: string; text: string }[];

  return (
    <>
      {head}
      <div className="exec-bar">
        <span className="page-sub">{period.label} · MMK · compared with the same length of time before</span>
        <PeriodPicker current={period} label="Period" hrefFor={(k) => `/reports/executive?p=${k}`} />
      </div>

      <section className="stats exec-stats" aria-label="Profit">
        <Stat icon={<Banknote size={20} />} label="Revenue" value={`${compact(d.now.rev)} MMK`}
              delta={delta(d.now.rev, d.before.rev)} note={prev} trend={spark((p) => p.rev)} />
        <Stat icon={<TrendingUp size={20} />} tone="slate" label="Gross profit" value={`${compact(gp(d.now))} MMK`}
              delta={delta(gp(d.now), gp(d.before))} note={`Margin ${pct(gp(d.now), d.now.rev)}`} trend={spark(gp)} />
        <Stat icon={<Wallet size={20} />} tone="violet" label="Net profit" value={`${compact(net(d.now))} MMK`}
              delta={delta(net(d.now), net(d.before))} note={`After ${compact(d.now.exp)} expenses`} trend={spark(net)} />
        <Stat icon={<Banknote size={20} />} tone="amber" label="Cash & bank" value={`${compact(d.cash)} MMK`} note="As of now" />
      </section>

      <section className="stats exec-stats" aria-label="Working capital">
        <Stat icon={<Users size={20} />} label="Receivables" value={`${compact(d.ar)} MMK`}
              note={d.arOverdue ? `${compact(d.arOverdue)} overdue` : "None overdue"} noteTone={d.arOverdue ? "warn" : undefined} />
        <Stat icon={<Truck size={20} />} tone="slate" label="Payables" value={`${compact(d.ap)} MMK`}
              note={d.apDue7 ? `${compact(d.apDue7)} due in 7 days` : "Nothing due this week"} />
        <Stat icon={<Package size={20} />} tone="violet" label="Stock value" value={`${compact(d.stock)} MMK`}
              note={d.days.dio != null ? `${d0(d.days.dio)} days of sales` : undefined} />
        <Stat icon={<Wallet size={20} />} tone="amber" label="Cash cycle" value={d.days.ccc == null ? "—" : `${d0(d.days.ccc)} days`}
              note={`Paid in ${d0(d.days.dso)} · stock ${d0(d.days.dio)} · we pay in ${d0(d.days.dpo)}`} />
      </section>

      <div className="exec-grid">
        <div className="card">
          <div className="card-head"><h2>Branches</h2><span className="page-sub">{period.label}</span></div>
          <div className="card-body tight">
            <table className="table exec-table">
              <thead><tr><th>Branch</th><th className="r">Revenue</th><th className="r">Gross profit</th><th className="r">Margin</th>
                <th className="r">Net profit</th><th className="r">Stock</th></tr></thead>
              <tbody>
                {d.branches.map((b) => (
                  <tr key={b.id}><td>{b.name} <span className="subline">{b.code}</span></td><td className="r">{money(b.pl.rev)}</td><td className="r">{money(gp(b.pl))}</td>
                    <td className="r">{pct(gp(b.pl), b.pl.rev)}</td><td className={`r${net(b.pl) < 0 ? " neg" : ""}`}>{money(net(b.pl))}</td>
                    <td className="r">{money(b.stock)}</td></tr>
                ))}
                {d.unassigned && (d.unassigned.rev || d.unassigned.exp) ? (
                  <tr className="subline"><td>Company-wide (no branch)</td><td className="r">{money(d.unassigned.rev)}</td>
                    <td className="r">{money(gp(d.unassigned))}</td><td className="r" /><td className="r">{money(net(d.unassigned))}</td><td className="r" /></tr>
                ) : null}
              </tbody>
              <tfoot><tr><td>Company</td><td className="r">{money(d.now.rev)}</td><td className="r">{money(gp(d.now))}</td>
                <td className="r">{pct(gp(d.now), d.now.rev)}</td><td className="r">{money(net(d.now))}</td><td className="r">{money(d.stock)}</td></tr></tfoot>
            </table>
          </div>
        </div>

        <div className="card">
          <div className="card-head"><h2>Needs attention</h2></div>
          <div className="card-body">
            {issues.length === 0 ? (
              <p className="exec-ok"><Check size={16} aria-hidden="true" /> Nothing overdue, nothing below zero, and the books balance.</p>
            ) : (
              <ul className="exec-issues">
                {issues.map((i) => <li key={i.text}><AlertTriangle size={15} aria-hidden="true" /><Link href={i.href}>{i.text}</Link></li>)}
              </ul>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-head"><h2>Profit by month</h2><span className="page-sub">Last 12 months · MMK</span></div>
          <div className="card-body tight">
            <table className="table exec-table">
              <thead><tr><th>Month</th><th className="r">Revenue</th><th className="r">Gross profit</th><th className="r">Margin</th>
                <th className="r">Expenses</th><th className="r">Net profit</th></tr></thead>
              <tbody>
                {[...d.trend].reverse().map((m) => (
                  <tr key={m.month}><td>{new Date(`${m.month}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" })}</td>
                    <td className="r">{money(m.rev)}</td><td className="r">{money(gp(m))}</td><td className="r">{pct(gp(m), m.rev)}</td>
                    <td className="r">{money(m.exp)}</td><td className={`r${net(m) < 0 ? " neg" : ""}`}>{money(net(m))}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <div className="card-head"><h2>Largest expenses</h2><span className="page-sub">{period.label}</span></div>
          <div className="card-body">
            {d.expenses.length === 0 ? <p className="page-sub">No expenses posted in this period.</p>
              : <RankedBarChart data={d.expenses.map((e) => ({ label: `${e.code} ${e.name}`, value: e.amount }))} />}
            <p className="exec-links"><Link href="/finance/income-statement">Income statement →</Link> <Link href="/reports/financial-ratios">Financial ratios →</Link></p>
          </div>
        </div>
      </div>
    </>
  );
}
