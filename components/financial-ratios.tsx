"use client";

import Link from "next/link";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine,
} from "recharts";
import {
  Scale, Layers, Banknote, Wallet, RefreshCw, Percent, TrendingUp, Landmark, ShieldCheck, Gauge, ArrowRight,
} from "lucide-react";
import { money } from "@/lib/format";
import { HelpHint } from "@/components/help-hint";
import { ExportCsvButton } from "@/components/export-csv";
import type { RatioKey, RatioWindow } from "@/lib/financial-ratios";

export type RatioTab = "overview" | "liquidity" | "working-capital" | "profitability" | "risk";

type Point = { label: string; workingCapital: number } & Record<RatioKey, number | null>;
type Cycle = { ccc: number | null; dio: number | null; dso: number | null; dpo: number | null };
type Kind = "x" | "pct" | "times";

/** Every ratio once: what it is called, how it reads, and the two figures it divides. */
const RATIO: Record<RatioKey, {
  label: string; kind: Kind; lowerIsBetter?: boolean; formula: string; meaning: string;
  parts: (w: RatioWindow) => [number, number];
}> = {
  current: { label: "Current ratio", kind: "x", formula: "Current assets ÷ current liabilities",
    meaning: "Compares current assets to current liabilities.", parts: (w) => [w.currentAssets, w.currentLiabilities] },
  quick: { label: "Quick ratio", kind: "x", formula: "(Current assets − inventory) ÷ current liabilities",
    meaning: "Short-term obligations met from the most liquid assets, inventory excluded.",
    parts: (w) => [w.currentAssets - w.inventory, w.currentLiabilities] },
  cash: { label: "Cash ratio", kind: "x", formula: "Cash and bank ÷ current liabilities",
    meaning: "Short-term liabilities paid off with cash and cash equivalents.", parts: (w) => [w.cash, w.currentLiabilities] },
  absolute: { label: "Absolute liquidity ratio", kind: "x", formula: "(Cash + marketable securities) ÷ current liabilities",
    meaning: "Short-term liabilities covered by cash and marketable securities. The chart holds no short-term investments, so it equals the cash ratio until one is added under 13.",
    parts: (w) => [w.cash, w.currentLiabilities] },
  receivableTurnover: { label: "Receivable turnover", kind: "times", formula: "Net sales ÷ average receivable",
    meaning: "How efficiently receivables are collected: sales made per kyat owed.", parts: (w) => [w.netSales, w.avgReceivable] },
  debtorsTurnover: { label: "Debtors turnover", kind: "times", formula: "Cash collected from customers ÷ average receivable",
    meaning: "How many times receivables were turned into cash in the period.", parts: (w) => [w.collected, w.avgReceivable] },
  creditorsTurnover: { label: "Creditors turnover", kind: "times", formula: "Supplier bills ÷ average payable",
    meaning: "How quickly suppliers are paid. Lower means longer credit is being used.", lowerIsBetter: true,
    parts: (w) => [w.creditPurchases, w.avgPayable] },
  grossMargin: { label: "Gross profit margin", kind: "pct", formula: "Gross profit ÷ net sales",
    meaning: "What is left of each sale after the cost of the goods.", parts: (w) => [w.grossProfit, w.netSales] },
  operatingMargin: { label: "Operating margin", kind: "pct", formula: "Operating profit ÷ net sales",
    meaning: "Profit from trading after running costs, before interest and other income.", parts: (w) => [w.operatingProfit, w.netSales] },
  netMargin: { label: "Earning margin", kind: "pct", formula: "Net profit ÷ net sales",
    meaning: "The share of revenue that becomes profit after all expenses.", parts: (w) => [w.netProfit, w.netSales] },
  roa: { label: "Return on assets (ROA)", kind: "pct", formula: "Net profit ÷ average total assets",
    meaning: "Profit earned on everything the business holds.", parts: (w) => [w.netProfit, w.avgAssets] },
  roe: { label: "Return on equity (ROE)", kind: "pct", formula: "Net profit ÷ average equity",
    meaning: "The return generated on the owners' equity.", parts: (w) => [w.netProfit, w.avgEquity] },
  roi: { label: "Return on investment (ROI)", kind: "pct", formula: "Net profit ÷ average (equity + debt)",
    meaning: "Profit against all the money invested, the owners' and the lenders'.", parts: (w) => [w.netProfit, w.avgCapital] },
  debtToEquity: { label: "Debt to equity", kind: "x", lowerIsBetter: true, formula: "Debt ÷ equity",
    meaning: "Total borrowing compared with the owners' equity. Debt is the loans under 23.", parts: (w) => [w.debt, w.equity] },
  debtToAssets: { label: "Debt to assets", kind: "x", lowerIsBetter: true, formula: "Debt ÷ total assets",
    meaning: "The share of the assets financed by borrowing.", parts: (w) => [w.debt, w.totalAssets] },
  liabilitiesToEquity: { label: "Liabilities to equity", kind: "x", lowerIsBetter: true, formula: "Total liabilities ÷ equity",
    meaning: "Everything owed, borrowing and suppliers alike, against equity.", parts: (w) => [w.totalLiabilities, w.equity] },
  interestCover: { label: "Interest cover", kind: "x", formula: "Operating profit ÷ interest expense",
    meaning: "How many times operating profit covers the interest due. Interest is posted to 67101.",
    parts: (w) => [w.operatingProfit, w.interest] },
  financialLeverage: { label: "Financial leverage", kind: "x", lowerIsBetter: true, formula: "Average total assets ÷ average equity",
    meaning: "How far borrowed money finances the operations.", parts: (w) => [w.avgAssets, w.avgEquity] },
  operatingLeverage: { label: "Operating leverage", kind: "x", lowerIsBetter: true, formula: "Gross profit ÷ operating profit",
    meaning: "How much a change in sales moves operating profit: the weight of fixed costs. Cost of sales is taken as the variable cost, expenses as the fixed.",
    parts: (w) => [w.grossProfit, w.operatingProfit] },
};

