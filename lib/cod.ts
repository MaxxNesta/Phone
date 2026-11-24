/**
 * Cash on delivery: dispatch, handover, failed attempts, returns, and the
 * driver's cash (0233).
 *
 * A COD invoice (ar_on_handover) posts nothing. Its stock goes out in
 * parcels: each parcel is a stock transfer from the warehouse to its Out for
 * delivery bin, naming the invoice and the driver or courier carrying it.
 * Every way a parcel can be closed runs through this file:
 *
 *   confirmHandover   paid at the door: a delivery from the bin bills and
 *                     costs what it hands over, deposits for the invoice are
 *                     applied, the rest is a receipt into whoever holds the
 *                     money (Cash with Drivers, a verified bank or wallet, or
 *                     COD Receivable under the courier). All or nothing.
 *   notHome / refused events only; a refused parcel is returning.
 *   receiveReturn     the same IMEIs scanned back in: a transfer from the bin
 *                     to the warehouse.
 *
 * The invoice screen, the trip stop and the courier pay-in all call these, so
 * the rule is checked once.
 */

import { sql } from "./db";
import type { TransactionSql } from "postgres";
import { collect } from "./cod-collect";
export { collectText, collectTotal } from "./cod-collect";
import {
  applyAdvance, inTransaction, postCashVoucher, postCustomerReceipt, postDelivery, postStockAdjustment, postStockTransfer, round4,
} from "./posting";

type Db = typeof sql | TransactionSql;

export type ParcelState = "OUT" | "NOT_HOME" | "REFUSED" | "RETURNED" | "HANDED_OVER" | "LOST";
export type Collector = { kind: "DRIVER" | "COURIER"; id: string; name: string };

export type Parcel = {
  id: string; no: string; date: string; invoiceId: string; invoiceNo: string;
  customerId: string; customer: string; warehouseId: string; binId: string;
  /** The branch the warehouse belongs to, for the money side. */
  branchId: string;
  collector: Collector | null;
  state: ParcelState; lastReason: string | null; retryOn: string | null; lastAt: string | null;
  /** The delivery that handed it over, or the transfer that brought it back. */
  closedBy: string | null; closedByNo: string | null;
  lines: { lineId: string; itemId: string; item: string; qty: number; serials: string[]; focReasonId: string | null }[];
  /** What handing it over bills: its goods at the invoice's prices, with the charge and services if nothing was handed over before. */
  due: number;
  /** Its goods alone, the charge and services still unbilled, the invoice's unused deposit, and the goods on its other open parcels. */
  goods: number; extras: number; deposit: number; othersGoods: number;
  /** The invoice's other parcels still out, by number. */
  others: string[];
  /** Cash to take at the door: handed over now, and if every other open parcel goes first. */
  collectNow: number; collectLast: number;
};

const PARCELS = (db: Db, where: ReturnType<typeof sql>) => db`
  select t.id, t.doc_no as no, t.doc_date::text as date, t.source_document_id as "invoiceId", i.doc_no as "invoiceNo",
         i.partner_id as "customerId", bp.name as customer, t.location_id as "warehouseId", t.to_location_id as "binId",
         (select coalesce(l.parent_id, l.id) from location l where l.id = t.location_id) as "branchId",
         t.driver_id, t.courier_id, dr.name as driver_name, cr.name as courier_name,
         (select json_build_object('kind', e.kind, 'reason', e.reason, 'retry', e.retry_on::text, 'at', e.created_at,
                                   'doc', e.document_id, 'docNo', ed.doc_no)
            from dispatch_event e left join document ed on ed.id = e.document_id
           where e.parcel_id = t.id
             and (e.document_id is null or ed.status = 'POSTED')
           order by e.created_at desc, e.id desc limit 1) as last,
         (select json_agg(json_build_object('lineId', dl.source_line_id, 'itemId', dl.item_id, 'item', it.code || ' · ' || it.name,
                  'qty', dl.base_qty::float, 'foc', il.foc_reason_id,
                  'serials', coalesce((select json_agg(ss.serial_no order by ss.serial_no)
                                         from stock_movement sm join stock_serial_issue si on si.stock_movement_id = sm.id
                                         join stock_serial ss on ss.id = si.serial_id
                                        where sm.document_line_id = dl.id and sm.qty < 0), '[]'::json))
                  order by dl.line_no)
            from document_line dl join item it on it.id = dl.item_id
            left join document_line il on il.id = dl.source_line_id
           where dl.document_id = t.id) as lines,
         -- Its goods at the invoice's prices (gross, so tax with them) ...
         (select coalesce(sum(il.gross_amount / nullif(il.base_qty, 0) * dl.base_qty), 0)::float
            from document_line dl join document_line il on il.id = dl.source_line_id
           where dl.document_id = t.id and il.foc_reason_id is null) as goods,
         -- Deposits taken for the invoice and not yet applied.
         (select coalesce(sum(v.available), 0)::float from v_partner_advance v join document a on a.id = v.payment_id
           where a.source_document_id = i.id and a.doc_type = 'CUSTOMER_RECEIPT' and a.status = 'POSTED') as deposit,
         -- The goods on the invoice's other parcels still out.
         (select coalesce(sum(il.gross_amount / nullif(il.base_qty, 0) * sl.base_qty), 0)::float
            from document s join location sb on sb.id = s.to_location_id and sb.is_transit
            join document_line sl on sl.document_id = s.id
            join document_line il on il.id = sl.source_line_id and il.foc_reason_id is null
           where s.source_document_id = i.id and s.id <> t.id and s.doc_type = 'STOCK_TRANSFER' and s.status = 'POSTED'
             and not exists (select 1 from dispatch_event e left join document ed on ed.id = e.document_id
                              where e.parcel_id = s.id and (e.kind = 'REFUSED' or (e.kind in ('HANDED_OVER', 'RETURNED', 'LOST') and ed.status = 'POSTED')))
         ) as others_goods,
         array(select s.doc_no from document s join location sb on sb.id = s.to_location_id and sb.is_transit
                where s.source_document_id = i.id and s.id <> t.id and s.doc_type = 'STOCK_TRANSFER' and s.status = 'POSTED'
                  and not exists (select 1 from dispatch_event e left join document ed on ed.id = e.document_id
                                   where e.parcel_id = s.id and (e.kind = 'REFUSED' or (e.kind in ('HANDED_OVER', 'RETURNED', 'LOST') and ed.status = 'POSTED')))
                order by s.doc_no) as others,
         -- ... and, while nothing has been handed over, the charge and services.
         (case when exists (select 1 from sales_billed_on_handover h join document hd on hd.id = h.document_id and hd.status = 'POSTED'
                             where h.invoice_id = i.id) then 0
               else coalesce(i.delivery_fee, 0) + coalesce((select sum(il.gross_amount) from document_line il join item it on it.id = il.item_id
                                                             where il.document_id = i.id and not it.is_stocked and il.foc_reason_id is null), 0)
          end)::float as extras
    from document t
    join document i on i.id = t.source_document_id and i.ar_on_handover
    join location b on b.id = t.to_location_id and b.is_transit
    join business_partner bp on bp.id = i.partner_id
    left join driver dr on dr.id = t.driver_id
    left join business_partner cr on cr.id = t.courier_id
   where t.doc_type = 'STOCK_TRANSFER' and t.status = 'POSTED' and ${where}
   order by t.doc_date, t.doc_no`;

