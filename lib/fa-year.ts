import { sql } from "./db";
import { loadSchedules, thisMonth, type LoadedAsset } from "./fa-schedule";
import { firstMonth, fromUnits, toUnits, type Month } from "./fa-engine";
import { unitSchedule } from "./fa-units";

/**
 * A year of fixed assets, month by month: the Category summary and the Asset
 * schedule. Read through the same schedules as the calendar, the asset page
 * and the posting run, so a figure here is the figure there.
 *
 * Every month of depreciation is one of three:
 *   POSTED   on the ledger (a run, linked history, an opening balance)
 *   DUE      ready to post: the month has come and nothing is posted (the calendar's word)
 *   PLANNED  a month still to come
 *
 * A branch filter reads each month at the branch the asset posted to then:
 * a transfer moves the months after it, never the ones before.
 */

export type DepState = "POSTED" | "DUE" | "PLANNED";
export type MonthCell = {
  additions: number; disposals: number;
  /** Depreciation and closing net book value: posted only, and with due and planned months too. */
  depPosted: number; depAll: number; nbvPosted: number; nbvAll: number;
};
export type SummaryRow = { id: string; name: string; assets: number; months: MonthCell[] };
export type SummaryGroup = SummaryRow & { subs: SummaryRow[] };
export type ScheduleAsset = {
  id: string; code: string; name: string; notes: string; heading: string; category: string; branch: string; acquired: string;
  /** Depreciation before the year: the file's "Op; Accu". */
  opening: number;
  cost: number; quantity: number; residual: number; life: number; inService: string | null; start: Month | null; disposedOn: string | null;
  months: ({ amount: number; state: DepState } | null)[];
  /** Net book value at the end of the year (or its last month in view), with planned months. */
  closing: number;
  /** A group's units, each with its share of the cost, the months and the closing value. */
  units: { id: string; code: string; cost: number; months: (number | null)[]; closing: number }[];
};

export type YearFilters = { branches: string[] | null; branchId?: string; categoryId?: string; heading?: string };

const n = (u: bigint) => Number(fromUnits(u));
const lastDay = (m: Month) => {
  const [y, mo] = m.split("-").map(Number);
  return `${m}-${String(new Date(Date.UTC(y, mo, 0)).getUTCDate()).padStart(2, "0")}`;
};
const blank = (): MonthCell => ({ additions: 0, disposals: 0, depPosted: 0, depAll: 0, nbvPosted: 0, nbvAll: 0 });
const add = (a: MonthCell, b: MonthCell) => {
  a.additions += b.additions; a.disposals += b.disposals; a.depPosted += b.depPosted;
  a.depAll += b.depAll; a.nbvPosted += b.nbvPosted; a.nbvAll += b.nbvAll;
};

