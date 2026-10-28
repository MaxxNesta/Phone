/**
 * Landed cost: freight, insurance, duty and the rest, spread onto the phones
 * of posted goods receipts.
 *
 * A landed cost is a `document` (doc_type LANDED_COST): a draft while its
 * charges are entered and calculated, posted once, reversed by a document of
 * its own. Posting moves each charge out of Landed Cost Clearing and onto the
 * phones it was spread over — inventory for a phone still owned, cost of
 * sales for one that has gone — and records, per phone, which it was.
 *
 * Phones are costed one by one (an IMEI leaves at what that phone cost), but
 * a receipt line of several phones is one cost layer. A phone still owned is
 * therefore moved onto a layer of its own before its cost changes: a −1/+1
 * pair marked COST_LAYER_SPLIT, at the same warehouse, quantity and value,
 * with no journal. Once alone on a layer it stays there; later landed costs
 * and reversals reuse that layer.
 *
 * Accessories (items without an IMEI) are not eligible in this version.
 */

import type { TransactionSql } from "postgres";
import {
  round4, inTransaction, writeJournal, createFifoLot, moveSerialsTo, type JournalLine,
} from "./posting";

export type Method = "VALUE" | "EQUAL" | "MANUAL";
export const METHOD_LABEL: Record<Method, string> = {
  VALUE: "By purchase value",
  EQUAL: "Equal per phone",
  MANUAL: "Manual by product variant",
};
const METHODS = Object.keys(METHOD_LABEL) as Method[];

/** Statuses in which the business still owns the phone. */
const OWNED = new Set(["IN_STOCK", "RESERVED", "REPAIR"]);

/** What the phone's history says a landed cost did. */
const NOTE = {
  INVENTORY: "Added to its cost",
  HOLDING: "Added to its cost, waiting for the invoice",
  COGS: "Added to cost of sales (already invoiced)",
} as const;

export type ChargeInput = {
  costTypeId: string;
  partnerId?: string | null;
  /** A journal line that debited a clearing account: the bill this charge is. */
  sourceJournalLineId?: string | null;
  description?: string | null;
  currency?: string | null;
  exchangeRate?: number | null;
  rateDate?: string | null;
  amount?: number | null; // in `currency`
  method: Method;
  clearingAccountId?: string | null;
  reference?: string | null;
  /** MANUAL only: per product variant, in base currency. */
  manual?: { itemId: string; amount: number }[];
};

export type DraftInput = {
  docDate: string;
  templateId?: string | null;
  shipmentRef?: string | null;
  carrierRef?: string | null;
  notes?: string | null;
  receiptIds: string[];
  charges: ChargeInput[];
};

type Actor = { companyId: string; userId: string | null };

// ------------------------------------------------------------- helpers --

async function baseCurrency(tx: TransactionSql, companyId: string) {
  const [r] = await tx`
    select c.base_currency as code, cu.decimal_places::int as dp
      from company c join currency cu on cu.code = c.base_currency
     where c.id = ${companyId}`;
  return { code: r.code as string, dp: Number(r.dp) };
}

const roundTo = (n: number, dp: number) => {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
};
const floorTo = (n: number, dp: number) => {
  const f = 10 ** dp;
  // A hair of tolerance so 2.9999999 from binary arithmetic floors to 3.
  return Math.floor(n * f + 1e-9) / f;
};

async function history(tx: TransactionSql, companyId: string, documentId: string,
  action: string, userId: string | null, reason?: string | null, detail?: unknown, relatedId?: string | null) {
  await tx`
    insert into document_history (company_id, document_id, action, acted_by, reason, related_id, detail)
    values (${companyId}, ${documentId}, ${action}, ${userId}, ${reason ?? null}, ${relatedId ?? null},
            ${detail === undefined ? null : tx.json(detail as never)})`;
}

/** The draft, locked: every change to a landed cost goes through one row lock. */
async function lockDraft(tx: TransactionSql, companyId: string, id: string) {
  const [doc] = await tx`
    select d.id, d.status, d.doc_no, d.doc_date::text as doc_date, d.location_id
      from document d
     where d.id = ${id} and d.company_id = ${companyId} and d.doc_type = 'LANDED_COST'
       for update`;
  if (!doc) throw new Error("Landed cost not found.");
  return doc as { id: string; status: string; doc_no: string; doc_date: string; location_id: string | null };
}

function assertDraft(doc: { status: string; doc_no: string }) {
  if (doc.status !== "DRAFT") {
    throw new Error(`${doc.doc_no} is ${doc.status.toLowerCase()} and cannot be changed. Reverse it to correct it.`);
  }
}

/** Posted goods receipts of this company, refused otherwise. */
async function assertReceipts(tx: TransactionSql, companyId: string, ids: string[]) {
  if (ids.length === 0) throw new Error("Choose at least one goods receipt.");
  const rows = await tx`
    select id, doc_no, status, reverses_document_id from document
     where id = any(${ids}) and company_id = ${companyId} and doc_type = 'GOODS_RECEIPT'`;
  for (const id of ids) {
    const r = rows.find((x) => x.id === id);
    if (!r) throw new Error("A chosen receipt is not a goods receipt of this company.");
    if (r.status !== "POSTED" || r.reverses_document_id) {
      throw new Error(`${r.doc_no} is not a posted goods receipt. Only posted receipts can carry a landed cost.`);
    }
  }
  return rows;
}

