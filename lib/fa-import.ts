import { schedule, toUnits, fromUnits, addMonths, type Month } from "./fa-engine";

/**
 * The asset register as the shop keeps it in Excel, read from a paste and
 * checked against MTK's own schedule. Pure: no database, so the page reads it
 * in the browser as the paste lands. Nothing here saves or posts — how each
 * asset was paid (cash, bank or credit) is decided before that exists.
 *
 * Columns are by position, A to Y, as the file lays them out; the header row
 * is found by its "Description" and checked label by label.
 */

export const FA_COLUMNS: { col: string; header: string; field: string }[] = [
  { col: "A", header: "No", field: "Source row number, for reference. MTK gives each asset its own ID." },
  { col: "B", header: "Description", field: "Asset description, kept in full: Burmese, dates, supplier names and notes." },
  { col: "C", header: "Types", field: "Category: the chart's title account, such as Machinery or Furniture and Office Equipment." },
  { col: "D", header: "Software", field: "Subcategory, despite the header: Generator & Solar, Computer & Printer… Each has its own accounts." },
  { col: "E", header: "Depreciation Rate", field: "Useful life in months: 24 means 24 months, not 24%." },
  { col: "F", header: "Mohths", field: "Depreciation start month, such as Jan 2026." },
  { col: "G", header: "Date", field: "Asset date in the file; reviewed and mapped to the purchase date." },
  { col: "H", header: "Qty", field: "Number of items the row stands for." },
  { col: "I", header: "Price", field: "Unit price, for review." },
  { col: "J", header: "Cost", field: "Total cost the depreciation schedule uses." },
  { col: "K", header: "Disopsal", field: "Disposal value in the file; reviewed before it becomes a disposal." },
  { col: "L", header: "Op; Accu", field: "Opening accumulated depreciation. Blank is confirmed, never assumed zero." },
  { col: "M–X", header: "Jan–Dec", field: "The file's monthly depreciation, compared with MTK's schedule." },
  { col: "Y", header: "NBV", field: "The file's book value, compared at the end of the year." },
];

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const HEADERS = ["no", "description", "types", "software", "depreciation rate", "mohths", "date", "qty", "price", "cost", "disopsal", "op; accu"];

export type Category = { id: string; name: string; group: string | null };
export type Severity = "ok" | "review" | "blocked";
export type Issue = { level: "review" | "blocked"; text: string };
export type FaImportRow = {
  line: number; no: string; description: string; group: string; categoryText: string;
  category: Category | null; life: number | null; start: Month | null; startText: string;
  date: string | null; dateText: string; qty: number | null; price: number | null; cost: number | null;
  disposal: number | null; opening: number | null; openingBlank: boolean;
  excel: (number | null)[]; mtk: number[]; nbv: number | null; mtkNbv: number | null;
  issues: Issue[]; status: Severity;
};

/** "1,250,000", "(500)", "-", "" → number or null. */
export function num(v: string | undefined): number | null {
  const s = (v ?? "").replace(/[,\s]/g, "").replace(/^MMK|Ks$/i, "");
  if (!s || s === "-") return null;
  const neg = /^\(.*\)$/.test(s);
  const n = Number(neg ? s.slice(1, -1) : s);
  return Number.isFinite(n) ? (neg ? -n : n) : null;
}

