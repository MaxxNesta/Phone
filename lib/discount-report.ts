import { sql } from "./db";

/**
 * Discounts and free goods, for one side of the business (Sales → Discounts
 * & free goods, Purchases → Discounts received). One query module for both so
 * the two reports are the same shape and cannot drift apart.
 *
 *   discounts  every discounted invoice line, by kind (line, volume,
 *              invoice-wide), plus every DISCOUNT note raised after the
 *              invoice, with where the note's money landed in the ledger
 *   free       every free line: with a sale or standalone (sales), or free
 *              units from a supplier (purchases), with reason, quantity,
 *              cost, the account the cost went to, and on a sale the revenue
 *              allocated to it (IFRS 15, 0205)
 *   ledger     the period's balances of the accounts these land in, so the
 *              report can be tied to the books
 *
 * Posted documents only; amended and voided ones drop out by status. Period
 * is inclusive `from`, exclusive `to`, by posting date.
 */
export type Side = "sales" | "purchases";

export async function discountReport(companyId: string, side: Side, from: string, to: string, locs: string[] | null,
  /** A test passes its transaction, to read what it has not committed. */
  db: typeof sql = sql) {
  const sales = side === "sales";
  const invType = sales ? "SALES_INVOICE" : "PURCHASE_INVOICE";
  const noteType = sales ? "CREDIT_NOTE" : "DEBIT_NOTE";
  const inScope = locs ? db`and d.location_id = any(${locs})` : db``;
  const period = db`d.posting_date >= ${from}::date and d.posting_date < ${to}::date`;

  const [lines, notes, free, ledger] = await Promise.all([
    db`
      select dl.id, d.id as document_id, d.doc_no, to_char(d.posting_date, 'YYYY-MM-DD') as date,
             d.partner_id, coalesce(p.name, 'Walk-in') as partner, i.code as item_code, i.name as item_name,
             dl.base_qty::float as qty,
             coalesce(dl.discount_amount, 0)::float as line_d,
             coalesce(dl.volume_discount_amount, 0)::float as volume_d,
             coalesce(dl.invoice_discount_amount, 0)::float as invoice_d,
             dl.net_amount::float as net,
             -- Purchases: whether the bill's discount lowered the goods' cost
             -- (NET) or was credited to Purchase Discounts (GROSS).
             ${sales ? db`null` : db`exists (select 1 from journal_line jl
                join system_account sa on sa.account_id = jl.account_id and sa.role = 'PURCHASE_DISCOUNT_RECEIVED'
               where jl.journal_entry_id = d.journal_entry_id)`} as credited
        from document d
        join document_line dl on dl.document_id = d.id
        join item i on i.id = dl.item_id
        left join business_partner p on p.id = d.partner_id
       where d.company_id = ${companyId} and d.doc_type = ${invType} and d.status = 'POSTED'
         and ${period} ${inScope}
         and coalesce(dl.discount_amount, 0) + coalesce(dl.volume_discount_amount, 0)
             + coalesce(dl.invoice_discount_amount, 0) > 0
       order by d.posting_date desc, d.doc_no desc, dl.line_no`,
    db`
      select d.id as document_id, d.doc_no, to_char(d.posting_date, 'YYYY-MM-DD') as date,
             d.partner_id, coalesce(p.name, 'Walk-in') as partner, d.net_total::float as amount,
             d.memo as reason, src.id as against_id, src.doc_no as against,
             -- Where it landed: the note's own journal, the side that is not
             -- the customer or supplier (sales: debits; purchases: credits).
             (select coalesce(json_agg(json_build_object('code', a.code, 'name', a.name, 'amount', abs(x.v)) order by a.code), '[]')
                from (select jl.account_id, sum(jl.base_amount) as v from journal_line jl
                       where jl.journal_entry_id = d.journal_entry_id group by jl.account_id
                      having ${sales ? db`sum(jl.base_amount) > 0` : db`sum(jl.base_amount) < 0`}) x
                join account a on a.id = x.account_id) as landed
        from document d
        left join document src on src.id = d.source_document_id
        left join business_partner p on p.id = d.partner_id
       where d.company_id = ${companyId} and d.doc_type = ${noteType} and d.status = 'POSTED'
         and d.adjustment_reason = 'DISCOUNT' and ${period} ${inScope}
       order by d.posting_date desc, d.doc_no desc`,
    sales ? db`
      -- A free line counts where its goods moved: on the invoice that issued
      -- them, or on the delivery. A deliver-later invoice's free line is
      -- counted by its delivery, never twice.
      select dl.id, d.id as document_id, d.doc_type, d.doc_no, to_char(d.posting_date, 'YYYY-MM-DD') as date,
             coalesce(p.name, 'Walk-in') as partner, i.code as item_code, i.name as item_name,
             dl.base_qty::float as qty, r.code as reason_code, r.name as reason,
             case when d.doc_type = 'SALES_INVOICE' or d.source_document_id is not null
                       or exists (select 1 from document_line o where o.document_id = d.id and o.foc_reason_id is null)
                  then 'WITH_SALE' else 'STANDALONE' end as category,
             coalesce((select -sum(sm.total_cost) from stock_movement sm where sm.document_line_id = dl.id), 0)::float as cost,
             (select string_agg(distinct a.code || ' ' || a.name, ', ')
                from stock_movement sm join stock_lot_consumption c on c.stock_movement_id = sm.id
                join account a on a.id = c.expense_account_id where sm.document_line_id = dl.id) as charged_to,
             dl.revenue_amount::float as revenue
        from document d
        join document_line dl on dl.document_id = d.id and dl.foc_reason_id is not null
        join foc_reason r on r.id = dl.foc_reason_id
        join item i on i.id = dl.item_id
        left join business_partner p on p.id = d.partner_id
       where d.company_id = ${companyId} and d.doc_type in ('SALES_INVOICE', 'DELIVERY') and d.status = 'POSTED'
         and ${period} ${inScope}
         and exists (select 1 from stock_movement sm where sm.document_line_id = dl.id)
       order by d.posting_date desc, d.doc_no desc` : db`
      select dl.id, d.id as document_id, d.doc_type, d.doc_no, to_char(d.posting_date, 'YYYY-MM-DD') as date,
             coalesce(p.name, '—') as partner, i.code as item_code, i.name as item_name,
             dl.base_qty::float as qty, r.code as reason_code, r.name as reason,
             'FROM_SUPPLIER' as category,
             -- The share of the bill these units carry (0204); bills from
             -- before it put free units on stock at nothing.
             coalesce(dl.stock_cost, 0)::float as cost, null as charged_to, null::float as revenue
        from document d
        join document_line dl on dl.document_id = d.id and dl.foc_reason_id is not null
        join foc_reason r on r.id = dl.foc_reason_id
        join item i on i.id = dl.item_id
        left join business_partner p on p.id = d.partner_id
       where d.company_id = ${companyId} and d.doc_type = 'PURCHASE_INVOICE' and d.status = 'POSTED'
         and ${period} ${inScope}
       order by d.posting_date desc, d.doc_no desc`,
    db`
      select sa.role, a.code, a.name,
             coalesce((select sum(jl.base_amount) from journal_line jl join journal_entry je on je.id = jl.journal_entry_id
                        where jl.account_id = a.id and je.entry_date >= ${from}::date and je.entry_date < ${to}::date), 0)::float as v
        from system_account sa join account a on a.id = sa.account_id
       where sa.company_id = ${companyId}
         and sa.role in (${sales ? "SALES_DISCOUNT_ALLOWED" : "PURCHASE_DISCOUNT_RECEIVED"})`,
  ]);

  const sum = (rows: readonly Record<string, unknown>[], k: string) => rows.reduce((t, r) => t + Number(r[k] ?? 0), 0);
  const onLines = sum(lines, "line_d") + sum(lines, "volume_d") + sum(lines, "invoice_d");
  const afterwards = sum(notes, "amount");

  // Per customer or supplier: what came off on invoices and afterwards.
  const by = new Map<string, { partner: string; docs: Set<string>; onLines: number; afterwards: number; gross: number }>();
  const at = (id: string | null, name: string) => {
    const k = id ?? "-";
    if (!by.has(k)) by.set(k, { partner: name, docs: new Set(), onLines: 0, afterwards: 0, gross: 0 });
    return by.get(k)!;
  };
  for (const l of lines) {
    const b = at(l.partner_id as string | null, l.partner as string);
    b.docs.add(l.document_id as string);
    const d = Number(l.line_d) + Number(l.volume_d) + Number(l.invoice_d);
    b.onLines += d; b.gross += Number(l.net) + d;
  }
  for (const nt of notes) at(nt.partner_id as string | null, nt.partner as string).afterwards += Number(nt.amount);

  return {
    lines: lines as unknown as DiscountLine[],
    notes: notes as unknown as DiscountNote[],
    free: free as unknown as FreeLine[],
    ledger: ledger as unknown as { role: string; code: string; name: string; v: number }[],
    totals: {
      onLines, afterwards, total: onLines + afterwards,
      grossOfDiscounted: sum(lines, "net") + onLines,
      freeQty: sum(free, "qty"), freeCost: sum(free, "cost"),
      freeWithSale: free.filter((f) => f.category === "WITH_SALE").reduce((t, f) => t + Number(f.cost), 0),
      freeStandalone: free.filter((f) => f.category === "STANDALONE").reduce((t, f) => t + Number(f.cost), 0),
      freeRevenue: sum(free, "revenue"),
    },
    byPartner: [...by.values()].map((b) => ({ partner: b.partner, docs: b.docs.size, onLines: b.onLines,
      afterwards: b.afterwards, total: b.onLines + b.afterwards, gross: b.gross }))
      .sort((a, b) => b.total - a.total),
  };
}

export type DiscountLine = {
  id: string; document_id: string; doc_no: string; date: string; partner_id: string | null; partner: string;
  item_code: string; item_name: string; qty: number; line_d: number; volume_d: number; invoice_d: number;
  net: number; credited: boolean | null;
};
export type DiscountNote = {
  document_id: string; doc_no: string; date: string; partner_id: string | null; partner: string; amount: number;
  reason: string | null; against_id: string | null; against: string | null;
  landed: { code: string; name: string; amount: number }[];
};
export type FreeLine = {
  id: string; document_id: string; doc_type: string; doc_no: string; date: string; partner: string;
  item_code: string; item_name: string; qty: number; reason_code: string; reason: string;
  category: "WITH_SALE" | "STANDALONE" | "FROM_SUPPLIER"; cost: number; charged_to: string | null; revenue: number | null;
};
