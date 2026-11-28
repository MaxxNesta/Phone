/**
 * Shared by the financial statements' Compare view (2026-11-28): the periods
 * a range splits into, and the rows the comparison table draws. Each
 * statement fills the rows from its own calculation, a column a period.
 */
export type Grain = "month" | "quarter" | "year";
export const GRAINS: Record<Grain, string> = { month: "Monthly", quarter: "Quarterly", year: "Yearly" };
export const asGrain = (v: string | undefined): Grain => (v && v in GRAINS ? v : "month") as Grain;

export type Period = {
  /** The period's first day, as date_trunc gives it. */
  key: string;
  label: string;
  /** Its first and last day inside the range: the first period may start late, the last end early. */
  from: string;
  to: string;
};

export type CompareRow = {
  key: string;
  kind: "section" | "group" | "account" | "total" | "subtotal";
  label: string;
  code?: string;
  depth: number;
  /** The groups above it, so folding one hides everything under it. */
  under: string[];
  /** +1 when a rise is good (sales, profit, assets, cash in), −1 when it is bad (costs, debts, cash out). */
  better: 1 | -1;
  strong?: boolean;
  /** The statement line it opens beside the table (the cash flow's ?line=), when it has one. */
  drill?: string;
  values: number[];
  total: number;
};

const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** Every period from the one holding `from` to the one holding `to`, empty ones included. */
export function periodsOf(from: string, to: string, grain: Grain): Period[] {
  const out: Period[] = [];
  let [y, m] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  if (grain === "quarter") m = Math.floor((m - 1) / 3) * 3 + 1;
  if (grain === "year") m = 1;
  const step = grain === "month" ? 1 : grain === "quarter" ? 3 : 12;
  while (y < ty || (y === ty && m <= tm)) {
    let ey = y, em = m + step - 1; while (em > 12) { em -= 12; ey += 1; }
    const start = iso(y, m, 1), end = iso(ey, em, lastDay(ey, em));
    out.push({
      key: start,
      label: grain === "month" ? `${MONTH[m - 1]} ${y}` : grain === "quarter" ? `Q${(m + 2) / 3} ${y}` : String(y),
      from: start < from ? from : start,
      to: end > to ? to : end,
    });
    m += step; while (m > 12) { m -= 12; y += 1; }
  }
  return out;
}

type Node = { id: string; code: string; name: string; amount: number; children: Node[] };
type Shape = {
  sections: { key: string; label: string; nodes: Node[]; total: number; totalLabel: string }[];
  subtotals: { after: string; label: string; value: number; strong?: boolean }[];
};

/**
 * A statement's sections, a column per shape, as the table's rows. Laid out
 * from `whole` (the full range, or the latest date) so a row present in any
 * column is present in all; `total` is whole's figure.
 */
export function sectionRows(whole: Shape, cols: Shape[], better: (sectionKey: string) => 1 | -1, subtotalBetter: 1 | -1 = 1): CompareRow[] {
  const index = (sh: Shape) => {
    const m = new Map<string, number>();
    const walk = (ns: Node[]) => { for (const n of ns) { m.set(`n:${n.id}`, n.amount); walk(n.children); } };
    for (const s of sh.sections) { walk(s.nodes); m.set(`t:${s.key}`, s.total); }
    for (const t of sh.subtotals) m.set(`s:${t.label}`, t.value);
    return m;
  };
  const colIdx = cols.map(index), wholeIdx = index(whole);
  const row = (key: string, r: Omit<CompareRow, "values" | "total" | "key">): CompareRow =>
    ({ key, ...r, values: colIdx.map((c) => c.get(key) ?? 0), total: wholeIdx.get(key) ?? 0 });
  const rows: CompareRow[] = [];
  for (const s of whole.sections) {
    const b = better(s.key);
    rows.push({ key: `h:${s.key}`, kind: "section", label: s.label, depth: 0, under: [], better: b, values: [], total: 0 });
    const walk = (ns: Node[], depth: number, under: string[]) => {
      for (const n of ns) {
        const k = `n:${n.id}`;
        rows.push(row(k, { kind: n.children.length ? "group" : "account", label: n.name, code: n.code, depth, under, better: b }));
        if (n.children.length) walk(n.children, depth + 1, [...under, k]);
      }
    };
    walk(s.nodes, 1, []);
    rows.push(row(`t:${s.key}`, { kind: "total", label: s.totalLabel, depth: 0, under: [], better: b }));
    for (const t of whole.subtotals.filter((x) => x.after === s.key))
      rows.push(row(`s:${t.label}`, { kind: "subtotal", label: t.label, depth: 0, under: [], better: subtotalBetter, strong: t.strong }));
  }
  return rows;
}
