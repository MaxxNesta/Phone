/**
 * What couriers are owed: landed-cost charges posted with a payee and no bill
 * behind them, each a debt in Payable (Other) under that payee until a
 * courier payment settles it.
 *
 * The open amount is always worked out from the charge and the payments that
 * name it, never kept on the charge, so it cannot drift from either. A
 * payment whose voucher was voided keeps its settlement rows for the record
 * and stops counting.
 */

import { sql } from "./db";
import type { TransactionSql } from "postgres";
import { inTransaction, postCashVoucher, postBankVoucher, round4 } from "./posting";
import * as L from "./landed-cost";

export type CourierBalance = {
  partner_id: string; partner_code: string; partner_name: string; phone: string | null;
  charges: number; owed: number; paid: number; outstanding: number;
  open_charges: number; last_charge: string | null; last_paid: string | null;
};

/** The charges that are debts: posted, active, owed to a payee. */
const owed = () => sql`
  c.is_active and c.owed_account_id is not null and c.partner_id is not null
  and lc.status = 'POSTED'`;

/** What has been paid on charge `c`, by payments still standing. */
const paidOn = () => sql`
  (select coalesce(sum(s.amount), 0) from courier_settlement s
     join document p on p.id = s.payment_id and p.status = 'POSTED'
    where s.charge_id = c.id)`;

/** One row per courier with anything owed, ever. */
export async function courierBalances(companyId: string, locs: string[] | null): Promise<CourierBalance[]> {
  const rows = await sql`
    with ch as (
      select c.id, c.partner_id, c.base_amount as owed, lc.doc_date, ${paidOn()} as paid
        from landed_cost_charge c join document lc on lc.id = c.landed_cost_id
       where lc.company_id = ${companyId} and ${owed()}
         ${locs ? sql`and lc.location_id = any(${locs})` : sql``})
    select bp.id as partner_id, bp.code as partner_code, bp.name as partner_name, bp.phone,
           count(*)::int as charges, sum(ch.owed)::float as owed, sum(ch.paid)::float as paid,
           sum(ch.owed - ch.paid)::float as outstanding,
           count(*) filter (where ch.owed - ch.paid > 0.0001)::int as open_charges,
           max(ch.doc_date)::text as last_charge,
           (select max(p.doc_date)::text from courier_settlement s join document p on p.id = s.payment_id
             where p.status = 'POSTED' and s.charge_id in (select id from ch c2 where c2.partner_id = bp.id)) as last_paid
      from ch join business_partner bp on bp.id = ch.partner_id
     group by bp.id
     order by sum(ch.owed - ch.paid) desc, bp.name`;
  return rows as unknown as CourierBalance[];
}

/** A document to link to: its id and number. */
export type DocRef = { id: string; no: string };

export type CourierCharge = {
  id: string; lc_id: string; lc_no: string; doc_date: string; cost_type: string; reference: string | null;
  receipts: DocRef[]; phones: number; owed: number; paid: number; open: number;
};

/** Every charge owed to one courier, newest first, with what is still open. */
export async function courierCharges(companyId: string, partnerId: string, locs: string[] | null): Promise<CourierCharge[]> {
  const rows = await sql`
    select c.id, lc.id as lc_id, lc.doc_no as lc_no, lc.doc_date::text as doc_date, t.name as cost_type, c.reference,
           coalesce((select json_agg(json_build_object('id', r.id, 'no', r.doc_no) order by r.doc_no)
               from landed_cost_receipt x join document r on r.id = x.receipt_id where x.landed_cost_id = lc.id), '[]'::json) as receipts,
           (select count(*)::int from landed_cost_allocation a where a.charge_id = c.id) as phones,
           c.base_amount::float as owed, ${paidOn()}::float as paid
      from landed_cost_charge c
      join document lc on lc.id = c.landed_cost_id
      join landed_cost_type t on t.id = c.cost_type_id
     where lc.company_id = ${companyId} and c.partner_id = ${partnerId} and ${owed()}
       ${locs ? sql`and lc.location_id = any(${locs})` : sql``}
     order by lc.doc_date desc, lc.doc_no desc, c.line_no`;
  return (rows as unknown as Omit<CourierCharge, "open">[]).map((r) => ({ ...r, open: round4(r.owed - r.paid) }));
}

export type CourierPayment = {
  id: string; doc_no: string; doc_date: string; status: string; account: string; total: number;
  reference: string | null; memo: string | null; lines: { lc_id: string; lc_no: string; cost_type: string; amount: number }[];
};

