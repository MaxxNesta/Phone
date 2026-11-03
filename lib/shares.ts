import type { TransactionSql } from "postgres";
import { randomUUID } from "node:crypto";
import { sql } from "./db";
import { inTransaction, writeJournal } from "./posting";

/**
 * Shareholders and share transfers (migration 0166). Holdings are never
 * stored: they are the posted transfers replayed in date order, so "who owns
 * what" and "which transaction changed it" can never disagree.
 */

export type TransferType = "ISSUE" | "PURCHASE" | "TRANSFER";
export type ShareType = "EQUITY" | "PREFERENCE";
/** Share numbers, both ends included: [1, 6000]. */
export type Range = [number, number];

export type Movement = {
  id: string; no: string; type: TransferType; date: string; shareType: ShareType;
  from: string | null; to: string | null; fromNo: number; toNo: number; rate: number;
};

// ------------------------------------------------------------- ranges --

const count = (rs: Range[]) => rs.reduce((t, [a, b]) => t + (b - a + 1), 0);
const merge = (rs: Range[]): Range[] => {
  const s = [...rs].sort((x, y) => x[0] - y[0]);
  const out: Range[] = [];
  for (const r of s) {
    const last = out[out.length - 1];
    if (last && r[0] <= last[1] + 1) last[1] = Math.max(last[1], r[1]);
    else out.push([r[0], r[1]]);
  }
  return out;
};
const covers = (rs: Range[], [a, b]: Range) => rs.some(([x, y]) => x <= a && b <= y);
const overlaps = (rs: Range[], [a, b]: Range) => rs.some(([x, y]) => a <= y && x <= b);
const minus = (rs: Range[], [a, b]: Range): Range[] =>
  rs.flatMap(([x, y]): Range[] => (b < x || a > y ? [[x, y]] : [
    ...(x < a ? [[x, a - 1] as Range] : []), ...(b < y ? [[b + 1, y] as Range] : []),
  ]));
export const formatRanges = (rs: Range[]) => rs.map(([a, b]) => (a === b ? `${a}` : `${a}–${b}`)).join(", ");

/**
 * Who holds which numbers after these movements, in order. Throws, naming the
 * transfer, at the first one that cannot happen: an issue reusing numbers, or
 * a transfer or buy-back of numbers the giver does not hold on that date.
 * Pure, so the check is the same wherever it runs.
 */
export function replay(moves: Movement[]) {
  const held = new Map<string, Range[]>();            // `${shareType}|${holder}`
  const issued = new Map<ShareType, Range[]>();        // every number ever issued, per type
  const key = (t: ShareType, h: string) => `${t}|${h}`;
  const sorted = [...moves].sort((a, b) => a.date.localeCompare(b.date) || a.no.localeCompare(b.no));
  for (const m of sorted) {
    const r: Range = [m.fromNo, m.toNo];
    const n = m.toNo - m.fromNo + 1;
    if (m.type === "ISSUE") {
      const used = issued.get(m.shareType) ?? [];
      if (overlaps(used, r)) throw new Error(`${m.no}: share numbers ${m.fromNo}–${m.toNo} were already issued. The next free number is ${used.length ? Math.max(...used.map((x) => x[1])) + 1 : 1}.`);
      issued.set(m.shareType, merge([...used, r]));
    } else {
      const k = key(m.shareType, m.from!);
      const has = held.get(k) ?? [];
      if (!covers(merge(has), r)) {
        throw new Error(`${m.no}: on ${m.date} the giver holds ${count(has).toLocaleString("en-US")} ${m.shareType.toLowerCase()} shares (${formatRanges(merge(has)) || "none"}), not numbers ${m.fromNo}–${m.toNo} (${n.toLocaleString("en-US")}).`);
      }
      held.set(k, minus(merge(has), r));
    }
    if (m.type !== "PURCHASE") {
      const k = key(m.shareType, m.to!);
      held.set(k, merge([...(held.get(k) ?? []), r]));
    }
  }
  return {
    holding: (holder: string, type: ShareType) => merge(held.get(key(type, holder)) ?? []),
    nextIssueNo: (type: ShareType) => { const u = issued.get(type) ?? []; return u.length ? Math.max(...u.map((x) => x[1])) + 1 : 1; },
    entries: [...held.entries()].map(([k, rs]) => { const [t, h] = k.split("|"); return { shareType: t as ShareType, holder: h, ranges: merge(rs), shares: count(rs) }; }),
  };
}

