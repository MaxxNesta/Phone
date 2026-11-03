/**
 * Reading the old system's purchase-invoice report.
 *
 * The report is printed, not tabulated: each invoice is a block of
 * "Label : value" header rows, a line table with the IMEIs on the row under
 * each line, and a totals block (printed twice). Cells shift between
 * blocks because the report merges them, so values are read by label and by
 * order — the first three numbers after a description are qty, price and
 * amount — never by column position.
 *
 *   Docid : s126010003   InvoiceNo :   Date : 02/01/2026
 *   Supplier : China     Payment : Credit
 *   Location : Main Store  Remark : 29.12.25 purchase
 *   Code  Description  Qty  Pur.price  Amount  Type  Remark
 *   IPZ003  IPhone 17 (256GB) ZA/A - Black  4.00  3,772,989.00  15,091,956.00  1142310  Count :4
 *   354630185148539, 354630185378847, …
 *   Invoice Total 11.00 50,387,932.00 …
 *
 * Pure: text in, a verdict out. The preview and the import both run it, so
 * what was approved is what is written.
 */

export type SourceLine = {
  code: string; description: string; qty: number; unitPrice: number; amount: number;
  remark: string | null; count: number | null; serials: string[];
};

export type SourceInvoice = {
  /** Row in the sheet the invoice's Docid sits on, for messages. */
  row: number;
  oldRef: string; supplierInvoiceNo: string | null; rawDate: string;
  supplier: string; payment: string | null; location: string; remark: string | null;
  lines: SourceLine[];
  totals: {
    qty: number | null; invoiceTotal: number | null; itemDiscount: number; voucherDiscount: number;
    advancePay: number; paidAmount: number; netTotal: number | null; currency: string; exchangeRate: number;
  };
};

const NUM = /^-?[\d,]+(\.\d+)?$/;
const num = (s: string) => Number(s.replace(/,/g, ""));
const isNum = (s: string) => NUM.test(s.trim());
const key = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");

/** Header labels the report prints; pasted, they may come without their colon. */
const KNOWN = /^(docid|invoiceno|date|supplier|payment|location|remark)$/;
const LABEL = /^([A-Za-z_. ]+?)\s*:\s*(.*)$/;
const isLabel = (c: string) => LABEL.test(c) || KNOWN.test(key(c));

/** "Label : value" pairs on a header row; a value may sit in the next cell. */
function labelled(cells: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < cells.length; i++) {
    const m = cells[i].match(LABEL) ?? (KNOWN.test(key(cells[i])) ? [cells[i], cells[i], ""] : null);
    if (!m) continue;
    let v = m[2].trim();
    if (!v && i + 1 < cells.length && cells[i + 1] && !isLabel(cells[i + 1])) v = cells[++i].trim();
    out[key(m[1])] = v;
  }
  return out;
}

/** Cells copied from Excel: tabs between cells; a quoted cell may hold tabs, newlines or "". */
export function parseTsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c !== '"') cell += c;
      else if (text[i + 1] === '"') { cell += '"'; i++; }
      else quoted = false;
    } else if (c === '"' && cell === "") quoted = true;
    else if (c === "\t") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

const isDocid = (cells: string[]) => /^docid/.test(key((cells.find((c) => c.trim()) ?? "").split(":")[0]));

/** Where each invoice starts (its Docid row) and ends (the last filled row before the next), 0-based. */
export function invoiceBlocks(rows: string[][]): { start: number; end: number; ref: string }[] {
  const out: { start: number; end: number; ref: string }[] = [];
  rows.forEach((r, i) => {
    if (isDocid(r)) out.push({ start: i, end: i, ref: labelled(r.map((c) => c.trim())).docid ?? "" });
    else if (out.length && r.some((c) => c.trim())) out[out.length - 1].end = i;
  });
  return out;
}

/** An item line has qty, price and amount after its code and description. */
const isItemLine = (filled: string[]) => filled.slice(2).filter(isNum).length >= 3;

/** The row under a line: its IMEIs, or a Mac's serials (C02XK0ABJGH5) — every token a code. */
function serialTokens(cells: string[]): string[] | null {
  const tokens = cells.join(",").split(/[,\s;]+/).filter(Boolean);
  return tokens.length > 0 && tokens.every((t) => /^[A-Za-z0-9][A-Za-z0-9-]{3,}$/.test(t)) ? tokens : null;
}