// ------------------------------------------------------ eligible units --

export type Unit = {
  serial_id: string; serial_no: string; item_id: string; item_name: string;
  receipt_id: string; receipt_no: string; receipt_line_id: string | null; line_no: number;
  original_cost: number;
};

/**
 * The phones the receipts brought in, with what each cost to buy: the receipt
 * layer's price and any correction a supplier bill made to it, but not
 * earlier landed costs — "by purchase value" means by what was paid for the
 * phone itself.
 */
export async function eligibleUnits(tx: TransactionSql, companyId: string, receiptIds: string[]): Promise<Unit[]> {
  if (receiptIds.length === 0) return [];
  const rows = await tx`
    select s.id as serial_id, s.serial_no, s.item_id, i.name as item_name,
           sm.document_id as receipt_id, d.doc_no as receipt_no,
           sm.document_line_id as receipt_line_id, coalesce(dl.line_no, 0)::int as line_no,
           (gl.unit_cost + coalesce((
              select sum(a.delta_unit_cost) from stock_lot_adjustment a
                left join document ad on ad.id = a.document_id
               where a.lot_id = gl.id and coalesce(ad.doc_type, '') <> 'LANDED_COST'), 0))::float as original_cost
      from stock_serial s
      join stock_movement sm on sm.id = s.stock_movement_id
      join document d on d.id = sm.document_id
      join item i on i.id = s.item_id
      left join document_line dl on dl.id = sm.document_line_id
      join stock_lot gl on gl.stock_movement_id = sm.id
     where s.company_id = ${companyId} and sm.document_id = any(${receiptIds})
     order by d.doc_no, dl.line_no, s.serial_no`;
  return rows as unknown as Unit[];
}

/** Receipt lines whose goods are not phones: not eligible in this version. */
export async function excludedLines(tx: TransactionSql, companyId: string, receiptIds: string[]) {
  if (receiptIds.length === 0) return [];
  return tx`
    select d.id as receipt_id, d.doc_no as receipt_no, dl.id as line_id, dl.line_no, i.name as item_name,
           dl.base_qty::float as qty, dl.net_amount::float as value
      from document_line dl
      join document d on d.id = dl.document_id
      join item i on i.id = dl.item_id
     where d.company_id = ${companyId} and d.id = any(${receiptIds})
       and not coalesce(i.tracks_serial, false)
     order by d.doc_no, dl.line_no` as unknown as Promise<Array<{
      receipt_id: string; receipt_no: string; line_id: string; line_no: number;
      item_name: string; qty: number; value: number }>>;
}

// ---------------------------------------------------------- allocation --

/**
 * Spread `amount` over `weights` so the parts add back to it exactly.
 *
 * Each share is floored to the currency's unit, and what that leaves over —
 * never negative — goes to the largest share, ties to the first in the order
 * given. Deterministic: the same inputs always give the same answer.
 */
export function spread(amount: number, weights: number[], dp: number): number[] {
  const total = weights.reduce((s, w) => s + w, 0);
  if (weights.length === 0) return [];
  if (!(total > 0)) throw new Error("There is nothing to spread this charge over.");
  const parts = weights.map((w) => floorTo((amount * w) / total, dp));
  const left = roundTo(amount - parts.reduce((s, p) => s + p, 0), dp);
  let big = 0;
  for (let i = 1; i < parts.length; i++) if (parts[i] > parts[big]) big = i;
  parts[big] = roundTo(parts[big] + left, dp);
  return parts;
}

/** Each charge's share per phone, by its method. */
export function allocate(
  charge: { base_amount: number; method: Method; manual: { item_id: string; amount: number }[] },
  units: Unit[], dp: number, chargeLabel: string,
): number[] {
  const amount = roundTo(Number(charge.base_amount), dp);
  if (charge.method === "VALUE") {
    if (!units.some((u) => u.original_cost > 0)) {
      throw new Error(`${chargeLabel}: the phones have no purchase value to spread by. Use Equal per phone.`);
    }
    return spread(amount, units.map((u) => Math.max(0, u.original_cost)), dp);
  }
  if (charge.method === "EQUAL") return spread(amount, units.map(() => 1), dp);

  // Manual by product variant: the variants must account for the whole
  // charge, and each variant's share is divided evenly among its phones.
  const byItem = new Map(charge.manual.map((m) => [m.item_id, roundTo(Number(m.amount), dp)]));
  const sum = roundTo([...byItem.values()].reduce((s, v) => s + v, 0), dp);
  if (sum !== amount) {
    throw new Error(`${chargeLabel}: the variant amounts add up to ${sum.toLocaleString("en-US")}, `
      + `not the charge's ${amount.toLocaleString("en-US")}. They must equal it exactly.`);
  }
  const out = units.map(() => 0);
  for (const [itemId, share] of byItem) {
    const idx = units.map((u, i) => (u.item_id === itemId ? i : -1)).filter((i) => i >= 0);
    if (idx.length === 0) {
      if (share !== 0) throw new Error(`${chargeLabel}: a variant was given an amount but has no eligible phones.`);
      continue;
    }
    const parts = share === 0 ? idx.map(() => 0) : spread(share, idx.map(() => 1), dp);
    idx.forEach((i, k) => { out[i] = parts[k]; });
  }
  return out;
}

