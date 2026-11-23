/**
 * Cash on delivery carried by a courier company (0232, 0233).
 *
 * The courier delivers and collects; the shop learns of it from the courier
 * and confirms the parcel handed over (lib/cod.ts, the same rule as a
 * driver's doorstep handover). The customer is billed and settled at that
 * moment and the courier owes the money instead, in COD Receivable under its
 * name. When the courier pays in, it usually keeps its fee back: the cash or
 * bank takes what arrived, Carriage Outward the fee, and COD Receivable the
 * whole.
 *
 * Nothing is kept about either step beyond the documents: what a courier
 * holds is the balance of COD Receivable under it; what is still out with it
 * is its parcels not yet handed over or back.
 */

import { sql } from "./db";
import type { TransactionSql } from "postgres";
import { inTransaction, postBankVoucher, postCashVoucher, round4 } from "./posting";
import { confirmHandover, openParcels, type Parcel } from "./cod";

export type CodCourier = {
  id: string; code: string; name: string; phone: string | null;
  /** How it charges (0234): keeps its fee out of the pay-in, or bills it later. */
  feeMode: "DEDUCTED" | "BILLED";
  /** Parcels it is carrying, not yet handed over or back, and what they bill. */
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

/** Every courier, with what it is carrying, holding and has paid in. */
export async function codCouriers(companyId: string): Promise<CodCourier[]> {
  const [rows, parcels] = await Promise.all([sql`
    with held as (
      select jl.partner_id, sum(jl.base_amount) as held,
             -sum(jl.base_amount) filter (where jl.base_amount < 0) as remitted,
             max(je.entry_date) filter (where jl.base_amount < 0) as last_remitted
        from journal_line jl join journal_entry je on je.id = jl.journal_entry_id
       where jl.company_id = ${companyId}
         and jl.account_id = (select account_id from system_account where company_id = ${companyId} and role = 'COD_RECEIVABLE')
       group by jl.partner_id)
    select bp.id, bp.code, bp.name, bp.phone, bp.cod_fee_mode as "feeMode",
           coalesce(held.held, 0)::float as held, coalesce(held.remitted, 0)::float as remitted,
           held.last_remitted::text as "lastRemitted"
      from business_partner bp
      left join held on held.partner_id = bp.id
     where bp.company_id = ${companyId}
       and (bp.is_courier and bp.is_active or abs(coalesce(held.held, 0)) > 0.005
            or exists (select 1 from document t where t.courier_id = bp.id and t.doc_type = 'STOCK_TRANSFER'))`,
    openParcels(companyId)]);
  const list = (rows as unknown as Omit<CodCourier, "out" | "outCount">[]).map((c) => {
    const mine = parcels.filter((p) => p.collector?.kind === "COURIER" && p.collector.id === c.id && p.state !== "REFUSED");
    return { ...c, out: round4(mine.reduce((t, p) => t + p.due, 0)), outCount: mine.length };
  });
  return list.sort((a, b) => (b.held + b.out) - (a.held + a.out) || a.name.localeCompare(b.name));
}

/** Parcels out with couriers (not refused), oldest first. */
export async function courierParcels(companyId: string, courierId: string | null): Promise<Parcel[]> {
  return (await openParcels(companyId, courierId))
    .filter((p) => p.collector?.kind === "COURIER" && p.state !== "REFUSED");
}

/**
 * The courier reports these parcels delivered and paid: each is handed over
 * through the one doorstep rule, its money into COD Receivable under the
 * courier.
 */
export async function courierCollected(tx: TransactionSql, input: {
  companyId: string; courierId: string; docDate: string; parcelIds: string[]; userId?: string | null;
}) {
  const done = [];
  for (const id of input.parcelIds) {
    const [t] = await tx`select courier_id, doc_no from document where id = ${id} and company_id = ${input.companyId}`;
    if (!t || t.courier_id !== input.courierId) throw new Error(`${t?.doc_no ?? "That parcel"} is not with this courier.`);
    done.push(await confirmHandover(tx, { companyId: input.companyId, parcelId: id, docDate: input.docDate,
                                          payment: { to: "COURIER", amount: "DUE" }, userId: input.userId }));
  }
  return done;
}

export type RemitInput = {
  companyId: string; courierId: string; docDate: string; locationId: string | null;
  /** Cash or bank the money arrived in. */
  moneyAccountId: string;
  /** What arrived, and what the courier kept back as its fee. */
  received: number; fee: number;
  /** BILLED: it paid in everything; its fee comes on a bill, so none is booked here (0234). */
  feeMode?: "DEDUCTED" | "BILLED";
  /** Parcels collected with this payment and not confirmed before. */
  collectParcelIds: string[];
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
  if (input.feeMode === "BILLED" && fee > 0) {
    throw new Error("This courier bills its fee separately: record the full amount received now and the fee on its bill, so it is expensed once.");
  }
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
    await courierCollected(tx, { companyId: input.companyId, courierId: input.courierId, docDate: input.docDate, parcelIds: input.collectParcelIds });
    const [h] = await tx`
      select coalesce(sum(base_amount), 0)::float as v from journal_line
       where company_id = ${input.companyId} and account_id = ${cod} and partner_id = ${input.courierId}`;
    const held = round4(Number(h.v));
    if (received + fee > held + 0.005) {
      throw new Error(`The courier holds ${held.toLocaleString("en-US")}; ${(received + fee).toLocaleString("en-US")} is more than that. Tick the parcels it collected.`);
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