export async function faYear(co: string, year: number, f: YearFilters) {
  const months = Array.from({ length: 12 }, (_, k) => `${year}-${String(k + 1).padStart(2, "0")}` as Month);
  const now = thisMonth();
  const all = (await loadSchedules(co, { branches: f.branches, categoryId: f.categoryId }))
    .filter((a) => !f.heading || a.heading === f.heading);
  const ids = all.map((a) => a.id);
  const moves = ids.length ? (await sql`
    select asset_id, to_char(event_date, 'YYYY-MM-DD') as date, from_branch_id, to_branch_id
      from fa_event where asset_id = any(${ids}) and event_type = 'TRANSFERRED' order by event_date, created_at`) as any[] : [];
  const [names, notes, unitRows] = await Promise.all([
    sql`select id, name from location where company_id = ${co} and parent_id is null`,
    ids.length ? sql`select id, coalesce(notes, '') as notes from fixed_asset where id = any(${ids})` : Promise.resolve([]),
    ids.length ? sql`select id, asset_id, code, cost::text from fa_unit where asset_id = any(${ids}) order by asset_id, seq` : Promise.resolve([]),
  ]);
  const unitsBy = new Map<string, any[]>();
  for (const u of unitRows as any[]) unitsBy.set(u.asset_id, [...(unitsBy.get(u.asset_id) ?? []), u]);
  const noteOf = new Map((notes as any[]).map((x) => [x.id as string, x.notes as string]));
  const branchName = new Map((names as any[]).map((b) => [b.id as string, b.name as string]));

  /** Where the asset posted at the end of a month. */
  const branchAt = (a: LoadedAsset, m: Month) => {
    if (a.postsElsewhere) return a.postBranchId;
    const mine = moves.filter((x) => x.asset_id === a.id);
    if (!mine.length) return a.postBranchId;
    const before = mine.filter((x) => x.date <= lastDay(m));
    return (before.length ? before.at(-1).to_branch_id : mine[0].from_branch_id) as string;
  };

  // Each asset's twelve months, in the branch view asked for.
  const cells = new Map<string, (MonthCell | null)[]>();
  const schedule: ScheduleAsset[] = [];
  for (const a of all) {
    const cost = n(a.engine.cost);
    // An opening figure not yet backed by a journal counts in the plan, not in what is posted.
    let accPosted = 0, accAll = n(a.carried);
    // Depreciation before the year counts towards its opening net book value.
    for (const r of a.rows) if (r.month < months[0]) { accAll += n(r.amount); if (r.state === "POSTED") accPosted += n(r.amount); }
    const opening = accAll;
    const row: (MonthCell | null)[] = [];
    const sched: ScheduleAsset["months"] = [];
    let closing: number | null = null;
    for (const m of months) {
      const r = a.rows.find((x) => x.month === m);
      const amount = r ? n(r.amount) : 0;
      const state: DepState = r?.state === "POSTED" ? "POSTED" : m <= now ? "DUE" : "PLANNED";
      accAll += amount; if (state === "POSTED") accPosted += amount;
      const end = lastDay(m);
      const held = a.acquired <= end && !(a.disposedOn && a.disposedOn <= end);
      const inView = !f.branchId || branchAt(a, m) === f.branchId;
      if (!inView) { row.push(null); sched.push(null); continue; }
      row.push({
        additions: a.acquired.slice(0, 7) === m ? cost : 0,
        disposals: a.disposedOn?.slice(0, 7) === m ? cost : 0,
        depPosted: state === "POSTED" ? amount : 0, depAll: amount,
        nbvPosted: held ? cost - accPosted : 0, nbvAll: held ? cost - accAll : 0,
      });
      sched.push(r && amount !== 0 ? { amount, state } : null);
      if (held) closing = cost - accAll;
    }
    if (row.every((c) => c === null)) continue;
    // Only assets the year touches: held at some month end, or depreciating in it.
    if (row.every((c) => !c || (!c.nbvAll && !c.additions && !c.disposals && !c.depAll))) continue;
    cells.set(a.id, row);
    const start = firstMonth(a.engine)?.month ?? null;
    schedule.push({
      id: a.id, code: a.code, name: a.name, notes: noteOf.get(a.id) ?? "", heading: a.heading, category: a.category, acquired: a.acquired, opening,
      branch: branchName.get(branchAt(a, months[11])) ?? a.postBranch,
      cost, quantity: a.quantity, residual: n(a.engine.residual), life: a.engine.lifeMonths, inService: a.inService, start, disposedOn: a.disposedOn,
      months: sched, closing: closing ?? 0,
      units: (() => {
        // Each unit's share of every month, by running total, so the units add up to the group (lib/fa-units.ts).
        const us = unitsBy.get(a.id) ?? [];
        if (us.length < 2) return [];
        const costs = us.map((u) => toUnits(u.cost));
        return us.map((u, i) => {
          const rows = unitSchedule(a.rows, costs, i, a.engine.cost);
          const ms = months.map((m, k) => (sched[k] ? n(rows.find((r) => r.month === m)?.amount ?? 0n) : null));
          const last = [...rows].reverse().find((r) => r.month <= months[11]);
          return { id: u.id, code: u.code, cost: n(costs[i]), months: ms, closing: last ? n(last.closing) : n(costs[i]) };
        });
      })(),
    });
  }

  // Category summary: heading, then its subcategories, in chart order (the schedules come in code order).
  const groups = new Map<string, SummaryGroup>();
  for (const a of all) {
    const row = cells.get(a.id);
    if (!row) continue;
    const g = groups.get(a.heading) ?? { id: a.heading, name: a.heading, assets: 0, months: months.map(blank), subs: [] };
    let s = g.subs.find((x) => x.id === a.categoryId);
    if (!s) { s = { id: a.categoryId, name: a.category, assets: 0, months: months.map(blank) }; g.subs.push(s); }
    g.assets++; s.assets++;
    row.forEach((c, k) => { if (c) { add(g.months[k], c); add(s!.months[k], c); } });
    groups.set(a.heading, g);
  }
  const total: SummaryRow = { id: "total", name: "Total", assets: 0, months: months.map(blank) };
  for (const g of groups.values()) { total.assets += g.assets; g.months.forEach((c, k) => add(total.months[k], c)); }
  return { year, months, now, groups: [...groups.values()], total, schedule };
}
