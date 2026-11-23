/**
 * Cash on delivery carried by a courier company (0232).
 *
 * The courier delivers and collects; the shop learns of it from the courier
 * and marks the invoice collected. The customer's debt is then settled and
 * the courier owes the money instead, in COD Receivable under its name. When
 * the courier pays in, it usually keeps its fee back: the cash or bank takes
 * what arrived, Carriage Outward the fee, and COD Receivable the whole.
 *
 * Nothing is kept about either step beyond the documents: what a courier
 * holds is the balance of COD Receivable under it; what is still out with it
 * is the outstanding of its open COD invoices.
 */

import { sql } from "./db";
import type { TransactionSql } from "postgres";
import { inTransaction, postBankVoucher, postCashVoucher, postCustomerReceipt, round4 } from "./posting";

export type CodCourier = {
  id: string; code: string; name: string; phone: string | null;
  /** Open COD invoices it carries: delivered or not, not yet collected. */
  out: number; outCount: number;
  /** Collected and not yet paid in. */
  held: number;
  /** Paid in to date, fees included. */
  remitted: number; lastRemitted: string | null;
};

async function roleAccount(db: typeof sql | TransactionSql, companyId: string, role: string) {
  const [r] = await db`select account_id from system_account where company_id = ${companyId} and role = ${role}`;
  return (r?.account_id as string | undefined) ?? null;
}

/** Every courier, with what it is carrying, holding and has paid in. One query. */
export async function codCouriers(companyId: string): Promise<CodCourier[]> {
  const rows = await sql`
    with cod as (select account_id from system_account where company_id = ${companyId} and role = 'COD_RECEIVABLE'),
    held as (
      select jl.partner_id, sum(jl.base_amount) as held,
             -sum(jl.base_amount) filter (where jl.base_amount < 0) as remitted,
             max(je.entry_date) filter (where jl.base_amount < 0) as last_remitted
        from journal_line jl join journal_entry je on je.id = jl.journal_entry_id
       where jl.company_id = ${companyId} and jl.account_id = (select account_id from cod)
       group by jl.partner_id),
    out as (
      select d.courier_id, sum(o.outstanding) as out, count(*) as n
        from document d join v_open_item o on o.document_id = d.id
       where d.company_id = ${companyId} and d.doc_type = 'SALES_INVOICE' and d.status = 'POSTED'
         and d.payment_type = 'COD' and d.courier_id is not null and o.outstanding > 0.005
       group by d.courier_id)
    select bp.id, bp.code, bp.name, bp.phone,
           coalesce(out.out, 0)::float as out, coalesce(out.n, 0)::int as "outCount",
           coalesce(held.held, 0)::float as held, coalesce(held.remitted, 0)::float as remitted,
           held.last_remitted::text as "lastRemitted"
      from business_partner bp
      left join out on out.courier_id = bp.id
      left join held on held.partner_id = bp.id
     where bp.company_id = ${companyId}
       and (bp.is_courier and bp.is_active or out.n > 0 or abs(coalesce(held.held, 0)) > 0.005)
     order by coalesce(held.held, 0) + coalesce(out.out, 0) desc, bp.name`;
  return rows as unknown as CodCourier[];
}

export type CodParcel = {
  id: string; no: string; date: string; customer: string; customerCode: string;
  total: number; outstanding: number;
  /** The branch it was sold in: the warehouse's branch. */
  branchId: string | null;
};

/** One courier's open COD invoices, oldest first. */
export async function codParcels(companyId: string, courierId: string | null): Promise<(CodParcel & { courierId: string })[]> {
  const rows = await sql`
    select d.id, d.doc_no as no, d.doc_date::text as date, bp.name as customer, bp.code as "customerCode",
           d.gross_total::float as total, o.outstanding::float as outstanding, d.courier_id as "courierId",
           (select coalesce(l.parent_id, l.id) from location l where l.id = d.location_id) as "branchId"
      from document d
      join v_open_item o on o.document_id = d.id
      join business_partner bp on bp.id = d.partner_id
     where d.company_id = ${companyId} and d.doc_type = 'SALES_INVOICE' and d.status = 'POSTED'
       and d.payment_type = 'COD' and d.courier_id is not null and o.outstanding > 0.005
       ${courierId ? sql`and d.courier_id = ${courierId}` : sql``}
     order by d.doc_date, d.doc_no`;
  return rows as unknown as (CodParcel & { courierId: string })[];
}

/**
 * The courier collected these invoices: each customer's debt is settled into
 * COD Receivable under the courier, one customer receipt per customer, for
 * all each invoice still owes.
 */