function toParcel(r: Record<string, unknown>): Parcel {
  const last = r.last as { kind: string; reason: string | null; retry: string | null; at: string; doc: string | null; docNo: string | null } | null;
  const state: ParcelState = !last ? "OUT"
    : last.kind === "HANDED_OVER" ? "HANDED_OVER"
    : last.kind === "RETURNED" ? "RETURNED"
    : last.kind === "LOST" ? "LOST"
    : last.kind === "REFUSED" ? "REFUSED"
    : last.kind === "NOT_HOME" ? "NOT_HOME" : "OUT";
  return {
    id: r.id as string, no: r.no as string, date: r.date as string, invoiceId: r.invoiceId as string, invoiceNo: r.invoiceNo as string,
    customerId: r.customerId as string, customer: r.customer as string, warehouseId: r.warehouseId as string, binId: r.binId as string,
    branchId: r.branchId as string,
    collector: r.driver_id ? { kind: "DRIVER", id: r.driver_id as string, name: r.driver_name as string }
      : r.courier_id ? { kind: "COURIER", id: r.courier_id as string, name: r.courier_name as string } : null,
    state, lastReason: last?.reason ?? null, retryOn: last?.retry ?? null, lastAt: last?.at ?? null,
    closedBy: state === "HANDED_OVER" || state === "RETURNED" || state === "LOST" ? last!.doc : null,
    closedByNo: state === "HANDED_OVER" || state === "RETURNED" || state === "LOST" ? last!.docNo : null,
    lines: ((r.lines as Array<{ lineId: string; itemId: string; item: string; qty: number; serials: string[]; foc: string | null }>) ?? [])
      .map((l) => ({ lineId: l.lineId, itemId: l.itemId, item: l.item, qty: Number(l.qty), serials: l.serials ?? [], focReasonId: l.foc })),
    due: round4(Number(r.goods) + Number(r.extras)),
    ...collect(Number(r.goods), Number(r.extras), Number(r.deposit), Number(r.others_goods)),
    others: (r.others as string[]) ?? [],
  };
}

/** Every parcel of one invoice. */
export async function invoiceParcels(invoiceId: string, db: Db = sql): Promise<Parcel[]> {
  return (await PARCELS(db, sql`t.source_document_id = ${invoiceId}`)).map(toParcel);
}

/** One parcel, locked when inside a transaction that will close it. */
export async function parcel(parcelId: string, db: Db = sql): Promise<Parcel | null> {
  const [r] = await PARCELS(db, sql`t.id = ${parcelId}`);
  return r ? toParcel(r) : null;
}

/** Parcels still out (not handed over or back in the warehouse), for one courier or every collector. */
export async function openParcels(companyId: string, courierId?: string | null): Promise<Parcel[]> {
  return (await PARCELS(sql, sql`t.company_id = ${companyId} ${courierId ? sql`and t.courier_id = ${courierId}` : sql``}
      and not exists (select 1 from dispatch_event e join document ed on ed.id = e.document_id and ed.status = 'POSTED'
                       where e.parcel_id = t.id and e.kind in ('HANDED_OVER', 'RETURNED', 'LOST'))`)).map(toParcel);
}

