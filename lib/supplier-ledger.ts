import { sql } from "./db";

/**
 * The supplier ledger: each supplier's purchases and payments in date order,
 * with a running balance — the old system's "Supplier Ledger" report.
 *
 * It reads Accounts Payable and Purchase Advance together, per supplier. A
 * payment made before the bill sits in Purchase Advance until it is applied,
 * so read alone the payable would show nothing on the day the money left; read
 * together, the payment appears on its own date and the balance goes negative
 * until the bill arrives, as it always did. Applying an advance only moves the
 * amount from one account to the other for the same supplier — it nets to
 * nothing here and is left out.
 */
export type LedgerRow = {
  partnerId: string; code: string; name: string;
  date: string; entryNo: string; docId: string | null; docNo: string | null; kind: string;
  /** The old system's reference (s126010015, sa26010001), when it came from there. */
  oldRef: string | null;
  /** What it was: the bank or cash a payment left from, and the remark. */
  description: string;
  purchase: number; payment: number; balance: number;
};
export type SupplierLedger = {
  partnerId: string; code: string; name: string;
  opening: number; rows: LedgerRow[]; purchases: number; payments: number; closing: number;
}[];

const KIND: Record<string, string> = {
  PURCHASE_INVOICE: "Purchase", DEBIT_NOTE: "Debit note", PURCHASE_RETURN: "Return",
  JOURNAL_VOUCHER: "Journal", OPENING_BALANCE: "Opening balance",
};

export async function getSupplierLedger(companyId: string, f: { partnerId?: string | null; from?: string | null; to?: string | null }): Promise<SupplierLedger> {
  // Every supplier line on its payable account or the advances account, summed per entry.
  // Entries that sum to nothing for the supplier (an advance applied) drop out.
  const rows = await sql`
    with adv as (select fn_system_account(${companyId}, 'SUPPLIER_ADVANCE') as id),
    lines as (
      select je.id as entry_id, je.entry_no, je.entry_date, je.source_type, je.source_id, jl.partner_id,
             jl.base_amount, (jl.account_id = (select id from adv)) as on_adv
        from journal_line jl
        join journal_entry je on je.id = jl.journal_entry_id
        join business_partner p on p.id = jl.partner_id and p.is_supplier
       where jl.company_id = ${companyId}
         ${f.partnerId ? sql`and jl.partner_id = ${f.partnerId}` : sql``}
         ${f.to ? sql`and je.entry_date <= ${f.to}::date` : sql``}
         and (jl.account_id = (select id from adv)
              or jl.account_id = fn_resolve_control_account(${companyId}, 'AP_CONTROL', jl.partner_id))
    ),
    entries as (
      select entry_id, entry_no, entry_date, source_type, source_id, partner_id,
             sum(base_amount)::float as amt, bool_or(on_adv) as on_adv
        from lines group by entry_id, entry_no, entry_date, source_type, source_id, partner_id
      having round(sum(base_amount), 2) <> 0
    )
    select e.entry_id, e.entry_no, e.entry_date::text as date, e.source_type, e.partner_id, e.amt, e.on_adv,
           p.code, p.name, d.id as doc_id, d.doc_type, d.doc_no, d.memo, d.reference, d.source_ref,
           -- The money's other side, for a payment: the bank or cash it left from.
           (select string_agg(distinct a.name, ', ') from journal_line x join account a on a.id = x.account_id
             where x.journal_entry_id = e.entry_id and (a.is_cash_account or a.is_bank_account)) as paid_from
      from entries e
      join business_partner p on p.id = e.partner_id
      left join document d on d.id = e.source_id
     order by p.code, e.entry_date, e.entry_no`;

  const out = new Map<string, SupplierLedger[number]>();
  for (const r of rows) {
    const id = r.partner_id as string;
    if (!out.has(id)) out.set(id, { partnerId: id, code: r.code, name: r.name, opening: 0, rows: [], purchases: 0, payments: 0, closing: 0 });
    const g = out.get(id)!;
    // Owed to the supplier is positive: a credit on the payable side.
    const owed = -Number(r.amt);
    if (f.from && r.date < f.from) { g.opening += owed; continue; }
    const kind = r.doc_type === "SUPPLIER_PAYMENT"
      ? (r.on_adv && owed < 0 ? "Supplier advance" : "Payment")
      : KIND[r.doc_type as string] ?? (r.doc_type ? String(r.doc_type).replace(/_/g, " ").toLowerCase() : String(r.source_type).toLowerCase());
    // A bill keeps its old id as source_ref; a payment keeps it as its reference.
    const oldRef = (r.source_ref || r.reference || null) as string | null;
    const description = [r.paid_from, r.memo]
      .filter((x, i, all) => x && String(x).trim() && x !== oldRef && all.indexOf(x) === i).join(" · ");
    g.rows.push({
      partnerId: id, code: r.code, name: r.name, date: r.date, entryNo: r.entry_no, docId: r.doc_id ?? null, docNo: r.doc_no ?? null,
      kind, oldRef, description, purchase: owed > 0 ? owed : 0, payment: owed < 0 ? -owed : 0, balance: 0,
    });
  }
  for (const g of out.values()) {
    let bal = g.opening;
    for (const r of g.rows) { bal += r.purchase - r.payment; r.balance = Math.round(bal * 100) / 100; }
    g.purchases = g.rows.reduce((s, r) => s + r.purchase, 0);
    g.payments = g.rows.reduce((s, r) => s + r.payment, 0);
    g.closing = Math.round(bal * 100) / 100;
  }
  return [...out.values()].filter((g) => g.rows.length || Math.abs(g.opening) >= 0.005);
}

/** Each supplier's unapplied advance: paid to them, not yet set against a bill. */
export async function getSupplierAdvanceBalances(companyId: string): Promise<Map<string, number>> {
  const rows = await sql`
    select jl.partner_id, sum(jl.base_amount)::float as bal
      from journal_line jl
     where jl.company_id = ${companyId} and jl.account_id = fn_system_account(${companyId}, 'SUPPLIER_ADVANCE')
       and jl.partner_id is not null
     group by jl.partner_id
    having round(sum(jl.base_amount), 2) <> 0`;
  return new Map(rows.map((r) => [r.partner_id as string, Number(r.bal)]));
}
