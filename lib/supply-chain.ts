import { sql } from "./db";

/**
 * Goods through the business by product category: who they came from
 * (posted goods receipts) and who they went to (posted sales invoices), in
 * units or in kyat. Voids are left out — the original goes to REVERSED and
 * the mirror that undid it carries reverses_document_id.
 */
export type Flow = { side: "in" | "out"; partnerId: string | null; partner: string; cat: string; qty: number; value: number };

export async function getFlows(companyId: string, f: { from: string; to: string; branchId?: string | null }): Promise<Flow[]> {
  const rows = await sql`
    select case when d.doc_type = 'GOODS_RECEIPT' then 'in' else 'out' end as side,
           d.partner_id, coalesce(p.name, 'Walk-in') as partner, i.item_group_id as cat,
           sum(dl.base_qty)::float as qty, sum(dl.net_amount)::float as value
      from document d
      join document_line dl on dl.document_id = d.id
      join item i on i.id = dl.item_id
      left join business_partner p on p.id = d.partner_id
      left join location l on l.id = coalesce(dl.location_id, d.location_id)
     where d.company_id = ${companyId}
       and d.doc_type in ('GOODS_RECEIPT', 'SALES_INVOICE')
       and d.status = 'POSTED' and d.reverses_document_id is null
       and d.posting_date between ${f.from}::date and ${f.to}::date
       and dl.base_qty > 0 and i.item_group_id is not null
       ${f.branchId ? sql`and coalesce(l.parent_id, l.id) = ${f.branchId}` : sql``}
     group by 1, 2, 3, 4`;
  return (rows as any[]).map((r) => ({ side: r.side, partnerId: r.partner_id, partner: r.partner, cat: r.cat, qty: Number(r.qty), value: Number(r.value) }));
}

export type CanvasNode = { key: string; label: string; total: number; href?: string };
export type CanvasCat = { id: string; name: string; color: string; inTotal: number; outTotal: number };
export type CanvasLink = { from: string; to: string; cat: string; v: number };

/** Soft hues for the categories on the canvas, in the order they are added. */
export const CAT_COLORS = ["#7FA7E8", "#F2B880", "#B9A3E8", "#F0A3B5", "#8EC9E8", "#E8C77F"];

/**
 * The canvas for the chosen categories: the busiest partners on each side by
 * name, the rest folded into one "Other" node so a 384-customer book still
 * reads, and a link per partner and category.
 */
export function buildCanvas(flows: Flow[], cats: { id: string; name: string }[], measure: "qty" | "value", top = { in: 8, out: 10 }) {
  const chosen = new Set(cats.map((c) => c.id));
  const mine = flows.filter((f) => chosen.has(f.cat));
  const m = (f: Flow) => (measure === "qty" ? f.qty : f.value);
  const side = (s: "in" | "out") => {
    const by = new Map<string, { label: string; total: number }>();
    for (const f of mine.filter((x) => x.side === s)) {
      const k = f.partnerId ?? "walk-in";
      const x = by.get(k) ?? { label: f.partner, total: 0 };
      x.total += m(f); by.set(k, x);
    }
    const sorted = [...by.entries()].sort((a, b) => b[1].total - a[1].total);
    const keep = new Set(sorted.slice(0, top[s]).map(([k]) => k));
    const rest = sorted.slice(top[s]);
    const nodes: CanvasNode[] = sorted.slice(0, top[s]).map(([k, x]) => ({ key: `${s}:${k}`, label: x.label, total: x.total }));
    if (rest.length) nodes.push({ key: `${s}:other`, label: `Other ${s === "in" ? "suppliers" : "customers"} (${rest.length})`, total: rest.reduce((t, [, x]) => t + x.total, 0) });
    return { nodes, keyOf: (f: Flow) => { const k = f.partnerId ?? "walk-in"; return keep.has(k) ? `${s}:${k}` : `${s}:other`; }, count: sorted.length };
  };
  const L = side("in"), R = side("out");
  const links = new Map<string, CanvasLink>();
  for (const f of mine) {
    const p = f.side === "in" ? L.keyOf(f) : R.keyOf(f);
    const [from, to] = f.side === "in" ? [p, `cat:${f.cat}`] : [`cat:${f.cat}`, p];
    const k = `${from}|${to}`;
    const x = links.get(k) ?? { from, to, cat: f.cat, v: 0 };
    x.v += m(f); links.set(k, x);
  }
  const catNodes: CanvasCat[] = cats.map((c, i) => ({
    id: c.id, name: c.name, color: CAT_COLORS[i % CAT_COLORS.length],
    inTotal: mine.filter((f) => f.cat === c.id && f.side === "in").reduce((t, f) => t + m(f), 0),
    outTotal: mine.filter((f) => f.cat === c.id && f.side === "out").reduce((t, f) => t + m(f), 0),
  }));
  return { left: L.nodes, right: R.nodes, cats: catNodes, links: [...links.values()].filter((l) => l.v > 0), suppliers: L.count, customers: R.count };
}

/** Per category: received, sold, and how many suppliers and customers, in both measures. */
export function categoryStats(flows: Flow[], catId: string) {
  const f = flows.filter((x) => x.cat === catId);
  const sum = (s: "in" | "out", k: "qty" | "value") => f.filter((x) => x.side === s).reduce((t, x) => t + x[k], 0);
  const top = (s: "in" | "out") => {
    const by = new Map<string, number>();
    for (const x of f.filter((y) => y.side === s)) by.set(x.partner, (by.get(x.partner) ?? 0) + x.qty);
    return [...by.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  };
  return {
    inQty: sum("in", "qty"), outQty: sum("out", "qty"), inValue: sum("in", "value"), outValue: sum("out", "value"),
    suppliers: new Set(f.filter((x) => x.side === "in").map((x) => x.partnerId ?? "walk-in")).size,
    customers: new Set(f.filter((x) => x.side === "out").map((x) => x.partnerId ?? "walk-in")).size,
    topSupplier: top("in"), topCustomer: top("out"),
  };
}
