"use client";

import { useState } from "react";
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, Cell,
  XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine, LabelList,
} from "recharts";
import { money } from "@/lib/format";
import { CycleGauge } from "@/components/cycle-gauge";
import { HelpHint } from "@/components/help-hint";

type Metrics = {
  from: string; to: string; days: number;
  revenue: number; cogs: number;
  inventory: number; receivable: number; payable: number;
  inventoryOpen: number; inventoryClose: number;
  receivableOpen: number; receivableClose: number;
  payableOpen: number; payableClose: number;
  currentAssets: number; currentLiabilities: number; stockInCurrent: number;
  dio: number | null; dso: number | null; dpo: number | null; ccc: number | null;
  currentRatio: number | null; quickRatio: number | null;
};

type Point = {
  label: string; ccc: number | null;
  dio: number | null; dso: number | null; dpo: number | null;
  revenue: number; cogs: number;
};

const d0 = (v: number | null) => (v === null ? "—" : Math.round(v).toString());
const d1 = (v: number | null) => (v === null ? "—" : v.toFixed(1));
const pct = (num: number, den: number) => (Math.abs(den) > 0.0001 ? `${((num / den) * 100).toFixed(1)}%` : "—");
const r2 = (v: number | null) => (v === null ? "—" : v.toFixed(2));

/**
 * The four spans, once, so both charts colour them the same.
 *
 * DIO blue and DSO amber matched nothing in particular until they also had
 * to match the bars beside them; a reader comparing the two charts should
 * not have to work out that the amber line and the amber bar are the same
 * thing.
 */
const SERIES = [
  { key: "dio", name: "DIO", colour: "var(--chart-3)" },
  { key: "dso", name: "DSO", colour: "var(--chart-2)" },
  { key: "dpo", name: "DPO", colour: "var(--chart-6)" },
  { key: "ccc", name: "CCC", colour: "var(--chart-1)" },
] as const;

type SeriesKey = (typeof SERIES)[number]["key"];
type Hidden = Partial<Record<SeriesKey, boolean>>;

/**
 * A legend you can switch off.
 *
 * Four spans on one axis is three too many when the question is whether
 * receivables alone moved. Clicking a key drops that span out of both
 * charts and clicking it again brings it back.
 *
 * Hiding changes what is drawn and never what is counted: the waterfall
 * leaves the gap where a hidden bar stood rather than closing up, because
 * closing up would silently restate the cycle as though that span were
 * zero.
 */
function ChartLegend({ hidden, toggle }: {
  hidden: Hidden;
  toggle: (k: SeriesKey) => void;
}) {
  return (
    <div className="chart-legend">
      {SERIES.map((sr) => {
        const off = !!hidden[sr.key];
        return (
          <button key={sr.key} type="button" aria-pressed={!off}
                  className={off ? "off" : undefined}
                  onClick={() => toggle(sr.key)}
                  title={off ? `Show ${sr.name}` : `Hide ${sr.name}`}>
            <span className="chart-legend-swatch"
                  style={{ borderColor: sr.colour,
                           background: off ? "transparent" : sr.colour }} />
            {sr.name}
          </button>
        );
      })}
    </div>
  );
}

/**
 * A change in days, said the way a reader needs it.
 *
 * Direction alone is not the answer: fewer days receivable is good and fewer
 * days payable is not, because paying later is free funding. So "better" is
 * a property of the span, not of the arrow.
 */
function Delta({ now, before, betterWhenLower = true }: {
  now: number | null; before: number | null; betterWhenLower?: boolean;
}) {
  if (now === null || before === null) {
    return <span className="subline">no comparable period</span>;
  }
  const diff = now - before;
  if (Math.abs(diff) < 0.5) return <span className="subline">unchanged</span>;
  const better = betterWhenLower ? diff < 0 : diff > 0;
  return (
    <span className="subline" style={{ color: better ? "var(--chart-1)" : "var(--warn)" }}>
      {diff < 0 ? "▼" : "▲"} {Math.abs(Math.round(diff))} days vs previous period
    </span>
  );
}

