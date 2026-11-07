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

export const FA_COLUMNS: { col: string; header: string; field: string; use: string; example: string }[] = [
  { col: "A", header: "No", field: "—", use: "Source row number, for reference. MTK gives each asset its own code.", example: "1" },
  { col: "B", header: "Asset name (review)", field: "Name", use: "The asset's name, checked before import. Without this column it is suggested from the description.", example: "Office Table Small 92-IR-Table A3-19" },
  { col: "C", header: "Notes / original description", field: "Notes", use: "The full original description, unchanged: supplier, quantity, remarks, Burmese text.", example: "Office Table Small 92-IR-Table A3-19 (3လုံး)*(180000-5%dis)Sweety Home 28/12/25" },
  { col: "D", header: "Category (Types)", field: "Category", use: "The chart's title account; matched by its words, in any case.", example: "FURNITURES AND FITTINGS" },
  { col: "E", header: "Subcategory", field: "Subcategory", use: "Each subcategory has its own accounts.", example: "Table , Chair & Locker" },
  { col: "F", header: "Useful life (months)", field: "Useful life", use: "In months: 24 means 24 months, not 24%.", example: "36" },
  { col: "G", header: "Depreciation start", field: "First month", use: "The month depreciation starts, in full.", example: "Jan'2026" },
  { col: "H", header: "Asset date", field: "Acquired on", use: "The purchase date. A Buddhist-era year is read as the calendar year: 2569 is 2026.", example: "28 Dec 2568" },
  { col: "I", header: "Quantity", field: "—", use: "Number of items the row stands for.", example: "3" },
  { col: "J", header: "Unit price", field: "—", use: "Quantity × unit price is checked against the total cost.", example: "170,991.67" },
  { col: "K", header: "Total cost", field: "Cost", use: "The cost the depreciation schedule uses.", example: "512,975.00" },
  { col: "L", header: "Disposal (source)", field: "—", use: "Disposal value; reviewed before it becomes a disposal.", example: "" },
  { col: "M", header: "Opening accumulated depreciation", field: "Opening accumulated", use: "Depreciation before the year. Blank is confirmed, never assumed zero.", example: "" },
  { col: "N–Y", header: "Jan 2026 … Dec 2026", field: "—", use: "The file's monthly depreciation, compared with MTK's schedule. A blank month is not compared.", example: "14,249.31" },
  { col: "Z", header: "NBV (source)", field: "—", use: "The file's book value, compared at its last month with a figure.", example: "413,229.86" },
];

/**
 * The register's headers, exactly and in order, for a year: what the Asset
 * schedule shows and exports, and what Import reads. One list, so the two
 * cannot drift apart.
 */
