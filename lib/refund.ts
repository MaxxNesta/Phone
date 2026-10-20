import type { TransactionSql } from "postgres";
import { sql } from "./db";
import { postSalesReturn, postCustomerRefund, refundableOnReturn, type ReturnInput } from "./posting";
import { resolveTenders, stampReceipt } from "./payment-channels";

/**
 * A customer return, and the money paid back for it if any, posted together.
 * And the same thing dry-run: posted inside a transaction that is always
 * rolled back, so the review screen shows exactly what the engine would
 * write — the accounts, the amounts, the balances before and after — rather
 * than a second, hand-written idea of it.
 */

type Tr = (key: string, values?: Record<string, string | number>) => string;

export type RefundSpec = { channelId: string; amount: number; reference: string | null } | null;

export type MoneyPreview = {
  entries: { docNo: string; docType: string; lines: { code: string; name: string; debit: number; credit: number }[] }[];
  /** Each cash or bank account the posting moves, with its balance either side. */
  cash: { code: string; name: string; before: number; after: number }[];
  /** What the customer owes (+) or is owed (−), on the invoice or on account. */
  customer: { name: string; scope: "invoice" | "account"; docNo: string | null; before: number; after: number };
  stock: { item: string; qty: number; location: string }[];
  refund: { amount: number; channel: string; account: string; reference: string | null } | null;
  /** What could still be paid back after this posting. */
  refundableAfter: number;
};

/** Posts the refund for a return just posted (or already posted) in `tx`. */
export async function refundReturn(
  tx: TransactionSql, companyId: string, userId: string | null, returnId: string, docDate: string,
  spec: NonNullable<RefundSpec>, tr: Tr,
) {
  const [r] = await tx`select location_id from document where id = ${returnId}`;
  const res = await resolveTenders(companyId, r?.location_id ?? null,
    [{ channelId: spec.channelId, amount: spec.amount, reference: spec.reference }], null, tx as never);
  if (!res.ok) throw new Error(tr(`tender.${res.problem.key}`, res.problem.values));
  const t = res.tenders[0];
  const refund = await postCustomerRefund({
    companyId, returnId, docDate, cashAccountId: t.channel.accountId as string, amount: t.amount,
  }, tx);
  await stampReceipt(tx as never, refund.id, t.channel.id, t.reference, userId);
  return refund;
}

/** Return plus optional refund, in the caller's transaction. */
export async function postReturnWithRefund(
  tx: TransactionSql, input: ReturnInput, userId: string | null, spec: RefundSpec, tr: Tr,
) {
  const ret = await postSalesReturn(input, tx);
  await tx`update document set created_by_id = ${userId}, posted_by_id = ${userId} where id = ${ret.id}`;
  const refund = spec && spec.amount > 0
    ? await refundReturn(tx, input.companyId, userId, ret.id, input.docDate, spec, tr) : null;
  return { id: ret.id as string, docNo: ret.docNo as string, refund };
}

class Rollback extends Error {}

/**
 * Runs `post` and reads back what it wrote, then undoes all of it. `post`
 * returns the ids of the documents it created; the first is the one the
 * customer balance is read against.
 */