/** "Jan 2026", "Jan-26", "January 2026", "2026-01", "1/1/2026", an Excel serial → "2026-01". */
export function parseMonth(v: string): Month | null {
  const s = v.trim().toLowerCase();
  let m = /^([a-z]{3})[a-z]*[\s\-/.']*(\d{2}|\d{4})$/.exec(s);
  if (m && MONTHS.includes(m[1])) return `${m[2].length === 2 ? "20" + m[2] : m[2]}-${String(MONTHS.indexOf(m[1]) + 1).padStart(2, "0")}`;
  m = /^(\d{4})-(\d{1,2})(?:-\d{1,2})?$/.exec(s);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}`;
  const d = parseDate(v);
  return d.date ? d.date.slice(0, 7) : null;
}

/** A date as Excel copies it. Day/month order is only certain when the day is over 12. */
export function parseDate(v: string): { date: string | null; unsure: boolean } {
  const s = v.trim();
  if (!s) return { date: null, unsure: false };
  const iso = (y: number, mo: number, d: number) => {
    const t = new Date(Date.UTC(y, mo - 1, d));
    return t.getUTCMonth() === mo - 1 && t.getUTCDate() === d ? t.toISOString().slice(0, 10) : null;
  };
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (m) return { date: iso(+m[1], +m[2], +m[3]), unsure: false };
  m = /^(\d{1,2})[\s\-/.]([a-z]{3})[a-z]*[\s\-/.,]*(\d{2}|\d{4})$/i.exec(s);
  if (m && MONTHS.includes(m[2].toLowerCase())) return { date: iso(+(m[3].length === 2 ? "20" + m[3] : m[3]), MONTHS.indexOf(m[2].toLowerCase()) + 1, +m[1]), unsure: false };
  m = /^([a-z]{3})[a-z]*\s+(\d{1,2}),?\s+(\d{4})$/i.exec(s);
  if (m && MONTHS.includes(m[1].toLowerCase())) return { date: iso(+m[3], MONTHS.indexOf(m[1].toLowerCase()) + 1, +m[2]), unsure: false };
  m = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2}|\d{4})$/.exec(s);
  if (m) {
    const y = +(m[3].length === 2 ? "20" + m[3] : m[3]), a = +m[1], b = +m[2];
    // Excel copies in the PC's order; the shop's sheets are day first unless the first can only be a month.
    if (a > 12) return { date: iso(y, b, a), unsure: false };
    if (b > 12) return { date: iso(y, a, b), unsure: false };
    return { date: iso(y, b, a), unsure: a !== b };
  }
  if (/^\d{5}$/.test(s)) {
    const t = new Date(Date.UTC(1899, 11, 30) + Number(s) * 86_400_000);
    return { date: t.toISOString().slice(0, 10), unsure: false };
  }
  return { date: null, unsure: false };
}

const norm = (s: string) => s.toLowerCase().replace(/&amp;/g, "&").replace(/\s+/g, " ").replace(/\s*&\s*/g, " & ").trim();
/** The file's category against the chart's: "Office Equipment" is under "Furniture and Office Equipment". */
const sameHeading = (file: string, chart: string) => {
  const f = norm(file).replace(/ and /g, " & "), c = norm(chart).replace(/ and /g, " & ");
  return f === c || c.includes(f) || f.includes(c);
};
const units = (n: number) => toUnits(n.toFixed(4));
const kyat = (u: bigint) => Number(fromUnits(u));
const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });

/** Where the header row is, the year its months belong to, and any label that is not where it should be. */
export function findHeader(rows: string[][]) {
  const at = rows.findIndex((r) => norm(r[1] ?? "") === "description");
  if (at < 0) return null;
  const head = rows[at];
  const wrong = HEADERS.flatMap((h, i) => norm(head[i] ?? "") === h ? [] : [`${"ABCDEFGHIJKL"[i]} reads “${(head[i] ?? "").trim() || "blank"}”, expected “${h}”`]);
  for (let k = 0; k < 12; k++) {
    const cell = norm(head[12 + k] ?? "");
    if (!cell.startsWith(MONTHS[k])) wrong.push(`${"MNOPQRSTUVWX"[k]} reads “${(head[12 + k] ?? "").trim() || "blank"}”, expected ${MONTHS[k]}`);
  }
  if (norm(head[24] ?? "") !== "nbv") wrong.push(`Y reads “${(head[24] ?? "").trim() || "blank"}”, expected NBV`);
  // The year: from a month header that carries one ("Jan-26"), else the commonest start year.
  const fromHead = head.slice(12, 24).map((c) => parseMonth(c)).find(Boolean);
  return { at, wrong, year: fromHead ? Number(fromHead.slice(0, 4)) : null };
}

export function readRegister(rows: string[][], categories: Category[]) {
  const h = findHeader(rows);
  if (!h) return null;
  const body = rows.slice(h.at + 1).map((r, i) => ({ r, line: h.at + 2 + i }))
    .filter(({ r }) => (r[1] ?? "").trim() || num(r[9]) !== null)
    // A total line is not an asset.
    .filter(({ r }) => !/^(grand\s*)?total/i.test((r[0] || r[1] || "").trim()));
  const starts = body.map(({ r }) => parseMonth(r[5] ?? "")).filter(Boolean) as Month[];
  const year = h.year ?? (starts.length ? Number(starts.sort()[Math.floor(starts.length / 2)].slice(0, 4)) : new Date().getFullYear());
  const first = `${year}-01` as Month, before = addMonths(first, -1);
  const byName = new Map(categories.map((c) => [norm(c.name), c]));

  const out: FaImportRow[] = body.map(({ r, line }) => {
    const issues: Issue[] = [];
    const block = (text: string) => issues.push({ level: "blocked", text });
    const review = (text: string) => issues.push({ level: "review", text });
    const description = (r[1] ?? "").trim(), group = (r[2] ?? "").trim(), categoryText = (r[3] ?? "").trim();
    const category = byName.get(norm(categoryText)) ?? null;
    if (!description) block("No description.");
    if (!categoryText) block("No subcategory in column D.");
    else if (!category) block(`No subcategory named “${categoryText}”. Add it in Fixed Asset Settings.`);
    else if (group && category.group && !sameHeading(group, category.group)) review(`Column C says “${group}”; the chart files ${category.name} under ${category.group}.`);

    const lifeRaw = num(r[4]);
    const life = lifeRaw !== null && Number.isInteger(lifeRaw) && lifeRaw > 0 && lifeRaw <= 1200 ? lifeRaw : null;
    if (life === null) block(!(r[4] ?? "").trim() ? "No useful life in column E." : `Useful life “${(r[4] ?? "").trim()}” is not a whole number of months.`);
    const startText = (r[5] ?? "").trim(), start = parseMonth(startText);
    if (!start) block(startText ? `Start month “${startText}” is not a month.` : "No start month in column F.");
    const dateText = (r[6] ?? "").trim(), d = parseDate(dateText);
    // Day/month unclear: the start month in column F settles it when one reading agrees.
    if (d.unsure && d.date && start) {
      const [y, mo, dd] = d.date.split("-");
      const swapped = `${y}-${dd}-${mo}`;
      if (d.date.slice(0, 7) === start) d.unsure = false;
      else if (swapped.slice(0, 7) === start) { d.date = swapped; d.unsure = false; }
    }
    if (dateText && !d.date) review(`Date “${dateText}” is not a date.`);
    else if (d.unsure) review(`Date ${dateText} could be day/month or month/day; read as ${d.date}.`);
    else if (!dateText) review("No date in column G; the purchase date will be asked for.");

    const qty = num(r[7]), price = num(r[8]), cost = num(r[9]);
    if (cost === null || cost <= 0) block("No cost in column J.");
    else if (qty !== null && price !== null && Math.abs(qty * price - cost) > 1) review(`Qty × price is ${fmt(qty * price)}, cost is ${fmt(cost)}.`);
    const disposal = num(r[10]);
    if (disposal) review(`Column K has ${fmt(disposal)} as disposal; confirm what it means before it becomes a disposal.`);
    const openingBlank = !(r[11] ?? "").trim();
    const opening = num(r[11]);
    if (openingBlank && start && start < first) review(`Opening accumulated is blank but depreciation began ${start}; confirm it is zero.`);
    if (opening && start && start >= first) review(`Opening accumulated is ${fmt(opening)} but depreciation starts in ${year}; it is not used.`);

    const excel = Array.from({ length: 12 }, (_, k) => num(r[12 + k]));
    const nbv = num(r[24]);
    let mtk: number[] = Array(12).fill(0), mtkNbv: number | null = null;
    if (life && start && cost && cost > 0) {
      // The file's opening figure covers everything before its year, as one carried amount.
      const carried = start < first && opening ? opening : 0;
      const rows = schedule(
        { cost: units(cost), residual: 0n, lifeMonths: life, inService: `${start}-01`, convention: "SAME_MONTH" },
        carried ? { posted: new Map([[before, units(carried)]]), openingThrough: before } : {},
      );
      mtk = Array.from({ length: 12 }, (_, k) => kyat(rows.find((x) => x.month === addMonths(first, k))?.amount ?? 0n));
      const last = [...rows].reverse().find((x) => x.month <= addMonths(first, 11));
      mtkNbv = last ? kyat(last.closing) : cost;
      const off = excel.map((v, k) => [k, (v ?? 0) - mtk[k]] as const).filter(([, dlt]) => Math.abs(dlt) > 1);
      if (off.length) review(`${off.length === 1 ? MONTHS[off[0][0]][0].toUpperCase() + MONTHS[off[0][0]].slice(1) : `${off.length} months`} differ from MTK's schedule (${off.slice(0, 3).map(([k, dlt]) => `${MONTHS[k][0].toUpperCase() + MONTHS[k].slice(1)} ${dlt > 0 ? "+" : ""}${fmt(dlt)}`).join(", ")}).`);
      if (nbv !== null && Math.abs(nbv - mtkNbv) > 1) review(`NBV ${fmt(nbv)} in the file, ${fmt(mtkNbv)} by MTK at Dec ${year}.`);
    }
    const status: Severity = issues.some((i) => i.level === "blocked") ? "blocked" : issues.length ? "review" : "ok";
    return { line, no: (r[0] ?? "").trim(), description, group, categoryText, category, life, start, startText,
      date: d.date, dateText, qty, price, cost, disposal, opening, openingBlank, excel, mtk, nbv, mtkNbv, issues, status };
  });
  return { headerLine: h.at + 1, wrongHeaders: h.wrong, year, rows: out };
}