async function collectorOf(db: Db, companyId: string, c: { driverId?: string | null; courierId?: string | null }) {
  if (!!c.driverId === !!c.courierId) throw new Error("Choose who carries it: one of your drivers, or a courier company.");
  if (c.driverId) {
    const [d] = await db`select name from driver where id = ${c.driverId} and company_id = ${companyId} and is_active`;
    if (!d) throw new Error("That driver is not on the driver list.");
  } else {
    const [k] = await db`select name from business_partner where id = ${c.courierId!} and company_id = ${companyId} and is_courier and is_active`;
    if (!k) throw new Error("That courier is not on the courier list.");
  }
}

/** What each line of a COD invoice still has to go out: ordered, less what is out or handed over, plus what came back. */
export async function undispatched(invoiceId: string, db: Db = sql) {
  return (await db`
    select dl.id as "lineId", dl.item_id as "itemId", it.code || ' · ' || it.name as item, it.tracks_serial as serial,
           (dl.base_qty - coalesce((
              select sum(case when tb.is_transit then tl.base_qty else -tl.base_qty end)
                from document_line tl join document t on t.id = tl.document_id and t.status = 'POSTED' and t.doc_type = 'STOCK_TRANSFER'
                join location tb on tb.id = t.to_location_id
                join location fb on fb.id = t.location_id
               where tl.source_line_id = dl.id and (tb.is_transit or fb.is_transit)), 0)
           + coalesce((select sum(ll.base_qty) from document_line ll
                         join dispatch_event le on le.parcel_id = ll.document_id and le.kind = 'LOST'
                         join document led on led.id = le.document_id and led.status = 'POSTED'
                        where ll.source_line_id = dl.id), 0))::float as qty
      from document_line dl join item it on it.id = dl.item_id
     where dl.document_id = ${invoiceId} and it.is_stocked
     order by dl.line_no`) as unknown as { lineId: string; itemId: string; item: string; serial: boolean; qty: number }[];
}

/**
 * Send a COD invoice's goods out with a driver or courier: the warehouse to
 * its Out for delivery bin. Lines left out send everything not yet out.
 */
export async function codDispatch(tx: TransactionSql, input: {
  companyId: string; invoiceId: string; docDate: string;
  driverId?: string | null; courierId?: string | null;
  lines?: { lineId: string; qty: number; serials?: string[] }[];
}) {
  const [inv] = await tx`
    select id, doc_no, partner_id, location_id, status, ar_on_handover, reversed_by_document_id
      from document where id = ${input.invoiceId} and company_id = ${input.companyId} and doc_type = 'SALES_INVOICE'
       for update`;
  if (!inv || inv.status !== "POSTED" || !inv.ar_on_handover) throw new Error("Only a posted cash-on-delivery invoice is dispatched this way.");
  await collectorOf(tx, input.companyId, input);
  const open = await undispatched(inv.id, tx);
  const wanted = input.lines ?? open.filter((l) => l.qty > 0).map((l) => ({ lineId: l.lineId, qty: l.qty, serials: [] as string[] }));
  const lines = wanted.filter((w) => w.qty > 0).map((w) => {
    const o = open.find((l) => l.lineId === w.lineId);
    if (!o) throw new Error("That line is not on this invoice.");
    if (w.qty > o.qty + 0.0001) throw new Error(`${o.item}: only ${o.qty} left to dispatch.`);
    if (o.serial && (w.serials?.length ?? 0) !== w.qty) throw new Error(`${o.item}: scan the ${w.qty} IMEI${w.qty === 1 ? "" : "s"} going out.`);
    return { itemId: o.itemId, qty: w.qty, serials: o.serial ? w.serials : undefined, sourceLineId: o.lineId };
  });
  if (lines.length === 0) throw new Error(`Everything on ${inv.doc_no} is already out or handed over.`);
  const [bin] = await tx`select fn_transit_location(${inv.location_id}) as id`;
  return postStockTransfer({
    companyId: input.companyId, fromLocationId: inv.location_id, toLocationId: bin.id, docDate: input.docDate,
    memo: `Dispatched for ${inv.doc_no}: cash on delivery`, reference: inv.doc_no,
    sourceDocumentId: inv.id, partnerId: inv.partner_id, driverId: input.driverId ?? null, courierId: input.courierId ?? null,
    lines,
  }, tx);
}

export type Payment = {
  /** Who now holds the money: the driver in cash, the company's own bank or wallet, or the courier. */
  to: "DRIVER" | "ACCOUNT" | "COURIER";
  /** What was paid; "DUE" when a courier reports the parcel paid in full. */
  amount: number | "DUE";
  /** ACCOUNT: the bank or wallet account it went into, and that someone saw it arrive. */
  accountId?: string | null;
  verified?: boolean;
  reference?: string | null;
};

async function role(db: Db, companyId: string, r: string) {
  const [x] = await db`select account_id from system_account where company_id = ${companyId} and role = ${r}`;
  return (x?.account_id as string | undefined) ?? null;
}