export function parsePurchaseReport(rows: string[][]): SourceInvoice[] {
  const out: SourceInvoice[] = [];
  let cur: SourceInvoice | null = null;
  let mode: "head" | "lines" | "totals" = "head";
  const seen = new Set<string>();

  rows.forEach((raw, i) => {
    const cells = raw.map((c) => (c ?? "").trim());
    const filled = cells.filter(Boolean);
    if (filled.length === 0) return;
    // "Supplier : China" and "Supplier :" both start with the label "supplier".
    const first = key(filled[0].split(":")[0]);

    if (isDocid(cells)) {
      const kv = labelled(cells);
      cur = {
        row: i + 1, oldRef: kv.docid ?? "", supplierInvoiceNo: kv.invoiceno || null, rawDate: kv.date ?? "",
        supplier: "", payment: null, location: "", remark: null, lines: [],
        totals: { qty: null, invoiceTotal: null, itemDiscount: 0, voucherDiscount: 0, advancePay: 0,
                  paidAmount: 0, netTotal: null, currency: "MMK", exchangeRate: 1 },
      };
      out.push(cur); mode = "head"; seen.clear();
      return;
    }
    if (!cur) return;
    const inv: SourceInvoice = cur;

    if (mode === "head" && /^(supplier|location|payment|remark)$/.test(first)) {
      const kv = labelled(cells);
      if (kv.supplier !== undefined) inv.supplier = kv.supplier;
      if (kv.payment !== undefined) inv.payment = kv.payment || null;
      if (kv.location !== undefined) inv.location = kv.location;
      if (kv.remark !== undefined) inv.remark = kv.remark || null;
      return;
    }
    if (first === "code") { mode = "lines"; return; }

    if (first === "invoicetotal" || mode === "totals") {
      mode = "totals";
      const label = key(filled[0]);
      if (seen.has(label)) return; // the report prints the totals block twice
      seen.add(label);
      const nums = filled.slice(1).filter(isNum).map(num);
      const t = inv.totals;
      if (label === "invoicetotal") { t.qty = nums[0] ?? null; t.invoiceTotal = nums[1] ?? null; }
      else if (label === "itemdiscount") t.itemDiscount = nums[0] ?? 0;
      else if (label === "voucherdiscount") {
        t.voucherDiscount = nums[0] ?? 0;
        // "Voucher Discount 0.00 K 50,387,932.00 1.00": the currency, its amount, the rate.
        const c = filled.findIndex((x) => /^[A-Za-z$]{1,3}$/.test(x));
        if (c > 0) {
          t.currency = filled[c] === "K" ? "MMK" : filled[c].toUpperCase();
          const after = filled.slice(c + 1).filter(isNum).map(num);
          if (after[1] !== undefined) t.exchangeRate = after[1];
        }
      }
      else if (label === "advancepay") t.advancePay = nums[0] ?? 0;
      else if (label === "paidamount") t.paidAmount = nums[0] ?? 0;
      else if (label === "nettotal") t.netTotal = nums[0] ?? null;
      return;
    }

    if (mode !== "lines") return;
    const serials = isItemLine(filled) ? null : serialTokens(filled);
    if (serials) {
      const last = inv.lines[inv.lines.length - 1];
      if (last) last.serials.push(...serials);
      return;
    }
    // An item line: code, description, then qty, price, amount; what follows is remark and "Count :N".
    const [code, description = "", ...rest] = filled;
    const nums: number[] = [];
    const extra: string[] = [];
    let count: number | null = null;
    for (const c of rest) {
      const m = c.match(/^count\s*:\s*(\d+)/i);
      if (m) count = Number(m[1]);
      else if (nums.length < 3 && isNum(c)) nums.push(num(c));
      else extra.push(c);
    }
    inv.lines.push({
      code, description, qty: nums[0] ?? 0, unitPrice: nums[1] ?? 0, amount: nums[2] ?? 0,
      remark: extra.join(" ") || null, count, serials: [],
    });
  });
  return out;
}