// -------------------------------------------------------------- reads --

async function movements(db: typeof sql | TransactionSql, companyId: string, except?: string): Promise<Movement[]> {
  const rows = await db`
    select id, transfer_no, transfer_type, to_char(transfer_date, 'YYYY-MM-DD') as d, share_type,
           from_shareholder_id, to_shareholder_id, from_no, to_no, rate::float as rate
      from share_transfer
     where company_id = ${companyId} and status = 'POSTED' ${except ? db`and id <> ${except}` : db``}`;
  return (rows as any[]).map((r) => ({ id: r.id, no: r.transfer_no, type: r.transfer_type, date: r.d, shareType: r.share_type,
    from: r.from_shareholder_id, to: r.to_shareholder_id, fromNo: r.from_no, toNo: r.to_no, rate: Number(r.rate) }));
}

export async function listShareholders(companyId: string) {
  const [people, moves, amounts] = await Promise.all([
    sql`select id, code, name, is_company, folio_no, phone, email, address, notes, is_active,
               to_char(created_at, 'YYYY-MM-DD') as created
          from shareholder where company_id = ${companyId} order by code`,
    movements(sql, companyId),
    // What each holder's shares came in at, less what went out, at the transfers' own rates.
    sql`select h, sum(v)::float as value from (
          select to_shareholder_id as h, amount as v from share_transfer where company_id = ${companyId} and status = 'POSTED' and to_shareholder_id is not null
          union all
          select from_shareholder_id, -amount from share_transfer where company_id = ${companyId} and status = 'POSTED' and from_shareholder_id is not null) x
        group by h`,
  ]);
  const r = replay(moves);
  const value = new Map((amounts as any[]).map((a) => [a.h as string, Number(a.value)]));
  return (people as any[]).map((p) => ({
    ...p,
    equity: count(r.holding(p.id, "EQUITY")),
    preference: count(r.holding(p.id, "PREFERENCE")),
    ranges: { EQUITY: formatRanges(r.holding(p.id, "EQUITY")), PREFERENCE: formatRanges(r.holding(p.id, "PREFERENCE")) },
    value: value.get(p.id) ?? 0,
  }));
}

/** Every posted and cancelled transfer, newest first, with the parties' names. */
export async function listTransfers(companyId: string, f: { from?: string; to?: string; shareholderId?: string } = {}) {
  return sql`
    select t.id, t.transfer_no, t.transfer_type, to_char(t.transfer_date, 'YYYY-MM-DD') as transfer_date, t.share_type,
           t.no_of_shares, t.from_no, t.to_no, t.rate::float as rate, t.amount::float as amount, t.status, t.remarks,
           t.from_shareholder_id, fs.name as from_name, fs.folio_no as from_folio,
           t.to_shareholder_id, ts.name as to_name, ts.folio_no as to_folio,
           je.entry_no, ea.code || ' ' || ea.name as equity_account, aa.code || ' ' || aa.name as asset_account
      from share_transfer t
      left join shareholder fs on fs.id = t.from_shareholder_id
      left join shareholder ts on ts.id = t.to_shareholder_id
      left join journal_entry je on je.id = t.journal_entry_id
      join account ea on ea.id = t.equity_account_id
      left join account aa on aa.id = t.asset_account_id
     where t.company_id = ${companyId}
       ${f.from ? sql`and t.transfer_date >= ${f.from}::date` : sql``}
       ${f.to ? sql`and t.transfer_date <= ${f.to}::date` : sql``}
       ${f.shareholderId ? sql`and ${f.shareholderId} in (t.from_shareholder_id, t.to_shareholder_id)` : sql``}
     order by t.transfer_date desc, t.transfer_no desc`;
}