const fmt = (kind: Kind, v: number | null) =>
  v === null ? "—" : kind === "pct" ? `${v.toFixed(1)}%` : kind === "times" ? `${v.toFixed(2)}×` : `${v.toFixed(2)}x`;
const days = (v: number | null) => (v === null ? "—" : `${Math.round(v)} days`);

/** Movement said the way it reads: percentages move in points, and "better" follows the ratio's sense. */
function Change({ now, before, kind, lowerIsBetter = false }: {
  now: number | null; before: number | null; kind: Kind | "days" | "money"; lowerIsBetter?: boolean;
}) {
  if (now === null || before === null) return <span className="page-sub">—</span>;
  const diff = now - before;
  if (Math.abs(diff) < 1e-9) return <span className="page-sub">no change</span>;
  const good = lowerIsBetter ? diff < 0 : diff > 0;
  const text = kind === "pct" ? `${diff > 0 ? "+" : ""}${diff.toFixed(1)} pp`
    : kind === "days" ? `${diff > 0 ? "+" : ""}${Math.round(diff)} days`
    : before === 0 ? "new" : `${diff > 0 ? "+" : ""}${((diff / Math.abs(before)) * 100).toFixed(1)}%`;
  return (
    <span className="delta" style={{ color: good ? "var(--chart-1)" : "var(--bad)" }}>
      {diff > 0 ? "▲" : "▼"} {text}
    </span>
  );
}

function Tile({ icon, label, meaning, value, now, before, prevText, kind, lowerIsBetter }: {
  icon: React.ReactNode; label: string; meaning: string; value: string; now: number | null; before: number | null;
  prevText: string; kind: Kind | "days" | "money"; lowerIsBetter?: boolean;
}) {
  return (
    <div className="kpi">
      <span className="kpi-icon" style={{ color: "var(--ink)", background: "var(--line-soft)" }}>{icon}</span>
      <span className="kpi-body">
        <span className="kpi-label">{label} <HelpHint label={label}>{meaning}</HelpHint></span>
        <span className="kpi-value">{value}</span>
        <span className="kpi-note">
          {now === null && before === null ? "No figures yet"
            : <><Change now={now} before={before} kind={kind} lowerIsBetter={lowerIsBetter} /> vs {prevText}</>}
        </span>
      </span>
    </div>
  );
}

function RatioTile({ k, icon, now, before }: { k: RatioKey; icon: React.ReactNode; now: RatioWindow; before: RatioWindow }) {
  const r = RATIO[k];
  return <Tile icon={icon} label={r.label} meaning={r.meaning} value={fmt(r.kind, now.ratios[k])}
    now={now.ratios[k]} before={before.ratios[k]} prevText={fmt(r.kind, before.ratios[k])} kind={r.kind} lowerIsBetter={r.lowerIsBetter} />;
}

const COLOURS = ["var(--chart-1)", "var(--ink)", "var(--muted)", "var(--chart-3)"];