/** Where a payment lands, and under whom. */
async function paymentTarget(db: Db, companyId: string, p: Parcel, pay: Payment) {
  if (pay.to === "DRIVER") {
    if (p.collector?.kind !== "DRIVER") throw new Error("Cash with a driver needs the parcel to be with one of your drivers.");
    const a = await role(db, companyId, "CASH_WITH_DRIVERS");
    if (!a) throw new Error("No account is set for Cash with Drivers. Point the CASH_WITH_DRIVERS role at an asset account first.");
    return { accountId: a, driverId: p.collector.id, partnerId: null as string | null };
  }
  if (pay.to === "COURIER") {
    if (p.collector?.kind !== "COURIER") throw new Error("Collected by a courier needs the parcel to be with a courier.");
    const a = await role(db, companyId, "COD_RECEIVABLE");
    if (!a) throw new Error("No account is set for COD Receivable.");
    return { accountId: a, driverId: null, partnerId: p.collector.id };
  }
  if (!pay.verified) throw new Error("A transfer still pending is not payment: the phone stays with the driver until it shows in the account.");
  const [a] = await db`
    select id from account where id = ${pay.accountId ?? null} and company_id = ${companyId} and (is_cash_account or is_bank_account) and is_postable`;
  if (!a) throw new Error("Choose the bank or wallet account the customer paid into.");
  return { accountId: a.id as string, driverId: null, partnerId: null };
}

/**
 * Paid at the door: hand the parcel over. Refused unless the parcel is out
 * and the money covers what it bills, after the invoice's deposits. The
 * delivery, the deposits applied, the receipt and the event post together.
 * A second confirmation finds the parcel already handed over and is refused.
 */
export async function confirmHandover(tx: TransactionSql, input: {
  companyId: string; parcelId: string; docDate: string; payment: Payment; userId?: string | null;
}) {
  // Locked first: two confirmations of one parcel queue here, and the second sees it handed over.
  const [lock] = await tx`select id from document where id = ${input.parcelId} and company_id = ${input.companyId} for update`;
  if (!lock) throw new Error("That parcel no longer exists.");
  const p = await parcel(input.parcelId, tx);
  if (!p) throw new Error("That is not a cash-on-delivery parcel.");
  if (p.state === "HANDED_OVER") throw new Error(`${p.no} was already handed over (${p.closedByNo}).`);
  if (p.state === "RETURNED") throw new Error(`${p.no} came back to the shop (${p.closedByNo}).`);
  if (p.state === "REFUSED") throw new Error(`${p.no} was refused and is on its way back. Receive it, then dispatch again.`);
  const target = await paymentTarget(tx, input.companyId, p, input.payment);

  const delivery = await postDelivery({
    companyId: input.companyId, partnerId: p.customerId, locationId: p.binId, journalLocationId: p.warehouseId,
    docDate: input.docDate, sourceDocumentId: p.invoiceId, cod: true,
    driverId: p.collector?.kind === "DRIVER" ? p.collector.id : null,
    courierId: p.collector?.kind === "COURIER" ? p.collector.id : null,
    memo: `Handed over ${p.no} · ${p.invoiceNo}`,
    lines: p.lines.map((l) => ({ itemId: l.itemId, qty: l.qty, sourceLineId: l.lineId,
                                 serials: l.serials.length ? l.serials : undefined, focReasonId: l.focReasonId })),
  }, tx);
  const [b] = await tx`select coalesce(sum(amount), 0)::float as v from sales_billed_on_handover where document_id = ${delivery.id}`;
  const billed = round4(Number(b.v));

  // Deposits taken for this invoice, oldest first.
  let applied = 0;
  const deposits = await tx`
    select v.payment_id, v.available::float as available from v_partner_advance v join document d on d.id = v.payment_id
     where d.source_document_id = ${p.invoiceId} and d.doc_type = 'CUSTOMER_RECEIPT' and d.status = 'POSTED' and v.available > 0
     order by d.doc_date, d.doc_no`;
  const use: { paymentId: string; amount: number }[] = [];
  for (const d of deposits) {
    const take = round4(Math.min(Number(d.available), billed - applied));
    if (take <= 0) break;
    use.push({ paymentId: d.payment_id as string, amount: take });
    applied = round4(applied + take);
  }
  if (use.length > 0) {
    await applyAdvance({ companyId: input.companyId, invoiceId: p.invoiceId, allocations: use, docDate: input.docDate,
                         memo: `Deposit applied on handover of ${p.no}` }, tx);
  }

  const due = round4(billed - applied);
  const paid = input.payment.amount === "DUE" ? due : round4(input.payment.amount);
  if (paid + 0.005 < due) {
    throw new Error(`${p.no} comes to ${due.toLocaleString("en-US")} after deposits; ${paid.toLocaleString("en-US")} does not cover it. `
      + `The phone stays with the ${p.collector?.kind === "COURIER" ? "courier" : "driver"}: record what was paid as a partial payment.`);
  }
  if (paid > due + 0.005) {
    throw new Error(`${p.no} comes to ${due.toLocaleString("en-US")} after deposits; ${paid.toLocaleString("en-US")} is more than that.`);
  }

  let receipt: { id: string; docNo: string } | null = null;
  if (due > 0) {
    receipt = await postCustomerReceipt({
      companyId: input.companyId, partnerId: p.customerId, docDate: input.docDate,
      cashAccountId: target.accountId, cashPartnerId: target.partnerId, driverId: target.driverId,
      allocations: [{ invoiceId: p.invoiceId, amount: due }],
      reference: input.payment.reference ?? null,
      memo: `Cash on delivery · ${p.no} · ${p.invoiceNo}${p.collector ? ` · ${p.collector.name}` : ""}`,
    }, tx);
  }

  await tx`
    insert into dispatch_event (company_id, parcel_id, invoice_id, kind, holder, document_id, acted_by)
    values (${input.companyId}, ${p.id}, ${p.invoiceId}, 'HANDED_OVER', ${p.collector?.name ?? null}, ${delivery.id}, ${input.userId ?? null})`;
  await tx`update delivery_trip_stop set status = 'DELIVERED', delivered_at = now(), failure_reason = null where document_id = ${p.id}`;
  return { delivery, receipt, billed, deposits: applied, due };
}