/** The free numbers to start an issue at, and each holder's numbers, for the form. */
export async function shareFormState(companyId: string) {
  const r = replay(await movements(sql, companyId));
  return {
    nextIssueNo: { EQUITY: r.nextIssueNo("EQUITY"), PREFERENCE: r.nextIssueNo("PREFERENCE") },
    holdings: r.entries.filter((e) => e.shares > 0),
  };
}

// ------------------------------------------------------------- writes --

export type TransferInput = {
  companyId: string; userId: string | null; type: TransferType; date: string; shareType: ShareType;
  fromShareholderId: string | null; toShareholderId: string | null;
  noOfShares: number; fromNo: number; rate: number;
  equityAccountId: string; assetAccountId: string | null; remarks: string | null;
};

/**
 * Posts a share transfer: checks it against every other posted one (in date
 * order, so a back-dated transfer cannot strand a later one), numbers it,
 * gives a first-time recipient its folio number, and for an issue or a
 * buy-back writes the journal entry in the same transaction.
 */
export async function postShareTransfer(input: TransferInput, outer?: TransactionSql) {
  return inTransaction(outer, async (tx) => {
    const { companyId, type } = input;
    const n = Math.trunc(input.noOfShares), fromNo = Math.trunc(input.fromNo);
    if (!(n > 0)) throw new Error("Enter how many shares.");
    if (!(fromNo > 0)) throw new Error("Enter the first share number.");
    if (!(input.rate >= 0)) throw new Error("Enter the rate per share.");
    const from = type === "ISSUE" ? null : input.fromShareholderId;
    const to = type === "PURCHASE" ? null : input.toShareholderId;
    if (type !== "ISSUE" && !from) throw new Error("Choose who the shares come from.");
    if (type !== "PURCHASE" && !to) throw new Error("Choose who receives the shares.");
    if (from && to && from === to) throw new Error("The shares cannot go to the shareholder they come from.");
    if (type !== "TRANSFER" && !input.assetAccountId) throw new Error("Choose the cash or bank account the money moves through.");

    // One share transfer at a time per company: the replay below reads every
    // other one, and two posting at once could each pass it alone.
    // The lock, the parties and the next number in one round trip.
    const year = input.date.slice(0, 4);
    const [{ k, parties }] = await tx`
      select (select count(*)::int + 1 from share_transfer where company_id = ${companyId} and transfer_no like ${`SHT-${year}-%`}) as k,
             (select coalesce(json_agg(json_build_object('id', id, 'name', name, 'folio_no', folio_no)), '[]')
                from shareholder where company_id = ${companyId} and id = any(${[from, to].filter(Boolean) as string[]}) and is_active) as parties
        from company where id = ${companyId} for update`;
    for (const id of [from, to].filter(Boolean)) if (!(parties as any[]).some((p) => p.id === id)) throw new Error("That shareholder was not found or is inactive.");
    const nameOf = (id: string | null) => (parties as any[]).find((p) => p.id === id)?.name ?? "";

    const no = `SHT-${year}-${String(k).padStart(5, "0")}`;
    const toNo = fromNo + n - 1;
    replay([...(await movements(tx, companyId)), { id: "new", no, type, date: input.date, shareType: input.shareType,
      from, to, fromNo, toNo, rate: input.rate }]);

    // A first-time recipient gets its folio number now.
    if (to && !(parties as any[]).find((p) => p.id === to)?.folio_no) {
      await tx`update shareholder set folio_no = 'FN' || lpad(((select count(folio_no) from shareholder where company_id = ${companyId}) + 1)::text, 5, '0')
                where id = ${to}`;
    }

    const amount = Math.round(n * input.rate * 100) / 100;
    // The id is chosen here so the journal can name it first, and the transfer goes in once, already linked.
    const id = randomUUID();
    let entry: string | null = null;
    // An issue brings money in for new equity; a buy-back pays it out. A
    // transfer between owners leaves the company's equity as it was.
    if (type !== "TRANSFER" && amount > 0) {
      const sign = type === "ISSUE" ? 1 : -1;
      entry = await writeJournal(tx, companyId, input.date, "SHARE_TRANSFER", id,
        `${no} ${type === "ISSUE" ? `share issue to ${nameOf(to)}` : `share buy-back from ${nameOf(from)}`}${input.remarks ? ` · ${input.remarks}` : ""}`,
        [{ accountId: input.assetAccountId!, amount: sign * amount }, { accountId: input.equityAccountId, amount: -sign * amount }]);
    }
    await tx`
      insert into share_transfer (id, journal_entry_id, company_id, transfer_no, transfer_type, transfer_date, from_shareholder_id, to_shareholder_id,
        share_type, no_of_shares, from_no, to_no, rate, amount, equity_account_id, asset_account_id, remarks, created_by_id)
      values (${id}, ${entry}, ${companyId}, ${no}, ${type}, ${input.date}::date, ${from}, ${to}, ${input.shareType}, ${n}, ${fromNo}, ${toNo},
        ${input.rate}, ${amount}, ${input.equityAccountId}, ${type === "TRANSFER" ? null : input.assetAccountId}, ${input.remarks}, ${input.userId})`;
    return { id, no };
  });
}

