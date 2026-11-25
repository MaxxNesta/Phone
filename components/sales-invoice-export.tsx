"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { FileSpreadsheet } from "lucide-react";
import { salesExportIds, salesExportBatch, type ExportInvoice } from "@/lib/sales-invoice-export";
import { purchaseExportIds, purchaseExportBatch } from "@/lib/purchase-invoice-export";
import { notify } from "@/components/toast";
import { todayLocal } from "@/lib/format";

const BATCH = 50;

type Kind = "sales" | "purchase";
const SOURCE = {
  sales: { ids: salesExportIds, batch: salesExportBatch },
  purchase: { ids: purchaseExportIds, batch: purchaseExportBatch },
};

/**
 * Sales Report [Each Invoice]: every invoice the list is showing (its search,
 * channel, dates, status and customer), each as a block with its lines, its
 * IMEIs or serials under each line, and its money below. Progress shows while
 * the details come in; a popup says when the file is ready.
 */
export function SalesInvoiceExport() { return <InvoiceExport kind="sales" />; }

/** Purchase Report [Each Invoice]: the same, for the bills the purchase list is showing (2026-11-25). */
export function PurchaseInvoiceExport() { return <InvoiceExport kind="purchase" />; }

function InvoiceExport({ kind }: { kind: Kind }) {
  const sp = useSearchParams();
  const [progress, setProgress] = useState<{ done: number; total: number; stage: string } | null>(null);

  async function run() {
    try {
      setProgress({ done: 0, total: 0, stage: "Finding invoices" });
      const params = Object.fromEntries([...sp.entries()].filter(([k]) => !["page", "size", "sort", "dir"].includes(k)));
      const ids = await SOURCE[kind].ids(params);
      if (ids.length === 0) { notify("info", "No posted invoices match these filters."); return; }
      const all: ExportInvoice[] = [];
      for (let i = 0; i < ids.length; i += BATCH) {
        setProgress({ done: i, total: ids.length, stage: "Reading invoices" });
        all.push(...await SOURCE[kind].batch(ids.slice(i, i + BATCH)));
      }
      setProgress({ done: ids.length, total: ids.length, stage: "Building the workbook" });
      await buildWorkbook(all, params, kind);
      notify("success", `${all.length} invoice${all.length === 1 ? "" : "s"} exported with their lines, IMEIs and totals.`, "Export ready");
    } catch (e) {
      notify("error", e instanceof Error ? e.message : String(e), "Export failed");
    } finally {
      setProgress(null);
    }
  }

  const pct = progress && progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
  return (
    <>
      <button type="button" className="dt-tool" onClick={run} disabled={!!progress}>
        <FileSpreadsheet size={15} aria-hidden="true" /> {progress ? "Exporting…" : "Export details"}
      </button>
      {progress && (
        <div className="sie-progress" role="status" aria-live="polite">
          <div className="pimp-progress">
            <div className="pimp-progress-t">
              <strong>{progress.stage}{progress.total ? ` · ${Math.min(progress.done + BATCH, progress.total)} of ${progress.total}` : ""}</strong>
              <span className="pimp-progress-n">{progress.total ? `${pct}%` : ""}</span>
            </div>
            <div className={`pimp-progress-track${progress.total ? "" : " indeterminate"}`}><span style={{ width: `${pct}%` }} /></div>
          </div>
        </div>
      )}
    </>
  );
}

/* ------------------------------------------------------------- workbook -- */

const DARK = "FF1D1D1F", SOFT = "FFF2F2F7", RULE = "FFD1D1D6", MUTED = "FF6E6E73", BLUE = "FF0071E3";
const fmtDate = (d: string) => new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });

