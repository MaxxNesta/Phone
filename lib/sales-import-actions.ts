"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "./auth";
import { begin, end } from "./heavy";
import { assertMyBranch } from "./branch-scope";
import { xlsxToRows } from "./read-spreadsheet";
import { parseCsv } from "./import-items";
import { parsePurchaseReport, parseTsv, invoiceStatus, resolved, type Mapping, type PlannedInvoice } from "./import-purchase-invoices";
import { planSalesImport } from "./import-sales-invoices";
import { getSalesImportMaster, postImportedSales, previewSalesPosting } from "./sales-import";
import type { PostingPreview } from "./purchase-import";
import type { PurchaseImportResult, SourceFormat } from "./purchase-import-actions";

/** An uploaded workbook or CSV, or cells pasted from Excel — the same report reader as purchases. */
async function read(content: string, format: SourceFormat) {
  return parsePurchaseReport(format === "xlsx" ? await xlsxToRows(content, true) : format === "tsv" ? parseTsv(content) : parseCsv(content));
}
const namedIn = (src: Awaited<ReturnType<typeof read>>) => ({
  refs: src.map((i) => i.oldRef), serials: src.flatMap((i) => i.lines.flatMap((l) => l.serials)),
});

/** The report read and checked against what is in stock, with what a reviewer may map to. Writes nothing. */
export async function previewSalesImport(content: string, format: SourceFormat) {
  const u = await requirePermission("sales.post");
  await begin("preview.sales", { companyId: u.companyId, who: u.id });
  const source = await read(content, format);
  if (source.length === 0) throw new Error("No invoices were found. Each invoice starts with a Docid row — is this the sales invoice report?");
  const master = await getSalesImportMaster(u.companyId, namedIn(source));
  return {
    invoices: planSalesImport(source, master, { suppliers: {}, locations: {} }),
    suppliers: master.customers, locations: master.locations, payAccounts: master.payAccounts,
  };
}

/** What one invoice would post, from the engine itself, rolled back — read again from the file on the server. */
export async function previewSalesInvoicePosting(content: string, format: SourceFormat, row: number, mapping: Mapping): Promise<PostingPreview> {
  const u = await requirePermission("sales.post");
  await begin("preview.sales", { companyId: u.companyId, who: u.id });
  const source = await read(content, format);
  const master = await getSalesImportMaster(u.companyId, namedIn(source));
  const p = planSalesImport(source, master, mapping).find((x) => x.row === row);
  if (!p) return { error: "That invoice is no longer in the file." };
  const s = invoiceStatus(p, mapping);
  if (s === "blocked" || s === "unmapped" || s === "imported") return { error: "Resolve this invoice's issues to preview what it posts." };
  return previewSalesPosting(u.companyId, p, mapping);
}

/** Re-reads the file against the database as it is now, then posts what is ready — each invoice on its own. */
export async function runSalesImport(input: {
  content: string; format: SourceFormat; filename: string; mapping: Mapping; skip: number[]; only?: number[];
}): Promise<PurchaseImportResult> {
  const u = await requirePermission("sales.post");
  let run = 0;
  try {
    run = await begin("import.sales", { companyId: u.companyId, who: u.id });
    const source = await read(input.content, input.format);
    const master = await getSalesImportMaster(u.companyId, namedIn(source));
    const plan = planSalesImport(source, master, input.mapping);
    const chosen: PlannedInvoice[] = [];
    let skipped = 0;
    for (const p of plan) {
      if (input.only && !input.only.includes(p.row)) continue;
      const s = invoiceStatus(p, input.mapping);
      if (s === "imported" || s === "blocked" || s === "unmapped" || input.skip.includes(p.row)) { skipped++; continue; }
      chosen.push(p);
    }
    if (chosen.length === 0) return { ok: false, error: "There is nothing ready to post." };
    await assertMyBranch(...new Set(chosen.map((p) => resolved(p.location, input.mapping.locations))));
    const results = await postImportedSales(u.companyId, chosen, input.mapping);
    if (results.some((r) => r.status === "posted")) {
      for (const p of ["/sales/invoices", "/documents", "/receivables", "/items/stock", "/ledger"]) revalidatePath(p);
    }
    return { ok: true, results, skipped };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  } finally {
    if (run) await end(run);
  }
}
