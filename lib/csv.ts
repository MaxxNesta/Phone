/**
 * One CSV cell, safe to open in a spreadsheet. A customer named
 * "=HYPERLINK(...)" must stay text, not run as a formula; plain numbers (a
 * negative amount) are left alone. Every export writes its cells through this.
 */
export function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Rows as a downloadable CSV, safe to open in a spreadsheet. */
export function csvResponse(rows: unknown[][], base: string) {
  const cell = csvCell;
  const csv = rows.map((r) => r.map(cell).join(",")).join("\n");
  // Only letters, digits and dashes reach the header.
  const name = `${base.toLowerCase().replace(/[^a-z0-9-]+/g, "-")}.csv`;
  return new Response("﻿" + csv, {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${name}"` },
  });
}