async function buildWorkbook(invoices: ExportInvoice[], params: Record<string, string>, kind: Kind) {
  const buying = kind === "purchase";
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Each invoice");
  const COLS = 6; // Code | Description | Qty | Sale price | Amount | Type
  ws.columns = [{ width: 14 }, { width: 46 }, { width: 9 }, { width: 15 }, { width: 17 }, { width: 16 }];
  const money = (c: { numFmt?: string; alignment?: unknown }) => { c.numFmt = "#,##0.##"; (c as any).alignment = { horizontal: "right" }; };
  const span = (r: { number: number }, from = 1, to = COLS) => ws.mergeCells(r.number, from, r.number, to);

  const t = ws.addRow([buying ? "Purchase report · each invoice" : "Sales report · each invoice"]); t.font = { bold: true, size: 15 };
  const period = params.dfrom || params.dto ? `${params.dfrom ? fmtDate(params.dfrom) : "start"} to ${params.dto ? fmtDate(params.dto) : "today"}`
    : params.dp ? `Period: ${params.dp}` : "All dates";
  const sub = ws.addRow([`${period} · ${invoices.length} invoices · exported ${fmtDate(todayLocal())}`]);
  sub.font = { color: { argb: MUTED } };
  ws.addRow([]);

  for (const inv of invoices) {
    // Start of the invoice: a dark bar. The labels are the old report's
    // ("Docid :", "Date :", "Payment :", "Customer :"…), cell by cell, so the
    // sales import reads this file back the way it reads the old software's.
    const ymd = inv.date.split("-");
    const bar = ws.addRow([`Docid : ${inv.docNo}`, `Date : ${ymd[2]}/${ymd[1]}/${ymd[0]}`, "", "", "",
      `Payment : ${inv.channel ? `${inv.payment} · ${inv.channel}` : inv.payment}`]);
    bar.eachCell({ includeEmpty: true }, (c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: DARK } }; c.font = { bold: true, color: { argb: "FFFFFFFF" } }; });
    bar.getCell(COLS).alignment = { horizontal: "right" };
    bar.height = 20;
    // Who and where, on one soft line.
    // A bill's labels are the old purchase report's: Supplier, InvoiceNo (the bill's Ref / order ID), Remark (its note).
    const who = ws.addRow(buying ? [
      `Supplier : ${inv.customer ?? ""}`,
      inv.customerCode ? `Supplier code : ${inv.customerCode}` : "",
      `Location : ${inv.location ?? ""}`, `InvoiceNo : ${inv.reference ?? ""}`, "",
      inv.memo ? `Remark : ${inv.memo}` : "",
    ] : [
      `Customer : ${inv.customer ?? "Walk-in"}`,
      inv.customerCode ? `Customer code : ${inv.customerCode}` : "",
      `Location : ${inv.location ?? ""}`, `Salesmen : ${inv.salesman ?? ""}`, "",
      inv.reference ? `Remark : ${inv.reference}` : "",
    ]);
    who.eachCell({ includeEmpty: true }, (c) => {
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: SOFT } };
      c.font = { color: { argb: "FF3A3A3C" } };
    });

    const head = ws.addRow(["Code", "Description", "Qty", buying ? "Cost" : "Sale price", "Amount", "Type"]);
    head.eachCell((c, n) => {
      c.font = { bold: true, color: { argb: "FF3A3A3C" } };
      c.border = { bottom: { style: "thin", color: { argb: RULE } } };
      if (n >= 3 && n <= 5) c.alignment = { horizontal: "right" };
    });

    for (const l of inv.lines) {
      const r = ws.addRow([l.code, l.name, l.qty, l.price, l.amount, l.foc ? `FOC · ${l.foc}` : ""]);
      [3, 4, 5].forEach((n) => money(r.getCell(n)));
      if (l.serials.length) {
        // The units under their line, as the old report printed them: the codes alone, which is how the import knows them.
        const s = ws.addRow(["", l.serials.join(", ")]);
        span(s, 2, COLS);
        s.getCell(2).font = { size: 9, color: { argb: BLUE } };
        s.getCell(2).alignment = { wrapText: true, vertical: "top" };
        s.height = Math.min(90, 14 * Math.ceil(l.serials.length / 4));
      }
    }

    // End of the invoice: the money, every field shown, zero where nothing.
    const T = inv.totals;
    const sums: [string, number, boolean?][] = [
      ["Invoice Total", T.invoiceTotal, true], ["Item Discount", T.itemDiscount], ["Voucher Discount", T.voucherDiscount],
      ["Tax", T.tax], [buying ? "Net Total" : "Net Amount", T.net, true], ["Advance Pay", T.advance], ["Paid Amount", T.paid],
      [buying ? "Returned / debited" : "Returned / credited", T.credited], ["Balance", T.balance, true],
    ];
    sums.forEach(([label, value, strong], i) => {
      const r = ws.addRow(["", "", i === 0 ? T.qty : "", label, value, ""]);
      const lab = r.getCell(4), val = r.getCell(5);
      lab.font = { bold: !!strong }; lab.alignment = { horizontal: "right" };
      val.font = { bold: !!strong }; money(val);
      if (i === 0) { money(r.getCell(3)); r.getCell(3).font = { bold: true };
        [3, 4, 5].forEach((n) => { r.getCell(n).border = { top: { style: "thin", color: { argb: "FF8E8E93" } } }; }); }
      if (label === "Net Amount" || label === "Net Total") [4, 5].forEach((n) => { r.getCell(n).border = { top: { style: "thin", color: { argb: RULE } } }; });
      if (label === "Balance") [4, 5].forEach((n) => { r.getCell(n).border = { top: { style: "thin", color: { argb: RULE } }, bottom: { style: "double", color: { argb: DARK } } }; });
    });
    if (inv.memo && !buying) { const m = ws.addRow(["", `Note: ${inv.memo}`]); span(m, 2, COLS); m.getCell(2).font = { italic: true, color: { argb: MUTED } }; }
    ws.addRow([]);
  }

  // The whole period at the foot.
  const g = invoices.reduce((s, i) => ({ net: s.net + i.totals.net, paid: s.paid + i.totals.paid + i.totals.advance, bal: s.bal + i.totals.balance }), { net: 0, paid: 0, bal: 0 });
  for (const [label, v] of [["All invoices · net", g.net], [buying ? "Paid (paid + advance)" : "Received (paid + advance)", g.paid], [buying ? "Still to pay" : "Still owed", g.bal]] as const) {
    const r = ws.addRow(["", "", "", label, v, ""]);
    r.getCell(4).font = { bold: true }; r.getCell(4).alignment = { horizontal: "right" };
    r.getCell(5).font = { bold: true }; money(r.getCell(5));
  }
  ws.views = [{ state: "frozen", ySplit: 3 }];
  ws.pageSetup = { orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0 };

  const buf = await wb.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const a = document.createElement("a");
  a.href = url; a.download = `${kind}-each-invoice-${todayLocal()}.xlsx`; a.click();
  URL.revokeObjectURL(url);
}