/**
 * Cancels a posted transfer: allowed only if every later transfer still
 * holds without it, and its journal entry is reversed one for one.
 */
export async function cancelShareTransfer(companyId: string, id: string, date: string, outer?: TransactionSql) {
  return inTransaction(outer, async (tx) => {
    // The lock, the transfer and its journal lines in one round trip.
    const [c] = await tx`
      select (select json_build_object('transfer_no', t.transfer_no, 'status', t.status, 'journal_entry_id', t.journal_entry_id,
                'lines', (select coalesce(json_agg(json_build_object('account_id', l.account_id, 'a', l.base_amount::float)), '[]')
                            from journal_line l where l.journal_entry_id = t.journal_entry_id))
                from share_transfer t where t.id = ${id} and t.company_id = ${companyId}) as t
        from company where id = ${companyId} for update`;
    const t = c?.t as { transfer_no: string; status: string; journal_entry_id: string | null; lines: { account_id: string; a: number }[] } | null;
    if (!t) throw new Error("That share transfer was not found.");
    if (t.status !== "POSTED") throw new Error(`${t.transfer_no} is already cancelled.`);
    try { replay(await movements(tx, companyId, id)); }
    catch (e) { throw new Error(`${t.transfer_no} cannot be cancelled: later transfers depend on it. ${e instanceof Error ? e.message : ""}`); }
    let reversal: string | null = null;
    if (t.journal_entry_id) {
      reversal = await writeJournal(tx, companyId, date, "SHARE_TRANSFER", id, `${t.transfer_no} cancelled`,
        t.lines.map((l) => ({ accountId: l.account_id, amount: -Number(l.a) })));
    }
    await tx`update share_transfer set status = 'CANCELLED', cancelled_at = now(), cancel_entry_id = ${reversal} where id = ${id}`;
    return { no: t.transfer_no as string };
  });
}

export async function createShareholder(companyId: string, s: { name: string; isCompany: boolean; phone?: string | null; email?: string | null; address?: string | null; notes?: string | null }) {
  const name = s.name.trim();
  if (!name) throw new Error("Enter the shareholder's name.");
  return inTransaction(undefined, async (tx) => {
    const [{ k }] = await tx`
      select (select count(*)::int + 1 from shareholder where company_id = ${companyId}) as k
        from company where id = ${companyId} for update`;
    const [row] = await tx`
      insert into shareholder (company_id, code, name, is_company, phone, email, address, notes)
      values (${companyId}, ${`SH-${String(k).padStart(4, "0")}`}, ${name}, ${s.isCompany}, ${s.phone || null}, ${s.email || null}, ${s.address || null}, ${s.notes || null})
      returning id, code`;
    return row as { id: string; code: string };
  });
}
