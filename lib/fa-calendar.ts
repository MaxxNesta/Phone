import { sql } from "./db";
import { loadSchedules, thisMonth, type LoadedAsset } from "./fa-schedule";
import { faExceptions } from "./fa-overview";
import { fromUnits, sum, type Month } from "./fa-engine";

/**
 * The Depreciation Calendar's figures: twelve months of what the schedule
 * expects against what the ledger carries, one month in detail, and the
 * events of that month day by day.
 *
 * Depreciation stays monthly. The day grid is a calendar of things that
 * happened (an acquisition, a posting, a transfer), not a daily charge.
 */

export type MonthStatus = "PLANNED" | "READY" | "PARTIAL" | "POSTED" | "EXCEPTION" | "NONE";
export type CalMonth = {
  month: Month; expected: string; posted: string; remaining: string;
  assets: number; warnings: number; status: MonthStatus;
};
export type CalAsset = {
  id: string; code: string; name: string; category: string; branch: string; branchId: string;
  amount: string; posted: string | null; opening: string; closing: string;
  state: "POSTED" | "PLANNED"; warning: string | null;
};
export type JournalPreview = {
  branchId: string; branch: string; total: string;
  lines: { accountId: string; code: string; name: string; debit: string; credit: string; assets: number }[];
};
export type CalEvent = {
  date: string; kind: "ACQUIRED" | "IN_SERVICE" | "DUE" | "POSTED" | "TRANSFER" | "DISPOSAL" | "EXCEPTION";
  label: string; detail: string; amount: string | null; href: string | null;
};

export type CalFilters = { branches: string[] | null; branchId?: string; categoryId?: string; status?: string; q?: string };

const lastDay = (m: Month) => {
  const [y, mo] = m.split("-").map(Number);
  return `${m}-${String(new Date(Date.UTC(y, mo, 0)).getUTCDate()).padStart(2, "0")}`;
};

/** Only assets that would be depreciated in a month count towards it. */
const counts = (a: LoadedAsset) => a.status === "ACTIVE" || a.status === "FULLY_DEPRECIATED" || a.status === "DISPOSED";

