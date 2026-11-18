import type { TransactionSql } from "postgres";
import { postPurchaseWithReceipt, postRetailSale, postSupplierPayment, postCustomerReceipt } from "./posting";

/**
 * Secondhand buyback and trade-in (0209). Composes the existing documents —
 * nothing here writes a journal of its own:
 *
 *   buyback   postPurchaseWithReceipt: bill + goods receipt, paid now
 *             (cashOut) or owed (2110). The IMEI may come back if we sold
 *             it before (reacquire); one on a shelf is refused.
 *   trade-in  the buyback (owed), the new phone's sale (owed), then a
 *             payment of the bill and a receipt against the sale through
 *             1450 Trade-in Clearing for the value applied, and the cash
 *             difference through the till. All in the caller's transaction,
 *             so it posts whole or not at all.
 */

export type Seller = {
  kind: "CUSTOMER" | "SHOP";
  /** An existing partner, or a new one made from name and phone. */
  partnerId?: string | null;
  name: string; phone: string; nrc?: string | null;
};
export type Inspection = {
  grade: string; batteryPct?: number | null; activationLock: "REMOVED" | "PRESENT";
  checks?: Record<string, string>; notes?: string | null;
};
export type BuyInput = {
  companyId: string; userId?: string | null; locationId: string; docDate: string;
  seller: Seller; itemId: string; imei: string; price: number;
  inspection: Inspection;
  /** Paid at the counter from this cash or bank account; omitted, it is owed. */
  cashAccountId?: string | null;
};

/** The seller as a partner who can both sell to us and buy from us. */
async function sellerPartner(tx: TransactionSql, companyId: string, s: Seller): Promise<string> {
  if (!s.name?.trim() || !s.phone?.trim()) throw new Error("The seller's name and phone are required");
  if (s.kind === "CUSTOMER" && !s.nrc?.trim()) throw new Error("An individual seller's NRC is required");
  if (s.partnerId) {
    const [p] = await tx`update business_partner set is_supplier = true, is_customer = true
                          where id = ${s.partnerId} and company_id = ${companyId} returning id`;
    if (!p) throw new Error("That seller no longer exists");
    return p.id as string;
  }
  const phone = s.phone.replace(/\D/g, "");
  const [found] = await tx`select id from business_partner
     where company_id = ${companyId} and regexp_replace(coalesce(phone, ''), '\\D', '', 'g') = ${phone}
     order by is_customer desc limit 1`;
  if (found) {
    await tx`update business_partner set is_supplier = true, is_customer = true where id = ${found.id}`;
    return found.id as string;
  }
  const [made] = await tx`
    insert into business_partner (company_id, code, name, phone, is_customer, is_supplier, notes)
    values (${companyId}, ${"SH-" + phone}, ${s.name.trim()}, ${s.phone.trim()}, true, true,
            ${s.kind === "SHOP" ? "Secondhand supplier (shop)" : "Secondhand seller"})
    returning id`;
  return made.id as string;
}

/** The last sale of ours this IMEI left on, if any. */
export async function previousSaleOf(db: TransactionSql, companyId: string, imei: string) {
  const [r] = await db`
    select d.id, d.doc_no, d.doc_type, to_char(d.posting_date, 'YYYY-MM-DD') as date, l.name as branch,
           exists (select 1 from v_stock_serial_available a where a.serial_id = s.id) as on_shelf
      from stock_serial s
      left join stock_serial_issue si on si.serial_id = s.id
      left join stock_movement sm on sm.id = si.stock_movement_id
      left join document d on d.id = sm.document_id and d.doc_type in ('SALES_INVOICE', 'DELIVERY')
      left join location l on l.id = d.location_id
     where s.company_id = ${companyId} and s.serial_no = ${imei.trim()}
     order by d.posting_date desc nulls last limit 1`;
  return r ?? null;
}

export async function postSecondhandBuy(tx: TransactionSql, input: BuyInput) {
  const imei = input.imei.trim();
  if (!imei) throw new Error("Enter the IMEI");
  if (!(input.price > 0)) throw new Error("Enter the buyback price");
  const partnerId = await sellerPartner(tx, input.companyId, input.seller);
  const before = await previousSaleOf(tx, input.companyId, imei);
  if (before?.on_shelf) throw new Error(`${imei} is in stock already. A phone cannot be on the shelf twice.`);

  const bill = await postPurchaseWithReceipt({
    companyId: input.companyId, partnerId, locationId: input.locationId,
    docDate: input.docDate, dueDate: input.docDate,
    memo: `Secondhand from ${input.seller.name.trim()} · ${input.inspection.grade}`,
    lines: [{ itemId: input.itemId, qty: 1, unitPrice: input.price, serials: [imei], reacquire: true }],
    cashOut: input.cashAccountId ? input.price : 0, cashAccountId: input.cashAccountId ?? null,
  }, tx);
  const [{ source_document_id: receiptId }] = await tx`select source_document_id from document where id = ${bill.id}`;
  const [serial] = await tx`select id from stock_serial where company_id = ${input.companyId} and serial_no = ${imei}`;
  const i = input.inspection;
  const [intake] = await tx`
    insert into secondhand_intake
      (company_id, serial_id, receipt_id, bill_id, seller_kind, seller_name, seller_phone, seller_nrc,
       grade, battery_pct, activation_lock, checks, notes, previous_sale_id, created_by_id)
    values (${input.companyId}, ${serial.id}, ${receiptId}, ${bill.id}, ${input.seller.kind},
            ${input.seller.name.trim()}, ${input.seller.phone.trim()}, ${input.seller.nrc?.trim() || null},
            ${i.grade}, ${i.batteryPct ?? null}, ${i.activationLock}, ${tx.json(i.checks ?? {})},
            ${i.notes?.trim() || null}, ${before?.id ?? null}, ${input.userId ?? null})
    returning id`;
  return { billId: bill.id, billNo: bill.docNo, receiptId: receiptId as string, intakeId: intake.id as string, partnerId };
}

