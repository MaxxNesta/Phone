import { schedule, toUnits, fromUnits, addMonths, monthOf, type Month, type Convention } from "./fa-engine";

/**
 * The asset register as the shop keeps it in Excel: pasted, read into
 * editable rows, then reviewed against the chart, the branches, the assets
 * already registered and MTK's own schedule.
 *
 * Pure, so the page reviews in the browser as the paste lands and the server
 * runs exactly the same review again before it saves anything. Nothing here
 * posts: an imported asset's purchase is linked or recorded separately, and
 * its depreciation comes from the engine.
 *
 * Columns are found by their header, in any order; extra columns are ignored.
 */

export const FA_COLUMNS: { col: string; header: string; field: string; use: string; example: string }[] = [
  { col: "A", header: "No", field: "—", use: "Source row number, kept with the asset for tracing. MTK gives each asset its own code.", example: "1" },
  { col: "B", header: "Asset name (review)", field: "Name", use: "The asset's name. Without this column it is suggested from the description.", example: "Office Table Small 92-IR-Table A3-19" },
  { col: "C", header: "Notes / original description", field: "Notes", use: "The full original description, kept unchanged in Notes.", example: "Office Table Small 92-IR-Table A3-19 (3လုံး)*(180000-5%dis)Sweety Home 28/12/25" },
  { col: "D", header: "Category (Types)", field: "Category", use: "The reporting heading: the chart's title account, matched by its words.", example: "FURNITURES AND FITTINGS" },
  { col: "E", header: "Subcategory", field: "Subcategory", use: "Supplies the asset, accumulated-depreciation and expense accounts. A name MTK does not know is mapped once for the whole paste.", example: "Table , Chair & Locker" },
  { col: "F", header: "Useful life (months)", field: "Useful life", use: "In months: 24 means 24 months, not 24%.", example: "36" },
  { col: "G", header: "Depreciation start", field: "Depreciation start", use: "An explicit first month, kept apart from the first-month rule. Reviewed where it differs from the rule.", example: "Jan'2026" },
  { col: "H", header: "Asset date", field: "Acquired on", use: "The purchase date. A Buddhist-era year is converted: 2569 is 2026.", example: "28 Dec 2568" },
  { col: "I", header: "Quantity", field: "Quantity", use: "How many the row stands for; saved with the asset.", example: "3" },
  { col: "J", header: "Unit price", field: "—", use: "For review only: quantity × unit price is checked against the total cost.", example: "170,991.67" },
  { col: "K", header: "Total cost", field: "Cost", use: "The cost of the whole group, used by the depreciation schedule.", example: "512,975.00" },
  { col: "L", header: "Disposal (source)", field: "—", use: "Reviewed; never turned into a disposal by the import.", example: "" },
  { col: "M", header: "Opening accumulated depreciation", field: "Opening accumulated", use: "Depreciation before MTK, through the month before the depreciation start unless an as-of column says otherwise. Blank is confirmed, never assumed zero.", example: "" },
];

/** Optional columns the import also reads when a sheet has them. */
export const FA_OPTIONAL = ["In-service date", "Residual value", "Depreciation method", "Opening accumulated as of", "Branch"];

/**
 * The register's headers, exactly and in order, for a year: what the Asset
 * schedule shows and exports. Import reads the same, months and NBV optional.
 */
