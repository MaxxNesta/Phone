"use client";
/**
 * The ledger and the outstanding summary as Excel workbooks (2026-11-25):
 * the old reports' layout (township, customer, opening, each entry, totals),
 * dressed like the invoice export: a dark bar a township, an indigo line a
 * customer, figures as numbers so the sheet still adds up.
 */
import type { PartnerLedger, Side, SummaryRow } from "@/lib/partner-ledger";
import { todayLocal } from "@/lib/format";

const DARK = "FF1D1D1F", INDIGO = "FF5856D6", INDIGO_SOFT = "FFEEEEFB", BLUE = "FF0071E3", MUTED = "FF6E6E73", RULE = "FFD1D1D6";
const NUM = "#,##0;[Red]-#,##0";
const nice = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
export const periodText = (from?: string, to?: string) => (from || to ? `${from ? nice(from) : "the start"} to ${to ? nice(to) : "today"}` : "All dates");

type Cell = { font?: unknown; fill?: unknown; border?: unknown; alignment?: unknown; numFmt?: string };
type Row = { eachCell: (o: { includeEmpty: boolean }, f: (c: Cell, n: number) => void) => void; getCell: (n: number) => Cell; height?: number };

async function book(title: string, sub: string, widths: number[]) {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(title.slice(0, 30));
  ws.columns = widths.map((width) => ({ width }));
  const t = ws.addRow([title]); t.font = { bold: true, size: 15 };
  const s = ws.addRow([sub]); s.font = { color: { argb: MUTED } };
  ws.addRow([]);
  return { wb, ws };
}
const paint = (r: Row, cols: number, fill: string | null, font: Record<string, unknown>) => {
  for (let n = 1; n <= cols; n++) {
    const c = r.getCell(n);
    if (fill) c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
    c.font = font;
  }
};
const nums = (r: Row, from: number, to: number, bold = false, color?: string) => {
  for (let n = from; n <= to; n++) {
    const c = r.getCell(n); c.numFmt = NUM; c.alignment = { horizontal: "right" };
    c.font = { bold, ...(color ? { color: { argb: color } } : {}) };
  }
};
const line = (r: Row, from: number, to: number, style: "thin" | "medium" | "double", color = DARK, where: "top" | "bottom" = "top") => {
  for (let n = from; n <= to; n++) r.getCell(n).border = { [where]: { style, color: { argb: color } } };
};
async function save(wb: { xlsx: { writeBuffer: () => Promise<ArrayBuffer> } }, name: string) {
  const buf = await wb.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const a = document.createElement("a"); a.href = url; a.download = `${name}-${todayLocal()}.xlsx`; a.click();
  URL.revokeObjectURL(url);
}

/** The customer or supplier ledger: township, then each partner's opening, entries, running balance and total. */
export async function exportLedger(side: Side, ledger: PartnerLedger, period: string) {
  const cust = side === "CUSTOMER";
  const COLS = 8;
  const { wb, ws } = await book(cust ? "Customer ledger" : "Supplier ledger", `${period} · ${ledger.length} ${cust ? "customers" : "suppliers"} · exported ${nice(todayLocal())}`,
    [13, 12, 17, 14, 34, 17, 17, 17]);
  const head = ws.addRow(["Date", "Type", "Document", "Old ref", "Description", "Increase", "Decrease", "Balance"]) as unknown as Row;
  paint(head, COLS, null, { bold: true, color: { argb: "FF3A3A3C" } });
  line(head, 1, COLS, "medium", DARK, "bottom");
  [6, 7, 8].forEach((n) => { head.getCell(n).alignment = { horizontal: "right" }; });
  // The whole first as well as last, so it is seen before scrolling.
  const top = ws.addRow(["", "", "", "", `Grand total · ${ledger.length} ${cust ? "customers" : "suppliers"}`,
    ledger.reduce((t, g) => t + g.charges, 0), ledger.reduce((t, g) => t + g.settles, 0), ledger.reduce((t, g) => t + g.closing, 0)]) as unknown as Row;
  top.getCell(5).font = { bold: true }; top.getCell(5).alignment = { horizontal: "right" };
  nums(top, 6, 8, true); line(top, 5, 8, "medium", DARK, "bottom");

  const towns = cust ? [...new Set(ledger.map((g) => g.township ?? ""))] : [null];
  const all = { c: 0, s: 0, b: 0 };
  for (const town of towns) {
    const gs = cust ? ledger.filter((g) => (g.township ?? "") === town) : ledger;
    if (cust) {
      ws.addRow([]);
      const bar = ws.addRow([`Township : ${town || "No township"}`]) as unknown as Row;
      paint(bar, COLS, DARK, { bold: true, size: 12, color: { argb: "FFFFFFFF" } }); bar.height = 20;
    }
    const t = { c: 0, s: 0, b: 0 };
    for (const g of gs) {
      const h = ws.addRow([g.code, g.name]) as unknown as Row;
      paint(h, COLS, INDIGO_SOFT, { bold: true, color: { argb: INDIGO } });
      const o = ws.addRow(["", "Opening", "", "", "", "", "", g.opening]) as unknown as Row;
      o.getCell(2).font = { color: { argb: MUTED } }; nums(o, 8, 8);
      for (const r of g.rows) {
        const x = ws.addRow([nice(r.date), r.kind, r.docNo ?? r.entryNo, r.oldRef ?? "", r.description, r.charge || null, r.settle || null, r.balance]) as unknown as Row;
        nums(x, 6, 8);
        x.getCell(5).font = { color: { argb: MUTED } };
      }
      const tot = ws.addRow(["", "", "", "", `Total ${g.name}`, g.charges, g.settles, g.closing]) as unknown as Row;
      tot.getCell(5).font = { bold: true }; tot.getCell(5).alignment = { horizontal: "right" };
      nums(tot, 6, 8, true); line(tot, 5, 8, "thin");
      t.c += g.charges; t.s += g.settles; t.b += g.closing;
    }
    if (cust) {
      const tt = ws.addRow(["", "", "", "", `Total ${town || "No township"}`, t.c, t.s, t.b]) as unknown as Row;
      tt.getCell(5).font = { bold: true, color: { argb: BLUE } }; tt.getCell(5).alignment = { horizontal: "right" };
      nums(tt, 6, 8, true, BLUE); line(tt, 5, 8, "medium", BLUE);
    }
    all.c += t.c; all.s += t.s; all.b += t.b;
  }
  ws.addRow([]);
  const g = ws.addRow(["", "", "", "", "Total", all.c, all.s, all.b]) as unknown as Row;
  g.getCell(5).font = { bold: true, size: 12 }; g.getCell(5).alignment = { horizontal: "right" };
  nums(g, 6, 8, true); line(g, 5, 8, "double", DARK, "bottom");
  (ws as unknown as { views: unknown[] }).views = [{ state: "frozen", ySplit: 5 }];
  await save(wb as never, cust ? "customer-ledger" : "supplier-ledger");
}

