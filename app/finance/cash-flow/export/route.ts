import { NextRequest } from "next/server";
import { requirePermission } from "@/lib/auth";
import { getCashFlowTransactions } from "@/lib/queries";
import { getIndirectDrill } from "@/lib/indirect-cash-flow";

/**
 * One cash flow line's rows as a CSV: the same rows its side panel lists,
 * direct or indirect, so the file and the screen cannot disagree.
 */
export async function GET(req: NextRequest) {
  const user = await requirePermission("accounting.view");
  const p = req.nextUrl.searchParams;
  const line = p.get("line") ?? "";
  const from = p.get("from") ?? `${new Date().getFullYear()}-01-01`;
  const to = p.get("to") ?? new Date().toISOString().slice(0, 10);
  const branch = p.get("branch") || null;
  if (!line) return new Response("Which line?", { status: 400 });
  // Dates go into the file name: only real dates, nothing a header could carry.
  const isDate = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d);
  if (!isDate(from) || !isDate(to)) return new Response("Dates must be YYYY-MM-DD", { status: 400 });

  if (p.get("method") === "indirect") {
    const d = await getIndirectDrill(user.companyId, from, to, branch, line);
    if (!d) return new Response("No such line", { status: 404 });
    return csvResponse([
      ["Date", "Document", "Journal", "Partner", "Description", "Account", "Amount (MMK)", "Balance (MMK)"],
      ...d.rows.map((r) => [r.date, r.docNo, r.entryNo, r.partner, r.description, r.account,
        r.amount.toFixed(2), r.balance === undefined ? "" : r.balance.toFixed(2)]),
    ], `cash-flow-indirect-${line}-${from}-to-${to}`);
  }

  const rows = await getCashFlowTransactions(user.companyId, from, to, branch, line);
  return csvResponse([
    ["Date", "Document", "Type", "Journal", "Customer / supplier", "Method", "Amount (MMK)"],
    ...rows.map((t) => [t.date, t.docNo, t.docType, t.entryNo, t.partner, t.method, t.amount.toFixed(2)]),
  ], `cash-flow-${line}-${from}-to-${to}`);
}

function csvResponse(rows: unknown[][], base: string) {
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
