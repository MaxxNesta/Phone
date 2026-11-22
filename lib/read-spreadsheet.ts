import { checkSpreadsheet, checkRowCount } from "./upload-limits";
import ExcelJS from "exceljs";

/**
 * Turning an uploaded file into rows of text.
 *
 * Server-side only. exceljs is a Node library and must not reach a browser
 * bundle; this module is imported solely from lib/actions.ts, which is
 * "use server", so it never does. Deliberately not marked with the
 * `server-only` package: that throws on import outside a Next.js request,
 * which would make this module impossible to test from a script, and the
 * bundling is verified against the build output instead.
 *
 * Reading .xlsx directly rather than asking for a CSV is not a convenience.
 * A 13-digit barcode is stored in the workbook as an exact number and only
 * *displayed* as 8.85123E+12; it is the save-as-CSV step that can write the
 * display out and lose the digits for good. Opening the workbook gets the
 * stored value, so the round trip that damages barcodes never happens.
 *
 * What it cannot rescue: a barcode typed into a numeric cell loses any
 * leading zeros before the file is ever saved, and anything past fifteen
 * significant digits is already rounded. Both are Excel deciding the value is
 * a quantity rather than a label, and the only cure is formatting the column
 * as Text. Hence the instruction on the upload screen either way.
 */
export type UploadFormat = "csv" | "xlsx";

/** How a cell reads once it is text. Dates and formulas are flattened to what
 *  a person would see, since every column here is a name, a code or a number. */
function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value instanceof Date) return value.toISOString().slice(0, 10);

  const v = value as Record<string, unknown>;
  // A formula cell carries both the formula and its last computed result.
  if ("result" in v) return cellText(v.result);
  // Rich text arrives as runs that have to be joined back together.
  if ("richText" in v && Array.isArray(v.richText)) {
    return (v.richText as { text?: string }[]).map((r) => r.text ?? "").join("").trim();
  }
  if ("text" in v) return cellText(v.text);
  if ("hyperlink" in v && "text" in v) return cellText(v.text);
  return String(value).trim();
}

/** allSheets: every sheet's rows one after another — a report may run over several. */
export async function xlsxToRows(base64: string, allSheets = false): Promise<string[][]> {
  checkSpreadsheet(base64, "xlsx");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(base64, "base64") as unknown as ArrayBuffer);

  if (!wb.worksheets[0]) throw new Error("That workbook has no sheets in it.");

  const rows: string[][] = [];
  let width = 0;
  const sheets = allSheets ? wb.worksheets : wb.worksheets.slice(0, 1);
  checkRowCount({ length: sheets.reduce((t, s) => t + s.actualRowCount, 0) } as unknown[]);
  for (const sheet of sheets) sheet.eachRow({ includeEmpty: false }, (row) => {
    const cells: string[] = [];
    // includeEmpty keeps blank cells in place; without it a row with a gap
    // would shift every later value one column to the left, silently into
    // the wrong field.
    row.eachCell({ includeEmpty: true }, (cell) => cells.push(cellText(cell.value)));
    width = Math.max(width, cells.length);
    rows.push(cells);
  });

  // Pad short rows so the header's column positions hold for every row.
  for (const r of rows) while (r.length < width) r.push("");

  return rows.filter((r) => r.some((c) => c !== ""));
}

/** Column widths that make the template readable without fiddling. */
const TEMPLATE_WIDTHS = [5, 20, 14, 34, 20, 20, 18, 14, 14];

/**
 * A blank import workbook with the Barcode column already formatted as Text.
 *
 * Formatting it here is what stops the barcode problem happening at all. Left
 * to Excel's own judgement a 13-digit barcode becomes a number, loses any
 * leading zero and rounds past fifteen digits, and by the time the file is
 * uploaded the original is gone. A template that arrives correct is worth
 * more than an instruction the user has to remember.
 */
/** The kinds of shop a template can be drawn for: example rows that look like their own catalogue. */
export const IMPORT_INDUSTRIES = {
  phone: "Phone and electronics shop",
  apparel: "Clothing and shoes",
  optical: "Optical shop",
  parts: "Spare parts",
  general: "General retail or grocery",
} as const;
export type ImportIndustry = keyof typeof IMPORT_INDUSTRIES;

type Example = Record<string, string | number>;
/*
 * Example rows per industry, by column. Option keys (Storage, Color, Size…)
 * land in this company's own option column with that name or code, and are
 * dropped where it has none. Rows with a Model are variants of that model.
 */
