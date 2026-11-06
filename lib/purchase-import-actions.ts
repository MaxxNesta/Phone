"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "./auth";
import { begin, end } from "./heavy";
import { assertMyBranch } from "./branch-scope";
import { xlsxToRows } from "./read-spreadsheet";
import { parseCsv } from "./import-items";
import { parsePurchaseReport, parseTsv, planPurchaseImport, invoiceStatus, resolved, type Mapping, type PlannedInvoice } from "./import-purchase-invoices";
import { getPurchaseImportMaster, postImportedPurchases, previewPurchasePosting, type PostedResult, type PostingPreview } from "./purchase-import";

export type SourceFormat = "csv" | "xlsx" | "tsv";

/** An uploaded workbook or CSV, or cells pasted from Excel (tab-separated). */
async function read(content: string, format: SourceFormat) {
  return parsePurchaseReport(format === "xlsx" ? await xlsxToRows(content, true) : format === "tsv" ? parseTsv(content) : parseCsv(content));
}

// Only what the file names is looked up among what is posted, held as history, or in stock.
const namedIn = (src: Awaited<ReturnType<typeof read>>) => ({
  refs: src.map((i) => i.oldRef), serials: src.flatMap((i) => i.lines.flatMap((l) => l.serials)),
});

/** The file read and checked, with what a reviewer may map to. Writes nothing. */
export async function previewPurchaseImport(content: string, format: SourceFormat) {
  const u = await requirePermission("purchase.post");
  await begin("preview.purchase", { companyId: u.companyId, who: u.id });
  const source = await read(content, format);
  if (source.length === 0) throw new Error("No invoices were found. Each invoice starts with a Docid row — is this the purchase invoice report?");
  const master = await getPurchaseImportMaster(u.companyId, namedIn(source));
  return {
    invoices: planPurchaseImport(source, master, { suppliers: {}, locations: {} }),
    suppliers: master.suppliers, locations: master.locations, payAccounts: master.payAccounts,
  };
}

/**
 * What one invoice would post, from the engine itself, rolled back. Read
 * again from the file on the server: what is previewed is what the file says,
 * not what the browser sends back.
 */
export async function previewInvoicePosting(content: string, format: SourceFormat, row: number, mapping: Mapping): Promise<PostingPreview> {
  const u = await requirePermission("purchase.post");
  await begin("preview.purchase", { companyId: u.companyId, who: u.id });
  const source = await read(content, format);
  const master = await getPurchaseImportMaster(u.companyId, namedIn(source));
  const p = planPurchaseImport(source, master, mapping).find((x) => x.row === row);
  if (!p) return { error: "That invoice is no longer in the file." };
  const s = invoiceStatus(p, mapping);
  if (s === "blocked" || s === "unmapped" || s === "imported") return { error: "Resolve this invoice's issues to preview what it posts." };
  return previewPurchasePosting(u.companyId, p, mapping, master);
}

export type PurchaseImportResult = { ok: true; results: PostedResult[]; skipped: number } | { ok: false; error: string };

/**
 * Re-reads the file against the database as it is now, then posts every
 * invoice that is ready and was not left out — each on its own, all of it or
 * none of it. Already-posted ones are reported, never posted again.
 */
export async function runPurchaseImport(input: {
  content: string; format: SourceFormat; filename: string; mapping: Mapping; skip: number[]; only?: number[];
}): Promise<PurchaseImportResult> {
  const u = await requirePermission("purchase.post");
  let run = 0;
  try {
    run = await begin("import.purchase", { companyId: u.companyId, who: u.id });
    const source = await read(input.content, input.format);
    const master = await getPurchaseImportMaster(u.companyId, namedIn(source));
    const plan = planPurchaseImport(source, master, input.mapping);
    const chosen: PlannedInvoice[] = [];
    let skipped = 0;
    for (const p of plan) {
      if (input.only && !input.only.includes(p.row)) continue;
      const s = invoiceStatus(p, input.mapping);
      if (s === "imported" || s === "blocked" || s === "unmapped" || input.skip.includes(p.row)) { skipped++; continue; }
      chosen.push(p);
    }
    if (chosen.length === 0) return { ok: false, error: "There is nothing ready to post." };
    // Someone limited to a branch posts into that branch's warehouses only, as on the form.
    await assertMyBranch(...new Set(chosen.map((p) => resolved(p.location, input.mapping.locations))));
    const results = await postImportedPurchases(u.companyId, chosen, input.mapping, master);
    if (results.some((r) => r.status === "posted")) {
      for (const p of ["/purchases/invoices", "/documents", "/payables", "/items/stock", "/ledger"]) revalidatePath(p);
    }
    return { ok: true, results, skipped };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  } finally {
    if (run) await end(run);
  }
}