export const registerHeaders = (year: number) => [
  "No", "Asset name (review)", "Notes / original description", "Category (Types)", "Subcategory", "Useful life (months)",
  "Depreciation start", "Asset date", "Quantity", "Unit price", "Total cost", "Disposal (source)", "Opening accumulated depreciation",
  ...["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].map((m) => `${m} ${year}`), "NBV (source)",
];

/**
 * A name from a description that mixes the name with notes: its first line,
 * up to the first Burmese text, bracket or date.
 */
export function suggestName(description: string): string {
  const first = description.split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? "";
  const cut = first.split(/[က-႟(（]|\b\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b/)[0].replace(/[\s,;:–—-]+$/, "").trim();
  const name = cut.length >= 3 ? cut : first;
  return name.length > 120 ? name.slice(0, 120).trimEnd() + "…" : name;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const FIELDS = {
  no: ["no", "no.", "sr", "sr no"],
  name: ["name", "asset name"],
  description: ["description", "notes", "notes / original description", "original description"],
  types: ["types", "type", "category"],
  software: ["software", "subcategory", "sub category", "sub-category"],
  life: ["depreciation rate", "useful life", "life", "life (months)"],
  start: ["mohths", "months", "month", "start month", "first month", "depreciation start"],
  date: ["date", "purchase date", "acquired on", "asset date", "acquired date", "acquisition date"],
  inService: ["in-service date", "in service date", "in service", "in-service", "in service from"],
  qty: ["qty", "quantity"],
  price: ["price", "unit price"],
  cost: ["cost", "total cost"],
  residual: ["residual", "residual value", "salvage value"],
  method: ["method", "depreciation method"],
  disposal: ["disopsal", "disposal"],
  opening: ["op; accu", "op;accu", "op accu", "op. accu", "opening accumulated", "opening accu", "opening accumulated depreciation"],
  openingAsOf: ["opening accumulated as of", "opening as of", "opening through", "opening accumulated through"],
  branch: ["branch", "location", "used at"],
  nbv: ["nbv", "net book value"],
} as const;
type Field = keyof typeof FIELDS;
const NEEDED: Field[] = ["types", "software", "life", "cost", "date"];
const LABEL: Record<Field, string> = { no: "No", name: "Asset name", description: "Notes / original description", types: "Category (Types)",
  software: "Subcategory", life: "Useful life (months)", start: "Depreciation start", date: "Asset date", inService: "In-service date",
  qty: "Quantity", price: "Unit price", cost: "Total cost", residual: "Residual value", method: "Depreciation method", disposal: "Disposal",
  opening: "Opening accumulated depreciation", openingAsOf: "Opening accumulated as of", branch: "Branch", nbv: "NBV" };

/** "1,250,000", "(500)", "-", "" → number or null. */
export function num(v: string | undefined): number | null {
  const s = (v ?? "").replace(/[,\s]/g, "").replace(/^MMK|Ks$/i, "");
  if (!s || s === "-") return null;
  const neg = /^\(.*\)$/.test(s);
  const n = Number(neg ? s.slice(1, -1) : s);
  return Number.isFinite(n) ? (neg ? -n : n) : null;
}

/** "Jan 2026", "Jan'2026", "Jan-26", "January 2569", "2026-01", "1/1/2026" → "2026-01". A Buddhist-era year is converted. */
export function parseMonth(v: string): Month | null {
  const s = v.trim().toLowerCase();
  let m = /^([a-z]{3})[a-z]*[\s\-/.']*(\d{2}|\d{4})$/.exec(s);
  if (m && MONTHS.includes(m[1])) {
    const y = m[2].length === 2 ? 2000 + Number(m[2]) : Number(m[2]);
    return `${y > 2400 ? y - 543 : y}-${String(MONTHS.indexOf(m[1]) + 1).padStart(2, "0")}`;
  }
  m = /^(\d{4})-(\d{1,2})(?:-\d{1,2})?$/.exec(s);
  if (m) return `${Number(m[1]) > 2400 ? Number(m[1]) - 543 : m[1]}-${m[2].padStart(2, "0")}`;
  const d = parseDate(v);
  return d.date ? d.date.slice(0, 7) : null;
}

/** A date as Excel copies it. Day/month order is only certain when the day is over 12. A Buddhist-era year is converted. */
export function parseDate(v: string): { date: string | null; unsure: boolean; buddhist: boolean } {
  const s = v.trim();
  let buddhist = false;
  if (!s) return { date: null, unsure: false, buddhist };
  const iso = (yr: number, mo: number, d: number) => {
    if (yr > 2400) buddhist = true;
    const y = yr > 2400 ? yr - 543 : yr;
    const t = new Date(Date.UTC(y, mo - 1, d));
    return t.getUTCMonth() === mo - 1 && t.getUTCDate() === d ? t.toISOString().slice(0, 10) : null;
  };
  const out = (date: string | null, unsure = false) => ({ date, unsure, buddhist });
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T].*)?$/.exec(s);
  if (m) return out(iso(+m[1], +m[2], +m[3]));
  m = /^(\d{1,2})[\s\-/.]([a-z]{3})[a-z]*[\s\-/.,]*(\d{2}|\d{4})$/i.exec(s);
  if (m && MONTHS.includes(m[2].toLowerCase())) return out(iso(+(m[3].length === 2 ? "20" + m[3] : m[3]), MONTHS.indexOf(m[2].toLowerCase()) + 1, +m[1]));
  m = /^([a-z]{3})[a-z]*\s+(\d{1,2}),?\s+(\d{4})$/i.exec(s);
  if (m && MONTHS.includes(m[1].toLowerCase())) return out(iso(+m[3], MONTHS.indexOf(m[1].toLowerCase()) + 1, +m[2]));
  m = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2}|\d{4})$/.exec(s);
  if (m) {
    const y = +(m[3].length === 2 ? "20" + m[3] : m[3]), a = +m[1], b = +m[2];
    if (a > 12) return out(iso(y, b, a));
    if (b > 12) return out(iso(y, a, b));
    return out(iso(y, b, a), a !== b);
  }
  if (/^\d{5}$/.test(s)) return out(new Date(Date.UTC(1899, 11, 30) + Number(s) * 86_400_000).toISOString().slice(0, 10));
  return out(null);
}