export async function calendar(co: string, year: number, month: Month, f: CalFilters) {
  const branches = f.branchId ? (f.branches ? f.branches.filter((b) => b === f.branchId) : [f.branchId]) : f.branches;
  const [all, exceptions] = await Promise.all([
    loadSchedules(co, { branches, categoryId: f.categoryId }),
    faExceptions(co),
  ]);
  const needle = f.q?.trim().toLowerCase();
  const assets = all.filter((a) => (!f.status || a.status === f.status)
    && (!needle || `${a.code} ${a.name}`.toLowerCase().includes(needle)));
  const badCategory = new Map(exceptions.mapping.map((m) => [m.id, `Account ${m.bad.join(", ")} cannot be posted to`]));
  const failedMonth = new Map(exceptions.failed.map((r) => [`${r.month}|${r.branch}`, r.error ?? "The run failed"]));
  const now = thisMonth();

  const monthRows = (m: Month) => assets.filter(counts).flatMap((a) => {
    const r = a.rows.find((x) => x.month === m);
    if (!r || (r.amount === 0n && r.state !== "POSTED")) return [];
    // An inactive asset is not depreciated; only what the ledger already carries shows.
    return [{ a, r }];
  });

  const months: CalMonth[] = Array.from({ length: 12 }, (_, k) => `${year}-${String(k + 1).padStart(2, "0")}`).map((m) => {
    const rows = monthRows(m);
    const expected = sum(rows.map(({ r }) => r.amount));
    const posted = sum(rows.filter(({ r }) => r.state === "POSTED").map(({ r }) => r.amount));
    const warnings = rows.filter(({ a, r }) => r.state === "PLANNED" && badCategory.has(a.categoryId)).length
      + [...new Set(rows.map(({ a }) => a.branch))].filter((b) => failedMonth.has(`${m}|${b}`)).length;
    const status: MonthStatus = rows.length === 0 ? "NONE"
      : warnings > 0 && posted < expected ? "EXCEPTION"
      : posted >= expected ? "POSTED"
      : posted > 0n ? "PARTIAL"
      : m <= now ? "READY" : "PLANNED";
    return { month: m, expected: fromUnits(expected), posted: fromUnits(posted), remaining: fromUnits(expected - posted),
             assets: rows.length, warnings, status };
  });

  // ---- the selected month in detail
  const rows = monthRows(month);
  const detail: CalAsset[] = rows.map(({ a, r }) => ({
    id: a.id, code: a.code, name: a.name, category: a.category, branch: a.branch, branchId: a.branchId,
    amount: fromUnits(r.amount), posted: r.posted === null ? null : fromUnits(r.posted),
    opening: fromUnits(r.opening), closing: fromUnits(r.closing), state: r.state,
    warning: r.state === "PLANNED" ? (badCategory.get(a.categoryId) ?? null) : null,
  }));

  // By category, for the schedule tab.
  const byCat = new Map<string, { category: string; assets: number; amount: bigint; posted: bigint }>();
  for (const { a, r } of rows) {
    const c = byCat.get(a.categoryId) ?? { category: a.category, assets: 0, amount: 0n, posted: 0n };
    c.assets++; c.amount += r.amount; if (r.state === "POSTED") c.posted += r.amount;
    byCat.set(a.categoryId, c);
  }

  // The voucher each branch would post for what is still open: one line per
  // expense account (debit) and one per accumulated-depreciation account
  // (credit), adding up exactly to the asset rows beneath them.
  const accountIds = [...new Set(rows.flatMap(({ a }) => [a.expenseAccountId, a.accumAccountId]))];
  const accounts = accountIds.length
    ? new Map((await sql`select id, code, name from account where id = any(${accountIds})`).map((x: any) => [x.id, x])) : new Map();
  const preview = new Map<string, { branch: string; lines: Map<string, { side: "D" | "C"; amount: bigint; assets: number }> }>();
  for (const { a, r } of rows) {
    if (r.state === "POSTED") continue;
    const p = preview.get(a.branchId) ?? { branch: a.branch, lines: new Map() };
    for (const [id, side] of [[a.expenseAccountId, "D"], [a.accumAccountId, "C"]] as const) {
      const l = p.lines.get(id) ?? { side, amount: 0n, assets: 0 };
      l.amount += r.amount; l.assets++;
      p.lines.set(id, l);
    }
    preview.set(a.branchId, p);
  }
  const journal: JournalPreview[] = [...preview.entries()].map(([branchId, p]) => {
    const lines = [...p.lines.entries()].map(([id, l]) => ({
      accountId: id, code: accounts.get(id)?.code ?? "?", name: accounts.get(id)?.name ?? "?",
      debit: l.side === "D" ? fromUnits(l.amount) : "0.0000", credit: l.side === "C" ? fromUnits(l.amount) : "0.0000", assets: l.assets,
    })).sort((x, y) => (x.debit !== "0.0000" ? 0 : 1) - (y.debit !== "0.0000" ? 0 : 1) || x.code.localeCompare(y.code));
    const total = sum([...p.lines.values()].filter((l) => l.side === "D").map((l) => l.amount));
    return { branchId, branch: p.branch, total: fromUnits(total), lines };
  });

  const ids = assets.map((a) => a.id);
  const from = `${month}-01`, to = lastDay(month);
  const [runs, links, evs, posts] = await Promise.all([
    sql`select r.id, r.status, r.mode, r.total::text as total, r.error, b.name as branch, d.id as doc_id, d.doc_no,
               cu.name as created_by, au.name as approved_by,
               to_char(r.created_at at time zone 'Asia/Yangon', 'YYYY-MM-DD HH24:MI') as created_at,
               to_char(r.posted_at at time zone 'Asia/Yangon', 'YYYY-MM-DD HH24:MI') as posted_at
          from fa_run r join location b on b.id = r.branch_id left join document d on d.id = r.document_id
          left join app_user cu on cu.id = r.created_by left join app_user au on au.id = r.approved_by
         where r.company_id = ${co} and r.period_month = ${from}
           ${branches ? sql`and r.branch_id = any(${branches})` : sql``}
         order by r.created_at desc`,
    ids.length ? sql`select f.code, f.name, x.source, x.amount::text as amount, d.id as doc_id, d.doc_no,
               to_char(je.entry_date, 'YYYY-MM-DD') as date
          from fa_depreciation x join fixed_asset f on f.id = x.asset_id
          join journal_line jl on jl.id = x.journal_line_id join journal_entry je on je.id = jl.journal_entry_id
          left join document d on d.id = je.source_id
         where x.asset_id = any(${ids}) and x.period_month = ${from} and x.source <> 'RUN'
         order by je.entry_date` : [],
    ids.length ? sql`select e.event_type, to_char(e.event_date, 'YYYY-MM-DD') as date, f.id as asset_id, f.code, f.name,
               fb.name as from_branch, tb.name as to_branch, e.detail
          from fa_event e join fixed_asset f on f.id = e.asset_id
          left join location fb on fb.id = e.from_branch_id left join location tb on tb.id = e.to_branch_id
         where e.asset_id = any(${ids}) and e.event_date between ${from} and ${to}
           and e.event_type in ('TRANSFERRED', 'DISPOSED', 'EXCEPTION')` : [],
    // Journals that carried this module's depreciation, on the day they were entered.
    ids.length ? sql`select to_char(je.entry_date, 'YYYY-MM-DD') as date, d.id as doc_id, d.doc_no,
               count(distinct x.asset_id)::int as assets, sum(x.amount)::text as amount,
               to_char(min(x.period_month), 'YYYY-MM') as period
          from fa_depreciation x join journal_line jl on jl.id = x.journal_line_id
          join journal_entry je on je.id = jl.journal_entry_id left join document d on d.id = je.source_id
         where x.asset_id = any(${ids}) and je.entry_date between ${from} and ${to}
         group by 1, 2, 3 order by 1` : [],
  ]);

  const events: CalEvent[] = [];
  const acqs = ids.length ? await sql`select id, code, name, acquisition_cost::text as cost,
               to_char(acquisition_date, 'YYYY-MM-DD') as acquired, to_char(in_service_date, 'YYYY-MM-DD') as in_service
          from fixed_asset where id = any(${ids})
           and (acquisition_date between ${from} and ${to} or in_service_date between ${from} and ${to})` : [];
  for (const x of acqs as any[]) {
    if (x.acquired >= from && x.acquired <= to) events.push({ date: x.acquired, kind: "ACQUIRED", label: "Acquired",
      detail: `${x.code} · ${x.name}`, amount: x.cost, href: `/fixed-assets/${x.id}` });
    if (x.in_service && x.in_service >= from && x.in_service <= to) events.push({ date: x.in_service, kind: "IN_SERVICE", label: "In service",
      detail: `${x.code} · ${x.name}`, amount: null, href: `/fixed-assets/${x.id}` });
  }
  for (const p of posts as any[]) events.push({ date: p.date, kind: "POSTED", label: "Journal posted",
    detail: `${p.doc_no ?? "Journal"} · ${p.assets} asset${p.assets === 1 ? "" : "s"} · for ${p.period}`, amount: p.amount,
    href: p.doc_id ? `/documents/${p.doc_id}` : null });
  const open = rows.filter(({ r }) => r.state === "PLANNED");
  if (open.length) events.push({ date: to, kind: "DUE", label: "Depreciation due",
    detail: `${open.length} asset${open.length === 1 ? "" : "s"} to post for ${month}`, amount: fromUnits(sum(open.map(({ r }) => r.amount))), href: null });
  for (const e of evs as any[]) events.push({
    date: e.date, kind: e.event_type === "TRANSFERRED" ? "TRANSFER" : e.event_type === "DISPOSED" ? "DISPOSAL" : "EXCEPTION",
    label: e.event_type === "TRANSFERRED" ? "Transferred" : e.event_type === "DISPOSED" ? "Disposed of" : "Exception",
    detail: `${e.code} · ${e.name}${e.from_branch && e.to_branch ? ` · ${e.from_branch} → ${e.to_branch}` : ""}`,
    amount: null, href: `/fixed-assets/${e.asset_id}` });
  for (const r of runs as any[]) if (r.status === "FAILED") events.push({ date: (r.created_at ?? to).slice(0, 10), kind: "EXCEPTION",
    label: "Run failed", detail: `${r.branch}: ${r.error ?? "the run failed"}`, amount: null, href: null });

  return {
    now, months, detail, events: events.sort((x, y) => x.date.localeCompare(y.date)),
    schedule: [...byCat.values()].map((c) => ({ ...c, amount: fromUnits(c.amount), posted: fromUnits(c.posted) })),
    journal, runs: runs as any[], links: links as any[],
  };
}
