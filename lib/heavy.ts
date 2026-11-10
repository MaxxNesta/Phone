import { sql } from "./db";

/**
 * Expensive work, kept in bounds.
 *
 * Imports, bulk changes, exports and the big reports each cost the database
 * many times what a page does. Two limits:
 *
 *   per person    so many starts of one kind a minute, whoever is asking
 *   one at a time an import or a bulk change runs once per company; a second
 *                 waits — two at once would race for document numbers and stock
 *
 * A run that dies holds its slot only until its time is up (heavy_run,
 * migration 0177).
 */

type Family = "import" | "preview" | "bulk" | "export" | "report" | "post";

export const LIMITS: Record<Family, { perMinute: number; oneAtATime?: boolean; timeoutSec?: number }> = {
  import: { perMinute: 6, oneAtATime: true, timeoutSec: 900 },
  bulk: { perMinute: 6, oneAtATime: true, timeoutSec: 300 },
  preview: { perMinute: 30 },
  export: { perMinute: 10 },
  report: { perMinute: 40 },
  // One invoice of an invoice import. The screen posts them one request each,
  // so counting each as a whole import refused the seventh invoice in a minute.
  post: { perMinute: 120, oneAtATime: true, timeoutSec: 300 },
};

const WORDS: Record<Family, string> = {
  import: "imports", bulk: "bulk changes", preview: "previews", export: "exports", report: "loads of this report",
  post: "invoice postings",
};

export class TooBusy extends Error {}

const familyOf = (kind: string) => kind.split(".")[0] as Family;

/**
 * Starts a run, or refuses with a message saying why. Returns the run's id,
 * to finish it with; a run that is not exclusive is finished as it starts.
 */
export async function begin(kind: string, who: { companyId: string | null; who: string }): Promise<number> {
  const f = familyOf(kind), lim = LIMITS[f];
  // A run past its time died without finishing: its slot is free again.
  if (lim.oneAtATime) await sql`
    update heavy_run set finished_at = now()
     where kind = ${kind} and exclusive and finished_at is null
       and started_at < now() - make_interval(secs => ${lim.timeoutSec ?? 0})`;
  const [r] = await sql`
    with old as (
      delete from heavy_run where kind = ${kind} and started_at < now() - interval '1 day'
    ),
    recent as (
      select count(*)::int as n from heavy_run
       where who = ${who.who} and kind = ${kind} and started_at > now() - interval '1 minute'
    )
    insert into heavy_run (company_id, who, kind, exclusive, finished_at)
    select ${who.companyId}, ${who.who}, ${kind}, ${!!lim.oneAtATime}, ${lim.oneAtATime ? null : sql`now()`}
     where (select n from recent) < ${lim.perMinute}
    on conflict do nothing
    returning id`;
  if (r) return Number(r.id);
  // Refused: say which limit, so the person knows whether to wait a moment or for someone else.
  const [running] = lim.oneAtATime ? await sql`
    select to_char(started_at at time zone 'Asia/Yangon', 'HH24:MI') as at from heavy_run
     where kind = ${kind} and exclusive and finished_at is null
       and coalesce(company_id, '00000000-0000-0000-0000-000000000000'::uuid)
         = coalesce(${who.companyId}::uuid, '00000000-0000-0000-0000-000000000000'::uuid)` : [];
  throw new TooBusy(running
    ? `Another of these is already running (started ${running.at}). Wait for it to finish, then try again.`
    : `Too many ${WORDS[f]} in the last minute — at most ${lim.perMinute}. Wait a moment and try again.`);
}

export async function end(id: number) {
  await sql`update heavy_run set finished_at = now() where id = ${id} and finished_at is null`;
}

/** Runs `fn` inside the limits for `kind`; a refusal throws TooBusy before any work is done. */
export async function heavy<T>(kind: string, user: { id: string; companyId: string }, fn: () => Promise<T>): Promise<T> {
  const id = await begin(kind, { companyId: user.companyId, who: user.id });
  try { return await fn(); } finally { if (LIMITS[familyOf(kind)].oneAtATime) await end(id); }
}

/**
 * The pages and downloads that count as heavy, by path. The middleware checks
 * these before the page runs any of its queries.
 */
export const HEAVY_PATHS: [prefix: string, kind: string][] = [
  ["/sales/reports", "report.sales"],
  ["/reports/financial-ratios", "report.ratios"],
  ["/reports/phone-sales", "report.phone-sales"],
  ["/reports/phone-stock", "report.phone-stock"],
  ["/reports/price-history", "report.price-history"],
  ["/finance/income-statement", "report.income-statement"],
  ["/finance/balance-sheet", "report.balance-sheet"],
  ["/finance/cash-flow", "report.cash-flow"],
  ["/finance/general-ledger", "report.general-ledger"],
  ["/finance/inventory-cogs", "report.inventory-cogs"],
  ["/finance/aging", "report.aging"],
  ["/ledger", "report.trial-balance"],
  ["/inventory/movements", "report.movements"],
  ["/inventory/intelligence", "report.intelligence"],
  ["/purchases/supplier-performance", "report.supplier-performance"],
  ["/fixed-assets/reports", "report.fixed-assets"],
];

/** The kind a path counts as: a download under …/export is an export, the rest by the table above. */
export function heavyKindFor(path: string): string | null {
  if (/\/export(\/|$)/.test(path)) return `export.${path.replace(/^\/|\/export.*$/g, "").replace(/\//g, "-")}`;
  return HEAVY_PATHS.find(([p]) => path === p || path.startsWith(p + "/"))?.[1] ?? null;
}
