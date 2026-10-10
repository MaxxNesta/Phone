"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ChevronRight, ChevronDown, ArrowLeftRight, ListTree, Download, Sigma, Rows3, Columns3, X } from "lucide-react";
import type { SalesFact } from "@/lib/queries";

/* ---- What can be grouped and what can be totalled ---- */

const BASE_DIMS: [string, string][] = [
  ["model", "Model"], ["brand", "Brand"], ["category", "Category"], ["item", "Product"],
  ["customer", "Customer"], ["branch", "Branch"], ["salesman", "Salesperson"], ["month", "Month"],
];
const MEASURES = [
  ["revenue", "Sales amount"], ["qty", "Quantity"], ["cost", "Cost"],
  ["profit", "Gross profit"], ["margin", "Margin %"],
] as const;
type Measure = (typeof MEASURES)[number][0];
type Totals = Record<Measure, number>;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const valueOf = (f: SalesFact, dim: string): string =>
  dim.startsWith("opt:") ? f.opts?.[dim.slice(4)] ?? "—" : String((f as Record<string, unknown>)[dim] ?? "—");
const labelOf = (dim: string, v: string) =>
  dim === "month" && /^\d{4}-\d{2}$/.test(v) ? `${MONTHS[Number(v.slice(5)) - 1]} ${v.slice(0, 4)}` : v;

function totals(facts: SalesFact[]): Totals {
  let revenue = 0, qty = 0, cost = 0;
  for (const f of facts) { revenue += f.revenue; qty += f.qty; cost += f.cost; }
  const profit = revenue - cost;
  return { revenue, qty, cost, profit, margin: revenue ? (profit / revenue) * 100 : 0 };
}
const fmt = (m: Measure, n: number) =>
  m === "margin" ? `${n.toFixed(1)}%` : n.toLocaleString("en-US", { maximumFractionDigits: 0 });

type Node = { key: string; dim: string; value: string; facts: SalesFact[]; depth: number };

/**
 * Sales as a pivot: any chain of groupings down the side, one across the top,
 * any measures in the cells. Every control here changes the table — rows,
 * columns, measures, swap, expand, sort, export — and a cell opens the
 * invoice lines it was added up from.
 */
