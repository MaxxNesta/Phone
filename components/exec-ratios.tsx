import Link from "next/link";
import { money } from "@/lib/format";
import { compact } from "@/components/stat";
import { RATIO, type Kind } from "@/lib/ratio-info";
import type { RatioKey, RatioWindow } from "@/lib/financial-ratios";

/**
 * The Executive dashboard's Ratios tab (preview 2026-11-25): a sentence, four
 * figures, return on equity taken apart, then every ratio in four groups with
 * its change, its last twelve months and where it sits against a usual range.
 *
 * Read with care at the edges. A ratio whose divisor is below zero (current
 * liabilities, equity, sales…) has no meaning, whatever number the division
 * gives, so it is shown as "not meaningful" with the reason, and listed under
 * Needs a look. Turnovers and returns are put on a year's pace, so a month and
 * a year read alike and the usual ranges hold for both.
 */
type Group = { id: string; tab: string; title: string; question: string; rows: Row[] };
type Row = { k: RatioKey; says: string; scale: [number, number]; band: [number, number]; annual?: boolean; of: string };

const GROUPS: Group[] = [
  { id: "liq", tab: "liquidity", title: "Liquidity", question: "Can the bills be paid?", rows: [
    { k: "current", says: "Current assets over what falls due within a year.", scale: [0, 3], band: [1.2, 2], of: "current liabilities" },
    { k: "quick", says: "The same, stock left out.", scale: [0, 1.5], band: [0.5, 1], of: "current liabilities" },
    { k: "cash", says: "Cash and bank alone.", scale: [0, 1], band: [0.2, 0.5], of: "current liabilities" },
  ] },
  { id: "eff", tab: "working-capital", title: "Working capital", question: "How fast does money turn?", rows: [
    { k: "receivableTurnover", says: "Sales a year per kyat customers owe.", scale: [0, 30], band: [12, 30], annual: true, of: "receivables" },
    { k: "debtorsTurnover", says: "Cash collected a year per kyat customers owe.", scale: [0, 30], band: [12, 30], annual: true, of: "receivables" },
    { k: "creditorsTurnover", says: "Supplier bills a year per kyat owed to them.", scale: [0, 12], band: [3, 8], annual: true, of: "payables" },
  ] },
  { id: "pro", tab: "profitability", title: "Profitability", question: "Is it worth it?", rows: [
    { k: "grossMargin", says: "Left of each sale after the cost of the goods.", scale: [0, 30], band: [10, 30], of: "sales" },
    { k: "operatingMargin", says: "After running costs, before interest.", scale: [0, 15], band: [4, 15], of: "sales" },
    { k: "netMargin", says: "Kept of every 100 kyat sold.", scale: [0, 15], band: [3, 15], of: "sales" },
    { k: "roa", says: "Profit a year on everything the business holds.", scale: [0, 25], band: [8, 25], annual: true, of: "assets" },
    { k: "roe", says: "Profit a year on the owners' money.", scale: [0, 40], band: [15, 40], annual: true, of: "equity" },
  ] },
  { id: "risk", tab: "risk", title: "Leverage and risk", question: "How much is borrowed?", rows: [
    { k: "debtToEquity", says: "Loans against the owners' equity.", scale: [0, 2], band: [0, 1], of: "equity" },
    { k: "liabilitiesToEquity", says: "Everything owed, suppliers included.", scale: [0, 3], band: [0, 1.5], of: "equity" },
    { k: "interestCover", says: "Times operating profit covers interest.", scale: [0, 30], band: [5, 30], of: "interest" },
  ] },
];
const ROWS = new Map(GROUPS.flatMap((g) => g.rows.map((r) => [r.k, r] as const)));

/** A ratio read off one window: its value, or why there is none. */
type Read = { v: number | null; bad?: string; nil?: string };
function read(w: RatioWindow, k: RatioKey): Read {
  const row = ROWS.get(k), [, den] = RATIO[k].parts(w);
  if (Math.abs(den) < 0.0001) return { v: null, nil: `No ${row?.of ?? "base"} to divide by` };
  if (den < 0) return { v: null, bad: `${cap(row?.of ?? "the base")} ${row?.of.endsWith("s") ? "are" : "is"} below zero (${money(den)})` };
  const v = w.ratios[k];
  return { v: v == null ? null : row?.annual ? v * (365 / w.days) : v };
}
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