export async function dryRun(
  companyId: string, partnerId: string,
  post: (tx: TransactionSql) => Promise<{ docIds: string[]; returnId: string }>,
): Promise<MoneyPreview> {
  let out: MoneyPreview | null = null;
  try {
    await sql.begin(async (tx) => {
      const [p] = await tx`select name from business_partner where id = ${partnerId} and company_id = ${companyId}`;
      // The customer's position before: computed after posting for the same
      // invoice, so read it here first for whichever scope applies below.
      const advBefore = await advanceHeld(tx, companyId, partnerId);

      const { docIds, returnId } = await post(tx);
      const [ret] = await tx`
        select d.doc_no, fn_current_document(d.source_document_id) as invoice_id, l.name as location
          from document d left join location l on l.id = d.location_id where d.id = ${returnId}`;

      const lines = await tx`
        select d.id as doc_id, d.doc_no, d.doc_type, a.id as account_id, a.code, a.name, a.is_cash_account,
               sum(jl.base_amount)::float as amount
          from document d
          join journal_line jl on jl.journal_entry_id = d.journal_entry_id
          join account a on a.id = jl.account_id
         where d.id = any(${docIds})
         group by d.id, d.doc_no, d.doc_type, a.id, a.code, a.name, a.is_cash_account
         order by d.doc_type desc, sum(jl.base_amount) desc`;
      const entries = docIds.map((id) => {
        const ls = lines.filter((l) => l.doc_id === id);
        return {
          docNo: String(ls[0]?.doc_no ?? ""), docType: String(ls[0]?.doc_type ?? ""),
          lines: ls.filter((l) => Math.abs(l.amount) > 0.004).map((l) => ({
            code: l.code, name: l.name, debit: l.amount > 0 ? l.amount : 0, credit: l.amount < 0 ? -l.amount : 0,
          })),
        };
      }).filter((e) => e.docNo);

      const moved = new Map<string, { code: string; name: string; delta: number }>();
      for (const l of lines.filter((x) => x.is_cash_account)) {
        const m = moved.get(l.account_id) ?? { code: l.code, name: l.name, delta: 0 };
        m.delta += Number(l.amount);
        moved.set(l.account_id, m);
      }
      const cash = [];
      for (const [id, m] of moved) {
        const [b] = await tx`select coalesce(sum(base_amount), 0)::float as v from journal_line where account_id = ${id}`;
        cash.push({ code: m.code, name: m.name, before: Number(b.v) - m.delta, after: Number(b.v) });
      }

      let customer: MoneyPreview["customer"];
      if (ret.invoice_id) {
        const [inv] = await tx`select doc_no from document where id = ${ret.invoice_id}`;
        const [o] = await tx`select coalesce(outstanding, 0)::float as o from v_open_item where document_id = ${ret.invoice_id}`;
        const created = await tx`
          select coalesce(sum(case when d.doc_type = 'SALES_RETURN' then d.gross_total
                                   when d.doc_type = 'CUSTOMER_REFUND' then -d.gross_total else 0 end), 0)::float as v
            from document d where d.id = any(${docIds})`;
        const after = Number(o?.o ?? 0);
        customer = { name: p?.name ?? "", scope: "invoice", docNo: inv?.doc_no ?? null,
                     before: after + Number(created[0].v), after };
      } else {
        customer = { name: p?.name ?? "", scope: "account", docNo: null,
                     before: -advBefore, after: -(await advanceHeld(tx, companyId, partnerId)) };
      }

      const stock = await tx`
        select i.name as item, sum(sm.qty)::float as qty, l.name as location
          from stock_movement sm join item i on i.id = sm.item_id join location l on l.id = sm.location_id
         where sm.document_id = any(${docIds})
         group by i.name, l.name having sum(sm.qty) <> 0`;

      const [rf] = await tx`
        select d.gross_total::float as amount, pc.name as channel, a.code || ' · ' || a.name as account,
               d.payment_reference
          from document d
          left join payment_channel pc on pc.id = d.payment_channel_id
          left join lateral (select x.code, x.name from journal_line l join account x on x.id = l.account_id
                              where l.journal_entry_id = d.journal_entry_id and x.is_cash_account limit 1) a on true
         where d.id = any(${docIds}) and d.doc_type = 'CUSTOMER_REFUND' limit 1`;

      out = {
        entries, cash, customer,
        stock: stock.map((s) => ({ item: s.item, qty: Number(s.qty), location: s.location })),
        refund: rf ? { amount: Number(rf.amount), channel: rf.channel ?? "", account: rf.account ?? "",
                       reference: rf.payment_reference ?? null } : null,
        refundableAfter: (await refundableOnReturn(tx, returnId)).refundable,
      };
      throw new Rollback();
    });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }
  return out as unknown as MoneyPreview;
}

async function advanceHeld(tx: TransactionSql, companyId: string, partnerId: string) {
  const [a] = await tx`
    select -coalesce(sum(jl.base_amount), 0)::float as held from journal_line jl
     where jl.company_id = ${companyId} and jl.partner_id = ${partnerId}
       and jl.account_id = fn_system_account(${companyId}, 'CUSTOMER_ADVANCE')`;
  return Number(a?.held ?? 0);
}
