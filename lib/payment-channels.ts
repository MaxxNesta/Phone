import type { Sql } from "postgres";
import { sql } from "./db";

/**
 * How a customer paid (migration 0141). A channel is resolved to the cash or
 * bank account its money lands in BEFORE the posting engine runs; the engine
 * only ever sees an account, so no provider is named in the accounting code.
 * After posting, the receipt is stamped with the channel and the wallet's
 * transaction reference, inside the same transaction.
 */

export type ChannelKind = "CASH" | "BANK" | "WALLET" | "QR" | "CARD" | "OTHER";

export type Channel = {
  id: string; code: string; name: string; kind: ChannelKind;
  requiresReference: boolean; merchantName: string | null; merchantNumber: string | null;
  /** The account it pays into at the location asked about; null = not set up there. */
  accountId: string | null; accountName: string | null;
};

/** Active channels as the till or a receipt form at one location sees them. */
export async function channelsAt(companyId: string, locationId: string | null, db: Sql = sql): Promise<Channel[]> {
  const rows = await db`
    select c.id, c.code, c.name, c.kind, c.requires_reference, c.merchant_name, c.merchant_number,
           a.id as account_id, a.name as account_name
      from payment_channel c
      left join account a on a.id = fn_payment_channel_account(c.id, ${locationId}::uuid) and a.is_active
     where c.company_id = ${companyId} and c.is_active
     order by c.sort_order, c.name`;
  return rows.map((r) => ({
    id: r.id, code: r.code, name: r.name, kind: r.kind,
    requiresReference: r.requires_reference, merchantName: r.merchant_name, merchantNumber: r.merchant_number,
    accountId: r.account_id ?? null, accountName: r.account_name ?? null,
  }));
}

export type TenderIn = { channelId: string; amount: number; reference?: string | null };
export type Tender = { channel: Channel; amount: number; reference: string | null };
export type TenderProblem = { key: string; values?: Record<string, string | number> };

const cents = (n: number) => Math.round(n * 100);

/**
 * The rules every tender obeys, whatever screen took it. Pure, so the test
 * suite checks it directly. `total` is what is due; null means no ceiling
 * (an advance or receipt checked elsewhere against its invoices).
 */
export function checkTenders(
  tenders: { channel: Channel | undefined; amount: number; reference: string | null }[],
  total: number | null,
): TenderProblem | null {
  const seen = new Set<string>();
  let paid = 0;
  for (const t of tenders) {
    if (!t.channel) return { key: "channelUnknown" };
    if (!(Number.isFinite(t.amount) && t.amount > 0)) return { key: "tenderAmount", values: { name: t.channel.name } };
    if (!t.channel.accountId) return { key: "channelUnmapped", values: { name: t.channel.name } };
    if (t.channel.requiresReference && !t.reference) return { key: "referenceRequired", values: { name: t.channel.name } };
    if (t.reference) {
      const k = `${t.channel.id}:${t.reference.toLowerCase()}`;
      if (seen.has(k)) return { key: "referenceTwice", values: { ref: t.reference } };
      seen.add(k);
    }
    paid += cents(t.amount);
  }
  // Change is given from the drawer, never posted: what is tendered and
  // posted can never be more than what is due.
  if (total != null && paid > cents(total)) return { key: "overpaid" };
  return null;
}

/** Looks the tenders' channels up for this location and checks them. */
export async function resolveTenders(
  companyId: string, locationId: string | null, input: TenderIn[], total: number | null, db: Sql = sql,
): Promise<{ ok: true; tenders: Tender[] } | { ok: false; problem: TenderProblem }> {
  const channels = new Map((await channelsAt(companyId, locationId, db)).map((c) => [c.id, c]));
  const list = input.map((t) => ({
    channel: channels.get(t.channelId),
    amount: Math.round(Number(t.amount) * 100) / 100,
    reference: String(t.reference ?? "").trim().slice(0, 80) || null,
  }));
  const problem = checkTenders(list, total);
  if (problem) return { ok: false, problem };
  return { ok: true, tenders: list as Tender[] };
}

/**
 * Labels a posted receipt with how it was paid. A reference recorded on
 * another posted receipt of the same channel is refused by the database
 * (document_payment_reference_once), and the whole posting rolls back.
 */
export async function stampReceipt(
  db: Sql, receiptId: string, channelId: string, reference: string | null, userId: string | null = null,
) {
  try {
    await db`
      update document set payment_channel_id = ${channelId}, payment_reference = ${reference},
             created_by_id = coalesce(created_by_id, ${userId}), posted_by_id = coalesce(posted_by_id, ${userId})
       where id = ${receiptId} and doc_type = 'CUSTOMER_RECEIPT'`;
  } catch (e) {
    if ((e as { code?: string }).code === "23505") {
      throw new Error(`Reference ${reference} has already been recorded for this payment method`);
    }
    throw e;
  }
}