export async function courierCollected(tx: TransactionSql, input: {
  companyId: string; courierId: string; docDate: string; invoiceIds: string[];
}) {
  if (input.invoiceIds.length === 0) return [];
  const cod = await roleAccount(tx, input.companyId, "COD_RECEIVABLE");
  if (!cod) throw new Error("No account is set for COD Receivable. Point the COD_RECEIVABLE role at an asset account first.");
  const [courier] = await tx`select name from business_partner where id = ${input.courierId} and company_id = ${input.companyId}`;
  if (!courier) throw new Error("That courier no longer exists.");
  const invs = await tx`
    select d.id, d.doc_no, d.partner_id, d.payment_type, d.courier_id, d.status, d.location_id,
           coalesce(o.outstanding, 0)::float as outstanding
      from document d left join v_open_item o on o.document_id = d.id
     where d.id = any(${input.invoiceIds}::uuid[]) and d.company_id = ${input.companyId} and d.doc_type = 'SALES_INVOICE'`;
  if (invs.length !== new Set(input.invoiceIds).size) throw new Error("An invoice on this list no longer exists.");
  const byCustomer = new Map<string, { invoiceId: string; amount: number }[]>();
  for (const i of invs) {
    if (i.status !== "POSTED") throw new Error(`${i.doc_no} is ${String(i.status).toLowerCase()}.`);
    if (i.payment_type !== "COD" || i.courier_id !== input.courierId) throw new Error(`${i.doc_no} is not carried by ${courier.name}.`);
    if (!(Number(i.outstanding) > 0.005)) throw new Error(`${i.doc_no} has nothing left to collect.`);
    const list = byCustomer.get(i.partner_id) ?? [];
    list.push({ invoiceId: i.id, amount: round4(Number(i.outstanding)) });
    byCustomer.set(i.partner_id, list);
  }
  const posted = [];
  for (const [partnerId, allocations] of byCustomer) {
    const nos = invs.filter((i) => allocations.some((a) => a.invoiceId === i.id)).map((i) => i.doc_no).join(", ");
    posted.push(await postCustomerReceipt({
      companyId: input.companyId, partnerId, docDate: input.docDate, cashAccountId: cod, cashPartnerId: input.courierId,
      allocations, memo: `Collected by ${courier.name} · ${nos}`,
    }, tx));
  }
  return posted;
}

export type RemitInput = {
  companyId: string; courierId: string; docDate: string; locationId: string | null;
  /** Cash or bank the money arrived in. */
  moneyAccountId: string;
  /** What arrived, and what the courier kept back as its fee. */
  received: number; fee: number;
  /** Invoices collected with this payment and not marked before. */
  collectInvoiceIds: string[];
  reference?: string | null; memo?: string | null;
};

/**
 * The courier pays in. Marks any listed invoice collected first, then one
 * cash or bank voucher: Dr money (received), Dr Carriage Outward (fee),
 * Cr COD Receivable under the courier (both). It may not take out more
 * than the courier holds.
 */
export async function remitCourier(input: RemitInput, outer?: TransactionSql) {
  const received = round4(input.received), fee = round4(input.fee);
  if (received < 0 || fee < 0) throw new Error("Amounts cannot be negative.");
  if (!(received + fee > 0)) throw new Error("Enter what the courier paid in.");
  return inTransaction(outer, async (tx) => {
    const [money] = await tx`
      select id, is_cash_account from account
       where id = ${input.moneyAccountId} and company_id = ${input.companyId} and (is_cash_account or is_bank_account)`;
    if (!money) throw new Error("Choose the cash or bank account the money came into.");
    const cod = await roleAccount(tx, input.companyId, "COD_RECEIVABLE");
    const carriage = await roleAccount(tx, input.companyId, "CARRIAGE_OUTWARD");
    if (!cod) throw new Error("No account is set for COD Receivable.");
    if (fee > 0 && !carriage) throw new Error("No account is set for Carriage Outward. Point the CARRIAGE_OUTWARD role at an expense account first.");

    // Locked so two people paying in the same courier's money cannot both spend it.
    await tx`select id from business_partner where id = ${input.courierId} and company_id = ${input.companyId} for update`;
    await courierCollected(tx, { companyId: input.companyId, courierId: input.courierId, docDate: input.docDate, invoiceIds: input.collectInvoiceIds });
    const [h] = await tx`
      select coalesce(sum(base_amount), 0)::float as v from journal_line
       where company_id = ${input.companyId} and account_id = ${cod} and partner_id = ${input.courierId}`;
    const held = round4(Number(h.v));
    if (received + fee > held + 0.005) {
      throw new Error(`The courier holds ${held.toLocaleString("en-US")}; ${(received + fee).toLocaleString("en-US")} is more than that. Tick the invoices it collected.`);
    }
    const [courier] = await tx`select name from business_partner where id = ${input.courierId}`;
    const voucher = {
      companyId: input.companyId, docDate: input.docDate, locationId: input.locationId, partnerId: input.courierId,
      reference: input.reference ?? null, memo: input.memo || `Cash on delivery paid in by ${courier.name}`,
      lines: [
        ...(received > 0 ? [{ accountId: money.id as string, amount: received }] : []),
        ...(fee > 0 ? [{ accountId: carriage!, amount: fee }] : []),
        { accountId: cod, amount: -round4(received + fee), partnerId: input.courierId },
      ],
    };
    return money.is_cash_account ? postCashVoucher(voucher, tx) : postBankVoucher(voucher, tx);
  });
}