export type TradeInInput = Omit<BuyInput, "price" | "cashAccountId"> & {
  /** The old phone at its inspected value: what it costs as stock. */
  inspectedValue: number;
  /** A promotion above that, given as a discount on the new phone (4190). */
  topUp?: number;
  newItemId: string; newImei: string; newPrice: number;
  /** Where the customer's cash difference goes, or a refund comes from. */
  cashAccountId: string;
  /** When the old phone is worth more than the new one: pay the rest now, or owe it. */
  payExcess?: boolean;
};

export async function postTradeIn(tx: TransactionSql, input: TradeInInput) {
  const topUp = Math.max(0, input.topUp ?? 0);
  if (!(input.newPrice > 0)) throw new Error("Enter the new phone's price");
  if (topUp > input.newPrice) throw new Error("The promotion cannot be more than the new phone's price");
  const [clear] = await tx`select fn_system_account(${input.companyId}, 'TRADE_IN_CLEARING') as a`;
  if (!clear?.a) throw new Error("No Trade-in Clearing account is set (migration 0209)");

  // 1. The old phone, owed to the customer at its inspected value.
  const buy = await postSecondhandBuy(tx, { ...input, price: input.inspectedValue, cashAccountId: null });

  // 2. The new phone, owed by the customer; the promotion is its discount.
  const sale = await postRetailSale({
    companyId: input.companyId, partnerId: buy.partnerId, locationId: input.locationId,
    docDate: input.docDate, dueDate: input.docDate, paymentType: "CREDIT",
    allowOverCreditLimit: true, creditOverrideReason: "Trade-in: settled in the same posting",
    memo: `Trade-in against ${buy.billNo}`,
    lines: [{ itemId: input.newItemId, qty: 1, unitPrice: input.newPrice,
              discountAmount: topUp || null, serials: [input.newImei.trim()] }],
  }, tx);
  const [inv] = await tx`select gross_total::float as total from document where id = ${sale.id}`;
  const saleTotal = Number(inv.total);

  // 3. One against the other, through clearing: the value applied.
  const applied = Math.min(input.inspectedValue, saleTotal);
  const base = { companyId: input.companyId, partnerId: buy.partnerId, docDate: input.docDate, locationId: input.locationId };
  const payment = await postSupplierPayment({ ...base, cashAccountId: clear.a,
    allocations: [{ invoiceId: buy.billId, amount: applied }], memo: `Trade-in ${sale.docNo}` }, tx);
  const receipt = await postCustomerReceipt({ ...base, cashAccountId: clear.a,
    allocations: [{ invoiceId: sale.id, amount: applied }], memo: `Trade-in ${buy.billNo}` }, tx);

  // 4. The difference in cash: the customer pays the rest, or is paid the excess.
  const difference = Math.round((saleTotal - input.inspectedValue) * 10000) / 10000;
  if (difference > 0) {
    await postCustomerReceipt({ ...base, cashAccountId: input.cashAccountId,
      allocations: [{ invoiceId: sale.id, amount: difference }], memo: `Trade-in difference` }, tx);
  } else if (difference < 0 && input.payExcess) {
    await postSupplierPayment({ ...base, cashAccountId: input.cashAccountId,
      allocations: [{ invoiceId: buy.billId, amount: -difference }], memo: `Trade-in excess paid` }, tx);
  }

  const [link] = await tx`
    insert into trade_in (company_id, intake_id, sale_id, payment_id, receipt_id,
                          sale_total, inspected_value, top_up, cash_difference)
    values (${input.companyId}, ${buy.intakeId}, ${sale.id}, ${payment.id}, ${receipt.id},
            ${saleTotal}, ${input.inspectedValue}, ${topUp}, ${difference})
    returning id`;
  return { id: sale.id, docNo: sale.docNo, tradeInId: link.id as string, billId: buy.billId, difference };
}