const EXAMPLES: Record<ImportIndustry, Example[]> = {
  phone: [
    { "Model": "iPhone 16 Pro", "Model Code": "IP16P", "Category": "iPhone", "Brand": "Apple", "Unit": "PCS", "Storage": "256GB", "Color": "Black", "Selling price": 4200000 },
    { "Model": "iPhone 16 Pro", "Model Code": "IP16P", "Category": "iPhone", "Brand": "Apple", "Unit": "PCS", "Storage": "256GB", "Color": "White", "Selling price": 4200000 },
    { "Model": "iPhone 16 Pro", "Model Code": "IP16P", "Category": "iPhone", "Brand": "Apple", "Unit": "PCS", "Storage": "512GB", "Color": "Black", "Selling price": 4900000 },
    { "Barcode": "6941487812345", "Stock ID": "AKN45W", "Stock Name": "Anker Nano 45W Charger", "Category": "Accessories", "Brand": "Anker", "Unit": "PCS", "Selling price": 95000 },
  ],
  apparel: [
    { "Model": "Basic T-shirt", "Model Code": "TS01", "Category": "Apparel", "Unit": "PCS", "Size": "M", "Color": "Black", "Selling price": 18000 },
    { "Model": "Basic T-shirt", "Model Code": "TS01", "Category": "Apparel", "Unit": "PCS", "Size": "L", "Color": "Black", "Selling price": 18000 },
    { "Model": "Runner Sneaker", "Model Code": "SN01", "Category": "Footwear", "Unit": "PAIR", "Size": "42", "Color": "White", "Selling price": 65000 },
    { "Barcode": "8851234500017", "Stock ID": "SOCK-3P", "Stock Name": "Socks 3-pack", "Category": "Apparel", "Unit": "PACK", "Selling price": 6000 },
  ],
  optical: [
    { "Model": "Aviator Frame", "Model Code": "FR-AV", "Category": "Frames", "Unit": "PCS", "Size": "54", "Color": "Gold", "Selling price": 85000 },
    { "Model": "Aviator Frame", "Model Code": "FR-AV", "Category": "Frames", "Unit": "PCS", "Size": "58", "Color": "Gold", "Selling price": 85000 },
    { "Stock ID": "LENS-SV156", "Stock Name": "Single vision lens 1.56", "Category": "Lenses", "Unit": "PAIR", "Selling price": 30000 },
    { "Barcode": "8851234500024", "Stock ID": "CLN-60", "Stock Name": "Lens cleaner 60ml", "Category": "Accessories", "Unit": "PCS", "Selling price": 5000 },
  ],
  parts: [
    { "Stock ID": "SCR-IP13-OLED", "Stock Name": "iPhone 13 screen OLED", "Category": "Screens", "Unit": "PCS", "Selling price": 180000 },
    { "Stock ID": "BAT-IP12", "Stock Name": "iPhone 12 battery", "Category": "Batteries", "Unit": "PCS", "Selling price": 45000 },
    { "Barcode": "8851234500031", "Stock ID": "GLUE-B7000", "Stock Name": "B-7000 glue 15ml", "Category": "Tools", "Unit": "PCS", "Selling price": 3000 },
  ],
  general: [
    { "Barcode": "8851234567890", "Stock ID": "Item001", "Stock Name": "Coca-Cola 300ml", "Category": "Beverages", "Sub Category": "Soft Drinks", "Brand": "Coca-Cola", "Unit": "Bottle", "Selling price": 1200 },
    { "Barcode": "8851234567891", "Stock ID": "Item002", "Stock Name": "Sprite 300ml", "Category": "Beverages", "Sub Category": "Soft Drinks", "Brand": "Sprite", "Unit": "Bottle" },
    { "Stock ID": "RICE-25", "Stock Name": "Rice 25kg (own packing)", "Category": "Grocery", "Unit": "Bag", "Selling price": 78000 },
  ],
};

const BASE_COLUMNS = ["No", "Barcode", "Stock ID", "Stock Name", "Category", "Sub Category", "Brand", "Unit", "Selling price"];

/**
 * The header and example rows for one industry. `options` are this company's
 * variant attributes (Storage, Color…): each becomes a column, after Model
 * and Model Code. A company with none gets the plain sheet.
 */
export function importTemplateRows(industry: ImportIndustry, options: { name: string; code: string }[]) {
  const variantCols = options.length ? ["Model", "Model Code", ...options.map((o) => o.name)] : [];
  const header = [...BASE_COLUMNS, ...variantCols];
  const n = (s: string) => s.trim().toLowerCase().replace("colour", "color");
  const colFor = (key: string) => {
    if (header.includes(key)) return key;
    const o = options.find((x) => n(x.name) === n(key) || n(x.code) === n(key)
      || (n(key) === "color" && n(x.code) === "col") || (n(key) === "storage" && n(x.code) === "sto"));
    return o?.name ?? null;
  };
  const examples = EXAMPLES[industry]
    .filter((e) => options.length || !e["Model"])
    .map((e, i) => {
      const row = header.map(() => "" as string | number);
      row[0] = i + 1;
      for (const [k, v] of Object.entries(e)) {
        const c = colFor(k);
        if (c) row[header.indexOf(c)] = v;
      }
      return row;
    });
  return { header, examples };
}

