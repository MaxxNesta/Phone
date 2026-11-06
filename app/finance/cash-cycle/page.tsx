import { sql } from "@/lib/db";
import { getCompany, getCashConversionCycle } from "@/lib/queries";
import { CashCycle } from "@/components/cash-cycle";

const dayAfter = (d: string) => new Date(new Date(d).getTime() + 86_400_000).toISOString().slice(0, 10);
const dayBefore = (d: string) => new Date(new Date(d).getTime() - 86_400_000).toISOString().slice(0, 10);
const isDate = (d?: string) => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d);

export default async function CashCyclePage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const company = await getCompany();
  if (!company) return <div className="empty">No company found.</div>;

  const sp = await searchParams;

  // The fiscal year by default: working capital is judged over a trading
  // year, and a quiet month reads as brilliance.
  const [fy] = (await sql`
    select to_char(start_date, 'YYYY-MM-DD') as start_date,
           to_char(end_date, 'YYYY-MM-DD') as end_date
      from fiscal_year where company_id = ${company.id}
     order by start_date desc limit 1`) as unknown as
    { start_date: string; end_date: string }[];

  // Both dates as people read them, the last day included.
  const from = isDate(sp.from) ? sp.from! : fy?.start_date ?? "2026-01-01";
  let last = isDate(sp.to) ? sp.to! : fy?.end_date ?? "2026-12-31";
  if (last < from) last = from;

  const cycle = await getCashConversionCycle(company.id, from, dayAfter(last));

  return (
    <>
      <div className="page-head">
        <span className="eyebrow">Accounting</span>
        <h1>Cash conversion cycle</h1>
        <p className="page-sub">
          Days between paying for goods and being paid for them. Lower is better; below zero, suppliers fund the stock.
        </p>
      </div>

      <form className="card filters" method="get">
        <div className="card-body filter-row">
          <div className="field"><label htmlFor="cf">From</label><input id="cf" type="date" name="from" defaultValue={from} /></div>
          <div className="field"><label htmlFor="ct">To</label><input id="ct" type="date" name="to" defaultValue={last} /></div>
          <button className="btn">Show</button>
          <span className="hint">
            Compared with {cycle.previous.from} – {dayBefore(cycle.previous.to)}
          </span>
        </div>
      </form>

      <CashCycle
        current={cycle.current}
        previous={cycle.previous}
        trend={cycle.trend}
        currency={company.base_currency}
      />
    </>
  );
}