// ------------------------------------------------------------- drafts --

/** A new draft, optionally with receipts already chosen. */
export async function createLandedCost(input: Actor & {
  docDate: string; receiptIds?: string[]; templateId?: string | null;
  shipmentRef?: string | null; carrierRef?: string | null; notes?: string | null;
}, outer?: TransactionSql) {
  return inTransaction(outer, async (tx) => {
    const receipts = input.receiptIds ?? [];
    const rows = receipts.length ? await assertReceipts(tx, input.companyId, receipts) : [];
    const [first] = receipts.length
      ? await tx`select location_id from document where id = ${receipts[0]}` : [];
    const base = await baseCurrency(tx, input.companyId);
    const [{ no }] = await tx`select fn_next_document_no(${input.companyId}, 'LANDED_COST', ${input.docDate}::date) as no`;
    const [{ fy }] = await tx`select fn_fiscal_year_for(${input.companyId}, ${input.docDate}::date) as fy`;
    const [doc] = await tx`
      insert into document
        (company_id, doc_type, doc_no, fiscal_year_id, doc_date, posting_date, location_id,
         currency, exchange_rate, status, net_total, tax_total, gross_total, memo, created_by_id)
      values
        (${input.companyId}, 'LANDED_COST', ${no}, ${fy ?? null}, ${input.docDate}::date, ${input.docDate}::date,
         ${first?.location_id ?? null}, ${base.code}, 1, 'DRAFT', 0, 0, 0, ${input.notes ?? null}, ${input.userId})
      returning id`;
    await tx`
      insert into landed_cost (document_id, company_id, template_id, shipment_ref, carrier_ref)
      values (${doc.id}, ${input.companyId}, ${input.templateId ?? null},
              ${input.shipmentRef?.trim() || null}, ${input.carrierRef?.trim() || null})`;
    for (const r of rows) {
      await tx`insert into landed_cost_receipt (landed_cost_id, receipt_id) values (${doc.id}, ${r.id})`;
    }
    await history(tx, input.companyId, doc.id, "CREATE", input.userId);
    return { id: doc.id as string, docNo: no as string };
  });
}

/**
 * Replace a draft's header, receipts and charges. Any change makes the last
 * calculation stale, so it is cleared and the draft must be calculated again.
 */
