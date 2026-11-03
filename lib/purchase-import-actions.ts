"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "./auth";
import { xlsxToRows } from "./read-spreadsheet";
import { parseCsv } from "./import-items";
import { parsePurchaseReport, planPurchaseImport, invoiceStatus, type Mapping, type PlannedInvoice } from "./import-purchase-invoices";
import { getPurchaseImportMaster, importHistoricalPurchases } from "./historical-purchases";

async function read(content: string, format: "csv" | "xlsx") {
  return parsePurchaseReport(format === "xlsx" ? await xlsxToRows(content, true) : parseCsv(content));
}

/** The file read and checked, with the suppliers and warehouses a reviewer may map to. Writes nothing. */
export async function previewPurchaseImport(content: string, format: "csv" | "xlsx") {
  const u = await requirePermission("purchase.post");
  const master = await getPurchaseImportMaster(u.companyId);
  const source = await read(content, format);
  if (source.length === 0) throw new Error("No invoices were found. The report's blocks start with a \"Docid :\" row — is this the purchase invoice report?");
  return {
    invoices: planPurchaseImport(source, master, { suppliers: {}, locations: {} }),
    suppliers: master.suppliers, locations: master.locations,
  };
}

export type PurchaseImportResult =
  | { ok: true; batchRef: string; imported: { oldRef: string; invoiceNo: string; id: string }[] }
  | { ok: false; error: string };

/** Re-reads the file against the database as it is now, then writes the chosen invoices, all or none. */
export async function runPurchaseImport(input: {
  content: string; format: "csv" | "xlsx"; filename: string; mapping: Mapping; skip: string[];
}): Promise<PurchaseImportResult> {
  const u = await requirePermission("purchase.post");
  try {
    const master = await getPurchaseImportMaster(u.companyId);
    const plan = planPurchaseImport(await read(input.content, input.format), master, input.mapping);
    const chosen: PlannedInvoice[] = [];
    for (const p of plan) {
      if (p.alreadyImported || input.skip.includes(p.oldRef)) continue;
      const s = invoiceStatus(p, input.mapping);
      if (s === "blocked") return { ok: false, error: `${p.oldRef}: ${p.issues.find((i) => i.level === "error")!.message}` };
      if (s === "unmapped") return { ok: false, error: `${p.oldRef}: choose its supplier and warehouse.` };
      chosen.push(p);
    }
    if (chosen.length === 0) return { ok: false, error: "There is nothing left to import." };
    const r = await importHistoricalPurchases({ companyId: u.companyId, userId: u.id, filename: input.filename, invoices: chosen, mapping: input.mapping });
    revalidatePath("/purchases/invoices", "layout");
    return { ok: true, ...r };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