const norm = (s: string) => s.toLowerCase().replace(/&amp;/g, "&").replace(/\s+/g, " ").replace(/\s*&\s*/g, " & ").replace(/\s*,\s*/g, ", ").trim();
/** By words, singular: "FURNITURES AND FITTINGS" shares "furniture" with "Furniture and Office Equipment". */
const sameHeading = (file: string, chart: string) => {
  const words = (s: string) => new Set(norm(s).split(/[^a-zက-႟]+/).filter((w) => w.length > 2 && w !== "and").map((w) => w.replace(/s$/, "")));
  const c = words(chart);
  return [...words(file)].some((w) => c.has(w));
};
const units = (n: number) => toUnits(n.toFixed(4));
const kyat = (u: bigint) => Number(fromUnits(u));
const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });
const monthName = (m: Month) => `${MONTHS[Number(m.slice(5)) - 1][0].toUpperCase()}${MONTHS[Number(m.slice(5)) - 1].slice(1)} ${m.slice(0, 4)}`;
export const showMonth = monthName;

/** Where the header row is, which column holds each field, the year of any month columns, and what is missing. */
export function findHeader(rows: string[][]) {
  const fieldOf = (cell: string) => {
    const c = norm(cell), outside = c.replace(/\s*\(.*\)\s*/g, " ").trim(), inside = /\(([^)]*)\)/.exec(c)?.[1].trim() ?? "";
    return (Object.keys(FIELDS) as Field[]).find((f) => [c, outside].some((x) => (FIELDS[f] as readonly string[]).includes(x)))
      ?? (Object.keys(FIELDS) as Field[]).find((f) => f !== "start" && (FIELDS[f] as readonly string[]).includes(inside));
  };
  const at = rows.findIndex((r) => { const fs = r.map(fieldOf); return fs.includes("cost") && (fs.includes("description") || fs.includes("name")); });
  if (at < 0) return null;
  const head = rows[at];
  const col = {} as Partial<Record<Field, number>>;
  head.forEach((c, i) => { const f = fieldOf(c); if (f && col[f] === undefined) col[f] = i; });
  // Monthly figures are optional: read when present, for comparison only.
  const months = MONTHS.map((m) => head.findIndex((c) => norm(c).startsWith(m) && !fieldOf(c)));
  const wrong = [
    ...NEEDED.filter((f) => col[f] === undefined).map((f) => `no “${LABEL[f]}” column`),
    ...(col.name === undefined && col.description === undefined ? ["no “Asset name” or “Notes” column"] : []),
  ];
  const fromHead = months.map((i) => (i >= 0 ? parseMonth(head[i]) : null)).find(Boolean);
  return { at, col, months, wrong, year: fromHead ? Number(fromHead.slice(0, 4)) : null };
}

// ------------------------------------------------------------ rows --

/** One pasted row as the import holds it: everything the review shows, editable before import. */
export type DraftRow = {
  line: number; no: string; include: boolean;
  name: string; notes: string;
  /** The file's words, kept to show and to map. */
  groupText: string; subText: string;
  /** Chosen by hand for this row; otherwise the paste's mapping of subText applies. */
  categoryId: string | null;
  branchId: string | null;
  acquired: string | null; acquiredText: string; acquiredUnsure: boolean; acquiredBuddhist: boolean;
  inService: string | null;
  start: Month | null; startText: string;
  qty: number | null; price: number | null; cost: number | null; residual: number;
  life: number | null; lifeText: string; method: string;
  opening: number | null; openingBlank: boolean; openingThrough: Month | null;
  disposal: number | null;
  excel: (number | null)[]; nbv: number | null;
};