export async function saveLandedCost(input: Actor & DraftInput & { id: string }, outer?: TransactionSql) {
  return inTransaction(outer, async (tx) => {
    const doc = await lockDraft(tx, input.companyId, input.id);
    assertDraft(doc);
    const receipts = [...new Set(input.receiptIds)];
    await assertReceipts(tx, input.companyId, receipts);
    const base = await baseCurrency(tx, input.companyId);
    const [clearing] = await tx`select fn_system_account(${input.companyId}, 'LANDED_COST_CLEARING') as a`;
    const [{ fy }] = await tx`select fn_fiscal_year_for(${input.companyId}, ${input.docDate}::date) as fy`;
    const [first] = receipts.length ? await tx`select location_id from document where id = ${receipts[0]}` : [];

    await tx`
      update document set doc_date = ${input.docDate}::date, posting_date = ${input.docDate}::date,
             fiscal_year_id = ${fy ?? null}, memo = ${input.notes?.trim() || null},
             location_id = ${first?.location_id ?? null}
       where id = ${doc.id}`;
    await tx`
      update landed_cost set template_id = ${input.templateId ?? null},
             shipment_ref = ${input.shipmentRef?.trim() || null}, carrier_ref = ${input.carrierRef?.trim() || null},
             calculated_at = null, calculated_by = null
       where document_id = ${doc.id}`;
    // A receipt set that changed may add or drop accessory lines: ask again.
    const [had] = await tx`select array_agg(receipt_id order by receipt_id) as ids from landed_cost_receipt where landed_cost_id = ${doc.id}`;
    if (JSON.stringify((had.ids ?? []).slice().sort()) !== JSON.stringify(receipts.slice().sort())) {
      await tx`update landed_cost set excluded_ack_at = null, excluded_ack_by = null where document_id = ${doc.id}`;
    }
    await tx`delete from landed_cost_allocation where landed_cost_id = ${doc.id}`;
    await tx`delete from landed_cost_receipt where landed_cost_id = ${doc.id}`;
    await tx`delete from landed_cost_charge where landed_cost_id = ${doc.id}`;
    for (const id of receipts) {
      await tx`insert into landed_cost_receipt (landed_cost_id, receipt_id) values (${doc.id}, ${id})`;
    }

    let total = 0;
    for (const [i, c] of input.charges.entries()) {
      const label = `Charge ${i + 1}`;
      if (!METHODS.includes(c.method)) throw new Error(`${label}: choose an allocation method.`);
      const [type] = await tx`
        select id, name, clearing_account_id from landed_cost_type
         where id = ${c.costTypeId} and company_id = ${input.companyId}`;
      if (!type) throw new Error(`${label}: choose a cost type.`);

      let currency: string, rate: number, fc: number, baseAmt: number;
      let rateDate: string | null, rateBy: string | null, clearingId: string;
      let partnerId = c.partnerId || null;

      if (c.sourceJournalLineId) {
        // The bill as it was posted: its currency, foreign amount, rate and
        // kyat are taken as they are. A bill already stored in kyat is never
        // converted a second time.
        const [jl] = await tx`
          select jl.id, jl.account_id, jl.currency, jl.amount::float as amount,
                 jl.exchange_rate::float as rate, jl.base_amount::float as base,
                 jl.partner_id, je.entry_date::text as entry_date, je.source_id
            from journal_line jl join journal_entry je on je.id = jl.journal_entry_id
           where jl.id = ${c.sourceJournalLineId} and jl.company_id = ${input.companyId}`;
        if (!jl) throw new Error(`${label}: the linked bill was not found.`);
        if (!(jl.base > 0)) throw new Error(`${label}: the linked line is not a debit, so it is not a charge.`);
        const [src] = jl.source_id
          ? await tx`select status from document where id = ${jl.source_id}` : [];
        if (src && src.status !== "POSTED") throw new Error(`${label}: the linked bill has been reversed.`);
        currency = jl.currency; fc = Math.abs(jl.amount); baseAmt = jl.base;
        rate = currency === base.code ? 1 : jl.rate; rateDate = jl.entry_date; rateBy = null;
        clearingId = jl.account_id; partnerId = partnerId ?? jl.partner_id ?? null;
      } else {
        currency = (c.currency || base.code).toUpperCase();
        fc = Number(c.amount);
        if (!(fc > 0)) throw new Error(`${label}: enter an amount above zero.`);
        if (currency === base.code) {
          rate = 1; baseAmt = roundTo(fc, base.dp); rateDate = input.docDate; rateBy = null;
        } else {
          // Never a silent 1: a charge in yuan with no rate is refused.
          rate = Number(c.exchangeRate);
          if (!(rate > 0)) throw new Error(`${label}: enter the exchange rate for ${currency} — kyat per 1 ${currency}.`);
          if (!c.rateDate) throw new Error(`${label}: enter the date the ${currency} rate is for.`);
          baseAmt = roundTo(fc * rate, base.dp);
          rateDate = c.rateDate; rateBy = input.userId;
        }
        clearingId = c.clearingAccountId || type.clearing_account_id || clearing.a;
      }
      if (!(baseAmt > 0)) throw new Error(`${label}: the amount comes to nothing in ${base.code}.`);

      let chargeId: string;
      try {
        const [row] = await tx.savepoint((sp) => sp`
          insert into landed_cost_charge
            (landed_cost_id, line_no, cost_type_id, partner_id, source_journal_line_id, description,
             currency, exchange_rate, rate_date, rate_entered_by, fc_amount, base_amount, method,
             clearing_account_id, reference)
          values
            (${doc.id}, ${i + 1}, ${type.id}, ${partnerId}, ${c.sourceJournalLineId || null},
             ${c.description?.trim() || null}, ${currency}, ${rate}, ${rateDate}::date, ${rateBy},
             ${fc}, ${baseAmt}, ${c.method}, ${clearingId}, ${c.reference?.trim() || null})
          returning id`);
        chargeId = row.id as string;
      } catch (e) {
        if ((e as { code?: string }).code === "23505") {
          throw new Error(`${label}: that bill is already spread by another landed cost. A bill is spread once.`);
        }
        throw e;
      }
      if (c.method === "MANUAL") {
        for (const m of c.manual ?? []) {
          if (!(Number(m.amount) >= 0)) throw new Error(`${label}: a variant amount cannot be negative.`);
          await tx`
            insert into landed_cost_manual (charge_id, item_id, amount)
            values (${chargeId}, ${m.itemId}, ${roundTo(Number(m.amount), base.dp)})`;
        }
      }
      total = round4(total + baseAmt);
    }
    await tx`update document set net_total = ${total}, gross_total = ${total} where id = ${doc.id}`;
    await history(tx, input.companyId, doc.id, "UPDATE", input.userId);
    return { id: doc.id };
  });
}

/** Someone says they know the accessories get none of the charges. */
export async function acknowledgeExcluded(input: Actor & { id: string }, outer?: TransactionSql) {
  return inTransaction(outer, async (tx) => {
    const doc = await lockDraft(tx, input.companyId, input.id);
    assertDraft(doc);
    await tx`update landed_cost set excluded_ack_at = now(), excluded_ack_by = ${input.userId} where document_id = ${doc.id}`;
    await history(tx, input.companyId, doc.id, "ACKNOWLEDGE", input.userId,
      "Charges go to IMEI-tracked phones only; accessory lines get none in this version.");
  });
}