/** The report writes day first (02/01/2026 is 2 January); Excel may hand over YYYY-MM-DD. */
export function reportDate(raw: string): string | null {
  const v = raw.trim();
  let y: number, m: number, d: number;
  const iso = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  const dmy = v.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (iso) [y, m, d] = [+iso[1], +iso[2], +iso[3]];
  else if (dmy) [y, m, d] = [+dmy[3], +dmy[2], +dmy[1]];
  else return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

/** The IMEI check digit. A serial that is not 15 digits (a MacBook's) is not held to it. */
export function luhnOk(s: string): boolean {
  let sum = 0;
  for (let i = 0; i < s.length; i++) {
    let d = Number(s[s.length - 1 - i]);
    if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return sum % 10 === 0;
}

// --------------------------------------------------------------- plan ----

export type PurchaseImportMaster = {
  suppliers: { id: string; code: string; name: string }[];
  locations: { id: string; code: string; name: string }[];
  items: { id: string; code: string; name: string; tracks_serial: boolean; identity: "IMEI" | "SERIAL" | "OPTIONAL" | "NONE" }[];
  /** Old refs already imported, and IMEIs already on an imported invoice. */
  importedRefs: string[];
  importedSerials: string[];
  /** Units already in the system with a serial this file names, and the item each is. */
  stockSerials: { serial: string; item_code: string }[];
};

export type Mapping = { suppliers: Record<string, string>; locations: Record<string, string> };

/** How a source name met the ERP: exactly, by a guess the user should confirm, or not at all. */
export type Match = { source: string; id: string | null; how: "exact" | "guess" | "none" };

export type Issue = { level: "error" | "review"; field: string; message: string };

export type PlannedLine = SourceLine & { itemId: string | null; itemName: string | null; tracksSerial: boolean; identity: string | null };

export type PlannedInvoice = {
  row: number; oldRef: string; supplierInvoiceNo: string | null;
  date: string | null; rawDate: string; payment: string | null; remark: string | null;
  supplier: Match; location: Match;
  lines: PlannedLine[];
  totals: SourceInvoice["totals"] & { lines: number };
  /** Everything but the supplier and warehouse match, which the reviewer may still change. */
  issues: Issue[];
  alreadyImported: boolean;
};

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

function match(source: string, list: { id: string; code: string; name: string }[], chosen?: string): Match {
  if (chosen && list.some((x) => x.id === chosen)) return { source, id: chosen, how: "exact" };
  const s = norm(source);
  if (!s) return { source, id: null, how: "none" };
  const exact = list.find((x) => norm(x.name) === s || norm(x.code) === s);
  if (exact) return { source, id: exact.id, how: "exact" };
  // "Main Store" → "Main Warehouse": a shared first word is a guess, shown for confirming.
  const word = s.split(" ")[0];
  const guess = list.find((x) => norm(x.name).split(" ")[0] === word) ?? list.find((x) => norm(x.name).includes(s));
  return guess ? { source, id: guess.id, how: "guess" } : { source, id: null, how: "none" };
}

export function planPurchaseImport(source: SourceInvoice[], master: PurchaseImportMaster, mapping: Mapping): PlannedInvoice[] {
  const items = new Map(master.items.map((i) => [norm(i.code), i]));
  const importedRefs = new Set(master.importedRefs.map(norm));
  const importedSerials = new Set(master.importedSerials);
  const stock = new Map(master.stockSerials.map((x) => [x.serial, x.item_code]));
  // Where each IMEI first appears in this file, so a repeat names both invoices.
  const firstSeen = new Map<string, string>();
  const refCount = new Map<string, number>();
  for (const s of source) refCount.set(norm(s.oldRef), (refCount.get(norm(s.oldRef)) ?? 0) + 1);

  return source.map((s) => {
    const issues: Issue[] = [];
    const err = (field: string, message: string) => issues.push({ level: "error", field, message });
    const review = (field: string, message: string) => issues.push({ level: "review", field, message });

    if (!s.oldRef) err("Docid", "The invoice has no Docid.");
    else if (refCount.get(norm(s.oldRef))! > 1) err("Docid", `${s.oldRef} appears more than once in this file.`);
    const date = reportDate(s.rawDate);
    if (!date) err("Date", s.rawDate ? `"${s.rawDate}" is not a date.` : "The invoice has no date.");
    if (s.lines.length === 0) err("Products", "No product lines were found under this invoice.");

    const lines: PlannedLine[] = s.lines.map((l, n) => {
      const it = items.get(norm(l.code));
      const at = `Line ${n + 1} (${l.code})`;
      if (!it) err(at, `No item is coded ${l.code} in the catalogue. Add it, then upload again.`);
      if (!(l.qty > 0)) err(at, "Quantity must be more than zero.");
      if (Math.abs(l.qty * l.unitPrice - l.amount) > Math.max(1, l.amount * 1e-6))
        err(at, `${l.qty} × ${l.unitPrice.toLocaleString("en-US")} is not the amount ${l.amount.toLocaleString("en-US")}.`);
      if (l.count !== null && l.count !== l.serials.length)
        review(at, `The report counts ${l.count} serials; ${l.serials.length} were read.`);
      const kind = it?.identity === "SERIAL" ? "serial numbers" : "IMEIs";
      if (it?.tracks_serial && l.serials.length !== l.qty)
        err(at, `${l.qty} units need ${l.qty} ${kind}; ${l.serials.length} found.`);
      if (it?.identity === "OPTIONAL" && l.serials.length > l.qty)
        err(at, `${l.serials.length} serials for ${l.qty} units.`);
      if (it?.identity === "NONE" && l.serials.length > 0)
        review(at, `${it.code} carries no serial; its ${l.serials.length} will be kept as a note.`);
      for (const x of l.serials) {
        if (it?.identity === "IMEI" && !/^\d{15}$/.test(x)) err(at, `${x} is not an IMEI — an IMEI is 15 digits.`);
        const held = stock.get(x);
        if (held && it && held !== it.code) review(at, `${x} is already in the system as ${held}, not ${it.code}.`);
      }
      const dupInLine = l.serials.filter((x, k) => l.serials.indexOf(x) !== k);
      if (dupInLine.length) err(at, `IMEI ${dupInLine[0]} appears twice on this line.`);
      for (const imei of new Set(l.serials)) {
        if (importedSerials.has(imei)) err(at, `IMEI ${imei} is already on an imported invoice.`);
        const other = firstSeen.get(imei);
        if (other && other !== s.oldRef) err(at, `IMEI ${imei} is also on ${other} in this file.`);
        else firstSeen.set(imei, s.oldRef);
        if (/^\d{15}$/.test(imei) && !luhnOk(imei)) review(at, `IMEI ${imei} fails its check digit — a typo in the old system?`);
      }
      return { ...l, itemId: it?.id ?? null, itemName: it?.name ?? null, tracksSerial: !!it?.tracks_serial, identity: it?.identity ?? null };
    });

    const lineTotal = s.lines.reduce((a, l) => a + l.amount, 0);
    const t = s.totals;
    if (t.invoiceTotal !== null && Math.abs(t.invoiceTotal - lineTotal) > 1)
      err("Invoice total", `Lines add up to ${lineTotal.toLocaleString("en-US")}; the report's total is ${t.invoiceTotal.toLocaleString("en-US")}.`);
    const net = (t.invoiceTotal ?? lineTotal) - t.itemDiscount - t.voucherDiscount;
    if (t.netTotal !== null && Math.abs(t.netTotal - net) > 1)
      review("Net total", `Total less discounts is ${net.toLocaleString("en-US")}; the report says ${t.netTotal.toLocaleString("en-US")}.`);

    return {
      row: s.row, oldRef: s.oldRef, supplierInvoiceNo: s.supplierInvoiceNo, date, rawDate: s.rawDate,
      payment: s.payment, remark: s.remark,
      supplier: match(s.supplier, master.suppliers, mapping.suppliers[s.supplier]),
      location: match(s.location, master.locations, mapping.locations[s.location]),
      lines, totals: { ...t, lines: lineTotal }, issues,
      alreadyImported: importedRefs.has(norm(s.oldRef)),
    };
  });
}

/** The ERP record a source name resolves to: the reviewer's choice, else an exact match. A guess counts only once chosen. */
export const resolved = (m: Match, chosen: Record<string, string>) =>
  chosen[m.source] ?? (m.how === "exact" ? m.id : null);

export type Status = "imported" | "blocked" | "unmapped" | "review" | "ready";

/** Ready to import, needing a look or a choice, or blocked. */
export function invoiceStatus(p: PlannedInvoice, chosen: Mapping): Status {
  if (p.alreadyImported) return "imported";
  if (p.issues.some((i) => i.level === "error")) return "blocked";
  if (!resolved(p.supplier, chosen.suppliers) || !resolved(p.location, chosen.locations)) return "unmapped";
  return p.issues.length ? "review" : "ready";
}
