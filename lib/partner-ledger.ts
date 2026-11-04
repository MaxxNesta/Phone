import { sql } from "./db";

/**
 * The supplier and customer ledgers: each partner's documents in date order,
 * with a running balance — the old system's Supplier Ledger and Customer
 * Ledger reports.
 *
 * Each reads the partner's control account together with its advances account
 * (Purchase Advance for a supplier, Sale Advance for a customer). Money paid or
 * taken before the bill sits in the advances account until it is applied, so
 * read alone the control account would show nothing on the day the money moved;
 * read together, it shows on its own date and the balance goes below zero until
 * the bill comes, as it always did. Applying an advance only moves the amount
 * between the two accounts for the same partner — it nets to nothing here and is
 * left out.
 */
export type Side = "SUPPLIER" | "CUSTOMER";

export type LedgerRow = {
  partnerId: string;
  date: string; entryNo: string; docId: string | null; docNo: string | null; kind: string;
  /** The old system's reference (s126010015, c226010058), when it came from there. */
  oldRef: string | null;
  /** What it was: the bank or cash the money moved through, and the remark. */
  description: string;
  /** Raised the balance (a purchase, a sale) or brought it down (a payment, a receipt). */
  charge: number; settle: number; balance: number;
};
export type PartnerLedger = {
  partnerId: string; code: string; name: string; township: string | null;
  opening: number; rows: LedgerRow[]; charges: number; settles: number; closing: number;
}[];

const ROLE = {
  SUPPLIER: { control: "AP_CONTROL", advance: "SUPPLIER_ADVANCE", payment: "SUPPLIER_PAYMENT", advanceLabel: "Supplier advance", paid: "Payment" },
  CUSTOMER: { control: "AR_CONTROL", advance: "CUSTOMER_ADVANCE", payment: "CUSTOMER_RECEIPT", advanceLabel: "Customer advance", paid: "Payment" },
} as const;

const KIND: Record<string, string> = {
  PURCHASE_INVOICE: "Purchase", DEBIT_NOTE: "Debit note", PURCHASE_RETURN: "Return",
  SALES_INVOICE: "Sales", CREDIT_NOTE: "Credit note", SALES_RETURN: "Return",
  JOURNAL_VOUCHER: "Journal", OPENING_BALANCE: "Opening balance",
};

export async function getPartnerLedger(companyId: string, side: Side, f: {
  partnerId?: string | null; township?: string | null; from?: string | null; to?: string | null;
}): Promise<PartnerLedger> {
  const r0 = ROLE[side];
  // Every partner line on its control account or the advances account, summed per entry.
  // Entries that sum to nothing for the partner (an advance applied) drop out.
  const rows = await sql`
    with adv as (select fn_system_account(${companyId}, ${r0.advance}) as id),
    lines as (
      select je.id as entry_id, je.entry_no, je.entry_date, je.source_type, je.source_id, jl.partner_id,
             jl.base_amount, (jl.account_id = (select id from adv)) as on_adv
        from journal_line jl
        join journal_entry je on je.id = jl.journal_entry_id
        join business_partner p on p.id = jl.partner_id
             and ${side === "SUPPLIER" ? sql`p.is_supplier` : sql`p.is_customer`}
       where jl.company_id = ${companyId}
         ${f.partnerId ? sql`and jl.partner_id = ${f.partnerId}` : sql``}
         ${f.township ? (f.township === "-" ? sql`and p.township is null` : sql`and p.township = ${f.township}`) : sql``}
         ${f.to ? sql`and je.entry_date <= ${f.to}::date` : sql``}
         and (jl.account_id = (select id from adv)
              or jl.account_id = fn_resolve_control_account(${companyId}, ${r0.control}, jl.partner_id))
    ),
    entries as (
      select entry_id, entry_no, entry_date, source_type, source_id, partner_id,
             sum(base_amount)::float as amt, bool_or(on_adv) as on_adv
        from lines group by entry_id, entry_no, entry_date, source_type, source_id, partner_id
      having round(sum(base_amount), 2) <> 0
    )
    select e.entry_id, e.entry_no, e.entry_date::text as date, e.source_type, e.partner_id, e.amt, e.on_adv,
           p.code, p.name, p.township, d.id as doc_id, d.doc_type, d.doc_no, d.memo, d.reference, d.source_ref,
           -- The money's other side, for a payment or receipt: the bank or cash it moved through.
           (select string_agg(distinct a.name, ', ') from journal_line x join account a on a.id = x.account_id
             where x.journal_entry_id = e.entry_id and (a.is_cash_account or a.is_bank_account)) as paid_from
      from entries e
      join business_partner p on p.id = e.partner_id
      left join document d on d.id = e.source_id
     order by p.township nulls last, p.code, e.entry_date, e.entry_no`;

  const out = new Map<string, PartnerLedger[number]>();
  for (const r of rows) {
    const id = r.partner_id as string;
    if (!out.has(id)) out.set(id, { partnerId: id, code: r.code, name: r.name, township: r.township ?? null, opening: 0, rows: [], charges: 0, settles: 0, closing: 0 });
    const g = out.get(id)!;
    // What the partner balance moves by: owed to a supplier is a credit, owed by a customer a debit.
    const owed = side === "SUPPLIER" ? -Number(r.amt) : Number(r.amt);
    if (f.from && r.date < f.from) { g.opening += owed; continue; }
    const kind = r.doc_type === r0.payment
      ? (r.on_adv && owed < 0 ? r0.advanceLabel : r0.paid)
      : KIND[r.doc_type as string] ?? (r.doc_type ? String(r.doc_type).replace(/_/g, " ").toLowerCase() : String(r.source_type).toLowerCase());
    // A bill or invoice keeps its old id as source_ref; a payment keeps it as its reference.
    const oldRef = (r.source_ref || r.reference || null) as string | null;
    const description = [r.paid_from, r.memo]
      .filter((x, i, all) => x && String(x).trim() && x !== oldRef && all.indexOf(x) === i).join(" · ");
    g.rows.push({
      partnerId: id, date: r.date, entryNo: r.entry_no, docId: r.doc_id ?? null, docNo: r.doc_no ?? null,
      kind, oldRef, description, charge: owed > 0 ? owed : 0, settle: owed < 0 ? -owed : 0, balance: 0,
    });
  }
  for (const g of out.values()) {
    let bal = g.opening;
    for (const r of g.rows) { bal += r.charge - r.settle; r.balance = Math.round(bal * 100) / 100; }
    g.charges = g.rows.reduce((s, r) => s + r.charge, 0);
    g.settles = g.rows.reduce((s, r) => s + r.settle, 0);
    g.closing = Math.round(bal * 100) / 100;
  }
  return [...out.values()].filter((g) => g.rows.length || Math.abs(g.opening) >= 0.005);
}

/** Each partner's unapplied advance: paid or taken ahead, not yet set against a bill (positive either side). */
export async function getAdvanceBalances(companyId: string, side: Side): Promise<Map<string, number>> {
  const rows = await sql`
    select jl.partner_id, sum(jl.base_amount)::float as bal
      from journal_line jl
     where jl.company_id = ${companyId} and jl.account_id = fn_system_account(${companyId}, ${ROLE[side].advance})
       and jl.partner_id is not null
     group by jl.partner_id
    having round(sum(jl.base_amount), 2) <> 0`;
  return new Map(rows.map((r) => [r.partner_id as string, side === "SUPPLIER" ? Number(r.bal) : -Number(r.bal)]));
}