/** The payments made to one courier, voided ones included and marked. */
export async function courierPayments(companyId: string, partnerId: string): Promise<CourierPayment[]> {
  const rows = await sql`
    select p.id, p.doc_no, p.doc_date::text as doc_date, p.status, p.reference, p.memo,
           sum(s.amount)::float as total,
           (select a.code || ' ' || a.name from journal_line jl join account a on a.id = jl.account_id
             where jl.journal_entry_id = p.journal_entry_id and jl.base_amount < 0 limit 1) as account,
           json_agg(json_build_object('lc_id', lc.id, 'lc_no', lc.doc_no, 'cost_type', t.name, 'amount', s.amount::float)
                    order by lc.doc_no) as lines
      from courier_settlement s
      join document p on p.id = s.payment_id
      join landed_cost_charge c on c.id = s.charge_id
      join document lc on lc.id = c.landed_cost_id
      join landed_cost_type t on t.id = c.cost_type_id
     where s.company_id = ${companyId} and c.partner_id = ${partnerId}
     group by p.id
     order by p.doc_date desc, p.doc_no desc`;
  return rows as unknown as CourierPayment[];
}

/** Cash and bank accounts a courier can be paid from. */
export async function moneyAccounts(companyId: string) {
  return sql`
    select id, code, name, is_bank_account from account
     where company_id = ${companyId} and is_active and is_postable and (is_cash_account or is_bank_account)
     order by is_bank_account, code` as unknown as Promise<{ id: string; code: string; name: string; is_bank_account: boolean }[]>;
}

export type PayCourierInput = {
  companyId: string; partnerId: string; docDate: string; locationId: string | null;
  moneyAccountId: string; reference?: string | null; memo?: string | null;
  allocations: { chargeId: string; amount: number }[];
};

/**
 * Pay a courier against the charges named: one cash or bank voucher, debiting
 * each charge's payable under the courier and crediting the till, and a
 * settlement row per charge. All or nothing; the charges are locked first so
 * two people paying the same driver at once queue rather than both pay.
 */
export async function payCourier(input: PayCourierInput) {
  const allocations = input.allocations.filter((a) => a.amount > 0);
  if (allocations.length === 0) throw new Error("Enter an amount against at least one charge.");
  return inTransaction(undefined, async (tx) => {
    const ids = allocations.map((a) => a.chargeId);
    const charges = await tx`
      select c.id, c.partner_id, c.owed_account_id, c.base_amount::float as owed, lc.doc_no, lc.status, c.is_active
        from landed_cost_charge c join document lc on lc.id = c.landed_cost_id
       where c.id = any(${ids}::uuid[]) and lc.company_id = ${input.companyId}
       order by c.id for update of c`;
    if (charges.length !== ids.length) throw new Error("A charge on this payment no longer exists.");
    const [money] = await tx`
      select id, is_cash_account, is_bank_account from account
       where id = ${input.moneyAccountId} and company_id = ${input.companyId} and (is_cash_account or is_bank_account)`;
    if (!money) throw new Error("Choose the cash or bank account the money is paid from.");

    const debits = new Map<string, number>();
    for (const a of allocations) {
      const c = charges.find((x) => x.id === a.chargeId)!;
      if (c.partner_id !== input.partnerId) throw new Error(`${c.doc_no} is owed to someone else.`);
      if (!c.is_active || c.status !== "POSTED" || !c.owed_account_id) throw new Error(`${c.doc_no} is not owed to anyone now.`);
      const [paid] = await tx`
        select coalesce(sum(s.amount), 0)::float as v from courier_settlement s
          join document p on p.id = s.payment_id and p.status = 'POSTED' where s.charge_id = ${c.id}`;
      const open = round4(c.owed - Number(paid.v));
      if (a.amount > open + 0.0001) throw new Error(`${c.doc_no} has ${open.toLocaleString("en-US")} open; ${a.amount.toLocaleString("en-US")} is more than that.`);
      debits.set(c.owed_account_id, round4((debits.get(c.owed_account_id) ?? 0) + a.amount));
    }
    const total = round4(allocations.reduce((s, a) => s + a.amount, 0));
    const voucher = {
      companyId: input.companyId, docDate: input.docDate, locationId: input.locationId,
      partnerId: input.partnerId, reference: input.reference ?? null, memo: input.memo ?? null,
      lines: [
        ...[...debits].map(([accountId, amount]) => ({ accountId, amount, partnerId: input.partnerId })),
        { accountId: money.id as string, amount: -total },
      ],
    };
    const posted = money.is_cash_account ? await postCashVoucher(voucher, tx) : await postBankVoucher(voucher, tx);
    for (const a of allocations) {
      await tx`
        insert into courier_settlement (company_id, payment_id, charge_id, amount)
        values (${input.companyId}, ${posted.id}, ${a.chargeId}, ${a.amount})`;
    }
    return posted;
  });
}