/** Work out every phone's share of every charge and keep it. */
export async function calculateLandedCost(input: Actor & { id: string }, outer?: TransactionSql) {
  return inTransaction(outer, async (tx) => {
    const doc = await lockDraft(tx, input.companyId, input.id);
    assertDraft(doc);
    const base = await baseCurrency(tx, input.companyId);
    const receipts = (await tx`select receipt_id from landed_cost_receipt where landed_cost_id = ${doc.id}`)
      .map((r) => r.receipt_id as string);
    await assertReceipts(tx, input.companyId, receipts);
    const units = await eligibleUnits(tx, input.companyId, receipts);
    if (units.length === 0) throw new Error("The chosen receipts have no IMEI-tracked phones to carry the charges.");
    const excluded = await excludedLines(tx, input.companyId, receipts);
    const [lc] = await tx`select excluded_ack_at from landed_cost where document_id = ${doc.id}`;
    if (excluded.length > 0 && !lc.excluded_ack_at) {
      throw new Error("These receipts include items that are not phones. Confirm that the charges go to the IMEI-tracked phones only.");
    }
    const charges = await tx`
      select c.id, c.line_no, c.base_amount::float as base_amount, c.method, t.name,
             coalesce((select json_agg(json_build_object('item_id', m.item_id, 'amount', m.amount::float))
                         from landed_cost_manual m where m.charge_id = c.id), '[]'::json) as manual
        from landed_cost_charge c join landed_cost_type t on t.id = c.cost_type_id
       where c.landed_cost_id = ${doc.id} order by c.line_no`;
    if (charges.length === 0) throw new Error("Add at least one charge.");

    await tx`delete from landed_cost_allocation where landed_cost_id = ${doc.id}`;
    for (const c of charges) {
      const parts = allocate(c as never, units, base.dp, `${c.name} (line ${c.line_no})`);
      const rows = units.map((u, i) => ({
        landed_cost_id: doc.id, charge_id: c.id, serial_id: u.serial_id, receipt_id: u.receipt_id,
        receipt_line_id: u.receipt_line_id, item_id: u.item_id, original_cost: u.original_cost, amount: parts[i],
      }));
      for (let i = 0; i < rows.length; i += 2000) {
        await tx`insert into landed_cost_allocation ${tx(rows.slice(i, i + 2000))}`;
      }
      const sum = roundTo(parts.reduce((s, p) => s + p, 0), base.dp);
      if (sum !== roundTo(Number(c.base_amount), base.dp)) {
        throw new Error(`${c.name}: allocated ${sum} of ${c.base_amount}. Nothing was saved.`);
      }
    }
    await tx`update landed_cost set calculated_at = now(), calculated_by = ${input.userId} where document_id = ${doc.id}`;
    await history(tx, input.companyId, doc.id, "CALCULATE", input.userId);
    return { units: units.length };
  });
}

/** A draft that is no longer wanted. Posted ones are reversed, never deleted. */
export async function deleteLandedCost(input: Actor & { id: string }, outer?: TransactionSql) {
  return inTransaction(outer, async (tx) => {
    const doc = await lockDraft(tx, input.companyId, input.id);
    assertDraft(doc);
    await tx`update landed_cost_charge set is_active = false where landed_cost_id = ${doc.id}`;
    await tx`delete from landed_cost_allocation where landed_cost_id = ${doc.id}`;
    await tx`update document set status = 'CANCELLED' where id = ${doc.id}`;
    await history(tx, input.companyId, doc.id, "UPDATE", input.userId, "Draft discarded");
  });
}

// ----------------------------------------------------------- posting --

type Treatment = "INVENTORY" | "HOLDING" | "COGS";
type Where = {
  status: string; owned: boolean; item_id: string; treatment: Treatment;
  lot_id: string; location_id: string; consumption_id: string | null; expense_account_id: string | null;
};

/** Where a phone is now, and if it has gone, the slice it left on. */
async function whereIs(tx: TransactionSql, serialId: string): Promise<Where> {
  const [v] = await tx`
    select v.status, v.item_id, s.stock_lot_id as lot_id, l.location_id
      from v_stock_serial v join stock_serial s on s.id = v.serial_id
      join stock_lot l on l.id = s.stock_lot_id
     where v.serial_id = ${serialId}`;
  const owned = OWNED.has(v.status as string);
  let consumption: { id: string; expense_account_id: string | null; location_id: string; held: boolean } | undefined;
  if (!owned) {
    // Held: it left on a delivery nobody has invoiced yet, so its cost is in
    // 1090, not in cost of sales (D8 — cost of sales waits for the invoice).
    const rows = await tx`
      select c.id, c.expense_account_id, sm.location_id,
             exists (select 1 from v_delivery_cost_unclaimed v where v.consumption_id = c.id) as held
        from stock_serial_issue si
        join stock_lot_consumption c on c.id = si.consumption_id
        join stock_movement sm on sm.id = si.stock_movement_id
       where si.serial_id = ${serialId} and fn_serial_issue_stands(si.stock_movement_id)
       order by si.created_at desc limit 1`;
    consumption = rows[0] as typeof consumption;
  }
  return {
    status: v.status, owned, item_id: v.item_id, lot_id: v.lot_id,
    treatment: owned ? "INVENTORY" : consumption?.held ? "HOLDING" : "COGS",
    location_id: consumption?.location_id ?? v.location_id,
    consumption_id: consumption?.id ?? null,
    expense_account_id: consumption?.expense_account_id ?? null,
  };
}