/**
 * Money taken before the phone is handed over: a partial payment, or a transfer
 * that arrived before the driver did. Kept as a deposit for the invoice and
 * applied once, at handover.
 */
export async function recordDeposit(tx: TransactionSql, input: {
  companyId: string; parcelId: string; docDate: string; payment: Payment;
}) {
  const p = await parcel(input.parcelId, tx);
  if (!p) throw new Error("That is not a cash-on-delivery parcel.");
  if (p.state === "HANDED_OVER" || p.state === "RETURNED") throw new Error(`${p.no} is closed.`);
  const amount = input.payment.amount === "DUE" ? 0 : round4(input.payment.amount);
  if (!(amount > 0)) throw new Error("Enter the amount paid.");
  const target = await paymentTarget(tx, input.companyId, p, input.payment);
  return postCustomerReceipt({
    companyId: input.companyId, partnerId: p.customerId, docDate: input.docDate,
    cashAccountId: target.accountId, cashPartnerId: target.partnerId, driverId: target.driverId,
    allocations: [], advance: amount, locationId: p.warehouseId, sourceDocumentId: p.invoiceId,
    reference: input.payment.reference ?? null,
    memo: `Deposit for ${p.invoiceNo} · ${p.no}`,
  }, tx);
}

/** The customer was not there: the parcel stays with its driver or courier for another try. */
export async function notHome(db: Db, input: { companyId: string; parcelId: string; reason: string; retryOn?: string | null; userId?: string | null }) {
  const p = await parcel(input.parcelId, db);
  if (!p) throw new Error("That is not a cash-on-delivery parcel.");
  if (p.state !== "OUT" && p.state !== "NOT_HOME") throw new Error(`${p.no} is not out for delivery.`);
  if (!input.reason.trim()) throw new Error("Say what happened: nobody home, phone off, wrong address.");
  await db`
    insert into dispatch_event (company_id, parcel_id, invoice_id, kind, reason, retry_on, holder, acted_by)
    values (${input.companyId}, ${p.id}, ${p.invoiceId}, 'NOT_HOME', ${input.reason.trim()}, ${input.retryOn || null},
            ${p.collector?.name ?? null}, ${input.userId ?? null})`;
  await db`update delivery_trip_stop set status = 'FAILED', failure_reason = ${input.reason.trim()} where document_id = ${p.id}`;
}

/** The customer refused it: it comes back. The phone stays out of stock until it is scanned in. */
export async function refused(db: Db, input: { companyId: string; parcelId: string; reason: string; userId?: string | null }) {
  const p = await parcel(input.parcelId, db);
  if (!p) throw new Error("That is not a cash-on-delivery parcel.");
  if (p.state !== "OUT" && p.state !== "NOT_HOME") throw new Error(`${p.no} is not out for delivery.`);
  if (!input.reason.trim()) throw new Error("Say why the customer refused it.");
  await db`
    insert into dispatch_event (company_id, parcel_id, invoice_id, kind, reason, holder, acted_by)
    values (${input.companyId}, ${p.id}, ${p.invoiceId}, 'REFUSED', ${input.reason.trim()}, ${p.collector?.name ?? null}, ${input.userId ?? null})`;
  await db`update delivery_trip_stop set status = 'FAILED', failure_reason = ${`Refused: ${input.reason.trim()}`} where document_id = ${p.id}`;
}

/**
 * A parcel comes back to the shop, refused or with nobody home: exactly what
 * went out, nothing else. Each IMEI is scanned back; anything without one is
 * counted back to the quantity that left. Then the bin to the warehouse.
 */
export async function receiveReturn(tx: TransactionSql, input: {
  companyId: string; parcelId: string; docDate: string; scanned: string[];
  /** Units counted back on lines without IMEIs, by invoice line. */
  counted?: Record<string, number>;
  userId?: string | null;
}) {
  const [lock] = await tx`select id from document where id = ${input.parcelId} and company_id = ${input.companyId} for update`;
  if (!lock) throw new Error("That parcel no longer exists.");
  const p = await parcel(input.parcelId, tx);
  if (!p) throw new Error("That is not a cash-on-delivery parcel.");
  if (p.state === "RETURNED") throw new Error(`${p.no} is already back (${p.closedByNo}).`);
  if (p.state !== "REFUSED" && p.state !== "NOT_HOME") throw new Error(`Mark ${p.no} refused or not home before receiving it back.`);
  const expect = p.lines.flatMap((l) => l.serials);
  const got = [...new Set(input.scanned.map((s) => s.trim()).filter(Boolean))];
  const missing = expect.filter((s) => !got.includes(s));
  const extra = got.filter((s) => !expect.includes(s));
  if (extra.length) throw new Error(`${extra.join(", ")} ${extra.length === 1 ? "is" : "are"} not in ${p.no}.`);
  if (missing.length) throw new Error(`Scan every phone in ${p.no}: ${missing.join(", ")} not scanned.`);
  for (const l of p.lines.filter((x) => x.serials.length === 0)) {
    const n = Number(input.counted?.[l.lineId] ?? NaN);
    if (n !== l.qty) throw new Error(`${l.item}: ${l.qty} went out; count all ${l.qty} back${Number.isFinite(n) ? ` (${n} counted)` : ""}.`);
  }
  const back = await postStockTransfer({
    companyId: input.companyId, fromLocationId: p.binId, toLocationId: p.warehouseId, docDate: input.docDate,
    memo: `Returned to shop: ${p.no} ${p.state === "REFUSED" ? "refused" : "customer not home"} (${p.lastReason ?? "no reason given"})`, reference: p.invoiceNo,
    sourceDocumentId: p.invoiceId, partnerId: p.customerId,
    lines: p.lines.map((l) => ({ itemId: l.itemId, qty: l.qty, serials: l.serials.length ? l.serials : undefined, sourceLineId: l.lineId })),
  }, tx);
  await tx`
    insert into dispatch_event (company_id, parcel_id, invoice_id, kind, holder, document_id, acted_by)
    values (${input.companyId}, ${p.id}, ${p.invoiceId}, 'RETURNED', ${p.collector?.name ?? null}, ${back.id}, ${input.userId ?? null})`;
  return back;
}

