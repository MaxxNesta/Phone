import { sql } from "@/lib/db";
import { requireUser, can } from "@/lib/auth";
import { deleteCurrency, deleteRate } from "@/lib/currency-actions";
import { CurrencyForm, RateForm } from "@/components/currency-forms";
import { shortDate } from "@/lib/format";

export const metadata = { title: "Currencies" };

export default async function Currencies() {
  const user = await requireUser();
  const admin = can(user, "settings.manage");
  const [co] = await sql`select base_currency from company where id = ${user.companyId}`;
  const [currencies, latest, history] = await Promise.all([
    sql`select code, name, symbol, decimal_places from currency order by code = ${co.base_currency} desc, code`,
    sql`select distinct on (from_currency) from_currency, rate::float, valid_from
          from exchange_rate
         where company_id = ${user.companyId} and to_currency = ${co.base_currency} and rate_type = 'MARKET'
         order by from_currency, valid_from desc`,
    sql`select id, from_currency, rate_type, valid_from, rate::float from exchange_rate
         where company_id = ${user.companyId} and to_currency = ${co.base_currency}
         order by valid_from desc, from_currency limit 60`,
  ]);
  const latestBy = new Map(latest.map((r: any) => [r.from_currency, r]));
  const foreign = currencies.filter((c: any) => c.code !== co.base_currency);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <div className="page-head hero">
        <span className="eyebrow">Settings · Accounting</span>
        <h1>Currencies &amp; exchange rates</h1>
        <p className="page-sub">
          Buy in yuan, baht or dollars; the books are kept in {co.base_currency}. A purchase uses the latest
          rate on or before its date unless you type one.
        </p>
      </div>

      <div className="section-grid">
        <div className="card" style={{ overflowX: "auto" }}>
          <div className="card-head"><h2>Currencies</h2></div>
          <table>
            <thead><tr><th>Code</th><th>Name</th><th>Symbol</th><th className="num">Decimals</th>
              <th className="num">Latest rate</th><th>Since</th>{admin && <th />}</tr></thead>
            <tbody>
              {currencies.map((c: any) => {
                const r = latestBy.get(c.code);
                return (
                  <tr key={c.code}>
                    <td className="m">{c.code}{c.code === co.base_currency && <span className="tag">books</span>}</td>
                    <td>{c.name}</td>
                    <td>{c.symbol ?? "—"}</td>
                    <td className="num">{c.decimal_places}</td>
                    <td className="num">{c.code === co.base_currency ? "—" : r ? r.rate.toLocaleString("en-US") : <span className="low">none</span>}</td>
                    <td>{r ? shortDate(r.valid_from) : "—"}</td>
                    {admin && (
                      <td>
                        {c.code !== co.base_currency && (
                          <details className="rowpop">
                            <summary className="linkish">Edit</summary>
                            <div className="rowpop-panel">
                              <CurrencyForm currency={c} />
                              <form action={deleteCurrency}>
                                <input type="hidden" name="code" value={c.code} />
                                <button className="linkish" style={{ color: "var(--bad)" }}>Delete (only if unused)</button>
                              </form>
                            </div>
                          </details>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div>
          <div className="card" style={{ marginBottom: "var(--s3)" }}>
            <div className="card-head"><h2>Record a rate</h2></div>
            <div className="card-body">
              <RateForm currencies={foreign.map((c: any) => c.code)} base={co.base_currency} today={today} />
            </div>
          </div>
          {admin && (
            <div className="card">
              <div className="card-head"><h2>Add a currency</h2></div>
              <div className="card-body"><CurrencyForm /></div>
            </div>
          )}
        </div>
      </div>

      <div className="card" style={{ overflowX: "auto" }}>
        <div className="card-head"><h2>Rate history</h2><span className="page-sub">1 unit = this many {co.base_currency}</span></div>
        <table>
          <thead><tr><th>From</th><th>Currency</th><th>Type</th><th className="num">Rate</th><th /></tr></thead>
          <tbody>
            {history.map((r: any) => (
              <tr key={r.id}>
                <td>{shortDate(r.valid_from)}</td>
                <td className="m">{r.from_currency}</td>
                <td>{r.rate_type.toLowerCase()}</td>
                <td className="num">{r.rate.toLocaleString("en-US", { maximumFractionDigits: 6 })}</td>
                <td>
                  <form action={deleteRate}>
                    <input type="hidden" name="id" value={r.id} />
                    <button className="linkish" aria-label={`Delete ${r.from_currency} rate of ${shortDate(r.valid_from)}`}>Delete</button>
                  </form>
                </td>
              </tr>
            ))}
            {history.length === 0 && <tr><td colSpan={5} className="page-sub">No rates yet.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="page-sub">Documents keep the rate they posted at — changing a rate here never changes what is already posted.</p>
    </>
  );
}