function Trend({ title, sub, data, keys, kind }: {
  title: string; sub: string; data: Point[]; keys: (RatioKey | "workingCapital")[]; kind: Kind | "money";
}) {
  const tick = (v: number) => (kind === "money" ? money(v) : kind === "pct" ? `${v}%` : `${v}`);
  const name = (k: string) => (k === "workingCapital" ? "Working capital" : RATIO[k as RatioKey].label);
  return (
    <div className="dash-card dash-card-pad">
      <div className="dash-section-head">
        <div><h2>{title}</h2><span className="dash-sub">{sub}</span></div>
      </div>
      <ResponsiveContainer width="100%" height={250}>
        <LineChart data={data} margin={{ top: 8, right: 12, left: kind === "money" ? 24 : -12, bottom: 0 }}>
          <CartesianGrid stroke="var(--line-soft)" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="var(--muted)" />
          <YAxis tick={{ fontSize: 11 }} stroke="var(--muted)" tickFormatter={tick} />
          <ReferenceLine y={0} stroke="var(--line)" />
          <Tooltip formatter={(v, n) => [kind === "money" ? money(Number(v)) : fmt(kind as Kind, Number(v)), name(String(n))]}
                   contentStyle={{ borderRadius: 10, border: "1px solid var(--line)", background: "var(--surface)", fontSize: 12 }} />
          {keys.map((k, i) => (
            <Line key={k} type="monotone" dataKey={k} name={k} stroke={COLOURS[i % COLOURS.length]}
                  strokeWidth={i === 0 ? 2.2 : 1.6} dot={{ r: 2.5 }} connectNulls />
          ))}
        </LineChart>
      </ResponsiveContainer>
      {keys.length > 1 && (
        <div className="chart-legend">
          {keys.map((k, i) => (
            <span key={k}><span className="chart-legend-swatch" style={{ borderColor: COLOURS[i], background: COLOURS[i] }} />{name(k)}</span>
          ))}
        </div>
      )}
    </div>
  );
}