export const registerHeaders = (year: number) => [
  "No", "Asset name (review)", "Notes / original description", "Category (Types)", "Subcategory", "Useful life (months)",
  "Depreciation start", "Asset date", "Quantity", "Unit price", "Total cost", "Disposal (source)", "Opening accumulated depreciation",
  ...["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].map((m) => `${m} ${year}`), "NBV (source)",
];

/**
 * A name from a description that mixes the name with notes: its first line,
 * up to the first Burmese text, bracket or date, which is where the shop's
 * sheets start the supplier and remarks. Only a suggestion; the full text is
 * kept as the notes.
 */
export function suggestName(description: string): string {
  const first = description.split(/\r?\n/)[0].trim();
  const cut = first.split(/[\u1000-\u109F(（]|\b\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b/)[0].replace(/[\s,;:–—-]+$/, "").trim();
  const name = cut.length >= 3 ? cut : first;
  return name.length > 120 ? name.slice(0, 120).trimEnd() + "…" : name;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
/**
 * Each field and the header labels that name it. Columns are found by their
 * header, not their letter, so a Name column added anywhere is read, and a
 * file without one still is (the name is suggested from the description).
 */
const FIELDS = {
  no: ["no", "no.", "sr", "sr no"],
  name: ["name", "asset name"],
  description: ["description", "notes", "notes / original description", "original description"],
  // "Asset name (review)", "Category (Types)": the words before the bracket, or the one inside it, name the field.
  types: ["types", "type", "category"],
  software: ["software", "subcategory", "sub category", "sub-category"],
  life: ["depreciation rate", "useful life", "life", "life (months)"],
  start: ["mohths", "months", "month", "start month", "first month", "depreciation start"],
  date: ["date", "purchase date", "acquired on", "asset date"],
  qty: ["qty", "quantity"],
  price: ["price", "unit price"],
  cost: ["cost", "total cost"],
  disposal: ["disopsal", "disposal"],
  opening: ["op; accu", "op;accu", "op accu", "op. accu", "opening accumulated", "opening accu", "opening accumulated depreciation"],
  nbv: ["nbv", "net book value"],
} as const;
type Field = keyof typeof FIELDS;
const NEEDED: Field[] = ["description", "types", "software", "life", "start", "cost"];
const LABEL: Record<Field, string> = { no: "No", name: "Name", description: "Description", types: "Types", software: "Software",
  life: "Depreciation Rate", start: "Mohths", date: "Date", qty: "Qty", price: "Price", cost: "Cost", disposal: "Disopsal", opening: "Op; Accu", nbv: "NBV" };

export type Category = { id: string; name: string; group: string | null };
export type Severity = "ok" | "review" | "blocked";
export type Issue = { level: "review" | "blocked"; text: string };
export type FaImportRow = {
  line: number; no: string; description: string;
  /** Suggested from the description; the description itself is kept as notes. */
  name: string; group: string; categoryText: string;
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
  if (m && MONTHS.includes(m[1])) {
    const y = m[2].length === 2 ? 2000 + Number(m[2]) : Number(m[2]);
    return `${y > 2400 ? y - 543 : y}-${String(MONTHS.indexOf(m[1]) + 1).padStart(2, "0")}`;
  }
  m = /^(\d{4})-(\d{1,2})(?:-\d{1,2})?$/.exec(s);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}`;
  const d = parseDate(v);
  return d.date ? d.date.slice(0, 7) : null;
}

/** A date as Excel copies it. Day/month order is only certain when the day is over 12. */
export function parseDate(v: string): { date: string | null; unsure: boolean } {
  const s = v.trim();
  if (!s) return { date: null, unsure: false };
  const iso = (yr: number, mo: number, d: number) => {
    const y = yr > 2400 ? yr - 543 : yr;
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

const norm = (s: string) => s.toLowerCase().replace(/&amp;/g, "&").replace(/\s+/g, " ").replace(/\s*&\s*/g, " & ").replace(/\s*,\s*/g, ", ").trim();
/** The file's category against the chart's: "Office Equipment" is under "Furniture and Office Equipment". */
const sameHeading = (file: string, chart: string) => {
  // By words, singular: "FURNITURES AND FITTINGS" shares "furniture" with "Furniture and Office Equipment".
  const words = (s: string) => new Set(norm(s).split(/[^a-z\u1000-\u109f]+/).filter((w) => w.length > 2 && w !== "and").map((w) => w.replace(/s$/, "")));
  const c = words(chart);
  return [...words(file)].some((w) => c.has(w));
};
const units = (n: number) => toUnits(n.toFixed(4));
const kyat = (u: bigint) => Number(fromUnits(u));
const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });

/** Where the header row is, which column holds each field, the year its months belong to, and what is missing. */
export function findHeader(rows: string[][]) {
  const fieldOf = (cell: string) => {
    const c = norm(cell), outside = c.replace(/\s*\(.*\)\s*/g, " ").trim(), inside = /\(([^)]*)\)/.exec(c)?.[1].trim() ?? "";
    // "Useful life (months)" and "NBV (source)": a bracket only adds a note to the name before it.
    return (Object.keys(FIELDS) as Field[]).find((f) => [c, outside].some((x) => (FIELDS[f] as readonly string[]).includes(x)))
      ?? (Object.keys(FIELDS) as Field[]).find((f) => f !== "start" && (FIELDS[f] as readonly string[]).includes(inside));
  };
  const at = rows.findIndex((r) => { const fs = r.map(fieldOf); return fs.includes("cost") && (fs.includes("description") || fs.includes("name")); });
  if (at < 0) return null;
  const head = rows[at];
  const col = {} as Partial<Record<Field, number>>;
  head.forEach((c, i) => { const f = fieldOf(c); if (f && col[f] === undefined) col[f] = i; });
  // The twelve months: the first header after the fixed columns that starts with each month's name.
  const months = MONTHS.map((m) => head.findIndex((c) => norm(c).startsWith(m) && !fieldOf(c)));
  const wrong = [
    ...NEEDED.filter((f) => col[f] === undefined && !(f === "description" && col.name !== undefined)).map((f) => `no “${LABEL[f]}” column`),
    ...months.flatMap((i, k) => (i < 0 ? [`no ${MONTHS[k][0].toUpperCase() + MONTHS[k].slice(1)} column`] : [])),
  ];
  // The year: from a month header that carries one ("Jan-26"), else the commonest start year.
  const fromHead = months.map((i) => (i >= 0 ? parseMonth(head[i]) : null)).find(Boolean);
  return { at, col, months, wrong, year: fromHead ? Number(fromHead.slice(0, 4)) : null };
}

/**
 * The month the file's NBV is as of: where cost less opening less the months
 * to date comes to the NBV, for most rows. Index 0–11, or null when no month
 * fits. The sheet's NBV is often struck at a month before its last figures.
 */
function inferNbvMonth(rows: { cost: number | null; opening: number | null; excel: (number | null)[]; nbv: number | null }[]) {
  const votes = Array(12).fill(0);
  for (const r of rows) {
    if (r.cost === null || r.nbv === null) continue;
    let left = r.cost - (r.opening ?? 0);
    r.excel.forEach((v, k) => { left -= v ?? 0; if (Math.abs(left - r.nbv!) <= 1) votes[k]++; });
  }
  const best = votes.indexOf(Math.max(...votes));
  return votes[best] > 0 ? { month: best, matches: votes[best] } : null;
}

/** nbvMonth: the month (0–11) the file's NBV is as of; by default the one that fits most rows. */
export function readRegister(rows: string[][], categories: Category[], nbvMonth?: number | null) {
  const h = findHeader(rows);
  if (!h) return null;
  const at = (r: string[], f: Field) => (h.col[f] === undefined ? "" : (r[h.col[f]!] ?? "").trim());
  const body = rows.slice(h.at + 1).map((r, i) => ({ r, line: h.at + 2 + i }))
    .filter(({ r }) => at(r, "description") || at(r, "name") || num(at(r, "cost")) !== null)
    // A total line is not an asset.
    .filter(({ r }) => !/^(grand\s*)?total/i.test(at(r, "no") || at(r, "name") || at(r, "description")));
  const starts = body.map(({ r }) => parseMonth(at(r, "start"))).filter(Boolean) as Month[];
  const year = h.year ?? (starts.length ? Number(starts.sort()[Math.floor(starts.length / 2)].slice(0, 4)) : new Date().getFullYear());
  const first = `${year}-01` as Month, before = addMonths(first, -1);
  const byName = new Map(categories.map((c) => [norm(c.name), c]));

  const inferred = inferNbvMonth(body.map(({ r }) => ({ cost: num(at(r, "cost")), opening: num(at(r, "opening")),
    excel: h.months.map((i) => (i < 0 ? null : num(r[i]))), nbv: num(at(r, "nbv")) })));
  const asOf = nbvMonth ?? inferred?.month ?? null;
  const out: FaImportRow[] = body.map(({ r, line }) => {
    const issues: Issue[] = [];
    const block = (text: string) => issues.push({ level: "blocked", text });
    const review = (text: string) => issues.push({ level: "review", text });
    const description = at(r, "description"), group = at(r, "types"), categoryText = at(r, "software");
    // A Name column wins; without one the name is suggested from the description.
    const name = at(r, "name") || suggestName(description);
    const category = byName.get(norm(categoryText)) ?? null;
    if (!name) block("No name or description.");
    if (!categoryText) block("No subcategory (the “Software” column).");
    else if (!category) block(`No subcategory named “${categoryText}”. Add it in Fixed Asset Settings.`);
    else if (group && category.group && !sameHeading(group, category.group)) review(`Types says “${group}”; the chart files ${category.name} under ${category.group}.`);

    const lifeText = at(r, "life"), lifeRaw = num(lifeText);
    const life = lifeRaw !== null && Number.isInteger(lifeRaw) && lifeRaw > 0 && lifeRaw <= 1200 ? lifeRaw : null;
    if (life === null) block(!lifeText ? "No useful life." : `Useful life “${lifeText}” is not a whole number of months.`);
    const startText = at(r, "start"), start = parseMonth(startText);
    if (!start) block(startText ? `Start month “${startText}” is not a month.` : "No start month.");
    const dateText = at(r, "date"), d = parseDate(dateText);
    // Day/month unclear: the start month settles it when one reading agrees.
    if (d.unsure && d.date && start) {
      const [y, mo, dd] = d.date.split("-");
      const swapped = `${y}-${dd}-${mo}`;
      if (d.date.slice(0, 7) === start) d.unsure = false;
      else if (swapped.slice(0, 7) === start) { d.date = swapped; d.unsure = false; }
    }
    if (dateText && !d.date) review(`Date “${dateText}” is not a date.`);
    else if (d.unsure) review(`Date ${dateText} could be day/month or month/day; read as ${d.date}.`);
    else if (!dateText) review("No date; the purchase date will be asked for.");

    const qty = num(at(r, "qty")), price = num(at(r, "price")), cost = num(at(r, "cost"));
    if (cost === null || cost <= 0) block("No cost.");
    else if (qty !== null && price !== null && Math.abs(qty * price - cost) > 1) review(`Qty × price is ${fmt(qty * price)}, cost is ${fmt(cost)}.`);
    const disposal = num(at(r, "disposal"));
    if (disposal) review(`Disopsal has ${fmt(disposal)}; confirm what it means before it becomes a disposal.`);
    const openingBlank = !at(r, "opening");
    const opening = num(at(r, "opening"));
    if (openingBlank && start && start < first) review(`Opening accumulated is blank but depreciation began ${start}; confirm it is zero.`);
    if (opening && start && start >= first) review(`Opening accumulated is ${fmt(opening)} but depreciation starts in ${year}; it is not used.`);

    const excel = h.months.map((i) => (i < 0 ? null : num(r[i])));
    const nbv = num(at(r, "nbv"));
    let mtk: number[] = Array(12).fill(0), mtkNbv: number | null = null, nbvAt: Month | null = null, tolerance = 1;
    if (life && start && cost && cost > 0) {
      // The file's opening figure covers everything before its year, as one carried amount.
      const carried = start < first && opening ? opening : 0;
      const rows = schedule(
        { cost: units(cost), residual: 0n, lifeMonths: life, inService: `${start}-01`, convention: "SAME_MONTH" },
        carried ? { posted: new Map([[before, units(carried)]]), openingThrough: before } : {},
      );
      mtk = Array.from({ length: 12 }, (_, k) => kyat(rows.find((x) => x.month === addMonths(first, k))?.amount ?? 0n));
      // The file's NBV is as of its last month with a figure; MTK's is taken at the same month.
      const lastK = asOf ?? excel.reduce<number>((k0, v, k) => (v !== null ? k : k0), 11);
      nbvAt = addMonths(first, lastK);
      const last = [...rows].reverse().find((x) => x.month <= nbvAt!);
      mtkNbv = last ? kyat(last.closing) : cost;
      // MTK posts whole kyat, the file carries the decimals: a kyat a month either way is rounding.
      tolerance = Math.max(1, lastK + 1);
      const off = excel.flatMap((v, k) => (v === null ? [] : [[k, v - mtk[k]] as const])).filter(([, dlt]) => Math.abs(dlt) > 1);
      if (off.length) review(`${off.length === 1 ? MONTHS[off[0][0]][0].toUpperCase() + MONTHS[off[0][0]].slice(1) : `${off.length} months`} differ from MTK's schedule (${off.slice(0, 3).map(([k, dlt]) => `${MONTHS[k][0].toUpperCase() + MONTHS[k].slice(1)} ${dlt > 0 ? "+" : ""}${fmt(dlt)}`).join(", ")}).`);
      if (nbv !== null && Math.abs(nbv - mtkNbv) > tolerance) review(`NBV ${fmt(nbv)} in the file, ${fmt(mtkNbv)} by MTK at ${nbvAt}.`);
    }
    const status: Severity = issues.some((i) => i.level === "blocked") ? "blocked" : issues.length ? "review" : "ok";
    return { line, no: at(r, "no"), description, name, group, categoryText, category, life, start, startText,
      date: d.date, dateText, qty, price, cost, disposal, opening, openingBlank, excel, mtk, nbv, mtkNbv, issues, status };
  });
  return { headerLine: h.at + 1, wrongHeaders: h.wrong, year, rows: out,
    /** The NBV's month as used, and what the file itself suggested. */
    nbvMonth: asOf, inferred };
}
