"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { CanvasCat, CanvasLink, CanvasNode } from "@/lib/supply-chain";

const W = 1000, CARD = 200, GAP = 16, MIN_H = 58, PAD_TOP = 40;
const COL = { left: 10, mid: (W - CARD) / 2, right: W - CARD - 10 };
const fmt = (v: number, unit: string) =>
  unit === "MMK" ? (v >= 1e9 ? `${+(v / 1e9).toFixed(2)}B` : v >= 1e6 ? `${+(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${+(v / 1e3).toFixed(0)}K` : `${Math.round(v)}`)
    : Math.round(v).toLocaleString("en-US");
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

type Placed = { key: string; x: number; y: number; h: number; label: string; total: number; cat?: CanvasCat };

/**
 * Suppliers on the left, the chosen categories in the middle, customers on
 * the right; each ribbon is goods moving, as wide as its volume. Hovering a
 * card lights up its flows and dims the rest; clicking a category opens its
 * figures beside the canvas.
 */
export function SupplyCanvas({ left, cats, right, links, unit, focus, baseQuery }: {
  left: CanvasNode[]; cats: CanvasCat[]; right: CanvasNode[]; links: CanvasLink[];
  unit: "units" | "MMK"; focus: string | null; baseQuery: string;
}) {
  const router = useRouter();
  const [hover, setHover] = useState<string | null>(null);

  const layout = useMemo(() => {
    const midTotals = cats.map((c) => Math.max(c.inTotal, c.outTotal));
    const sums = [left.reduce((t, n) => t + n.total, 0), midTotals.reduce((t, v) => t + v, 0), right.reduce((t, n) => t + n.total, 0)];
    const most = Math.max(left.length, cats.length, right.length, 1);
    // One scale for every ribbon and card, so equal volumes look equal anywhere.
    // The canvas grows with the number of cards, not with volume: one
    // supplier and one category make a short canvas, not two 400px slabs.
    const target = Math.min(440, Math.max(150, most * 92));
    const scale = Math.max(...sums) > 0 ? Math.max(0, target - GAP * (most - 1)) / Math.max(...sums) : 0;
    const place = (items: { key: string; label: string; total: number; cat?: CanvasCat }[], x: number, size: (i: number) => number) => {
      const hs = items.map((_, i) => Math.max(MIN_H, size(i) * scale));
      return { hs, x, items };
    };
    const cols = [
      place(left.map((n) => ({ ...n })), COL.left, (i) => left[i].total),
      place(cats.map((c) => ({ key: `cat:${c.id}`, label: c.name, total: Math.max(c.inTotal, c.outTotal), cat: c })), COL.mid, (i) => midTotals[i]),
      place(right.map((n) => ({ ...n })), COL.right, (i) => right[i].total),
    ];
    const heights = cols.map((c) => c.hs.reduce((t, h) => t + h, 0) + GAP * Math.max(0, c.hs.length - 1));
    const H = Math.max(...heights, 200);
    const nodes = new Map<string, Placed>();
    cols.forEach((c, ci) => {
      let y = PAD_TOP + (H - heights[ci]) / 2;
      c.items.forEach((it, i) => { nodes.set(it.key, { key: it.key, x: c.x, y, h: c.hs[i], label: it.label, total: it.total, cat: it.cat }); y += c.hs[i] + GAP; });
    });
    // Ribbons stack down each card's edge in the order of the card at their other end.
    const order = (k: string) => { const n = nodes.get(k)!; return n.y; };
    const outOff = new Map<string, number>(), inOff = new Map<string, number>();
    const sorted = [...links].sort((a, b) => order(a.from) - order(b.from) || order(a.to) - order(b.to));
    const startOut = (k: string) => { const n = nodes.get(k)!; const used = links.filter((l) => l.from === k).reduce((t, l) => t + l.v * scale, 0); return n.y + (n.h - used) / 2; };
    const startIn = (k: string) => { const n = nodes.get(k)!; const used = links.filter((l) => l.to === k).reduce((t, l) => t + l.v * scale, 0); return n.y + (n.h - used) / 2; };
    const bySourceOrder = [...sorted].sort((a, b) => order(a.from) - order(b.from) || order(a.to) - order(b.to));
    const byTargetOrder = [...sorted].sort((a, b) => order(a.to) - order(b.to) || order(a.from) - order(b.from));
    const y0 = new Map<CanvasLink, number>(), y1 = new Map<CanvasLink, number>();
    for (const l of bySourceOrder) { const s = outOff.get(l.from) ?? startOut(l.from); y0.set(l, s); outOff.set(l.from, s + l.v * scale); }
    for (const l of byTargetOrder) { const s = inOff.get(l.to) ?? startIn(l.to); y1.set(l, s); inOff.set(l.to, s + l.v * scale); }
    const ribbons = sorted.map((l) => {
      const a = nodes.get(l.from)!, b = nodes.get(l.to)!;
      const x0 = a.x + CARD, x1 = b.x, t = Math.max(1.5, l.v * scale), mx = (x0 + x1) / 2;
      const ya = y0.get(l)!, yb = y1.get(l)!;
      return { l, t, d: `M${x0},${ya} C${mx},${ya} ${mx},${yb} ${x1},${yb} L${x1},${yb + t} C${mx},${yb + t} ${mx},${ya + t} ${x0},${ya + t} Z`, mid: { x: mx, y: (ya + yb) / 2 + t / 2 } };
    });
    return { nodes: [...nodes.values()], ribbons, H: H + PAD_TOP + 16 };
  }, [left, cats, right, links]);

  const colorOf = (catId: string) => cats.find((c) => c.id === catId)?.color ?? "var(--line)";
  const lit = (l: CanvasLink) => !hover || l.from === hover || l.to === hover;
  const open = (catId: string) => {
    const sep = baseQuery.length > 1 ? "&" : "";
    router.replace(`${baseQuery}${sep}focus=${catId}`, { scroll: false });
  };

  return (
    <svg className="sc-svg" viewBox={`0 0 ${W} ${layout.H}`} role="img"
      aria-label={`Goods flow: ${left.length} suppliers into ${cats.map((c) => c.name).join(", ")}, out to ${right.length} customers`}>
      <text x={COL.left + CARD / 2} y={18} className="sc-col">SUPPLIERS</text>
      <text x={COL.mid + CARD / 2} y={18} className="sc-col">PRODUCT CATEGORIES</text>
      <text x={COL.right + CARD / 2} y={18} className="sc-col">CUSTOMERS</text>
      {left.length === 0 && <text x={COL.left + CARD / 2} y={PAD_TOP + 40} className="sc-none">Nothing received in this period</text>}
      {right.length === 0 && <text x={COL.right + CARD / 2} y={PAD_TOP + 40} className="sc-none">Nothing sold in this period</text>}

      {layout.ribbons.map(({ l, d }) => (
        <path key={`${l.from}|${l.to}`} d={d} fill={colorOf(l.cat)} className="sc-ribbon" data-lit={lit(l) || undefined}
          onMouseEnter={() => setHover(null)}>
          <title>{`${fmt(l.v, unit)} ${unit}`}</title>
        </path>
      ))}
      {layout.ribbons.filter(({ t, l }) => t >= 14 && lit(l)).map(({ l, mid }) => (
        <text key={`v${l.from}|${l.to}`} x={mid.x} y={mid.y + 4} className="sc-val">{fmt(l.v, unit)}</text>
      ))}

      {layout.nodes.map((n) => {
        const isCat = !!n.cat;
        const on = isCat && n.cat!.id === focus;
        const net = isCat ? n.cat!.inTotal - n.cat!.outTotal : 0;
        return (
          <g key={n.key} className={`sc-node${isCat ? " cat" : ""}${on ? " on" : ""}`} transform={`translate(${n.x},${n.y})`}
            onMouseEnter={() => setHover(n.key)} onMouseLeave={() => setHover(null)}
            onClick={isCat ? () => open(n.cat!.id) : undefined} tabIndex={isCat ? 0 : undefined}
            onKeyDown={isCat ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(n.cat!.id); } } : undefined}
            role={isCat ? "button" : undefined} aria-label={isCat ? `${n.label}: show details` : undefined}>
            <rect width={CARD} height={n.h} rx={12} className="sc-card" />
            {isCat && <rect width={5} height={n.h} rx={2.5} fill={n.cat!.color} />}
            <text x={isCat ? 18 : 14} y={isCat ? 24 : Math.min(n.h / 2 - 2, 26)} className="sc-name">{clip(n.label, isCat ? 22 : 24)}</text>
            {isCat ? (
              <>
                <text x={18} y={42} className="sc-sub">In {fmt(n.cat!.inTotal, unit)} · Out {fmt(n.cat!.outTotal, unit)}</text>
                {n.h >= 66 && <text x={18} y={60} className="sc-net">{net >= 0 ? "+" : "−"}{fmt(Math.abs(net), unit)} {unit === "units" ? "units" : "MMK"} net</text>}
              </>
            ) : (
              <text x={14} y={Math.min(n.h / 2 + 16, 44)} className="sc-sub">{fmt(n.total, unit)} {unit}</text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