/** Each ratio with its formula and both its figures, for this period and the one before. */
function RatioTable({ keys, now, before, currency }: { keys: RatioKey[]; now: RatioWindow; before: RatioWindow; currency: string }) {
  const rows: (string | number)[][] = [["Ratio", "Formula", "This period", "Previous", "Numerator", "Denominator"]];
  for (const k of keys) {
    const r = RATIO[k], [a, b] = r.parts(now);
    rows.push([r.label, r.formula, fmt(r.kind, now.ratios[k]), fmt(r.kind, before.ratios[k]), a, b]);
  }
  return (
    <div className="card">
      <div className="card-head">
        <h2>Ratio, formula and figures</h2>
        <ExportCsvButton name="financial-ratios" rows={rows} />
      </div>
      <div className="tablewrap">
        <table>
          <thead>
            <tr><th>Ratio</th><th className="r">This period</th><th className="r">Previous</th><th>Change</th></tr>
          </thead>
          <tbody>
            {keys.map((k) => {
              const r = RATIO[k], [a, b] = r.parts(now), [pa, pb] = r.parts(before);
              return (
                <tr key={k}>
                  <td className="wrap"><strong>{r.label}</strong><div className="subline">{r.formula}</div></td>
                  <td className="r"><strong>{fmt(r.kind, now.ratios[k])}</strong>
                    <div className="subline">{money(a)} ÷ {money(b)}</div></td>
                  <td className="r">{fmt(r.kind, before.ratios[k])}
                    <div className="subline">{money(pa)} ÷ {money(pb)}</div></td>
                  <td><Change now={now.ratios[k]} before={before.ratios[k]} kind={r.kind} lowerIsBetter={r.lowerIsBetter} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="card-body"><span className="hint">Amounts in {currency}.</span></div>
    </div>
  );
}

/** Lines of money, this period beside the one before. */
function Figures({ title, rows }: { title: string; rows: [string, number, number, boolean?][] }) {
  return (
    <div className="card">
      <div className="card-head"><h2>{title}</h2></div>
      <div className="tablewrap">
        <table>
          <thead><tr><th></th><th className="r">This period</th><th className="r">Previous</th><th>Change</th></tr></thead>
          <tbody>
            {rows.map(([l, a, b, strong]) => (
              <tr key={l}>
                <td>{strong ? <strong>{l}</strong> : l}</td>
                <td className="r">{strong ? <strong>{money(a)}</strong> : money(a)}</td>
                <td className="r">{money(b)}</td>
                <td><Change now={a} before={b} kind="money" /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function FinancialRatios({ tab, current: c, previous: p, trend, cycle, currency, cycleHref }: {
  tab: RatioTab; current: RatioWindow; previous: RatioWindow; trend: Point[];
  cycle: { now: Cycle; before: Cycle } | null; currency: string; cycleHref: string;
}) {
  const sub = "from the start of the period to each month end";

  if (tab === "overview") {
    const cc = cycle!;
    return (
      <>
        <div className="kpis kpis-tiled">
          <RatioTile k="current" icon={<Scale size={16} />} now={c} before={p} />
          <RatioTile k="quick" icon={<Layers size={16} />} now={c} before={p} />
          <Tile icon={<RefreshCw size={16} />} label="Cash conversion cycle" meaning="Days between paying for goods and being paid for them."
            value={days(cc.now.ccc)} now={cc.now.ccc} before={cc.before.ccc} prevText={days(cc.before.ccc)} kind="days" lowerIsBetter />
          <RatioTile k="netMargin" icon={<Percent size={16} />} now={c} before={p} />
        </div>
        <Trend title="Liquidity trend" sub="Current ratio and quick ratio" data={trend} keys={["current", "quick"]} kind="x" />
        <Figures title="Performance comparison" rows={[
          ["Net sales", c.netSales, p.netSales], ["Gross profit", c.grossProfit, p.grossProfit],
          ["Operating profit", c.operatingProfit, p.operatingProfit], ["Net profit", c.netProfit, p.netProfit, true],
        ]} />
        <RatioTable keys={["netMargin", "current", "quick", "roe"]} now={c} before={p} currency={currency} />
      </>
    );
  }

  if (tab === "liquidity") {
    return (
      <>
        <div className="kpis kpis-tiled">
          <RatioTile k="cash" icon={<Banknote size={16} />} now={c} before={p} />
          <RatioTile k="current" icon={<Scale size={16} />} now={c} before={p} />
          <RatioTile k="quick" icon={<Layers size={16} />} now={c} before={p} />
          <RatioTile k="absolute" icon={<Wallet size={16} />} now={c} before={p} />
        </div>
        <Trend title="Liquidity ratios trend" sub={sub} data={trend} keys={["current", "quick", "cash", "absolute"]} kind="x" />
        <RatioTable keys={["cash", "current", "quick", "absolute"]} now={c} before={p} currency={currency} />
      </>
    );
  }

  if (tab === "working-capital") {
    const cc = cycle!.now;
    const asOf = new Date(new Date(c.to).getTime() - 86_400_000).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
    return (
      <>
        <div className="kpis kpis-tiled">
          <Tile icon={<Wallet size={16} />} label="Working capital" meaning="Current assets less current liabilities."
            value={money(c.workingCapital)} now={c.workingCapital} before={p.workingCapital} prevText={money(p.workingCapital)} kind="money" />
          <Tile icon={<Layers size={16} />} label="Current assets" meaning="Everything under Current Assets (13)."
            value={money(c.currentAssets)} now={c.currentAssets} before={p.currentAssets} prevText={money(p.currentAssets)} kind="money" />
          <Tile icon={<Landmark size={16} />} label="Current liabilities" meaning="Everything under Current Liabilities (21)." lowerIsBetter
            value={money(c.currentLiabilities)} now={c.currentLiabilities} before={p.currentLiabilities} prevText={money(p.currentLiabilities)} kind="money" />
        </div>
        <div className="card"><div className="card-body fr-equation">
          <span className="page-sub">As of {asOf}</span>
          <span>{money(c.currentAssets)} − {money(c.currentLiabilities)} = <strong>{money(c.workingCapital)} {currency}</strong></span>
        </div></div>
        <div className="dash-split">
          <Trend title="Working capital monthly trend" sub={`${currency}, at each month end`} data={trend} keys={["workingCapital"]} kind="money" />
          <div className="card">
            <div className="card-head"><h2>Current assets and liabilities</h2></div>
            <div className="tablewrap">
              <table>
                <tbody>
                  <tr><th>Current assets</th><th className="r">{currency}</th></tr>
                  <tr><td>Cash and bank</td><td className="r">{money(c.cash)}</td></tr>
                  <tr><td>Trade receivables</td><td className="r">{money(c.receivable)}</td></tr>
                  <tr><td>Inventory</td><td className="r">{money(c.inventory)}</td></tr>
                  <tr><td>Other current assets</td><td className="r">{money(c.otherCurrentAssets)}</td></tr>
                  <tr><td><strong>Total current assets</strong></td><td className="r"><strong>{money(c.currentAssets)}</strong></td></tr>
                  <tr><th>Current liabilities</th><th className="r">{currency}</th></tr>
                  <tr><td>Trade payables</td><td className="r">{money(c.payable)}</td></tr>
                  <tr><td>Other current liabilities</td><td className="r">{money(c.otherCurrentLiabilities)}</td></tr>
                  <tr><td><strong>Total current liabilities</strong></td><td className="r"><strong>{money(c.currentLiabilities)}</strong></td></tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
        <div className="card"><div className="card-body fr-equation">
          <span><RefreshCw size={15} aria-hidden="true" /> <strong>Cash conversion cycle</strong></span>
          <strong style={{ fontSize: "var(--t-lg)" }}>{days(cc.ccc)}</strong>
          <span className="page-sub">Inventory {days(cc.dio)} + Receivable {days(cc.dso)} − Payable {days(cc.dpo)}</span>
          <Link href={cycleHref} className="btn ghost" style={{ marginLeft: "auto" }}>View detailed CCC report <ArrowRight size={14} aria-hidden="true" /></Link>
        </div></div>
        <Trend title="Turnover trend" sub={sub} data={trend} keys={["receivableTurnover", "debtorsTurnover", "creditorsTurnover"]} kind="times" />
        <RatioTable keys={["receivableTurnover", "debtorsTurnover", "creditorsTurnover"]} now={c} before={p} currency={currency} />
      </>
    );
  }

  if (tab === "profitability") {
    return (
      <>
        <div className="kpis kpis-tiled">
          <RatioTile k="grossMargin" icon={<TrendingUp size={16} />} now={c} before={p} />
          <RatioTile k="netMargin" icon={<Percent size={16} />} now={c} before={p} />
          <RatioTile k="roa" icon={<Layers size={16} />} now={c} before={p} />
          <RatioTile k="roe" icon={<Scale size={16} />} now={c} before={p} />
        </div>
        <Trend title="Profit margins by month" sub={sub} data={trend} keys={["grossMargin", "operatingMargin", "netMargin"]} kind="pct" />
        <Trend title="Returns" sub={sub} data={trend} keys={["roi", "roe", "roa"]} kind="pct" />
        <RatioTable keys={["grossMargin", "operatingMargin", "netMargin", "roa", "roe", "roi"]} now={c} before={p} currency={currency} />
        <Figures title="Profit and loss" rows={[
          ["Net sales", c.netSales, p.netSales], ["Cost of sales", c.cogs, p.cogs], ["Gross profit", c.grossProfit, p.grossProfit, true],
          ["Operating expenses", c.operatingExpenses, p.operatingExpenses], ["Operating profit", c.operatingProfit, p.operatingProfit, true],
          ["Interest expense", c.interest, p.interest], ["Other income", c.otherIncome, p.otherIncome], ["Net profit", c.netProfit, p.netProfit, true],
        ]} />
      </>
    );
  }

  return (
    <>
      <div className="kpis kpis-tiled">
        <RatioTile k="debtToEquity" icon={<Scale size={16} />} now={c} before={p} />
        <RatioTile k="debtToAssets" icon={<Layers size={16} />} now={c} before={p} />
        <RatioTile k="interestCover" icon={<ShieldCheck size={16} />} now={c} before={p} />
        <RatioTile k="liabilitiesToEquity" icon={<Gauge size={16} />} now={c} before={p} />
      </div>
      <div className="dash-split">
        <Trend title="Leverage and coverage trend" sub={sub} data={trend}
               keys={["interestCover", "liabilitiesToEquity", "debtToEquity", "financialLeverage"]} kind="x" />
        <Figures title="Key figures" rows={[
          ["Total assets", c.totalAssets, p.totalAssets], ["Total liabilities", c.totalLiabilities, p.totalLiabilities],
          ["Total equity", c.equity, p.equity, true], ["Debt (loans under 23)", c.debt, p.debt],
          ["Interest expense", c.interest, p.interest], ["Operating profit", c.operatingProfit, p.operatingProfit],
        ]} />
      </div>
      <RatioTable keys={["debtToEquity", "debtToAssets", "liabilitiesToEquity", "interestCover", "financialLeverage", "operatingLeverage"]}
                  now={c} before={p} currency={currency} />
    </>
  );
}