/** The account a phone's cost is in now: inventory where it stands, 1090 while it waits for an invoice, else where its sale charged it. */
async function accountFor(tx: TransactionSql, companyId: string, w: Where): Promise<string> {
  if (w.treatment === "INVENTORY") {
    return (await tx`select fn_resolve_account_for_item(${companyId}, 'INVENTORY', ${w.item_id}, null, ${w.location_id}) as a`)[0].a;
  }
  if (w.treatment === "HOLDING") {
    return (await tx`select fn_system_account(${companyId}, 'SHIPPED_NOT_INVOICED') as a`)[0].a;
  }
  return w.expense_account_id
    ?? (await tx`select fn_resolve_account_for_item(${companyId}, 'COGS', ${w.item_id}) as a`)[0].a;
}

/**
 * Put an owned phone on a layer of its own, if it shares one.
 *
 * A −1 from the shared layer and a +1 onto a new one-phone layer at the same
 * warehouse, the same cost and the same place in the FIFO queue, marked
 * COST_LAYER_SPLIT and posted to no account. Done once: a phone already alone
 * on its layer is left where it is.
 */
async function isolate(tx: TransactionSql, companyId: string, landedCostId: string, documentId: string,
  serialId: string, lotId: string, date: string): Promise<string> {
  const [lot] = await tx`
    select l.id, l.item_id, l.location_id, l.qty_received::float as qty, l.received_date, l.batch_no, l.expiry_date,
           (l.unit_cost + coalesce((select sum(a.delta_unit_cost) from stock_lot_adjustment a where a.lot_id = l.id), 0))::float as cost,
           l.qty_received - coalesce((select sum(c.qty) from stock_lot_consumption c where c.lot_id = l.id), 0) as remaining
      from stock_lot l where l.id = ${lotId} for update`;
  if (Number(lot.qty) <= 1) return lot.id as string;
  if (Number(lot.remaining) < 1 - 1e-6) throw new Error("A phone's cost layer has nothing left on it — the stock and its IMEIs disagree.");

  const cost = round4(Number(lot.cost));
  const [out] = await tx`
    insert into stock_movement (company_id, item_id, location_id, movement_date, qty, unit_cost, total_cost, document_id, kind)
    values (${companyId}, ${lot.item_id}, ${lot.location_id}, ${date}::date, -1, ${cost}, ${-cost}, ${documentId}, 'COST_LAYER_SPLIT')
    returning id`;
  const [c] = await tx`
    insert into stock_lot_consumption (company_id, lot_id, stock_movement_id, qty, unit_cost, expense_account_id)
    values (${companyId}, ${lot.id}, ${out.id}, 1, ${cost}, null) returning id`;
  const [inn] = await tx`
    insert into stock_movement (company_id, item_id, location_id, movement_date, qty, unit_cost, total_cost, document_id, kind)
    values (${companyId}, ${lot.item_id}, ${lot.location_id}, ${date}::date, 1, ${cost}, ${cost}, ${documentId}, 'COST_LAYER_SPLIT')
    returning id`;
  const newLot = await createFifoLot(tx, companyId, lot.item_id, lot.location_id,
    new Date(lot.received_date).toISOString(), cost, 1, inn.id as string,
    { batchNo: lot.batch_no, expiryDate: lot.expiry_date ? String(lot.expiry_date).slice(0, 10) : null });
  await tx`
    insert into landed_cost_relayer (consumption_id, landed_cost_id, serial_id, from_lot_id, to_lot_id)
    values (${c.id}, ${landedCostId}, ${serialId}, ${lot.id}, ${newLot})`;
  await moveSerialsTo(tx, companyId, [serialId], newLot,
    { kind: "COST_LAYER_SPLIT", documentId, from: lot.location_id, to: lot.location_id });
  return newLot;
}

/**
 * Change an owned phone's cost by `amount`, on its own layer: the layer's
 * adjustment and a value-only stock movement, so the stock ledger moves with
 * the inventory account.
 */
async function revalueOwned(tx: TransactionSql, companyId: string, documentId: string,
  lotId: string, itemId: string, locationId: string, amount: number, date: string, reason: string) {
  await tx`
    insert into stock_lot_adjustment (company_id, lot_id, document_id, delta_unit_cost, qty_remaining, qty_issued, reason)
    values (${companyId}, ${lotId}, ${documentId}, ${amount}, 1, 0, ${reason})`;
  await tx`
    insert into stock_movement (company_id, item_id, location_id, movement_date, qty, unit_cost, total_cost, document_id)
    values (${companyId}, ${itemId}, ${locationId}, ${date}::date, 0, 0, ${amount}, ${documentId})`;
}