export type DriverCash = { driverId: string; driver: string; held: number;
  collections: { id: string; no: string; date: string; amount: number; customer: string; memo: string | null; branchId: string | null }[] };

/** Cash each driver holds, and the collections not yet handed in. */
export async function driversCash(companyId: string, db: Db = sql): Promise<DriverCash[]> {
  const cwd = await role(db, companyId, "CASH_WITH_DRIVERS");
  if (!cwd) return [];
  const rows = await db`
    with lines as (
      select d.driver_id, d.id, d.doc_no, d.doc_date, d.doc_type, d.memo, d.partner_id, jl.base_amount,
             (select coalesce(l.parent_id, l.id) from location l where l.id = coalesce(jl.location_id, d.location_id)) as branch_id
        from journal_line jl join journal_entry je on je.id = jl.journal_entry_id
        join document d on d.id = je.source_id
       where jl.company_id = ${companyId} and jl.account_id = ${cwd} and d.driver_id is not null)
    select dr.id as "driverId", dr.name as driver, coalesce(sum(l.base_amount), 0)::float as held,
           coalesce(json_agg(json_build_object('id', l.id, 'no', l.doc_no, 'date', l.doc_date::text, 'amount', l.base_amount::float,
                                               'customer', bp.name, 'memo', l.memo, 'branchId', l.branch_id) order by l.doc_date, l.doc_no)
             filter (where l.doc_type = 'CUSTOMER_RECEIPT' and l.base_amount > 0
                       and not exists (select 1 from driver_handin_item h join document hd on hd.id = h.handin_id and hd.status = 'POSTED'
                                        where h.receipt_id = l.id)
                       and not exists (select 1 from document rv where rv.id = l.id and rv.status <> 'POSTED')), '[]') as collections
      from driver dr join lines l on l.driver_id = dr.id
      left join business_partner bp on bp.id = l.partner_id
     where dr.company_id = ${companyId}
     group by dr.id, dr.name
    having round(sum(l.base_amount), 2) <> 0
     order by dr.name`;
  return rows as unknown as DriverCash[];
}

/**
 * The cashier takes the driver's cash: the amount counted goes from Cash with
 * Drivers into the till. Anything counted short stays against the driver.
 */
export async function receiveFromDriver(input: {
  companyId: string; driverId: string; docDate: string; locationId: string | null; tillAccountId: string;
  counted: number; receiptIds: string[]; memo?: string | null;
}, outer?: TransactionSql) {
  const counted = round4(input.counted);
  if (!(counted > 0)) throw new Error("Enter the cash counted.");
  return inTransaction(outer, async (tx) => {
    await tx`select id from driver where id = ${input.driverId} and company_id = ${input.companyId} for update`;
    const cwd = await role(tx, input.companyId, "CASH_WITH_DRIVERS");
    if (!cwd) throw new Error("No account is set for Cash with Drivers.");
    const [till] = await tx`select id from account where id = ${input.tillAccountId} and company_id = ${input.companyId} and is_cash_account`;
    if (!till) throw new Error("Choose the till the cash goes into.");
    const [h] = await tx`
      select coalesce(sum(jl.base_amount), 0)::float as v from journal_line jl join journal_entry je on je.id = jl.journal_entry_id
        join document d on d.id = je.source_id
       where jl.account_id = ${cwd} and d.driver_id = ${input.driverId}`;
    if (counted > round4(Number(h.v)) + 0.005) throw new Error(`The driver holds ${Number(h.v).toLocaleString("en-US")}; ${counted.toLocaleString("en-US")} is more than that.`);
    const [dr] = await tx`select name from driver where id = ${input.driverId}`;
    const v = await postCashVoucher({
      companyId: input.companyId, docDate: input.docDate, locationId: input.locationId, driverId: input.driverId,
      memo: input.memo || `Cash on delivery handed in by ${dr.name}`,
      lines: [{ accountId: till.id as string, amount: counted }, { accountId: cwd, amount: -counted }],
    }, tx);
    for (const r of input.receiptIds) {
      await tx`insert into driver_handin_item (company_id, handin_id, receipt_id) values (${input.companyId}, ${v.id}, ${r})`;
    }
    return v;
  });
}

