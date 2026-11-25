import Link from "next/link";
import { IBM_Plex_Sans } from "next/font/google";
import { getCompany, getHealth } from "@/lib/queries";
import { seenLocations } from "@/lib/branch-scope";
import { hasModule, planIncludes } from "@/lib/plans";
import { money } from "@/lib/format";
import { resolvePeriod } from "@/lib/period";
import { executiveData, type Pl } from "@/lib/executive";
import { getRatioOverview } from "@/lib/financial-ratios";
import { ExecRatios } from "@/components/exec-ratios";
import { Suspense } from "react";
import { staleClearing, CLEARING_STALE_DAYS } from "@/lib/landed-cost-queries";
import { compact } from "@/components/stat";
import { RankedBarChart } from "@/components/charts";
import { ExecTabs } from "@/components/exec-tabs";
import { ProfitColumns, Gauge, HealthRadar, BusyHours, IncomeFlow, type RadarAxis, type FlowNode, type FlowLink } from "@/components/exec-charts";

/* The Executive page has a face of its own: IBM Plex Sans, true black on
   white, ruled sections instead of cards. Nothing else in the app uses it. */
const plex = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-exec", display: "swap" });

const gp = (p: Pl) => p.rev - p.cogs;
const net = (p: Pl) => p.rev - p.cogs - p.exp;
const pctOf = (part: number, whole: number) => (whole ? (part / whole) * 100 : null);
const pct = (part: number, whole: number) => { const v = pctOf(part, whole); return v == null ? "—" : `${v.toFixed(1)}%`; };
const d0 = (n: number | null) => (n == null ? "—" : `${Math.round(n)}`);
const clamp = (v: number) => Math.max(0, Math.min(100, v));
function change(now: number, before: number) {
  if (!before) return null;
  const c = ((now - before) / Math.abs(before)) * 100;
  return { c, text: `${c >= 0 ? "▲" : "▼"} ${Math.abs(c).toFixed(1)}%` };
}

const TABS = [["overview", "Overview"], ["profit", "Profit"], ["cash", "Working capital"], ["branches", "Branches"], ["ratios", "Ratios"]] as const;
type Tab = (typeof TABS)[number][0];
const SPANS = [["1m", "1M"], ["3m", "3M"], ["6m", "6M"], ["12m", "12M"]] as const;
const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const hourName = (h: number) => `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? "am" : "pm"}`;

/**
 * The owner's page (Management Reports add-on): is the business making money,
 * where is the cash, what is owed both ways, which branch carries it, and
 * when the shop is busy. Profit is the general ledger's, so it agrees with
 * the income statement. One loader, its queries in parallel, none per row;
 * the Ratios tab is one more pass over the ledger (lib/financial-ratios.ts),
 * streamed in behind the rest.
 */
