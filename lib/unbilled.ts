import { getOpenGoodsReceipts } from "./queries";

export type UnbilledReceipt = {
  id: string; docNo: string; docDate: string; days: number;
  partnerId: string; partnerName: string; partnerCode: string;
  lines: number; value: number;
};

/**
 * Goods received that no supplier invoice covers yet, per receipt, valued in
 * kyat at what the receipt booked them at. Read from the same reckoning the
 * invoice form bills from, so what is shown here is exactly what "Create
 * invoice" will offer. Not a debt in the books until the bill is entered:
 * the value sits in GR/IR clearing, not in the supplier's balance.
 */
export async function unbilledReceipts(companyId: string): Promise<UnbilledReceipt[]> {
  const docs = (await getOpenGoodsReceipts(companyId, null)) as unknown as Array<{
    id: string; doc_no: string; doc_date: string; partner_id: string;
    partner_name: string | null; partner_code: string | null;
    lines: { enteredQty: number; unitPrice: number }[];
  }>;
  const today = Date.now();
  return docs.map((d) => ({
    id: d.id, docNo: d.doc_no, docDate: String(d.doc_date).slice(0, 10),
    days: Math.max(0, Math.floor((today - new Date(d.doc_date).getTime()) / 86_400_000)),
    partnerId: d.partner_id, partnerName: d.partner_name ?? "—", partnerCode: d.partner_code ?? "",
    lines: d.lines.length,
    value: Math.round(d.lines.reduce((s, l) => s + l.enteredQty * l.unitPrice, 0) * 100) / 100,
  }));
}

/** The same, summed per supplier. */
export function unbilledBySupplier(rows: UnbilledReceipt[]) {
  const by = new Map<string, { partnerId: string; partnerName: string; partnerCode: string;
                               receipts: number; value: number; oldest: number }>();
  for (const r of rows) {
    const s = by.get(r.partnerId) ?? { partnerId: r.partnerId, partnerName: r.partnerName,
      partnerCode: r.partnerCode, receipts: 0, value: 0, oldest: 0 };
    s.receipts += 1; s.value += r.value; s.oldest = Math.max(s.oldest, r.days);
    by.set(r.partnerId, s);
  }
  return [...by.values()].sort((a, b) => b.value - a.value);
}