/** Figures stay short however far out they go: 1.97×, 26.3×, 367×, 12.4K×, −0.13×. */
function num(v: number, kind: Kind | "plain") {
  const a = Math.abs(v), s = v < 0 ? "−" : "";
  const body = a >= 10_000 ? compact(a) : a >= 100 || kind === "plain" ? Math.round(a).toLocaleString("en-US")
    : kind === "pct" ? a.toFixed(1) : a >= 10 ? a.toFixed(1) : a.toFixed(2);
  return s + body;
}
/* Past 999 a figure says nothing more (a margin on almost no sales, a cover on
   almost no interest): it shows as >999 and the exact figure is on hover. */
const show = (kind: Kind, v: number | null) => {
  if (v == null) return "—";
  const unit = kind === "pct" ? "%" : "×";
  return Math.abs(v) > 999 ? `${v > 0 ? ">" : "<−"}999${unit}` : `${num(v, kind)}${unit}`;
};
const exact = (kind: Kind, v: number | null) => (v != null && Math.abs(v) > 999 ? `${v.toLocaleString("en-US", { maximumFractionDigits: 2 })}${kind === "pct" ? "%" : "×"}` : undefined);

function change(kind: Kind, now: Read, before: Read, lowerIsBetter = false) {
  if (now.v == null || before.v == null) return null;
  const d = now.v - before.v;
  if (Math.abs(d) < (kind === "pct" ? 0.05 : 0.005)) return { text: "no change", tone: "" };
  const good = lowerIsBetter ? d < 0 : d > 0;
  return { text: `${d > 0 ? "▲ +" : "▼ "}${Math.abs(d) > 999 ? (d > 0 ? "999+" : "−999+") : num(d, kind)}${kind === "pct" ? " pts" : ""}`, tone: good ? "good" : "bad" };
}

/** Outside the usual range, and on the side that hurts. */
const worse = (r: Row, v: number, lower?: boolean) => (lower ? v > r.band[1] : v < r.band[0]);
const outside = (r: Row, v: number) => v < r.band[0] || v > r.band[1];

/** Twelve months as one quiet line; a month with no reading is a gap. Far-out months sit at the edge. */
function Spark({ points, row }: { points: (number | null)[]; row: Row }) {
  const w = 96, h = 30, have = points.filter((p): p is number => p != null);
  if (have.length < 2) return <span className="rx-spark-none">—</span>;
  const width = row.scale[1] - row.scale[0];
  const lo = Math.max(Math.min(...have), row.scale[0] - width), hi = Math.min(Math.max(...have), row.scale[1] + width);
  const y = (v: number) => { const c = Math.max(lo, Math.min(hi, v)); return h - 4 - (hi > lo ? (c - lo) / (hi - lo) : 0.5) * (h - 8); };
  const x = (i: number) => (i / (points.length - 1)) * (w - 6) + 3;
  const runs: string[] = [];
  let run: string[] = [];
  points.forEach((p, i) => { if (p == null) { if (run.length) runs.push(run.join(" ")); run = []; } else run.push(`${x(i).toFixed(1)},${y(p).toFixed(1)}`); });
  if (run.length) runs.push(run.join(" "));
  const last = points.length - 1 - [...points].reverse().findIndex((p) => p != null);
  return (
    <svg className="rx-spark" viewBox={`0 0 ${w} ${h}`} width={w} height={h} aria-hidden>
      {runs.map((r) => <polyline key={r} points={r} />)}
      <circle cx={x(last)} cy={y(points[last]!)} r={3} />
    </svg>
  );
}

function Range({ row, v, kind }: { row: Row; v: number | null; kind: Kind }) {
  const [a, b] = row.scale, at = (n: number) => Math.max(0, Math.min(100, ((n - a) / (b - a)) * 100));
  const off = v == null ? "" : v < a ? " lo" : v > b ? " hi" : "";
  return (
    <span className="rx-range" title={`Usual range ${show(kind, row.band[0])} to ${show(kind, row.band[1])}`}>
      <span className="rx-band" style={{ left: `${at(row.band[0])}%`, width: `${at(row.band[1]) - at(row.band[0])}%` }} />
      {v != null && <span className={`rx-mark${outside(row, v) ? " out" : ""}${off}`} style={{ left: `${at(v)}%` }} />}
    </span>
  );
}