export default async function Executive({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const company = await getCompany();
  if (!company) return <div className="empty">No company found.</div>;

  const shell = (body: React.ReactNode) => <div className={`xd ${plex.variable}`}>{body}</div>;
  if (!hasModule(company, "management")) {
    return shell(<><h1 className="xd-title">Executive</h1>
      <p className="xd-lede">Management Reports is an add-on for the Standard and Advanced packages. Turn it on under Settings, Package and modules.</p></>);
  }
  // Company totals are everyone's figures: shown only to someone who sees every branch.
  if (await seenLocations()) {
    return shell(<><h1 className="xd-title">Executive</h1>
      <p className="xd-lede">This page covers the whole company, so it needs access to every branch.</p></>);
  }

  const tab: Tab = TABS.find(([k]) => k === sp.tab)?.[0] ?? "overview";
  const period = resolvePeriod(sp.p ?? "1m");
  const landed = hasModule(company, "landed_cost");
  const [d, health, clearing] = await Promise.all([executiveData(company.id, period.from, period.to), getHealth(company.id),
    landed ? staleClearing(company.id) : Promise.resolve({ n: 0, total: 0 })]);

  const gm = pctOf(gp(d.now), d.now.rev), nm = pctOf(net(d.now), d.now.rev);
  const onTime = d.ar > 0 ? 100 * (1 - d.arOverdue / d.ar) : 100;
  const cover = d.ap > 0 ? d.cash / d.ap : null;
  const growth = d.before.rev ? ((d.now.rev - d.before.rev) / d.before.rev) * 100 : null;
  const radar: RadarAxis[] = [
    { label: "Gross margin", score: clamp(((gm ?? 0) / 40) * 100), reading: gm == null ? "No sales" : `${gm.toFixed(1)}% of revenue`, how: "40% or more scores 100." },
    { label: "Net margin", score: clamp(((nm ?? 0) / 20) * 100), reading: nm == null ? "No sales" : `${nm.toFixed(1)}% of revenue`, how: "20% or more scores 100; a loss scores 0." },
    { label: "Growth", score: growth == null ? 50 : clamp(50 + growth), reading: growth == null ? "No earlier sales to compare" : `${growth >= 0 ? "+" : ""}${growth.toFixed(1)}% revenue on the period before`, how: "Flat scores 50; +50% scores 100, −50% scores 0." },
    { label: "Cash cover", score: cover == null ? (d.cash > 0 ? 100 : 50) : clamp((cover / 1.5) * 100), reading: cover == null ? "Nothing owed to suppliers" : `Cash is ${cover.toFixed(2)} times what suppliers are owed`, how: "Cash at 1.5 times payables or more scores 100." },
    { label: "Collections", score: clamp(onTime), reading: `${onTime.toFixed(0)}% of receivables not overdue`, how: "The share of what customers owe that is not yet past due." },
    { label: "Stock turn", score: d.days.dio == null ? 50 : clamp(((180 - d.days.dio) / 150) * 100), reading: d.days.dio == null ? "No cost of sales yet" : `${Math.round(d.days.dio)} days of stock`, how: "30 days or less scores 100; 180 days or more scores 0." },
  ];

  const issues = [
    d.arOverdueN > 0 && { href: "/finance/aging", text: `${d.arOverdueN} customer invoice${d.arOverdueN === 1 ? " is" : "s are"} overdue, ${compact(d.arOverdue)} MMK in all.` },
    d.apDue7 > 0 && { href: "/payables", text: `${compact(d.apDue7)} MMK is due to suppliers within 7 days.` },
    d.negativeLines > 0 && { href: "/inventory/negative-stock", text: `${d.negativeLines} stock line${d.negativeLines === 1 ? " is" : "s are"} below zero.` },
    health.trialBalance !== 0 && { href: "/ledger", text: `The trial balance is off by ${money(health.trialBalance)}.` },
    health.unbalanced > 0 && { href: "/finance/journal", text: `${health.unbalanced} journal entr${health.unbalanced === 1 ? "y does" : "ies do"} not balance.` },
    clearing.n > 0 && { href: "/purchases/landed-cost-clearing", text: `${compact(clearing.total)} MMK of import bills has sat in landed cost clearing over ${CLEARING_STALE_DAYS} days.` },
    health.inventoryBreaks > 0 && { href: "/finance/inventory-cogs", text: `Stock and the ledger differ in ${health.inventoryBreaks} place${health.inventoryBreaks === 1 ? "" : "s"}.` },
  ].filter(Boolean) as { href: string; text: string }[];

  const top = Math.max(0, ...d.hours.map((h) => h.sales));
  const peaks = d.hours.filter((h) => h.sales === top);
  const byDay = Array.from({ length: 7 }, (_, i) => d.hours.filter((h) => h.dow === i + 1).reduce((t, h) => t + h.sales, 0));
  const busiestDay = byDay.some((n) => n > 0) ? byDay.indexOf(Math.max(...byDay)) : -1;
  const totalSales = byDay.reduce((t, n) => t + n, 0);

  const kpi = (label: string, value: string, sub?: React.ReactNode, tone?: "up" | "down") => (
    <div className="xd-kpi">
      <span className="xd-kpi-label">{label}</span>
      <span className="xd-kpi-value">{value}</span>
      {sub && <span className={`xd-kpi-sub${tone ? ` ${tone}` : ""}`}>{sub}</span>}
    </div>
  );
  const rc = change(d.now.rev, d.before.rev), gc = change(gp(d.now), gp(d.before));

  const hero = (
    <section className="xd-hero">
      <p className="xd-headline">
        {d.now.rev === 0 ? <>No sales were posted in {period.phrase}.</>
          : net(d.now) >= 0
            ? <>The business kept <strong>{compact(net(d.now))} MMK</strong> of profit in {period.phrase}, {nm!.toFixed(1)} kyat in every 100 sold.</>
            : <>The business lost <strong className="neg">{compact(-net(d.now))} MMK</strong> in {period.phrase}, after {compact(d.now.exp)} MMK of expenses.</>}
      </p>
      <div className="xd-kpis">
        {kpi("Revenue", `${compact(d.now.rev)}`, rc ? `${rc.text} on the period before` : "No earlier period", rc ? (rc.c >= 0 ? "up" : "down") : undefined)}
        {kpi("Gross profit", `${compact(gp(d.now))}`, gc ? `${gc.text}, margin ${pct(gp(d.now), d.now.rev)}` : `Margin ${pct(gp(d.now), d.now.rev)}`, gc ? (gc.c >= 0 ? "up" : "down") : undefined)}
        {kpi("Cash and bank", `${compact(d.cash)}`, "As it stands today")}
        {kpi("Customers owe", `${compact(d.ar)}`, d.arOverdue ? <span className="neg">{compact(d.arOverdue)} overdue</span> : "None overdue")}
      </div>
    </section>
  );

  const section = (title: string, aside: string | null, body: React.ReactNode, cls = "") => (
    <section className={`xd-sec ${cls}`}>
      <header><h2>{title}</h2>{aside && <span>{aside}</span>}</header>
      {body}
    </section>
  );

  const gaugesRow = (
    <div className="xd-gauges">
      <Gauge label="Gross margin" value={gm} max={40} note="of revenue" />
      <Gauge label="Net margin" value={nm} max={20} note="after expenses" />
      <Gauge label="Paid on time" value={d.ar > 0 ? onTime : null} max={100} display={d.ar > 0 ? undefined : "—"} note="receivables not overdue" />
      <Gauge label="Cash cover" value={cover} max={2} suffix="×" display={cover == null ? "—" : `${cover.toFixed(2)}×`} note="cash over payables" />
    </div>
  );
  const attention = issues.length === 0
    ? <p className="xd-quiet">Nothing is overdue, nothing is below zero, and the books balance.</p>
    : <ol className="xd-issues">{issues.map((i) => <li key={i.text}><Link href={i.href}>{i.text}</Link></li>)}</ol>;
  const busy = (
    <>
      <BusyHours cells={d.hours} />
      {totalSales > 0 && (
        <p className="xd-note">
          {totalSales} sales in {period.phrase}.{" "}
          {peaks.length === 1
            ? <>The busiest hour was {DAY_NAMES[peaks[0].dow - 1]} at {hourName(peaks[0].hour)}, with {top} sales. </>
            : <>No single hour stands out yet; the busiest hours had {top} sale{top === 1 ? "" : "s"} each. </>}
          {byDay.filter((n) => n === byDay[busiestDay]).length === 1 && <>{DAY_NAMES[busiestDay]} was the busiest day.</>}
        </p>
      )}
    </>
  );
  const branchTable = (
    <table className="xd-table">
      <thead><tr><th>Branch</th><th className="r">Revenue</th><th className="r">Gross profit</th><th className="r">Margin</th><th className="r">Net profit</th><th className="r">Stock</th></tr></thead>
      <tbody>
        {d.branches.map((b) => (
          <tr key={b.id}><td>{b.name} <span className="xd-code">{b.code}</span></td><td className="r">{money(b.pl.rev)}</td><td className="r">{money(gp(b.pl))}</td>
            <td className="r">{pct(gp(b.pl), b.pl.rev)}</td><td className={`r${net(b.pl) < 0 ? " neg" : ""}`}>{money(net(b.pl))}</td><td className="r">{money(b.stock)}</td></tr>
        ))}
        {d.unassigned && (d.unassigned.rev || d.unassigned.exp) ? (
          <tr className="xd-muted"><td>Company-wide, no branch</td><td className="r">{money(d.unassigned.rev)}</td><td className="r">{money(gp(d.unassigned))}</td>
            <td className="r" /><td className="r">{money(net(d.unassigned))}</td><td className="r" /></tr>
        ) : null}
      </tbody>
      <tfoot><tr><td>Company</td><td className="r">{money(d.now.rev)}</td><td className="r">{money(gp(d.now))}</td><td className="r">{pct(gp(d.now), d.now.rev)}</td>
        <td className={`r${net(d.now) < 0 ? " neg" : ""}`}>{money(net(d.now))}</td><td className="r">{money(d.stock)}</td></tr></tfoot>
    </table>
  );
  /* The income flow: sources, (returns and discounts,) revenue, cost of sales
     and gross profit, expenses and net profit (or the loss that fed them),
     expenses by account. Built from the same ledger figures as the tiles. */
  const flow = (() => {
    const nodes: FlowNode[] = [], links: FlowLink[] = [];
    const sources = d.revenueBy.filter((r) => r.amount > 0);
    const deductions = -d.revenueBy.filter((r) => r.amount < 0).reduce((t, r) => t + r.amount, 0);
    const top4 = sources.slice(0, 4), restSrc = sources.slice(4).reduce((t, r) => t + r.amount, 0);
    const srcs = [...top4.map((r) => ({ id: `src-${r.code}`, label: r.name, value: r.amount })),
                  ...(restSrc > 0 ? [{ id: "src-other", label: "Other income", value: restSrc }] : [])];
    const gross = srcs.reduce((t, r) => t + r.value, 0);
    const rev = d.now.rev, cogs = d.now.cogs, g = gp(d.now), exp = d.now.exp, n = net(d.now);
    if (rev <= 0) return null;
    let c = 0;
    const showSources = srcs.length > 1 || deductions > 0;
    if (showSources) { srcs.forEach((x) => nodes.push({ ...x, col: c, tone: "neutral" })); c++; }
    if (deductions > 0) {
      nodes.push({ id: "gross", label: "Gross sales", value: gross, col: c, tone: "neutral" });
      srcs.forEach((x) => links.push({ from: x.id, to: "gross", value: x.value, tone: "neutral" }));
      c++;
      nodes.push({ id: "ded", label: "Returns and discounts", value: deductions, col: c, tone: "cost" });
      links.push({ from: "gross", to: "ded", value: deductions, tone: "cost" });
      nodes.push({ id: "rev", label: "Revenue", value: rev, col: c, tone: "keep", note: "" });
      links.push({ from: "gross", to: "rev", value: rev, tone: "keep" });
    } else {
      nodes.push({ id: "rev", label: "Revenue", value: rev, col: c, tone: "keep", note: "" });
      if (showSources) srcs.forEach((x) => links.push({ from: x.id, to: "rev", value: x.value, tone: "neutral" }));
    }
    c++;
    if (g <= 0) {
      nodes.push({ id: "cogs", label: "Cost of sales", value: cogs, col: c, tone: "cost" });
      links.push({ from: "rev", to: "cogs", value: rev, tone: "cost" });
      return { nodes, links };
    }
    nodes.push({ id: "gp", label: "Gross profit", value: g, col: c, tone: "keep" });
    nodes.push({ id: "cogs", label: "Cost of sales", value: cogs, col: c, tone: "cost" });
    links.push({ from: "rev", to: "gp", value: g, tone: "keep" }, { from: "rev", to: "cogs", value: cogs, tone: "cost" });
    if (exp <= 0) {
      c++;
      nodes.push({ id: "net", label: "Net profit", value: g, col: c, tone: "keep" });
      links.push({ from: "gp", to: "net", value: g, tone: "keep" });
      return { nodes, links };
    }
    c++;
    if (n >= 0) {
      nodes.push({ id: "net", label: "Net profit", value: n, col: c, tone: "keep" });
      links.push({ from: "gp", to: "net", value: n, tone: "keep" });
    } else {
      nodes.push({ id: "loss", label: "Net loss", value: -n, col: c - 1, tone: "cost" });
      links.push({ from: "loss", to: "exp", value: -n, tone: "cost" });
    }
    nodes.push({ id: "exp", label: "Expenses", value: exp, col: c, tone: "cost" });
    links.push({ from: "gp", to: "exp", value: Math.min(g, exp), tone: "cost" });
    c++;
    const topExp = d.expenses.slice(0, 4), restExp = exp - topExp.reduce((t, e) => t + e.amount, 0);
    for (const e of topExp) {
      nodes.push({ id: `exp-${e.code}`, label: e.name, value: e.amount, col: c, tone: "cost" });
      links.push({ from: "exp", to: `exp-${e.code}`, value: e.amount, tone: "cost" });
    }
    if (restExp > 0.5) {
      nodes.push({ id: "exp-other", label: "Other expenses", value: restExp, col: c, tone: "cost" });
      links.push({ from: "exp", to: "exp-other", value: restExp, tone: "cost" });
    }
    return { nodes, links };
  })();
  const flowChart = flow
    ? <IncomeFlow nodes={flow.nodes} links={flow.links} base={d.now.rev} />
    : <p className="xd-quiet">No revenue was posted in this period, so there is nothing to follow yet.</p>;
  const profitChart = <ProfitColumns months={d.trend.map((m) => ({ month: m.month, rev: m.rev, gp: gp(m) }))} />;

  return shell(
    <ExecTabs
      title={<h1 className="xd-title">Executive</h1>}
      dateline={<p className="xd-dateline">{company.name}, {period.label.toLowerCase()}, figures in MMK. Profit is read from the general ledger.</p>}
      initial={tab} period={period.key}
      spans={SPANS.map(([key, label]) => ({ key, label }))}
      tabs={[
        { id: "overview", label: "Overview", content: (
        <>
          {hero}
          <div className="xd-split">
            {section("Revenue and gross profit", "Last 12 months", profitChart)}
            {section("Business health", "Six scores out of 100", <>
              <HealthRadar axes={radar} />
              <details className="xd-how"><summary>How each score is worked out</summary>
                <table className="xd-table"><tbody>{radar.map((a) => <tr key={a.label}><td>{a.label}</td><td className="r">{Math.round(a.score)}</td><td>{a.reading}. {a.how}</td></tr>)}</tbody></table>
              </details></>)}
          </div>
          {section("When the shop is busy", "Sales by weekday and hour, shop time", busy, "xd-signature")}
          <div className="xd-split">
            {section("Margins and cover", null, gaugesRow)}
            {section("Needs attention", null, attention)}
          </div>
        </>
        ) },
        { id: "profit", label: "Profit", content: (
        <>
          {hero}
          {section("Where the money went", `${period.label}, from revenue to net profit`, flowChart)}
          {section("Revenue and gross profit", "Last 12 months", <ProfitColumns wide months={d.trend.map((m) => ({ month: m.month, rev: m.rev, gp: gp(m) }))} />)}
          <div className="xd-split">
            {section("Profit by month", "Last 12 months", (
              <table className="xd-table">
                <thead><tr><th>Month</th><th className="r">Revenue</th><th className="r">Gross profit</th><th className="r">Margin</th><th className="r">Expenses</th><th className="r">Net profit</th></tr></thead>
                <tbody>
                  {[...d.trend].reverse().map((m) => (
                    <tr key={m.month}><td>{new Date(`${m.month}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" })}</td>
                      <td className="r">{money(m.rev)}</td><td className="r">{money(gp(m))}</td><td className="r">{pct(gp(m), m.rev)}</td>
                      <td className="r">{money(m.exp)}</td><td className={`r${net(m) < 0 ? " neg" : ""}`}>{money(net(m))}</td></tr>
                  ))}
                </tbody>
              </table>
            ))}
            {section("Largest expenses", period.label, <>
              {d.expenses.length === 0 ? <p className="xd-quiet">No expenses were posted in this period.</p>
                : <RankedBarChart data={d.expenses.map((e) => ({ label: `${e.code} ${e.name}`, value: e.amount }))} />}
              <p className="xd-links"><Link href="/finance/income-statement">Open the income statement</Link>{planIncludes(company.plan, "financial_ratios") && <Link href="/reports/financial-ratios">Open financial ratios</Link>}</p>
            </>)}
          </div>
        </>
        ) },
        { id: "cash", label: "Working capital", content: (
        <>
          <section className="xd-hero">
            <p className="xd-headline">
              {d.days.ccc == null ? <>There is not enough trading yet to measure how long cash is tied up.</>
                : Math.round(d.days.ccc) === 0 ? <>Cash comes back about as fast as it goes out: customers pay as suppliers fall due.</>
                : d.days.ccc > 0 ? <>Cash is tied up for <strong>{d0(d.days.ccc)} days</strong> between paying for stock and being paid for it.</>
                : <>Suppliers are carrying the stock: customers pay <strong>{d0(-d.days.ccc)} days</strong> before the suppliers are paid.</>}
            </p>
            <div className="xd-kpis">
              {kpi("Customers owe", compact(d.ar), d.arOverdue ? <span className="neg">{compact(d.arOverdue)} overdue</span> : "None overdue")}
              {kpi("We owe suppliers", compact(d.ap), d.apDue7 ? `${compact(d.apDue7)} due within 7 days` : "Nothing due this week")}
              {kpi("Stock", compact(d.stock), d.days.dio != null ? `${d0(d.days.dio)} days of stock` : undefined)}
              {kpi("Cash and bank", compact(d.cash), "As it stands today")}
            </div>
          </section>
          <div className="xd-split">
            {section("The cash cycle", "On the last 3 months' pace", <>
              <div className="xd-gauges three">
                <Gauge label="Customers pay in" value={d.days.dso} max={90} suffix=" d" display={d.days.dso == null ? "—" : `${d0(d.days.dso)} d`} note="receivables over daily sales" />
                <Gauge label="Stock sits for" value={d.days.dio} max={180} suffix=" d" display={d.days.dio == null ? "—" : `${d0(d.days.dio)} d`} note="stock over daily cost of sales" />
                <Gauge label="We pay in" value={d.days.dpo} max={90} suffix=" d" display={d.days.dpo == null ? "—" : `${d0(d.days.dpo)} d`} note="payables over daily cost of sales" />
              </div>
              <p className="xd-note">Days customers take to pay, plus days stock sits, less days we take to pay suppliers.</p>
            </>)}
            {section("Needs attention", null, attention)}
          </div>
        </>
        ) },
        { id: "branches", label: "Branches", content: (
        <>
          {section("Branches side by side", period.label, branchTable)}
          <div className="xd-split even">
            {section("Revenue by branch", period.label, <RankedBarChart data={[...d.branches].sort((a, b) => b.pl.rev - a.pl.rev).map((b) => ({ label: b.name, value: b.pl.rev }))} />)}
            {section("Net profit by branch", period.label, <RankedBarChart data={[...d.branches].sort((a, b) => net(b.pl) - net(a.pl)).map((b) => ({ label: b.name, value: net(b.pl) }))} />)}
          </div>
        </>
        ) },
        { id: "ratios", label: "Ratios", content: (
          /* The ratios read the whole ledger once (balances need every line
             since the start), so they stream in after the rest of the page
             rather than hold it up. */
          <Suspense fallback={<p className="xd-quiet rx-wait">Reading the ledger for the ratios…</p>}>
            <RatiosPane co={company.id} from={period.from} to={period.to} phrase={period.phrase} fullReport={planIncludes(company.plan, "financial_ratios")} />
          </Suspense>
        ) },
      ]}
    />,
  );
}

async function RatiosPane({ co, from, to, phrase, fullReport }: { co: string; from: string; to: string; phrase: string; fullReport: boolean }) {
  const r = await getRatioOverview(co, from, to);
  return <ExecRatios now={r.current} before={r.previous} months={r.months} from={from} to={to} phrase={phrase} fullReport={fullReport}
    spanMonths={Math.round((Date.parse(to) - Date.parse(from)) / (30.44 * 86_400_000))} />;
}