export type CourierBillInput = {
  companyId: string; userId: string | null; partnerId: string; docDate: string; receiptIds: string[];
  amount: number; method?: "EQUAL" | "VALUE"; costTypeId?: string | null; reference?: string | null; notes?: string | null;
  /** Paid on the spot from this cash or bank account: nothing is owed, so no courier is needed. */
  paidFromAccountId?: string | null;
};

/**
 * A courier's charge for goods already received, booked and spread in one
 * go: a landed cost with that one charge, calculated and posted inside the
 * caller's transaction. Posting writes Dr Carriage Inward / Cr Payable
 * (Other) under the courier, and the spread Dr Inventory / Cr Carriage
 * Inward. Used by Record courier bill, and by a goods receipt that carries
 * its courier's charge, so the receipt and the charge post or fail together.
 */
export async function courierBill(tx: TransactionSql, input: CourierBillInput) {
  if (!(input.amount > 0)) throw new Error("Enter the courier's charge.");
  const paid = input.paidFromAccountId || null;
  if (!paid && !input.partnerId) throw new Error("Choose the courier the charge is owed to.");
  const [courier] = input.partnerId
    ? await tx`select name from business_partner where id = ${input.partnerId} and company_id = ${input.companyId}` : [{ name: null }];
  if (!courier) throw new Error("That courier was not found.");
  let costTypeId = input.costTypeId || null;
  if (!costTypeId) {
    const [t] = await tx`
      select id from landed_cost_type where company_id = ${input.companyId} and is_active
       order by (code = 'CARRIAGE') desc, (code = 'LOCAL') desc, name limit 1`;
    if (!t) throw new Error("Set up a landed cost type first (Settings → Purchasing → Landed cost types).");
    costTypeId = t.id as string;
  }
  const actor = { companyId: input.companyId, userId: input.userId };
  const head = { docDate: input.docDate, receiptIds: input.receiptIds, shipmentRef: input.reference ?? null,
                 carrierRef: (courier.name as string | null) ?? null, notes: input.notes ?? null };

  // Paid on the spot: the money leaves the till now, Dr Carriage Inward /
  // Cr the till, and the landed cost spreads that line onto the phones, so
  // nothing is owed and the courier's name is optional.
  let sourceJournalLineId: string | null = null;
  if (paid) {
    const [money] = await tx`
      select id, is_cash_account from account
       where id = ${paid} and company_id = ${input.companyId} and (is_cash_account or is_bank_account)`;
    if (!money) throw new Error("Choose the cash or bank account the courier was paid from.");
    const [via] = await tx`
      select account_id from system_account where company_id = ${input.companyId}
         and role in ('CARRIAGE_INWARD', 'LANDED_COST_CLEARING') order by (role = 'CARRIAGE_INWARD') desc limit 1`;
    if (!via) throw new Error("Set the Carriage Inward account first (Settings → Accounts).");
    const [branch] = await tx`
      select coalesce(l.parent_id, l.id) as id from document d join location l on l.id = d.location_id
       where d.id = ${input.receiptIds[0]}`;
    const voucher = {
      companyId: input.companyId, docDate: input.docDate, locationId: branch?.id ?? null,
      partnerId: input.partnerId || null, reference: input.reference ?? null,
      memo: input.notes ?? "Courier charge, paid on delivery",
      lines: [{ accountId: via.account_id as string, amount: input.amount, partnerId: input.partnerId || null },
              { accountId: money.id as string, amount: -input.amount }],
    };
    const v = money.is_cash_account ? await postCashVoucher(voucher, tx) : await postBankVoucher(voucher, tx);
    const [line] = await tx`
      select jl.id from journal_line jl join document d on d.journal_entry_id = jl.journal_entry_id
       where d.id = ${v.id} and jl.base_amount > 0`;
    sourceJournalLineId = line.id as string;
  }

  const lc = await L.createLandedCost({ ...actor, ...head }, tx);
  await L.saveLandedCost({
    ...actor, ...head, id: lc.id,
    charges: [{ costTypeId, partnerId: input.partnerId || null, amount: input.amount, method: input.method ?? "EQUAL",
                sourceJournalLineId, reference: input.reference ?? null, description: input.notes ?? null }],
  }, tx);
  await L.acknowledgeExcluded({ ...actor, id: lc.id }, tx);
  await L.calculateLandedCost({ ...actor, id: lc.id }, tx);
  await L.postLandedCost({ ...actor, id: lc.id }, tx);
  return lc;
}
