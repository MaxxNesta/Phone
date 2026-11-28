import { sectionRows, type CompareRow } from "./statement-compare";

/**
 * A financial statement as a document to hand over (2026-11-28): the rows
 * the exported workbook prints, three levels at most, no account codes.
 *
 *   level 1  the section            ASSETS, REVENUE, OPERATING ACTIVITIES
 *   level 2  its main heads         Current assets, Sales
 *   level 3  what makes those up    Cash and bank, Receivables
 *
 * Anything deeper is already inside its level-3 figure (a group's amount is
 * the sum of what is under it), so it is simply not printed. The chart's own
 * top account, which only repeats the section's name, is skipped. Clearing
 * and tax lines are not printed one by one: their amounts stay in current
 * assets or current liabilities, as one "Other current …" line, so every
 * column still adds up.
 */
export type DocRow = {
  label: string;
  level: 1 | 2 | 3;
  /** head: a heading with no figures; line: a figure; total: a ruled total; grand: the statement's bottom line. */
  kind: "head" | "line" | "total" | "grand";
  values: (number | null)[];
};

export type StatementDoc = {
  company: string;
  title: string;
  /** Period, branch, basis — one line each under the title. */
  lines: string[];
  currency: string;
  columns: string[];
  rows: DocRow[];
  file: string;
  /** Wide comparisons print landscape. */
  wide?: boolean;
};

export function rowsToDoc(rows: CompareRow[], opts: { columns: number; total: boolean; foldIds?: Set<string> }): DocRow[] {
  const fold = opts.foldIds ?? new Set<string>();
  const width = opts.columns + (opts.total ? 1 : 0);
  const vals = (r: CompareRow) => [...r.values, ...(opts.total ? [r.total] : [])];
  const idOf = (r: CompareRow) => (r.key.startsWith("n:") ? r.key.slice(2) : r.key);
  const out: DocRow[] = [];

  // Sections in display order: a section row and what follows it.
  const sections: CompareRow[][] = [];
  for (const r of rows) {
    if (r.kind === "section" || !sections.length) sections.push([r]);
    else sections[sections.length - 1].push(r);
  }

  for (const sec of sections) {
    const start = out.length;
    const head = sec[0].kind === "section" ? sec[0] : null;
    const body = head ? sec.slice(1) : sec;
    if (head) out.push({ label: head.label, level: 1, kind: "head", values: [] });
    // The chart's top account that only repeats the section: skipped, its children step up.
    // One group at the top (loose lines beside it, like unclosed earnings, do not count).
    const roots = body.filter((r) => r.depth === 1 && r.kind === "group");
    const skip = roots.length === 1 ? roots[0] : null;
    const shift = skip ? 1 : 0;
    const isFold = (r: CompareRow) => {
      const id = idOf(r);
      if (id.startsWith("clearing-") || fold.has(id)) return true;
      const kids = body.filter((x) => x.under.includes(r.key) && x.kind === "account");
      return kids.length > 0 && kids.every((k) => fold.has(idOf(k)) || idOf(k).startsWith("clearing-"));
    };

    let group: CompareRow | null = null;
    let other: number[] = [], folded = false, kidsSeen = 0;
    const close = () => {
      if (!group) return;
      if (folded && other.some((v) => Math.abs(v) >= 0.005)) {
        const word = /liabilit/i.test(group.label) ? "liabilities" : /asset/i.test(group.label) ? "assets" : "items";
        out.push({ label: `Other current ${word}`, level: 3, kind: "line", values: other });
      }
      if (kidsSeen) out.push({ label: `Total ${group.label}`, level: 2, kind: "total", values: vals(group) });
      group = null;
    };

    body.forEach((r, i) => {
      if (r === skip) return;
      if (r.kind === "total" || r.kind === "subtotal") {
        if (r.depth === 0) { close(); out.push({ label: r.label, level: 1, kind: r.kind === "subtotal" && r.strong ? "grand" : "total", values: vals(r) }); return; }
      }
      const lvl = r.depth - shift;
      if (lvl <= 1) {
        close();
        const next = body[i + 1];
        const hasKids = !!next && next !== skip && next.depth - shift === 2;
        if (hasKids) {
          out.push({ label: r.label, level: 2, kind: "head", values: [] });
          group = r; other = new Array(width).fill(0); folded = false; kidsSeen = 0;
        } else out.push({ label: r.label, level: 2, kind: r.kind === "total" ? "total" : "line", values: vals(r) });
        return;
      }
      if (lvl === 2) {
        kidsSeen++;
        if (isFold(r)) { vals(r).forEach((v, k) => { other[k] += v; }); folded = true; return; }
        out.push({ label: r.label, level: 3, kind: "line", values: vals(r) });
      }
      // Deeper than three levels: already inside its level-3 figure.
    });
    close();
    // A section with one main head only: its heading and total say what the
    // section's own heading and total already say, so its lines step up.
    const mine = out.slice(start);
    const heads = mine.filter((d) => d.level === 2 && d.kind === "head");
    const loose = mine.filter((d) => d.level === 2 && d.kind === "line");
    if (heads.length === 1 && loose.length === 0) {
      const h = heads[0], t = mine.find((d) => d.level === 2 && d.kind === "total" && d.label === `Total ${h.label}`);
      out.splice(start, mine.length, ...mine.filter((d) => d !== h && d !== t).map((d) => (d.level === 3 ? { ...d, level: 2 as const } : d)));
    }
  }
  // A line of nothing in every column says nothing; totals always stay.
  return out.filter((d) => d.kind !== "line" || d.values.some((v) => v !== null && Math.abs(v) >= 0.005));
}

type Shape = Parameters<typeof sectionRows>[0];

/** A one-column statement (the income statement or balance sheet for one period or date) as a document's rows. */
export function shapeToDoc(shape: Shape, foldIds?: Set<string>): DocRow[] {
  return rowsToDoc(sectionRows(shape, [shape], () => 1), { columns: 1, total: false, foldIds });
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/** 2026-01-31 → 31 January 2026, as a statement's heading writes a date. */
export const longDate = (d: string) => { const [y, m, day] = d.split("-").map(Number); return `${day} ${MONTHS[m - 1]} ${y}`; };
