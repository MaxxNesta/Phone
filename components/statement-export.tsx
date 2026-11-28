"use client";
import { useState } from "react";
import { FileSpreadsheet } from "lucide-react";
import type { StatementDoc } from "@/lib/statement-doc";
import { todayLocal } from "@/lib/format";

/**
 * A statement as an Excel workbook laid out like an official document
 * (2026-11-28): black on white, the company and statement on top, sections in
 * capitals, main heads bold, what makes them up indented under them, totals
 * ruled above, the bottom line ruled twice. Figures stay numbers, negatives in
 * brackets, so the sheet still adds up.
 */
const NUM = '#,##0;(#,##0);"–"';
const BLACK = "FF000000";
const thin = { style: "thin", color: { argb: BLACK } } as const;

export async function exportStatement(doc: StatementDoc) {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(doc.title.slice(0, 30), {
    pageSetup: { orientation: doc.wide ? "landscape" : "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 },
    views: [{ showGridLines: false }],
  });
  const n = doc.columns.length;
  ws.columns = [{ width: 48 }, ...doc.columns.map(() => ({ width: 17 }))];
  const font = (bold = false, size = 10, italic = false) => ({ name: "Arial", size, bold, italic, color: { argb: BLACK } });
  const put = (values: (string | number | null)[], f = font()) => {
    const r = ws.addRow(values);
    r.eachCell({ includeEmpty: true }, (c) => { c.font = f; });
    return r;
  };

  // The title block, centred over the whole width.
  const title = (text: string, f: ReturnType<typeof font>) => {
    const r = put([text], f);
    ws.mergeCells(r.number, 1, r.number, n + 1);
    r.getCell(1).alignment = { horizontal: "center" };
  };
  title(doc.company, font(true, 14));
  title(doc.title, font(true, 12));
  for (const l of doc.lines) title(l, font(false, 10));
  title(`(Amounts in ${doc.currency})`, font(false, 9, true));
  ws.addRow([]);

  const head = put(["", ...doc.columns], font(true));
  head.eachCell({ includeEmpty: true }, (c, i) => {
    c.border = { top: thin, bottom: thin };
    if (i > 1) c.alignment = { horizontal: "right" };
  });
  ws.views = [{ state: "frozen", ySplit: head.number, showGridLines: false }];

  let first = true;
  for (const r of doc.rows) {
    if (r.level === 1 && r.kind === "head" && !first) ws.addRow([]);
    first = false;
    const label = r.level === 1 && r.kind === "head" ? r.label.toUpperCase() : r.label;
    const bold = r.kind !== "line" || r.level === 1;
    const x = put([label, ...(r.kind === "head" ? [] : r.values)], font(bold, r.kind === "grand" ? 11 : 10));
    x.getCell(1).alignment = { indent: r.level === 1 ? 0 : r.level === 2 ? 1 : 3 };
    for (let i = 2; i <= n + 1; i++) {
      const c = x.getCell(i);
      c.numFmt = NUM;
      c.alignment = { horizontal: "right" };
      if (r.kind === "total") c.border = { top: thin };
      if (r.kind === "grand") c.border = { top: thin, bottom: { style: "double", color: { argb: BLACK } } };
    }
  }

  const buf = await wb.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const a = document.createElement("a");
  a.href = url; a.download = `${doc.file}-${todayLocal()}.xlsx`; a.click();
  URL.revokeObjectURL(url);
}

export function StatementExportButton({ doc, className = "erp-hbtn noprint" }: { doc: StatementDoc; className?: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <button type="button" className={className} disabled={busy}
            onClick={async () => { setBusy(true); try { await exportStatement(doc); } finally { setBusy(false); } }}>
      <FileSpreadsheet size={15} aria-hidden="true" /> {busy ? "Exporting…" : "Export"}
    </button>
  );
}