export type Category = { id: string; name: string; group: string | null; accounts?: string };
export type Branch = { id: string; name: string };
export type ExistingAsset = { code: string; name: string; cost: number; acquired: string };
export type Issue = { level: "review" | "attention"; text: string };
export type RowStatus = "ready" | "review" | "attention";
export type ReviewedRow = DraftRow & {
  category: Category | null; issues: Issue[]; status: RowStatus;
  /** MTK's monthly amount (the first full month), the year's months, and NBV at the file's as-of month. */
  monthly: number | null; mtk: number[]; mtkNbv: number | null; nbvAt: Month | null;
  duplicateOf: string | null;
};

/** The paste read into editable rows: header problems, the year of any month columns, and the rows. */
export function parseRegister(rows: string[][]) {
  const h = findHeader(rows);
  if (!h) return null;
  const at = (r: string[], f: Field) => (h.col[f] === undefined ? "" : (r[h.col[f]!] ?? "").trim());
  const body = rows.slice(h.at + 1).map((r, i) => ({ r, line: h.at + 2 + i }))
    .filter(({ r }) => at(r, "description") || at(r, "name") || num(at(r, "cost")) !== null)
    .filter(({ r }) => !/^(grand\s*)?total/i.test(at(r, "no") || at(r, "name") || at(r, "description")));
  const drafts: DraftRow[] = body.map(({ r, line }) => {
    const notes = at(r, "description"), d = parseDate(at(r, "date")), lifeText = at(r, "life"), lifeRaw = num(lifeText);
    const start = parseMonth(at(r, "start"));
    const svc = parseDate(at(r, "inService"));
    // Day/month unclear: the start month settles it when one reading agrees.
    if (d.unsure && d.date && start) {
      const [y, mo, dd] = d.date.split("-"), swapped = `${y}-${dd}-${mo}`;
      if (d.date.slice(0, 7) === start) d.unsure = false;
      else if (swapped.slice(0, 7) === start) { d.date = swapped; d.unsure = false; }
    }
    return {
      line, no: at(r, "no"), include: true,
      name: at(r, "name") || suggestName(notes), notes: notes || at(r, "name"),
      groupText: at(r, "types"), subText: at(r, "software"), categoryId: null, branchId: null,
      acquired: d.date, acquiredText: at(r, "date"), acquiredUnsure: d.unsure, acquiredBuddhist: d.buddhist,
      inService: svc.date, start, startText: at(r, "start"),
      qty: num(at(r, "qty")), price: num(at(r, "price")), cost: num(at(r, "cost")), residual: num(at(r, "residual")) ?? 0,
      life: lifeRaw !== null && Number.isInteger(lifeRaw) && lifeRaw > 0 && lifeRaw <= 1200 ? lifeRaw : null, lifeText,
      method: at(r, "method") || "Straight line",
      opening: num(at(r, "opening")), openingBlank: !at(r, "opening"), openingThrough: parseMonth(at(r, "openingAsOf")),
      disposal: num(at(r, "disposal")),
      excel: h.months.map((i) => (i < 0 ? null : num(r[i]))), nbv: num(at(r, "nbv")),
    };
  });
  // The month the file's NBV is as of: where cost less opening less the months to date comes to it, for most rows.
  const votes = Array(12).fill(0);
  for (const d of drafts) {
    if (d.cost === null || d.nbv === null) continue;
    let left = d.cost - (d.opening ?? 0);
    d.excel.forEach((v, k) => { left -= v ?? 0; if (v !== null && Math.abs(left - d.nbv!) <= 1) votes[k]++; });
  }
  const best = votes.indexOf(Math.max(...votes));
  const starts = drafts.map((d) => d.start).filter(Boolean) as Month[];
  const year = h.year ?? (starts.length ? Number(starts.sort()[Math.floor(starts.length / 2)].slice(0, 4)) : new Date().getFullYear());
  return { headerLine: h.at + 1, wrongHeaders: h.wrong, year, hasMonths: h.months.some((i) => i >= 0),
    inferred: votes[best] > 0 ? { month: best, matches: votes[best] } : null, drafts };
}