export type CodSheet = {
  parcels: Parcel[];
  toDispatch: Awaited<ReturnType<typeof undispatched>>;
  /** Customer: billed at handovers, settled, deposits waiting, still owed. */
  billed: number; paid: number; deposits: number; owed: number;
  /** Who holds the money collected: the driver (not handed in), the courier (not paid in), or the company's own account. */
  driverHolds: { driverId: string; name: string; amount: number }[];
  courierHolds: { courierId: string; name: string; amount: number }[];
  direct: number;
};

/** Everything the invoice sheet shows for a COD invoice, in four queries. */
export async function codSheet(invoiceId: string, companyId: string): Promise<CodSheet> {
  const [parcels, toDispatch, money, holders] = await Promise.all([
    invoiceParcels(invoiceId),
    undispatched(invoiceId),
    sql`
      select coalesce((select sum(h.amount) from sales_billed_on_handover h join document hd on hd.id = h.document_id and hd.status = 'POSTED'
                        where h.invoice_id = ${invoiceId}), 0)::float as billed,
             coalesce((select sum(pa.amount) from payment_allocation pa join document pay on pay.id = pa.payment_id and pay.status = 'POSTED'
                        left join document app on app.id = pa.applied_by_document_id
                        where pa.invoice_id = ${invoiceId} and (pa.applied_by_document_id is null or app.status = 'POSTED')), 0)::float as paid,
             coalesce((select sum(v.available) from v_partner_advance v join document d on d.id = v.payment_id
                        where d.source_document_id = ${invoiceId} and d.doc_type = 'CUSTOMER_RECEIPT' and d.status = 'POSTED'), 0)::float as deposits`,
    // Every receipt for this invoice (settling it, or a deposit for it), and the account its money went to.
    sql`
      select d.id, d.driver_id, dr.name as driver, jl.partner_id as courier_id, cp.name as courier, jl.base_amount::float as amount,
             (jl.account_id = (select account_id from system_account where company_id = ${companyId} and role = 'CASH_WITH_DRIVERS')) as to_driver,
             (jl.account_id = (select account_id from system_account where company_id = ${companyId} and role = 'COD_RECEIVABLE')) as to_courier,
             exists (select 1 from driver_handin_item h join document hd on hd.id = h.handin_id and hd.status = 'POSTED' where h.receipt_id = d.id) as handed_in
        from document d
        join journal_entry je on je.source_id = d.id
        join journal_line jl on jl.journal_entry_id = je.id and jl.base_amount > 0
        left join driver dr on dr.id = d.driver_id
        left join business_partner cp on cp.id = jl.partner_id
       where d.doc_type = 'CUSTOMER_RECEIPT' and d.status = 'POSTED' and d.company_id = ${companyId}
         and (d.source_document_id = ${invoiceId}
              or d.id in (select pa.payment_id from payment_allocation pa where pa.invoice_id = ${invoiceId} and pa.applied_by_document_id is null))`,
  ]);
  const m = money[0];
  const driverHolds = new Map<string, { driverId: string; name: string; amount: number }>();
  const courierHolds = new Map<string, { courierId: string; name: string; amount: number }>();
  let direct = 0;
  // A courier's balance is one pool; what this invoice added stays "with the courier" until the pool is paid down.
  const courierPools = new Map((await sql`
    select jl.partner_id, sum(jl.base_amount)::float as bal from journal_line jl
     where jl.company_id = ${companyId}
       and jl.account_id = (select account_id from system_account where company_id = ${companyId} and role = 'COD_RECEIVABLE')
     group by jl.partner_id`).map((r) => [r.partner_id as string, Number(r.bal)]));
  for (const h of holders) {
    if (h.to_driver) {
      if (h.handed_in) continue;
      const k = driverHolds.get(h.driver_id) ?? { driverId: h.driver_id, name: h.driver, amount: 0 };
      k.amount = round4(k.amount + Number(h.amount)); driverHolds.set(h.driver_id, k);
    } else if (h.to_courier) {
      const k = courierHolds.get(h.courier_id) ?? { courierId: h.courier_id, name: h.courier, amount: 0 };
      k.amount = round4(Math.min(k.amount + Number(h.amount), courierPools.get(h.courier_id) ?? 0)); courierHolds.set(h.courier_id, k);
    } else direct = round4(direct + Number(h.amount));
  }
  return {
    parcels, toDispatch,
    billed: Number(m.billed), paid: Number(m.paid), deposits: Number(m.deposits), owed: round4(Number(m.billed) - Number(m.paid)),
    driverHolds: [...driverHolds.values()].filter((d) => Math.abs(d.amount) > 0.005),
    courierHolds: [...courierHolds.values()].filter((c) => c.amount > 0.005),
    direct,
  };
}