/** Post a calculated draft: the phones' costs change and the entry is written, together or not at all. */
export async function postLandedCost(input: Actor & { id: string }, outer?: TransactionSql) {
  return inTransaction(outer, async (tx) => {
    const doc = await lockDraft(tx, input.companyId, input.id);
    assertDraft(doc);
    const base = await baseCurrency(tx, input.companyId);
    const [lc] = await tx`select calculated_at from landed_cost where document_id = ${doc.id}`;
    if (!lc?.calculated_at) throw new Error("Calculate the allocation before posting.");
    const receipts = (await tx`select receipt_id from landed_cost_receipt where landed_cost_id = ${doc.id}`)
      .map((r) => r.receipt_id as string);
    await assertReceipts(tx, input.companyId, receipts);

    const charges = await tx`
      select c.id, c.base_amount::float as base_amount, c.clearing_account_id, c.source_journal_line_id, c.partner_id,
             (select coalesce(sum(a.amount), 0)::float from landed_cost_allocation a where a.charge_id = c.id) as allocated
        from landed_cost_charge c where c.landed_cost_id = ${doc.id} and c.is_active order by c.line_no`;
    if (charges.length === 0) throw new Error("Add at least one charge.");
    for (const c of charges) {
      if (roundTo(c.allocated, base.dp) !== roundTo(c.base_amount, base.dp)) {
        throw new Error("The allocation no longer adds up to the charges. Calculate again.");
      }
    }

    // Each phone's total, locked in id order so two postings over the same
    // phones queue rather than deadlock.
    const perSerial = await tx`
      select a.serial_id, s.serial_no, sum(a.amount)::float as amount
        from landed_cost_allocation a join stock_serial s on s.id = a.serial_id
       where a.landed_cost_id = ${doc.id}
       group by a.serial_id, s.serial_no order by a.serial_id`;
    await tx`select id from stock_serial where id = any(${perSerial.map((r) => r.serial_id)}) order by id for update`;

    const journal: JournalLine[] = [];
    const reason = `${doc.doc_no} landed cost`;
    for (const p of perSerial) {
      const amount = roundTo(Number(p.amount), base.dp);
      if (amount === 0) continue;
      const w = await whereIs(tx, p.serial_id);
      let lotId: string | null = null;
      if (w.owned) {
        lotId = await isolate(tx, input.companyId, doc.id, doc.id, p.serial_id, w.lot_id, doc.doc_date);
        await revalueOwned(tx, input.companyId, doc.id, lotId, w.item_id, w.location_id, amount, doc.doc_date, reason);
      }
      const accountId = await accountFor(tx, input.companyId, w);
      journal.push({ accountId, amount, locationId: w.location_id });
      await tx`
        insert into landed_cost_posting
          (landed_cost_id, document_id, serial_id, status_then, treatment, account_id, location_id, lot_id, consumption_id, amount)
        values (${doc.id}, ${doc.id}, ${p.serial_id}, ${w.status}, ${w.treatment}, ${accountId},
                ${w.location_id}, ${lotId}, ${w.consumption_id}, ${amount})`;
      await tx`
        insert into stock_serial_event (company_id, serial_id, event, document_id, to_location_id, lot_id, note)
        values (${input.companyId}, ${p.serial_id}, 'LANDED_COST', ${doc.id}, ${w.location_id}, ${lotId},
                ${NOTE[w.treatment]})`;
    }
    // A charge with a payee and no bill behind it is a debt to that payee:
    // it is owed in Payable (Other) until a courier payment settles it. One
    // linked to a bill only spends what the bill put into clearing.
    const [owedTo] = await tx`
      select account_id from system_account where company_id = ${input.companyId} and role = 'OTHER_PAYABLE'`;
    for (const c of charges) {
      const owed = !c.source_journal_line_id && c.partner_id && owedTo ? owedTo.account_id as string : null;
      journal.push({ accountId: owed ?? c.clearing_account_id, amount: -roundTo(c.base_amount, base.dp),
                     partnerId: owed ? c.partner_id : null, locationId: doc.location_id });
      await tx`update landed_cost_charge set owed_account_id = ${owed} where id = ${c.id}`;
    }

    const entryId = await writeJournal(tx, input.companyId, doc.doc_date, "LANDED_COST", doc.id,
      `${doc.doc_no} landed cost`, journal, doc.location_id);
    await tx`
      update document set status = 'POSTED', posted_at = now(), posted_by_id = ${input.userId},
             journal_entry_id = ${entryId}
       where id = ${doc.id}`;
    await history(tx, input.companyId, doc.id, "POST", input.userId);
    return { id: doc.id, docNo: doc.doc_no, journalEntryId: entryId };
  });
}

/**
 * Undo a posted landed cost with a document of its own.
 *
 * Each phone's amount is taken back from wherever it is now, which need not
 * be where it was put: a phone revalued on the shelf and sold since carries
 * the amount in cost of sales; one costed to cost of sales and returned since
 * carries it back on the shelf. A phone stays on its own layer — it is never
 * merged back into the one it was split from.
 */