/** A ratio's change. Unlike a span, higher is the safer direction. */
function Ratio({ now, before }: { now: number | null; before: number | null }) {
  if (now === null || before === null) {
    return <span className="subline">no comparable period</span>;
  }
  const diff = now - before;
  if (Math.abs(diff) < 0.005) return <span className="subline">unchanged</span>;
  return (
    <span className="subline" style={{ color: diff > 0 ? "var(--chart-1)" : "var(--warn)" }}>
      {diff > 0 ? "▲" : "▼"} {Math.abs(diff).toFixed(2)} vs previous period
    </span>
  );
}

function Tip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="card" style={{ padding: "0.4rem 0.6rem", fontSize: "0.78rem" }}>
      <strong>{label}</strong>
      {payload.map((p: any) => (
        <div key={p.dataKey} style={{ color: p.color }}>
          {p.name}: {p.value === null ? "—" : Math.round(p.value)} days
        </div>
      ))}
    </div>
  );
}

export function CashCycle({
  current, previous, trend, currency,
}: {
  current: Metrics; previous: Metrics; trend: Point[]; currency: string;
}) {
  const c = current;
  const unanswerable = c.ccc === null;

  /*
   * A waterfall, not four bars side by side.
   *
   * Each span begins where the last one ended: the goods sit for DIO days,
   * then the customer takes DSO more, and paying the supplier DPO days in
   * pulls the whole thing back. The cycle is the gap between where the last
   * bar lands and where the first one started — which is the point, and is
   * invisible if every bar starts from zero.
   *
   * Recharts draws a floating bar from a [low, high] pair, so each step
   * carries its own base rather than being stacked on a transparent one.
   */
  const [hidden, setHidden] = useState<Hidden>({});
  const toggle = (k: SeriesKey) =>
    setHidden((h) => ({ ...h, [k]: !h[k] }));

  const dio = c.dio ?? 0, dso = c.dso ?? 0, dpo = c.dpo ?? 0, ccc = c.ccc ?? 0;
  const afterDio = dio;
  const afterDso = dio + dso;
  const afterDpo = afterDso - dpo;
  const waterfall = [
    { key: "dio" as SeriesKey, name: "DIO", sub: "Inventory", delta: dio,
      range: [0, afterDio], colour: "var(--chart-3)", on: "#FFFFFF" },
    { key: "dso" as SeriesKey, name: "DSO", sub: "Receivable", delta: dso,
      range: [afterDio, afterDso], colour: "var(--chart-2)", on: "#12161C" },
    { key: "dpo" as SeriesKey, name: "DPO", sub: "Payable", delta: -dpo,
      range: [afterDpo, afterDso], colour: "var(--chart-6)", on: "#12161C" },
    // --brand is dark on a light theme and light on a dark one; --surface
    // inverts with it, so the figure stays legible in both.
    { key: "ccc" as SeriesKey, name: "CCC", sub: "Days", delta: ccc,
      range: [Math.min(0, ccc), Math.max(0, ccc)],
      colour: "var(--chart-1)", on: "var(--surface)" },
  ];
  const off = (k: SeriesKey) => !!hidden[k];

  const rows = [
    {
      key: "dio", label: "Days inventory", formula: "Avg inventory ÷ COGS × days",
      now: c.dio, before: previous.dio, betterWhenLower: true,
      open: c.inventoryOpen, close: c.inventoryClose, balance: c.inventory,
      base: c.cogs, baseLabel: "Cost of sales",
    },
    {
      key: "dso", label: "Days receivable", formula: "Avg receivable ÷ revenue × days",
      now: c.dso, before: previous.dso, betterWhenLower: true,
      open: c.receivableOpen, close: c.receivableClose, balance: c.receivable,
      base: c.revenue, baseLabel: "Revenue",
    },
    {
      key: "dpo", label: "Days payable", formula: "Avg payable ÷ COGS × days",
      now: c.dpo, before: previous.dpo, betterWhenLower: false,
      open: c.payableOpen, close: c.payableClose, balance: c.payable,
      base: c.cogs, baseLabel: "Cost of sales",
    },
  ];

  // This period beside the one before, line by line.
  const p = previous;
  const figures: { label: string; now: string; before: string; strong?: boolean }[] = [
    { label: "Days in period", now: String(c.days), before: String(p.days) },
    { label: "Revenue", now: money(c.revenue), before: money(p.revenue) },
    { label: "Cost of sales", now: money(c.cogs), before: money(p.cogs) },
    { label: "Gross profit", now: money(c.revenue - c.cogs), before: money(p.revenue - p.cogs), strong: true },
    { label: "Gross margin", now: pct(c.revenue - c.cogs, c.revenue), before: pct(p.revenue - p.cogs, p.revenue) },
    { label: "Current assets", now: money(c.currentAssets), before: money(p.currentAssets) },
    { label: "Current liabilities", now: money(c.currentLiabilities), before: money(p.currentLiabilities) },
    { label: "Inventory in current assets", now: money(c.stockInCurrent), before: money(p.stockInCurrent) },
    { label: "Working capital", now: money(c.currentAssets - c.currentLiabilities),
      before: money(p.currentAssets - p.currentLiabilities), strong: true },
    { label: "Current ratio", now: r2(c.currentRatio), before: r2(p.currentRatio) },
    { label: "Quick ratio", now: r2(c.quickRatio), before: r2(p.quickRatio) },
  ];

  const suspicious =
    (c.dso !== null && c.dso > 120) || (c.dpo !== null && c.dpo > 120) ||
    (c.dio !== null && c.dio > 180);

  return (
    <>
      <section>
        <div className="ccc-top">
          <div className="dash-card dash-card-pad">
            <div className="dash-section-head">
              <div>
                <h2 style={{ fontSize: "var(--t-md)" }}>
                  Cash conversion cycle
                  <HelpHint label="How the cycle is worked out">
                    <strong>DIO + DSO − DPO</strong>, year-end closing entries left out.
                  </HelpHint>
                </h2>
              </div>
            </div>
            {unanswerable ? (
              <div className="empty">No revenue or cost of sales in this period.</div>
            ) : (
              <>
                <div style={{
                  fontSize: "2.2rem", fontWeight: 700, lineHeight: 1.1,
                  color: c.ccc! < 0 ? "var(--chart-1)" : "var(--ink)",
                }}>
                  {d0(c.ccc)} days
                </div>
                <Delta now={c.ccc} before={previous.ccc} />
                <div className="hintbar" style={{ marginTop: "0.6rem" }}>
                  {c.ccc! < 0
                    ? "Funded by supplier credit."
                    : "Funded from working capital."}
                </div>
              </>
            )}
          </div>

          {/* Scales differ per span on purpose: days payable runs far longer
              than days inventory in any real trade. */}
          <CycleGauge value={c.dio} max={180} label="Days Inventory (DIO)"
                      hint="Goods sit on the shelf"
                      explain={<strong>Avg inventory ÷ cost of sales × days</strong>} />
          <CycleGauge value={c.dso} max={180} label="Days Receivable (DSO)"
                      hint="Customers take to pay"
                      explain={<strong>Avg receivable ÷ revenue × days</strong>} />
          <CycleGauge value={c.dpo} max={600} label="Days Payable (DPO)"
                      hint="We take to pay suppliers · higher is better" invert
                      explain={<strong>Avg payable ÷ cost of sales × days</strong>} />

          <div className="dash-card dash-card-pad">
            <div className="dash-section-head">
              <div>
                <h2 style={{ fontSize: "var(--t-md)" }}>
                  Current ratio
                  <HelpHint label="How the current ratio is worked out">
                    <strong>Current assets ÷ current liabilities</strong>
                  </HelpHint>
                </h2>
              </div>
            </div>
            <div style={{ fontSize: "1.9rem", fontWeight: 700, lineHeight: 1.15 }}>
              {c.currentRatio === null ? "—" : c.currentRatio.toFixed(2)}
            </div>
            <Ratio now={c.currentRatio} before={previous.currentRatio} />

            <div className="dash-section-head" style={{ marginTop: "0.9rem" }}>
              <div>
                <h2 style={{ fontSize: "var(--t-md)" }}>
                  Quick ratio
                  <HelpHint label="How the quick ratio is worked out">
                    <strong>(Current assets − inventory) ÷ current liabilities</strong>
                  </HelpHint>
                </h2>
              </div>
            </div>
            <div style={{ fontSize: "1.9rem", fontWeight: 700, lineHeight: 1.15 }}>
              {c.quickRatio === null ? "—" : c.quickRatio.toFixed(2)}
            </div>
            <Ratio now={c.quickRatio} before={previous.quickRatio} />
          </div>
        </div>
      </section>

      <section>
        <div className="dash-split">
          <div className="dash-card dash-card-pad">
            <div className="dash-section-head">
              <div>
                <h2>CCC trend</h2>
                <span className="dash-sub">
                  rolling twelve months to each month end
                </span>
              </div>
            </div>
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={trend} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                <CartesianGrid stroke="var(--line-soft)" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="var(--muted)" />
                <YAxis tick={{ fontSize: 11 }} stroke="var(--muted)" />
                <Tooltip content={<Tip />} />
                <ReferenceLine y={0} stroke="var(--muted)" />
                <Line type="monotone" dataKey="dio" name="DIO" hide={!!hidden.dio} stroke="var(--chart-3)" dot={{ r: 2 }} />
                <Line type="monotone" dataKey="dso" name="DSO" hide={!!hidden.dso} stroke="var(--chart-2)" dot={{ r: 2 }} />
                <Line type="monotone" dataKey="dpo" name="DPO" hide={!!hidden.dpo} stroke="var(--chart-6)" dot={{ r: 2 }} />
                <Line type="monotone" dataKey="ccc" name="CCC" hide={!!hidden.ccc} stroke="var(--chart-1)"
                      strokeWidth={2.2} dot={{ r: 2.5 }} />
              </LineChart>
            </ResponsiveContainer>
            <ChartLegend hidden={hidden} toggle={toggle} />
          </div>

          <div className="dash-card dash-card-pad">
            <div className="dash-section-head">
              <div>
                <h2>What makes up the cycle</h2>
                <span className="dash-sub">
                  each span begins where the one before it ends
                </span>
              </div>
            </div>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={waterfall} margin={{ top: 18, right: 8, left: -18, bottom: 0 }}>
                <CartesianGrid stroke="var(--line-soft)" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} stroke="var(--muted)" />
                <YAxis tick={{ fontSize: 11 }} stroke="var(--muted)" />
                <ReferenceLine y={0} stroke="var(--muted)" />
                {/* minPointSize keeps a nil span as a hairline: Recharts
                    numbers labels by rendered bar, so a missing bar would
                    slide every later label onto the wrong one. */}
                <Bar dataKey="range" radius={[3, 3, 3, 3]} minPointSize={2}>
                  {/* The step this span adds, inside the bar where it fits,
                      outside where it does not. */}
                  <LabelList dataKey="delta"
                             content={(props: any) => {
                               const { x, y, width, height, index } = props;
                               const w = waterfall[index as number];
                               if (!w || off(w.key)) return null;
                               const d = w.delta;
                               const inside = height >= 18;
                               return (
                                 <text
                                   x={x + width / 2}
                                   y={inside ? y + height / 2
                                             : d < 0 ? y + height + 13 : y - 6}
                                   textAnchor="middle"
                                   dominantBaseline={inside ? "central" : undefined}
                                   style={{ fontSize: 11, fontWeight: 600,
                                            fill: inside ? w.on : "var(--ink)" }}>
                                   {d > 0 ? "+" : ""}{Math.round(d)} days
                                 </text>
                               );
                             }} />
                  {waterfall.map((w) => (
                    <Cell key={w.name} fill={off(w.key) ? "transparent" : w.colour} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <ChartLegend hidden={hidden} toggle={toggle} />
          </div>
        </div>
      </section>

      {suspicious && (
        <section>
          <div className="card">
            <div className="card-body">
              <div className="hintbar caution">
                <strong>These spans look long.</strong> Usually open invoices or bills on a young ledger — see the balances below.
              </div>
            </div>
          </div>
        </section>
      )}

      <section>
        <div className="card">
          <div className="card-head">
            <h2>Key metrics</h2>
            <span className="page-sub">{c.days} days · amounts in {currency}</span>
          </div>
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th>Metric</th>
                  <th className="r">Days</th>
                  <th className="r">Previous</th>
                  <th>Change</th>
                  <th className="r">Opening</th>
                  <th className="r">Closing</th>
                  <th className="r">Average</th>
                  <th className="r">Divided by</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key}>
                    <td className="wrap">
                      <strong>{r.label}</strong>
                      <div className="subline">{r.formula}</div>
                    </td>
                    <td className="r"><strong>{d1(r.now)}</strong></td>
                    <td className="r">{d1(r.before)}</td>
                    <td>
                      <Delta now={r.now} before={r.before}
                             betterWhenLower={r.betterWhenLower} />
                    </td>
                    <td className="r">{money(r.open)}</td>
                    <td className="r">{money(r.close)}</td>
                    <td className="r"><strong>{money(r.balance)}</strong></td>
                    <td className="r">
                      {money(r.base)}
                      <div className="subline">{r.baseLabel}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={7}>
                    Cash conversion cycle{unanswerable ? "" : ` — ${d1(c.dio)} + ${d1(c.dso)} − ${d1(c.dpo)}`}
                  </td>
                  <td className="r"><strong>{unanswerable ? "no cycle" : `${d1(c.ccc)} days`}</strong></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      </section>

      <section>
        <div className="card">
          <div className="card-head">
            <h2>Figures behind it</h2>
            <span className="page-sub">this period beside the one before</span>
          </div>
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th></th>
                  <th className="r">This period</th>
                  <th className="r">Previous</th>
                </tr>
              </thead>
              <tbody>
                {figures.map((f) => (
                  <tr key={f.label}>
                    <td>{f.strong ? <strong>{f.label}</strong> : f.label}</td>
                    <td className="r">{f.strong ? <strong>{f.now}</strong> : f.now}</td>
                    <td className="r">{f.before}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section>
        <div className="card">
          <div className="card-head">
            <h2>By month</h2>
            <span className="page-sub">each month looks back twelve months</span>
          </div>
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th>To the start of</th>
                  <th className="r">Revenue</th>
                  <th className="r">Cost of sales</th>
                  <th className="r">DIO</th>
                  <th className="r">DSO</th>
                  <th className="r">DPO</th>
                  <th className="r">CCC</th>
                </tr>
              </thead>
              <tbody>
                {trend.map((t) => (
                  <tr key={t.label}>
                    <td>{t.label}</td>
                    <td className="r">{money(t.revenue)}</td>
                    <td className="r">{money(t.cogs)}</td>
                    <td className="r">{d1(t.dio)}</td>
                    <td className="r">{d1(t.dso)}</td>
                    <td className="r">{d1(t.dpo)}</td>
                    <td className="r"><strong>{d1(t.ccc)}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </>
  );
}