export function SalesPivot({ facts, currency }: { facts: SalesFact[]; currency: string }) {
  const attrDims = useMemo(() => {
    const names = new Set<string>();
    for (const f of facts) for (const k of Object.keys(f.opts ?? {})) names.add(k);
    return [...names].sort().map((n) => [`opt:${n}`, n] as [string, string]);
  }, [facts]);
  const allDims = [...BASE_DIMS, ...attrDims];
  const dimName = (d: string) => allDims.find(([k]) => k === d)?.[1] ?? d;

  const [rowDims, setRowDims] = useState<string[]>(() => ["model", ...attrDims.slice(0, 2).map(([k]) => k)]);
  const [colDim, setColDim] = useState<string>("month");
  const [measures, setMeasures] = useState<Measure[]>(["revenue"]);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<{ col: string; m: Measure; dir: 1 | -1 } | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [drill, setDrill] = useState<{ path: Node[]; col: string | null } | null>(null);
  const bar = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => { if (!bar.current?.contains(e.target as globalThis.Node)) setMenu(null); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const cols = useMemo(() => {
    if (!colDim) return [] as string[];
    const vals = [...new Set(facts.map((f) => valueOf(f, colDim)))];
    return colDim === "month" ? vals.sort()
      : vals.sort((a, b) => totals(facts.filter((f) => valueOf(f, colDim) === b)).revenue
                          - totals(facts.filter((f) => valueOf(f, colDim) === a)).revenue);
  }, [facts, colDim]);

  const cell = (fs: SalesFact[], col: string | null) =>
    totals(col === null ? fs : fs.filter((f) => valueOf(f, colDim) === col));

  // The children of a group, ordered by the sorted column or else by name.
  const childrenOf = (fs: SalesFact[], depth: number, parentKey: string): Node[] => {
    const dim = rowDims[depth];
    const groups = new Map<string, SalesFact[]>();
    for (const f of fs) {
      const v = valueOf(f, dim);
      if (!groups.has(v)) groups.set(v, []);
      groups.get(v)!.push(f);
    }
    const nodes = [...groups].map(([value, g]) => ({ key: `${parentKey}${dim}=${value}|`, dim, value, facts: g, depth }));
    if (sort) {
      const v = (n: Node) => cell(n.facts, sort.col === "__total" ? null : sort.col)[sort.m];
      nodes.sort((a, b) => (v(a) - v(b)) * sort.dir);
    } else nodes.sort((a, b) => a.value.localeCompare(b.value, undefined, { numeric: true }));
    return nodes;
  };

  // The rows on screen: each open group followed by its children.
  const visible = useMemo(() => {
    const out: { node: Node; path: Node[] }[] = [];
    const walk = (fs: SalesFact[], depth: number, parentKey: string, path: Node[]) => {
      if (depth >= rowDims.length) return;
      for (const n of childrenOf(fs, depth, parentKey)) {
        out.push({ node: n, path: [...path, n] });
        if (open.has(n.key)) walk(n.facts, depth + 1, n.key, [...path, n]);
      }
    };
    walk(facts, 0, "", []);
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facts, rowDims, open, sort, colDim]);

  const expandAll = () => {
    const keys = new Set<string>();
    const walk = (fs: SalesFact[], depth: number, parentKey: string) => {
      if (depth >= rowDims.length - 1) return;
      for (const n of childrenOf(fs, depth, parentKey)) { keys.add(n.key); walk(n.facts, depth + 1, n.key); }
    };
    walk(facts, 0, "");
    setOpen(keys);
  };
  const nestable = rowDims.length > 1;
  const allOpen = nestable && visible.length > 0 && visible.every((r) => r.node.depth >= rowDims.length - 1 || open.has(r.node.key));

  const toggleRowDim = (d: string) => {
    setRowDims((ds) => (ds.includes(d) ? ds.filter((x) => x !== d) : [...ds, d]));
    setOpen(new Set());
    if (d === colDim) setColDim("");
  };
  const toggleMeasure = (m: Measure) =>
    setMeasures((ms) => (ms.includes(m) ? (ms.length > 1 ? ms.filter((x) => x !== m) : ms) : MEASURES.map(([k]) => k).filter((k) => k === m || ms.includes(k))));
  const swap = () => {
    if (!rowDims.length) return;
    const top = rowDims[0];
    setRowDims(colDim ? [colDim, ...rowDims.slice(1)] : rowDims.slice(1));
    setColDim(top);
    setOpen(new Set());
  };
  const sortBy = (col: string, m: Measure) =>
    setSort((s) => (s && s.col === col && s.m === m ? (s.dir === -1 ? { ...s, dir: 1 } : null) : { col, m, dir: -1 }));

  const colKeys: (string | null)[] = [...cols, null];
  const grand = totals(facts);

  const exportCsv = () => {
    const head = [rowDims.map(dimName).join(" / ") || "Total",
      ...colKeys.flatMap((c) => measures.map((m) => `${c === null ? "Total" : labelOf(colDim, c)} ${MEASURES.find(([k]) => k === m)![1]}`))];
    const body = visible.map(({ node }) => [
      `${"  ".repeat(node.depth)}${labelOf(node.dim, node.value)}`,
      ...colKeys.flatMap((c) => measures.map((m) => cell(node.facts, c)[m].toFixed(m === "margin" ? 1 : 0))),
    ]);
    body.push(["Grand total", ...colKeys.flatMap((c) => measures.map((m) => cell(facts, c)[m].toFixed(m === "margin" ? 1 : 0)))]);
    const esc = (s: string) => (/^[=+\-@]/.test(s) && isNaN(Number(s)) ? `'${s}` : s);
    const csv = [head, ...body].map((r) => r.map((x) => `"${esc(String(x)).replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv" }));
    a.download = "sales-pivot.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const drillFacts = drill
    ? drill.path.reduce((fs, n) => fs.filter((f) => valueOf(f, n.dim) === n.value), facts)
        .filter((f) => drill.col === null || valueOf(f, colDim) === drill.col)
    : [];

  if (facts.length === 0) {
    return <div className="card"><p className="page-sub" style={{ padding: 24, textAlign: "center" }}>No posted sales in this period.</p></div>;
  }

  return (
    <div className="pv">
      <div className="pv-bar" ref={bar}>
        <Menu id="measures" menu={menu} setMenu={setMenu} primary
          label={<><Sigma size={15} aria-hidden="true" /> Measures: {measures.map((m) => MEASURES.find(([k]) => k === m)![1]).join(", ")}</>}>
          {MEASURES.map(([k, l]) => (
            <label key={k} className="pv-opt"><input type="checkbox" checked={measures.includes(k)} onChange={() => toggleMeasure(k)} /> {l}</label>
          ))}
        </Menu>
        <Menu id="rows" menu={menu} setMenu={setMenu}
          label={<><Rows3 size={15} aria-hidden="true" /> Rows: {rowDims.map(dimName).join(" → ") || "none"}</>}>
          <p className="pv-note">Click in the order to nest them.</p>
          {allDims.map(([k, l]) => (
            <label key={k} className="pv-opt">
              <input type="checkbox" checked={rowDims.includes(k)} onChange={() => toggleRowDim(k)} />
              {l}{rowDims.includes(k) && <span className="pv-rank">{rowDims.indexOf(k) + 1}</span>}
            </label>
          ))}
        </Menu>
        <Menu id="cols" menu={menu} setMenu={setMenu}
          label={<><Columns3 size={15} aria-hidden="true" /> Columns: {colDim ? dimName(colDim) : "none"}</>}>
          <label className="pv-opt"><input type="radio" name="pvcol" checked={!colDim} onChange={() => setColDim("")} /> None — totals only</label>
          {allDims.filter(([k]) => !rowDims.includes(k)).map(([k, l]) => (
            <label key={k} className="pv-opt"><input type="radio" name="pvcol" checked={colDim === k} onChange={() => { setColDim(k); setSort(null); }} /> {l}</label>
          ))}
        </Menu>
        <button type="button" className="pv-tool" onClick={swap} disabled={!rowDims.length}><ArrowLeftRight size={15} aria-hidden="true" /> Swap axes</button>
        <button type="button" className="pv-tool" disabled={!nestable} onClick={() => (allOpen ? setOpen(new Set()) : expandAll())}>
          <ListTree size={15} aria-hidden="true" /> {allOpen ? "Collapse all" : "Expand all"}
        </button>
        <button type="button" className="pv-tool" onClick={exportCsv}><Download size={15} aria-hidden="true" /> Export</button>
      </div>

      <div className="card pv-card">
        <div className="tablewrap">
          <table className="pv-table">
            <thead>
              {colDim && measures.length > 1 && (
                <tr>
                  <th />
                  {colKeys.map((c) => (
                    <th key={c ?? "__t"} colSpan={measures.length} className="r pv-colgroup">
                      {c === null ? `Total (${currency})` : labelOf(colDim, c)}
                    </th>
                  ))}
                </tr>
              )}
              <tr>
                <th className="pv-rowhead">{rowDims.map(dimName).join(" → ") || "Total"}</th>
                {colKeys.flatMap((c) => measures.map((m) => {
                  const col = c ?? "__total";
                  const on = sort?.col === col && sort.m === m;
                  const title = colDim && measures.length === 1
                    ? (c === null ? `Total (${currency})` : labelOf(colDim, c))
                    : MEASURES.find(([k]) => k === m)![1];
                  return (
                    <th key={`${col}-${m}`} className="r">
                      <button type="button" className="pv-sort" onClick={() => sortBy(col, m)}
                        aria-sort={on ? (sort!.dir === -1 ? "descending" : "ascending") : undefined}>
                        {title}{on ? (sort!.dir === -1 ? " ↓" : " ↑") : ""}
                      </button>
                    </th>
                  );
                }))}
              </tr>
            </thead>
            <tbody>
              {visible.map(({ node, path }) => {
                const leaf = node.depth >= rowDims.length - 1;
                const isOpen = open.has(node.key);
                return (
                  <tr key={node.key} className={`pv-d${Math.min(node.depth, 3)}`}>
                    <td style={{ paddingLeft: 14 + node.depth * 22 }}>
                      {leaf ? <span className="pv-leaf" /> : (
                        <button type="button" className="pv-twisty" aria-expanded={isOpen}
                          aria-label={`${isOpen ? "Collapse" : "Expand"} ${labelOf(node.dim, node.value)}`}
                          onClick={() => setOpen((o) => { const n = new Set(o); if (n.has(node.key)) n.delete(node.key); else n.add(node.key); return n; })}>
                          {isOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                        </button>
                      )}
                      {labelOf(node.dim, node.value)}
                    </td>
                    {colKeys.flatMap((c) => measures.map((m) => (
                      <td key={`${c}-${m}`} className="r">
                        <button type="button" className="pv-cell" title="View contributing invoice lines"
                          onClick={() => setDrill({ path, col: c })}>
                          {fmt(m, cell(node.facts, c)[m])}
                        </button>
                      </td>
                    )))}
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td>Grand total</td>
                {colKeys.flatMap((c) => measures.map((m) => (
                  <td key={`${c}-${m}`} className="r">{fmt(m, c === null ? grand[m] : cell(facts, c)[m])}</td>
                )))}
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {drill && (
        <div className="card pv-drill">
          <div className="card-head">
            <h2>{drill.path.map((n) => labelOf(n.dim, n.value)).join(" › ")}{drill.col !== null ? ` · ${labelOf(colDim, drill.col)}` : ""}</h2>
            <span className="page-sub">{drillFacts.length} invoice line{drillFacts.length === 1 ? "" : "s"}</span>
            <button type="button" className="pv-x" onClick={() => setDrill(null)} aria-label="Close"><X size={16} /></button>
          </div>
          <div className="tablewrap">
            <table className="pv-table">
              <thead><tr><th>Date</th><th>Invoice</th><th>Product</th><th>Customer</th><th className="r">Qty</th><th className="r">Amount</th><th className="r">Profit</th></tr></thead>
              <tbody>
                {drillFacts.slice(0, 300).map((f, i) => (
                  <tr key={i}>
                    <td>{f.date}</td>
                    <td><Link href={`/documents/${f.doc_id}`}>{f.doc_no}</Link></td>
                    <td>{f.item}</td>
                    <td>{f.customer}</td>
                    <td className="r">{fmt("qty", f.qty)}</td>
                    <td className="r">{fmt("revenue", f.revenue)}</td>
                    <td className="r">{fmt("profit", f.revenue - f.cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="pv-help">
        <div><Rows3 size={18} aria-hidden="true" /><span><strong>Rows: what you group</strong>Nest attributes — Model → Storage → Colour.</span></div>
        <div><Columns3 size={18} aria-hidden="true" /><span><strong>Columns: what you compare</strong>Month, branch, salesperson…</span></div>
        <div><Sigma size={18} aria-hidden="true" /><span><strong>Measures: what you total</strong>Sales amount, quantity, profit, margin.</span></div>
      </div>
      <p className="pv-note">Arrows open a group; its subtotal already includes what is inside. Click a number to see the invoice lines behind it; click a heading to sort.</p>
    </div>
  );
}

function Menu({ id, menu, setMenu, label, children, primary }: {
  id: string; menu: string | null; setMenu: (m: string | null) => void;
  label: React.ReactNode; children: React.ReactNode; primary?: boolean;
}) {
  const on = menu === id;
  return (
    <div className="pv-menu">
      <button type="button" className={`pv-tool${primary ? " primary" : ""}`} aria-expanded={on}
        onClick={() => setMenu(on ? null : id)}>
        {label} <ChevronDown size={14} aria-hidden="true" />
      </button>
      {on && <div className="pv-pop" role="menu">{children}</div>}
    </div>
  );
}

