"use client";

import { useState } from "react";
import { Download, FileSpreadsheet } from "lucide-react";
import { todayLocal } from "@/lib/format";
import { csvCell } from "@/lib/csv";

/**
 * A report exported in blocks: one per account (or per entry), each with a
 * clear start and end, so the file reads like the screen and not as one
 * plain list (owner, 2026-11-23).
 *
 * Excel gets the look: a dark header bar per block, a grey column header,
 * bold totals, a double rule under the last line, a blank row between.
 * CSV cannot hold colour, so each block opens with its title row and closes
 * with an "End of …" row instead.
 */
export type ExportBlock = {
  /** "1310 · Inventory" */
  title: string;
  /** Right of the title: "Opening 0 · Closing 319,850 Dr". */
  note?: string;
  rows: (string | number)[][];
  /** Total, Opening, Closing… bold, under the lines. */
  foot?: (string | number)[][];
};

type Sheet = { name: string; title: string; subtitle?: string; head: string[]; blocks: ExportBlock[] };

const stamp = () => `Exported ${todayLocal()}`;

export function downloadBlocksCsv(s: Sheet) {
  const out: (string | number)[][] = [[s.title], [s.subtitle ?? stamp()], []];
  for (const b of s.blocks) {
    out.push([b.note ? `${b.title}   (${b.note})` : b.title]);
    out.push(s.head);
    out.push(...b.rows, ...(b.foot ?? []));
    out.push([`End of ${b.title}`], []);
  }
  const text = out.map((r) => r.map((c) => csvCell(String(c))).join(",")).join("\n");
  // The BOM lets Excel read Myanmar text as UTF-8.
  save(new Blob(["﻿" + text], { type: "text/csv;charset=utf-8" }), `${s.name}-${todayLocal()}.csv`);
}

export async function downloadBlocksXlsx(s: Sheet) {
  // Loaded on the click, not with the page: it is large and most visits never export.
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(s.title.slice(0, 31).replace(/[\\/?*[\]:]/g, " "));
  const cols = s.head.length;
  const isNum = (v: unknown) => typeof v === "number";

  const t = ws.addRow([s.title]);
  t.font = { bold: true, size: 14 };
  const sub = ws.addRow([s.subtitle ?? stamp()]);
  sub.font = { color: { argb: "FF6E6E73" } };
  ws.addRow([]);

  for (const b of s.blocks) {
    // The block's start: a dark bar across the sheet, the note at its right.
    const bar = ws.addRow([b.title, ...Array(cols - 2).fill(""), b.note ?? ""]);
    ws.mergeCells(bar.number, 1, bar.number, Math.max(1, cols - 1));
    bar.eachCell({ includeEmpty: true }, (c) => {
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1D1D1F" } };
      c.font = { bold: true, color: { argb: "FFFFFFFF" } };
    });
    bar.getCell(cols).alignment = { horizontal: "right" };
    bar.height = 20;

    const head = ws.addRow(s.head);
    // A heading over figures sits right, over its numbers.
    const numCol = (n: number) => [...b.rows, ...(b.foot ?? [])].some((r) => typeof r[n - 1] === "number");
    head.eachCell((c, n) => {
      if (numCol(n)) c.alignment = { horizontal: "right" };
      c.font = { bold: true, color: { argb: "FF3A3A3C" } };
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF2F2F7" } };
      c.border = { bottom: { style: "thin", color: { argb: "FFD1D1D6" } } };
    });

    for (const r of b.rows) {
      const row = ws.addRow(r);
      row.eachCell((c) => { if (isNum(c.value)) { c.numFmt = "#,##0.##"; c.alignment = { horizontal: "right" }; } });
    }
    const foot = b.foot ?? [];
    foot.forEach((r, i) => {
      const row = ws.addRow(r);
      row.eachCell({ includeEmpty: true }, (c, n) => {
        c.font = { bold: i === 0, italic: i > 0 };
        if (i === 0) c.border = { top: { style: "thin", color: { argb: "FF8E8E93" } } };
        if (i === foot.length - 1 && n <= cols) c.border = { ...(c.border ?? {}), bottom: { style: "double", color: { argb: "FF1D1D1F" } } };
        if (isNum(c.value)) { c.numFmt = "#,##0.##"; c.alignment = { horizontal: "right" }; }
      });
    });
    ws.addRow([]);
  }

  // Widths from what each column holds, within reason.
  for (let i = 1; i <= cols; i++) {
    let w = String(s.head[i - 1] ?? "").length;
    ws.getColumn(i).eachCell({ includeEmpty: false }, (c, rowNo) => {
      if (rowNo <= 2) return;
      const v = c.value == null ? "" : typeof c.value === "number" ? c.value.toLocaleString("en-US") : String(c.value);
      w = Math.max(w, v.length);
    });
    ws.getColumn(i).width = Math.min(Math.max(w + 2, 8), 48);
  }
  ws.views = [{ state: "frozen", ySplit: 3 }];

  const buf = await wb.xlsx.writeBuffer();
  save(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `${s.name}-${todayLocal()}.xlsx`);
}

function save(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

/** Excel (styled) and CSV, side by side, for a report in blocks. */
export function ExportBlocksButtons(props: Sheet) {
  const [busy, setBusy] = useState(false);
  const none = props.blocks.length === 0;
  return (
    <>
      <button type="button" className="ghost tiny" disabled={none || busy}
        onClick={async () => { setBusy(true); try { await downloadBlocksXlsx(props); } finally { setBusy(false); } }}>
        <FileSpreadsheet size={13} aria-hidden="true" /> {busy ? "Preparing…" : "Excel"}
      </button>
      <button type="button" className="ghost tiny" disabled={none} onClick={() => downloadBlocksCsv(props)}>
        <Download size={13} aria-hidden="true" /> CSV
      </button>
    </>
  );
}