/** The outstanding summary: a line a partner, by township with its total, then the whole. */
export async function exportSummary(side: Side, rows: SummaryRow[], period: string, showOther: boolean) {
  const cust = side === "CUSTOMER";
  const keys = ["opening", "sale", "returned", "discount", "payment", ...(showOther ? ["other"] : []), "prepaid", "balance"] as (keyof SummaryRow)[];
  const labels = ["Opening", cust ? "Sale" : "Purchase", "Return", "Disc + FOC", "Payment", ...(showOther ? ["Other"] : []), "Prepaid", "Balance"];
  const COLS = 3 + keys.length;
  const { wb, ws } = await book(cust ? "Customer outstanding summary" : "Supplier outstanding summary",
    `${period} · ${rows.length} ${cust ? "customers" : "suppliers"} · exported ${nice(todayLocal())}`, [6, 10, 30, ...keys.map(() => 17)]);
  const head = ws.addRow(["Sr.", "Code", cust ? "Customer" : "Supplier", ...labels]) as unknown as Row;
  paint(head, COLS, null, { bold: true, color: { argb: "FF3A3A3C" } });
  line(head, 1, COLS, "medium", DARK, "bottom");
  for (let n = 4; n <= COLS; n++) head.getCell(n).alignment = { horizontal: "right" };

  const sum = (rs: SummaryRow[]) => keys.map((k) => rs.reduce((t, r) => t + Number(r[k]), 0));
  const towns = cust ? [...new Set(rows.map((r) => r.township ?? ""))] : [null];
  let sr = 0;
  for (const town of towns) {
    const rs = cust ? rows.filter((r) => (r.township ?? "") === town) : rows;
    if (cust) {
      const bar = ws.addRow([`Township : ${town || "No township"}`]) as unknown as Row;
      paint(bar, COLS, DARK, { bold: true, size: 12, color: { argb: "FFFFFFFF" } }); bar.height = 20;
    }
    for (const r of rs) {
      const x = ws.addRow([++sr, r.code, r.name, ...keys.map((k) => Number(r[k]))]) as unknown as Row;
      nums(x, 4, COLS);
      x.getCell(1).font = { color: { argb: MUTED } };
      line(x, 1, COLS, "thin", RULE, "bottom");
    }
    if (cust) {
      const tt = ws.addRow(["", "", `${town || "No township"} total`, ...sum(rs)]) as unknown as Row;
      tt.getCell(3).font = { bold: true, color: { argb: BLUE } };
      nums(tt, 4, COLS, true, BLUE); line(tt, 3, COLS, "medium", BLUE);
      ws.addRow([]);
    }
  }
  const g = ws.addRow(["", "", "Total", ...sum(rows)]) as unknown as Row;
  g.getCell(3).font = { bold: true, size: 12 };
  nums(g, 4, COLS, true); line(g, 3, COLS, "double", DARK, "bottom");
  (ws as unknown as { views: unknown[] }).views = [{ state: "frozen", ySplit: 4 }];
  await save(wb as never, cust ? "customer-outstanding-summary" : "supplier-outstanding-summary");
}