export function ExecRatios({ now, before, months, from, to, phrase, spanMonths }: {
  now: RatioWindow; before: RatioWindow; months: (RatioWindow & { month: string })[];
  from: string; to: string; phrase: string; spanMonths: number;
}) {
  const last = new Date(new Date(to).getTime() - 86_400_000).toISOString().slice(0, 10);
  const report = (tab: string) => `/reports/financial-ratios?${new URLSearchParams({ tab, from, to: last, compare: "previous" })}`;
  const R = (k: RatioKey) => read(now, k), B = (k: RatioKey) => read(before, k);
  const yearly = spanMonths < 12 ? " a year" : "";

  /* The sentence: what the owners earned, and how the bills are covered —
     each half only when its figure can be read. */
  const roe = R("roe"), cur = R("current");
  const halves = [
    roe.bad ? <>the owners&apos; equity is below zero, so the return on it cannot be read</>
      : roe.v == null ? null
      : roe.v >= 0 ? <>the owners earned <strong>{show("pct", roe.v)}</strong>{yearly} on their money</>
      : <>the owners lost <strong className="neg">{show("pct", -roe.v)}</strong>{yearly} of their money</>,
    cur.bad ? <>current liabilities read below zero, which needs a look</>
      : cur.v == null ? null
      : cur.v < 0 ? <>current assets read <strong className="neg">below zero</strong>, which needs a look</>
      : <>every 100 kyat due within a year is covered by <strong className={cur.v < 1 ? "neg" : undefined}>{num(cur.v * 100, "plain")} kyat</strong> of current assets</>,
  ].filter(Boolean);
  const lead = phrase === "this month" ? "This month" : `In ${phrase}`;
  const headline = halves.length === 0 ? <>There is not enough in the ledger yet to read the ratios for {phrase}.</>
    : halves.length === 1 ? <>{lead}, {halves[0]}.</>
    : <>{lead}, {halves[0]}, and {halves[1]}.</>;

  const kpi = (k: RatioKey) => {
    const r = R(k), c = change(RATIO[k].kind, r, B(k), RATIO[k].lowerIsBetter);
    return (
      <div className="xd-kpi" key={k}>
        <span className="xd-kpi-label">{RATIO[k].label.replace(/ \(.*\)$/, "")}</span>
        <span className={`xd-kpi-value${r.bad ? " rx-nm" : r.v != null && r.v < 0 ? " neg" : ""}`} title={exact(RATIO[k].kind, r.v)}>{r.bad ? "Not meaningful" : show(RATIO[k].kind, r.v)}</span>
        <span className={`xd-kpi-sub ${c?.tone === "good" ? "up" : c?.tone === "bad" ? "down" : ""}`}>
          {r.bad ?? r.nil ?? (c ? `${c.text} on the period before` : "No earlier period")}
        </span>
      </div>
    );
  };

  /* Return on equity = net margin × asset turnover × leverage, on a year's pace. */
  const pace = 365 / now.days;
  const dupont = now.netSales > 0 && now.avgAssets > 0 && now.avgEquity > 0 ? {
    nm: (now.netProfit / now.netSales) * 100, at: (now.netSales / now.avgAssets) * pace, lev: now.avgAssets / now.avgEquity,
  } : null;
  const missing = now.netSales <= 0 ? "there were no sales" : now.avgAssets <= 0 ? "the assets read nil or below zero" : "the owners' equity is nil or below zero";

  const issues: { href: string; text: string }[] = [];
  for (const g of GROUPS) for (const row of g.rows) {
    const r = R(row.k), label = RATIO[row.k].label.replace(/ \(.*\)$/, "");
    if (r.bad) issues.push({ href: report(g.tab), text: `${label} cannot be read: ${r.bad[0].toLowerCase()}${r.bad.slice(1)}.` });
    else if (r.v != null && worse(row, r.v, RATIO[row.k].lowerIsBetter)) {
      const kind = RATIO[row.k].kind;
      issues.push({ href: report(g.tab), text: `${label} is ${show(kind, r.v)}, ${RATIO[row.k].lowerIsBetter ? "above" : "below"} the usual ${show(kind, row.band[0])} to ${show(kind, row.band[1])}.` });
    }
  }

  const daysNote = (row: Row, v: number | null) =>
    v != null && v > 0 && row.annual && RATIO[row.k].kind === "times" ? ` About ${Math.round(365 / v)} days.` : "";

  return (
    <>
      <section className="xd-hero">
        <p className="xd-headline">{headline}</p>
        <div className="xd-kpis">{(["current", "roe", "netMargin", "debtToEquity"] as RatioKey[]).map(kpi)}</div>
      </section>

      <section className="xd-sec">
        <header><h2>Return on equity, taken apart</h2><span>Why the owners earn what they earn, on a year&apos;s pace</span></header>
        {dupont ? (
          <>
            <div className="rx-dupont">
              <div><span className="rx-dp-label">Net margin</span><span className="rx-dp-value">{show("pct", dupont.nm)}</span><small>kept of every sale</small></div>
              <span className="rx-op" aria-hidden>×</span>
              <div><span className="rx-dp-label">Asset turnover</span><span className="rx-dp-value">{show("x", dupont.at)}</span><small>sales a year per kyat of assets</small></div>
              <span className="rx-op" aria-hidden>×</span>
              <div><span className="rx-dp-label">Leverage</span><span className="rx-dp-value">{show("x", dupont.lev)}</span><small>assets per kyat of equity</small></div>
              <span className="rx-op" aria-hidden>=</span>
              <div className="rx-dp-total"><span className="rx-dp-label">Return on equity</span>
                <span className={`rx-dp-value${dupont.nm < 0 ? " neg" : ""}`}>{show("pct", dupont.nm * dupont.at * dupont.lev)}</span>
                <small>{(() => { const c = change("pct", roe, B("roe")); return c ? `${c.text} on the period before` : "a year's pace"; })()}</small></div>
            </div>
            <p className="xd-note">
              {num(Math.abs(dupont.nm), "pct")} kyat {dupont.nm >= 0 ? "kept" : "lost"} in every 100 sold, the assets sold through {num(dupont.at, "x")} times a year,
              and every kyat of the owners&apos; money carries {num(dupont.lev, "x")} kyat of assets.
            </p>
          </>
        ) : <p className="xd-quiet">Return on equity cannot be taken apart for {phrase}: {missing}.</p>}
      </section>

      <div className="rx-groups">
        {GROUPS.map((g) => (
          <section key={g.id} className="xd-sec rx-group">
            <header><h2>{g.title}</h2><span>{g.question}</span></header>
            <div className="rx-head" aria-hidden><span>Ratio</span><span>Now</span><span>Change</span><span>12 months</span><span>Usual range</span></div>
            {g.rows.map((row) => {
              const info = RATIO[row.k], r = R(row.k), c = change(info.kind, r, B(row.k), info.lowerIsBetter);
              return (
                <div key={row.k} className="rx-row">
                  <div className="rx-name"><span>{info.label.replace(/ \(.*\)$/, "")}</span>
                    <small>{r.bad ? <span className="neg">{r.bad}, so this cannot be read.</span> : <>{r.nil ? `${r.nil}.` : row.says}{daysNote(row, r.v)}</>}</small></div>
                  <span className={`rx-value${r.bad ? " rx-nm" : r.v != null && r.v < 0 ? " neg" : ""}`} title={exact(info.kind, r.v)}>{r.bad ? "n/m" : show(info.kind, r.v)}</span>
                  <span className={`rx-delta ${c?.tone ?? ""}`}>{c?.text ?? "—"}</span>
                  <Spark row={row} points={months.map((m) => read(m, row.k).v)} />
                  <Range row={row} v={r.v} kind={info.kind} />
                </div>
              );
            })}
          </section>
        ))}
      </div>

      <section className="xd-sec">
        <header><h2>Needs a look</h2><span>Ratios that cannot be read, or sit on the wrong side of their usual range</span></header>
        {issues.length === 0 ? <p className="xd-quiet">Every ratio can be read and none is on the wrong side of its usual range.</p>
          : <ol className="xd-issues">{issues.map((i) => <li key={i.text}><Link href={i.href}>{i.text}</Link></li>)}</ol>}
        <details className="xd-how"><summary>How each ratio is worked out</summary>
          <table className="xd-table"><tbody>
            {GROUPS.flatMap((g) => g.rows).map((row) => (
              <tr key={row.k}><td>{RATIO[row.k].label}</td><td>{RATIO[row.k].formula}{row.annual ? ", on a year's pace" : ""}</td>
                <td className="r">{show(RATIO[row.k].kind, row.band[0])} to {show(RATIO[row.k].kind, row.band[1])}</td></tr>
            ))}
            <tr className="xd-muted"><td colSpan={3}>The usual range is a common guide for a retail shop, not a rule: the dot is blue inside it and amber outside, with an arrow when it is off the bar.
              A ratio is not meaningful when what it divides by is below zero. Turnovers and returns are put on a year&apos;s pace so a month and a year read alike.</td></tr>
          </tbody></table>
        </details>
        <p className="xd-links"><Link href={report("overview")}>Open the full financial ratios report</Link></p>
      </section>
    </>
  );
}