export async function buildImportTemplate(industry: ImportIndustry = "general",
  options: { name: string; code: string }[] = []): Promise<string> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "ERP";
  const ws = wb.addWorksheet("Items");
  const { header, examples } = importTemplateRows(industry, options);

  ws.addRow(header);
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  header.forEach((_, i) => { ws.getColumn(i + 1).width = TEMPLATE_WIDTHS[i] ?? 14; });

  // '@' is Excel's text format. Applied to the whole column so it holds for
  // rows the user adds later, not only the examples below. Stock ID gets it
  // for the same reason as Barcode: a Stock ID of "0012" is not the number
  // twelve, and losing the leading zeros changes the item's code.
  ws.getColumn(2).numFmt = "@";
  ws.getColumn(3).numFmt = "@";

  for (const e of examples) {
    const r = ws.addRow(e);
    r.getCell(2).numFmt = "@";
    r.getCell(3).numFmt = "@";
    r.font = { italic: true, color: { argb: "FF888888" } };
  }

  const note = ws.addRow([]);
  note.getCell(1).value =
    "Delete the grey example rows before uploading. Category, Brand and Unit must already " +
    "exist in the ERP, but any the sheet names can be registered from the preview before " +
    "importing. Sub Category and Brand may be left blank. " +
    "Stock ID is the item's own piece of its code; leave it blank to be given the next number. " +
    (options.length
      ? "Variants: rows with the same Model in the same category become one product, one row per " +
        "variant, with its options in the option columns (" + options.map((o) => o.name).join(", ") + "). " +
        "Options must exist under Settings, Variants. Model Code numbers the variants (IP16P001, IP16P002 and so on); " +
        "leave Stock Name blank to name each variant from its model and options. A model already here gets " +
        "the new variants added. "
      : "") +
    "One row per item: this sheet sets up what the items ARE, and carries no quantity, cost or " +
    "warehouse; stock arrives on a goods receipt, or on a stock adjustment for opening balances.";
  ws.mergeCells(`A${note.number}:H${note.number}`);
  note.getCell(1).alignment = { wrapText: true, vertical: "top" };
  note.height = 96;

  return Buffer.from(await wb.xlsx.writeBuffer()).toString("base64");
}


/**
 * A blank receipt workbook whose columns are the fields the receipt screen
 * asks for, in the order it asks for them. Someone who has entered one
 * receipt by hand should recognise the sheet without being taught it.
 */
export async function buildVoucherTemplate(columns: string[], kind: "cash" | "bank"): Promise<string> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "ERP";
  const ws = wb.addWorksheet(kind === "cash" ? "Cash receipts" : "Bank receipts");

  ws.addRow(columns);
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  [5, 14, 24, 26, 14, 18, 20, 34].forEach((w, i) => { ws.getColumn(i + 1).width = w; });

  // Dates as text, so Excel cannot reformat one into a shape the sheet did
  // not intend — and the importer refuses an ambiguous 03/04/2026 anyway.
  ws.getColumn(2).numFmt = "@";

  const money = kind === "cash" ? "Cash on Hand" : "Cash at Bank";
  const examples = [
    [1, "2026-09-02", money, "Other Income", 150000, "Yangon Branch", "RCP-001", "Scrap sale"],
    [2, "2026-09-02", money, "Other Income", 42000, "Mandalay Branch", "RCP-002", "Rent recovered"],
  ];
  for (const e of examples) {
    const r = ws.addRow(e);
    r.getCell(2).numFmt = "@";
    r.font = { italic: true, color: { argb: "FF888888" } };
  }

  const note = ws.addRow([]);
  note.getCell(1).value =
    "Delete the two grey example rows before uploading. One row is one receipt. Dates as YYYY-MM-DD. " +
    "Received From must be an account in the chart that can be posted to — not a heading, and not " +
    "Accounts Receivable, which is maintained by the sales ledger: record money from a customer " +
    "against their invoice instead. Branch may be left blank, but then the receipt appears in no " +
    "branch's figures.";
  ws.mergeCells(`A${note.number}:H${note.number}`);
  note.getCell(1).alignment = { wrapText: true, vertical: "top" };
  note.height = 56;

  return Buffer.from(await wb.xlsx.writeBuffer()).toString("base64");
}