/** What the review needs to know beyond the rows themselves. */
export type ReviewContext = {
  categories: Category[]; branches: Branch[]; existing: ExistingAsset[];
  /** The file's subcategory words → an MTK subcategory, chosen once for the paste. */
  subMap: Record<string, string>;
  /** The branch every row takes unless it names its own. */
  branchId: string | null;
  /** The company's first-month rule, to show where an explicit start differs. */
  convention: Convention;
  year: number; nbvMonth: number | null;
};

/** Each row reviewed: its category, branch, issues, status and MTK's own schedule. */
export function reviewRows(drafts: DraftRow[], ctx: ReviewContext): ReviewedRow[] {
  const byName = new Map(ctx.categories.map((c) => [norm(c.name), c]));
  const byId = new Map(ctx.categories.map((c) => [c.id, c]));
  const first = `${ctx.year}-01` as Month;
  const key = (name: string, cost: number | null, acquired: string | null) => `${norm(name)}|${Math.round(cost ?? 0)}|${acquired ?? ""}`;
  const existing = new Map(ctx.existing.map((e) => [key(e.name, e.cost, e.acquired), e.code]));
  const seen = new Map<string, number>();

  return drafts.map((d) => {
    const issues: Issue[] = [];
    const attention = (text: string) => issues.push({ level: "attention", text });
    const review = (text: string) => issues.push({ level: "review", text });
    const category = (d.categoryId && byId.get(d.categoryId)) || byId.get(ctx.subMap[norm(d.subText)] ?? "") || byName.get(norm(d.subText)) || null;
    const branchId = d.branchId ?? ctx.branchId;

    if (!d.name.trim()) attention("No asset name.");
    if (!category) attention(d.subText ? `Subcategory “${d.subText}” is not one MTK has: map it to one.` : "No subcategory.");
    else if (d.groupText && category.group && !sameHeading(d.groupText, category.group)) review(`Category says “${d.groupText}”; the chart files ${category.name} under ${category.group}.`);
    if (!branchId || !ctx.branches.some((b) => b.id === branchId)) attention("Choose the branch it is used at.");
    if (d.life === null) attention(!d.lifeText ? "No useful life." : `Useful life “${d.lifeText}” is not a whole number of months.`);
    if (d.cost === null || d.cost <= 0) attention("No total cost.");
    if (!d.acquired) attention(d.acquiredText ? `Asset date “${d.acquiredText}” is not a date.` : "No asset date.");
    else if (d.acquiredUnsure) review(`Asset date ${d.acquiredText} could be day/month or month/day; read as ${d.acquired}.`);
    if (d.startText && !d.start) attention(`Depreciation start “${d.startText}” is not a month.`);
    if (d.inService && d.acquired && d.inService < d.acquired) attention("It cannot go into service before its asset date.");
    if (d.qty !== null && d.qty <= 0) attention("Quantity must be above zero.");
    if (d.residual < 0 || (d.cost !== null && d.residual > d.cost)) attention("Residual value must be between 0 and the cost.");
    if (!/^straight/i.test(d.method)) attention(`Method “${d.method}”: MTK depreciates straight line only.`);

    const inService = d.inService ?? d.acquired;
    // The first-month rule on the in-service date, against an explicit start month.
    const ruled = inService ? (ctx.convention === "NEXT_MONTH" ? addMonths(monthOf(inService), 1) : monthOf(inService)) : null;
    if (d.start && ruled && d.start !== ruled) review(`Depreciation starts ${monthName(d.start)}; the first-month rule would start it ${monthName(ruled)}. The explicit month is kept.`);
    if (d.cost !== null && d.qty !== null && d.price !== null && Math.abs(d.qty * d.price - d.cost) > 1) {
      review(`Quantity × unit price is ${fmt(d.qty * d.price)}; the total cost ${fmt(d.cost)} is used.`);
    }
    if (d.disposal) review(`Disposal (source) has ${fmt(d.disposal)}; the import does not dispose of anything.`);

    // An opening figure runs to the month before depreciation starts unless the sheet says otherwise.
    const startMonth = d.start ?? ruled;
    const openingThrough = d.opening ? d.openingThrough ?? (startMonth ? addMonths(startMonth, -1) : null) : null;
    if (d.openingBlank && startMonth && startMonth < first) review(`Opening accumulated is blank but depreciation began ${monthName(startMonth)}; confirm it is zero.`);
    if (d.opening && !openingThrough) attention("Opening accumulated needs the month it runs to.");
    if (d.opening && d.cost !== null && d.opening > d.cost - d.residual) attention("Opening accumulated is more than cost less residual.");

    // Imported before, or twice in this paste.
    const k = key(d.name, d.cost, d.acquired);
    const dupExisting = existing.get(k) ?? null;
    const dupLine = seen.get(k);
    if (dupExisting) review(`Possible duplicate of ${dupExisting}, already registered with the same name, cost and date.`);
    else if (dupLine !== undefined) review(`Possible duplicate of line ${dupLine} in this paste.`);
    if (!seen.has(k)) seen.set(k, d.line);

    let mtk: number[] = Array(12).fill(0), mtkNbv: number | null = null, nbvAt: Month | null = null, monthly: number | null = null;
    if (d.life && d.cost && d.cost > 0 && inService && d.residual <= d.cost) {
      const rows = schedule({
        cost: units(d.cost), residual: units(d.residual), lifeMonths: d.life, inService, convention: ctx.convention,
        startMonth: d.start, opening: d.opening && openingThrough ? { through: openingThrough, amount: units(d.opening) } : null,
      });
      monthly = rows.length ? kyat(rows[0].amount) : null;
      mtk = Array.from({ length: 12 }, (_, i) => kyat(rows.find((x) => x.month === addMonths(first, i))?.amount ?? 0n));
      if (d.excel.some((v) => v !== null)) {
        const off = d.excel.flatMap((v, i) => (v === null ? [] : [[i, v - mtk[i]] as const])).filter(([, dlt]) => Math.abs(dlt) > 1);
        if (off.length) review(`${off.length} month${off.length === 1 ? "" : "s"} in the file differ from MTK's schedule (${off.slice(0, 3).map(([i, dlt]) => `${monthName(addMonths(first, i)).slice(0, 3)} ${dlt > 0 ? "+" : ""}${fmt(dlt)}`).join(", ")}).`);
        const lastK = ctx.nbvMonth ?? d.excel.reduce<number>((k0, v, i) => (v !== null ? i : k0), 11);
        nbvAt = addMonths(first, lastK);
        const last = [...rows].reverse().find((x) => x.month <= nbvAt!);
        mtkNbv = last ? kyat(last.closing) : d.cost - (d.opening ?? 0);
        if (d.nbv !== null && Math.abs(d.nbv - mtkNbv) > Math.max(1, lastK + 1)) review(`NBV ${fmt(d.nbv)} in the file, ${fmt(mtkNbv)} by MTK at ${monthName(nbvAt)}.`);
      }
    }
    const status: RowStatus = issues.some((i) => i.level === "attention") ? "attention" : issues.length ? "review" : "ready";
    return { ...d, branchId, openingThrough, category, issues, status, monthly, mtk, mtkNbv, nbvAt, duplicateOf: dupExisting ?? (dupLine !== undefined ? `line ${dupLine}` : null) };
  });
}