export async function reverseLandedCost(input: Actor & { id: string; reason: string; date?: string }, outer?: TransactionSql) {
  return inTransaction(outer, async (tx) => {
    const reason = input.reason?.trim();
    if (!reason) throw new Error("Say why this landed cost is being reversed.");
    const [doc] = await tx`
      select id, status, doc_no, doc_date::text as doc_date, location_id from document
       where id = ${input.id} and company_id = ${input.companyId} and doc_type = 'LANDED_COST' for update`;
    if (!doc) throw new Error("Landed cost not found.");
    if (doc.status !== "POSTED") throw new Error(`${doc.doc_no} is not posted, so there is nothing to reverse.`);
    // What a courier has been paid against it stands; taking the debt away
    // under a payment would leave the payment owing nothing.
    const [paid] = await tx`
      select coalesce(sum(s.amount), 0)::float as v from courier_settlement s
        join document p on p.id = s.payment_id and p.status = 'POSTED'
        join landed_cost_charge c on c.id = s.charge_id where c.landed_cost_id = ${doc.id}`;
    if (Number(paid.v) > 0) {
      throw new Error(`${doc.doc_no} has courier payments against it (${paid.v.toLocaleString("en-US")}). Reverse those payments first.`);
    }
    const base = await baseCurrency(tx, input.companyId);
    const date = input.date || new Date().toISOString().slice(0, 10);

    const [{ no }] = await tx`select fn_next_document_no(${input.companyId}, 'LANDED_COST', ${date}::date) as no`;
    const [{ fy }] = await tx`select fn_fiscal_year_for(${input.companyId}, ${date}::date) as fy`;
    const [rev] = await tx`
      insert into document
        (company_id, doc_type, doc_no, fiscal_year_id, doc_date, posting_date, location_id, currency, exchange_rate,
         status, net_total, tax_total, gross_total, memo, created_by_id, posted_by_id, posted_at, reverses_document_id, void_reason)
      select company_id, 'LANDED_COST', ${no}, ${fy ?? null}, ${date}::date, ${date}::date, location_id, currency, 1,
             'POSTED', -net_total, 0, -gross_total, ${`Reverses ${doc.doc_no}`}, ${input.userId}, ${input.userId}, now(),
             id, ${reason}
        from document where id = ${doc.id}
      returning id`;

    const posted = await tx`
      select serial_id, sum(amount)::float as amount from landed_cost_posting
       where landed_cost_id = ${doc.id} and document_id = ${doc.id}
       group by serial_id order by serial_id`;
    await tx`select id from stock_serial where id = any(${posted.map((r) => r.serial_id)}) order by id for update`;

    const journal: JournalLine[] = [];
    for (const p of posted) {
      const amount = roundTo(Number(p.amount), base.dp);
      if (amount === 0) continue;
      const w = await whereIs(tx, p.serial_id);
      let lotId: string | null = null;
      if (w.owned) {
        lotId = await isolate(tx, input.companyId, doc.id, rev.id, p.serial_id, w.lot_id, date);
        await revalueOwned(tx, input.companyId, rev.id, lotId, w.item_id, w.location_id, -amount, date, `Reverses ${doc.doc_no}`);
      }
      const accountId = await accountFor(tx, input.companyId, w);
      journal.push({ accountId, amount: -amount, locationId: w.location_id });
      await tx`
        insert into landed_cost_posting
          (landed_cost_id, document_id, serial_id, status_then, treatment, account_id, location_id, lot_id, consumption_id, amount)
        values (${doc.id}, ${rev.id}, ${p.serial_id}, ${w.status}, ${w.treatment}, ${accountId},
                ${w.location_id}, ${lotId}, ${w.consumption_id}, ${-amount})`;
      await tx`
        insert into stock_serial_event (company_id, serial_id, event, document_id, to_location_id, lot_id, note)
        values (${input.companyId}, ${p.serial_id}, 'LANDED_COST', ${rev.id}, ${w.location_id}, ${lotId},
                ${`Reversed (${doc.doc_no})`})`;
    }
    const charges = await tx`
      select clearing_account_id, owed_account_id, partner_id, base_amount::float as base_amount from landed_cost_charge
       where landed_cost_id = ${doc.id} and is_active`;
    for (const c of charges) {
      journal.push({ accountId: c.owed_account_id ?? c.clearing_account_id, amount: roundTo(c.base_amount, base.dp),
                     partnerId: c.owed_account_id ? c.partner_id : null, locationId: doc.location_id });
    }
    const entryId = await writeJournal(tx, input.companyId, date, "LANDED_COST", rev.id,
      `${no} reverses ${doc.doc_no}`, journal, doc.location_id);

    await tx`update document set journal_entry_id = ${entryId} where id = ${rev.id}`;
    await tx`update document set status = 'REVERSED', reversed_by_document_id = ${rev.id} where id = ${doc.id}`;
    await tx`
      update landed_cost set reversed_at = now(), reversed_by = ${input.userId}, reversal_reason = ${reason}
       where document_id = ${doc.id}`;
    // The bills are free to be spread again, correctly this time.
    await tx`update landed_cost_charge set is_active = false where landed_cost_id = ${doc.id}`;
    await history(tx, input.companyId, doc.id, "REVERSE", input.userId, reason, undefined, rev.id);
    return { id: rev.id as string, docNo: no as string };
  });
}

/**
 * Landed cost a phone's slice carries now: every landed cost put on it after
 * it left, net of any reversal taken from there. It sits wherever the slice's
 * own cost sits — 1090 while the delivery waits for its invoice, cost of sales
 * after — so a return, a void or an invoice moves it with that cost.
 */
export async function landedOn(tx: TransactionSql, consumptionId: string): Promise<number> {
  const [r] = await tx`
    select coalesce(sum(amount), 0)::float as v from landed_cost_posting where consumption_id = ${consumptionId}`;
  return round4(Number(r.v));
}
