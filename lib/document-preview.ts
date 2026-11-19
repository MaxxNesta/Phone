import { sql } from "./db";
import { getDocumentLines, getRelatedDocuments, getDocumentPeople, getDocumentOutstanding, type RelatedDoc } from "./queries";

/**
 * The invoice preview (Astryx-style layout, our data): lines, what was paid
 * and how, the flow from order to payment, related documents and a timeline.
 * Reads the same loaders as the document page; adds only the payments query
 * (payment_allocation by invoice, one indexed read).
 */
export async function invoicePreview(id: string) {
  const [lines, related, people, outstanding, payments, serials] = await Promise.all([
    getDocumentLines(id),
    getRelatedDocuments(id),
    getDocumentPeople(id),
    getDocumentOutstanding(id),
    sql`
      select pay.id, pay.doc_no, pay.doc_type, to_char(pay.posting_date, 'YYYY-MM-DD') as date, pay.status,
             pa.base_amount::float as amount, pc.name as channel, pay.posted_at
        from payment_allocation pa
        join document pay on pay.id = pa.payment_id
        left join payment_channel pc on pc.id = pay.payment_channel_id
       where pa.invoice_id = ${id} and pay.status = 'POSTED'
       order by pay.posting_date, pay.doc_no`,
    sql`select dl.id as line_id, count(si.*)::int as n
          from document_line dl
          join stock_movement m on m.document_line_id = dl.id
          join stock_serial_issue si on si.stock_movement_id = m.id
         where dl.document_id = ${id} group by dl.id`,
  ]);
  return {
    lines: lines as unknown as Record<string, unknown>[],
    related, people, outstanding,
    payments: payments as unknown as { id: string; doc_no: string; doc_type: string; date: string; status: string; amount: number; channel: string | null; posted_at: string | null }[],
    serialLines: new Set((serials as unknown as { line_id: string }[]).map((r) => r.line_id)),
  };
}

export type Flat = RelatedDoc & { group: string; side: "source" | "downstream" };
/** Related documents as one list, each with the group it belongs to. */
export function flatten(related: Awaited<ReturnType<typeof getRelatedDocuments>>): Flat[] {
  return [
    ...related.source.flatMap((g) => g.docs.map((d) => ({ ...d, group: g.label, side: "source" as const }))),
    ...related.downstream.flatMap((g) => g.docs.map((d) => ({ ...d, group: g.label, side: "downstream" as const }))),
  ];
}