/** The file's subcategory words MTK does not know, once each. */
export function unknownSubcategories(drafts: DraftRow[], categories: Category[]) {
  const known = new Set(categories.map((c) => norm(c.name)));
  return [...new Map(drafts.filter((d) => d.subText && !known.has(norm(d.subText))).map((d) => [norm(d.subText), d.subText])).entries()]
    .map(([key, text]) => ({ key, text, group: drafts.find((d) => norm(d.subText) === key)?.groupText ?? "" }));
}
export const subKey = norm;

/** Parse and review in one step with no choices made: the tests' and the first look's view. */
export function readRegister(rows: string[][], categories: Category[], nbvMonth?: number | null,
  extra: Partial<Omit<ReviewContext, "categories" | "year" | "nbvMonth">> = {}) {
  const p = parseRegister(rows);
  if (!p) return null;
  const branches = extra.branches ?? [{ id: "b", name: "Main" }];
  const asOf = nbvMonth ?? p.inferred?.month ?? null;
  const reviewed = reviewRows(p.drafts, { categories, branches, existing: extra.existing ?? [], subMap: extra.subMap ?? {},
    branchId: extra.branchId ?? branches[0]?.id ?? null, convention: extra.convention ?? "SAME_MONTH", year: p.year, nbvMonth: asOf });
  return { headerLine: p.headerLine, wrongHeaders: p.wrongHeaders, year: p.year, rows: reviewed, nbvMonth: asOf, inferred: p.inferred };
}
