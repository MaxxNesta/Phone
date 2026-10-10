/** Rows as a downloadable CSV, safe to open in a spreadsheet. */
export function csvResponse(rows: unknown[][], base: string) {
  const cell = (v: unknown) => {
    let s = v === null || v === undefined ? "" : String(v);
    // A customer named "=HYPERLINK(...)" must stay text in a spreadsheet,
    // not run as a formula. Plain numbers (a negative amount) are left alone.
    if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = "'" + s;
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = rows.map((r) => r.map(cell).join(",")).join("\n");
  // Only letters, digits and dashes reach the header.
  const name = `${base.toLowerCase().replace(/[^a-z0-9-]+/g, "-")}.csv`;
  return new Response("﻿" + csv, {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${name}"` },
  });
}