/** COD invoices with goods still in the warehouse, waiting to be dispatched. One query. */
export async function codAwaitingDispatch(companyId: string) {
  return (await sql`
    select d.id, d.doc_no as no, d.doc_date::text as date, d.location_id as "warehouseId", bp.name as customer,
           d.driver_id is not null or d.courier_id is not null as "carrierChosen",
           coalesce(dr.name, cr.name) as carrier,
           sum(dl.base_qty - coalesce((
             select sum(case when tb.is_transit then tl.base_qty else -tl.base_qty end)
               from document_line tl join document t on t.id = tl.document_id and t.status = 'POSTED' and t.doc_type = 'STOCK_TRANSFER'
               join location tb on tb.id = t.to_location_id join location fb on fb.id = t.location_id
              where tl.source_line_id = dl.id and (tb.is_transit or fb.is_transit)), 0)
           + coalesce((select sum(ll.base_qty) from document_line ll
                         join dispatch_event le on le.parcel_id = ll.document_id and le.kind = 'LOST'
                         join document led on led.id = le.document_id and led.status = 'POSTED'
                        where ll.source_line_id = dl.id), 0))::float as qty
      from document d
      join business_partner bp on bp.id = d.partner_id
      join document_line dl on dl.document_id = d.id
      join item it on it.id = dl.item_id and it.is_stocked
      left join driver dr on dr.id = d.driver_id
      left join business_partner cr on cr.id = d.courier_id
     where d.company_id = ${companyId} and d.doc_type = 'SALES_INVOICE' and d.ar_on_handover and d.status = 'POSTED'
       and d.reversed_by_document_id is null
     group by d.id, bp.name, dr.name, cr.name
    having sum(dl.base_qty - coalesce((
             select sum(case when tb.is_transit then tl.base_qty else -tl.base_qty end)
               from document_line tl join document t on t.id = tl.document_id and t.status = 'POSTED' and t.doc_type = 'STOCK_TRANSFER'
               join location tb on tb.id = t.to_location_id join location fb on fb.id = t.location_id
              where tl.source_line_id = dl.id and (tb.is_transit or fb.is_transit)), 0)
           + coalesce((select sum(ll.base_qty) from document_line ll
                         join dispatch_event le on le.parcel_id = ll.document_id and le.kind = 'LOST'
                         join document led on led.id = le.document_id and led.status = 'POSTED'
                        where ll.source_line_id = dl.id), 0)) > 0
     order by d.doc_date, d.doc_no`) as unknown as { id: string; no: string; date: string; warehouseId: string; customer: string; carrier: string | null; qty: number }[];
}

/**
 * Lost in transit (0235): the parcel never arrived and is not coming back.
 * Its phones are written off the Out for delivery bin at their cost, charged
 * to whoever bears the loss: the shop (Inventory Damage), or the driver or
 * courier carrying it, who then owes the cost (Cash with Drivers under the
 * driver; COD Receivable under the courier) and settles it through Driver
 * cash or the courier pay-in. Nothing was billed, so the customer owes
 * nothing; any deposit stays theirs; the invoice can be dispatched again.
 */
export async function lostInTransit(tx: TransactionSql, input: {
  companyId: string; parcelId: string; docDate: string; reason: string;
  bearer: "SHOP" | "CARRIER"; userId?: string | null;
}) {
  const [lock] = await tx`select id from document where id = ${input.parcelId} and company_id = ${input.companyId} for update`;
  if (!lock) throw new Error("That parcel no longer exists.");
  const p = await parcel(input.parcelId, tx);
  if (!p) throw new Error("That is not a cash-on-delivery parcel.");
  if (p.state === "HANDED_OVER" || p.state === "RETURNED" || p.state === "LOST") throw new Error(`${p.no} is closed (${p.closedByNo}).`);
  if (!input.reason.trim()) throw new Error("Say what happened: stolen, damaged beyond repair, lost by the courier.");
  let charge: { accountId: string; partnerId: string | null; driverId: string | null } | null = null;
  if (input.bearer === "CARRIER") {
    if (!p.collector) throw new Error(`${p.no} names no driver or courier to charge.`);
    const r = p.collector.kind === "DRIVER" ? "CASH_WITH_DRIVERS" : "COD_RECEIVABLE";
    const [a] = await tx`select account_id from system_account where company_id = ${input.companyId} and role = ${r}`;
    if (!a) throw new Error(`No account is set for ${r === "CASH_WITH_DRIVERS" ? "Cash with Drivers" : "COD Receivable"}.`);
    charge = { accountId: a.account_id, partnerId: p.collector.kind === "COURIER" ? p.collector.id : null,
               driverId: p.collector.kind === "DRIVER" ? p.collector.id : null };
  }
  const who = input.bearer === "SHOP" ? "the shop" : p.collector!.name;
  const adj = await postStockAdjustment({
    companyId: input.companyId, locationId: p.binId, journalLocationId: p.warehouseId, docDate: input.docDate,
    writeOff: true, sourceDocumentId: p.invoiceId, partnerId: p.customerId,
    chargeAccountId: charge?.accountId ?? null, chargePartnerId: charge?.partnerId ?? null, driverId: charge?.driverId ?? null,
    memo: `Lost in transit: ${p.no} for ${p.invoiceNo} (${input.reason.trim()}). Borne by ${who}.`, reference: p.invoiceNo,
    lines: p.lines.map((l) => ({ itemId: l.itemId, qty: -l.qty, serials: l.serials.length ? l.serials : undefined, sourceLineId: l.lineId })),
  }, tx);
  await tx`
    insert into dispatch_event (company_id, parcel_id, invoice_id, kind, reason, holder, document_id, acted_by)
    values (${input.companyId}, ${p.id}, ${p.invoiceId}, 'LOST', ${input.reason.trim()}, ${p.collector?.name ?? null}, ${adj.id}, ${input.userId ?? null})`;
  await tx`update delivery_trip_stop set status = 'FAILED', failure_reason = ${`Lost: ${input.reason.trim()}`} where document_id = ${p.id}`;
  return adj;
}
