import Link from "next/link";
import { requirePermission, can } from "@/lib/auth";
import { sql } from "@/lib/db";
import { planFxRevaluation } from "@/lib/posting";
import { shortDate } from "@/lib/format";
import { getTranslations } from "next-intl/server";
import { PostRevaluation, VoidRevaluation } from "@/components/fx-revaluation-forms";

/**
 * Month-end exchange revaluation (0223, docs/06 D-P6).
 *
 * Run by the accountant at month close, before the period is locked: choose
 * the month end, check or type the rate for that day, look at what each
 * balance comes to, and post. The entry is dated the month end and reversed
 * the next day, so it changes the balance sheet and the month's result and
 * nothing else. A wrong rate is put right by voiding the run and running it
 * again.
 */
export default async function FxRevaluation({ searchParams }: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requirePermission("accounting.view");
  const t = await getTranslations("finance");
  const sp = await searchParams;
  const ends = (await sql`
    select (date_trunc('month', fn_shop_today()) - make_interval(months => g) - interval '1 day')::date::text as d
      from generate_series(0, 11) g`).map((r) => String(r.d));
  const periodEnd = sp.period && /^\d{4}-\d{2}-\d{2}$/.test(sp.period) ? sp.period : ends[0];
  const typed: Record<string, number> = {};
  for (const [k, v] of Object.entries(sp)) {
    const m = /^rate_([A-Z]{3})$/.exec(k);
    if (m && Number(v) > 0) typed[m[1]] = Number(v);
  }

  const [standing] = await sql`
    select r.*, u.name as by_name from fx_revaluation r left join app_user u on u.id = r.created_by
     where r.company_id = ${user.companyId} and r.period_end = ${periodEnd}::date and r.status = 'POSTED'`;
  const posted = standing ? await sql`
    select l.*, a.name as account_name, bp.name as partner_name
      from fx_revaluation_line l join account a on a.id = l.account_id
      left join business_partner bp on bp.id = l.partner_id
     where l.revaluation_id = ${standing.id} order by l.kind desc, bp.name, a.name` : [];
  const plan = standing ? null : await planFxRevaluation({ companyId: user.companyId, periodEnd, rates: typed });
  const history = await sql`
    select r.id, r.period_end::text as period_end, r.status, r.void_reason, r.created_at,
           (select coalesce(sum(difference), 0)::float from fx_revaluation_line l where l.revaluation_id = r.id) as total
      from fx_revaluation r where r.company_id = ${user.companyId} order by r.period_end desc, r.created_at desc limit 24`;
  const mayPost = can(user, "accounting.post");
  const money = (v: unknown) => Number(v ?? 0).toLocaleString("en-US", { maximumFractionDigits: 2 });

  const rows: any[] = standing
    ? posted.map((l: any) => ({ kind: l.kind, name: l.kind === "PAYABLE" ? l.partner_name : l.account_name,
        currency: l.currency, fc: Number(l.fc_balance), carried: Number(l.carried), rate: Number(l.rate),
        revalued: Number(l.revalued), difference: Number(l.difference) }))
    : plan!.lines.map((l) => ({ kind: l.kind, name: l.kind === "PAYABLE" ? l.partnerName : l.accountName,
        currency: l.currency, fc: l.fcBalance, carried: l.carried, rate: l.rate, revalued: l.revalued, difference: l.difference }));
  const total = rows.reduce((s, r) => s + r.difference, 0);

  return (
    <>
      <div className="page-head hero">
        <h1>{t("fxr.title")}</h1>
        <p className="page-sub">{t("fxr.sub")}</p>
      </div>

      <form className="card filters" method="get">
        <div className="card-body filter-row">
          <div className="field">
            <label htmlFor="period">{t("fxr.monthEnd")}</label>
            <select id="period" name="period" defaultValue={periodEnd}>
              {ends.map((d) => <option key={d} value={d}>{shortDate(d)}</option>)}
            </select>
          </div>
          {!standing && Object.keys({ ...plan!.rates, ...Object.fromEntries(plan!.missingRates.map((c) => [c, 0])) }).map((cur) => (
            <div className="field" key={cur}>
              <label htmlFor={`rate_${cur}`}>{t("fxr.rateFor", { cur, base: plan!.base })}</label>
              <input id={`rate_${cur}`} name={`rate_${cur}`} type="number" step="any" min="0"
                defaultValue={plan!.rates[cur] ?? ""} placeholder={t("fxr.ratePlaceholder")} />
            </div>
          ))}
          <button className="btn ghost">{t("fxr.preview")}</button>
        </div>
      </form>

      {standing && (
        <div className="hintbar" style={{ marginBottom: "var(--s3)" }}>
          {t("fxr.done", { d: shortDate(periodEnd), who: standing.by_name ?? "—" })}{" "}
          {Object.entries(standing.rates as Record<string, number>).map(([c, r]) => `${c} ${r}`).join(", ")}
        </div>
      )}
      {!standing && plan!.missingRates.length > 0 && (
        <div className="alert">{t("fxr.missing", { cur: plan!.missingRates.join(", "), d: shortDate(periodEnd) })}</div>
      )}

      <div className="card" style={{ overflowX: "auto" }}>
        <div className="card-head"><h2>{standing ? t("fxr.posted") : t("fxr.previewTitle")}</h2></div>
        <table>
          <thead>
            <tr><th>{t("fxr.what")}</th><th>{t("fxr.currency")}</th><th className="r">{t("fxr.foreign")}</th>
              <th className="r">{t("fxr.carried")}</th><th className="r">{t("fxr.rate")}</th>
              <th className="r">{t("fxr.revalued")}</th><th className="r">{t("fxr.difference")}</th></tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td>{r.name ?? "—"} <span className="subline">{r.kind === "PAYABLE" ? t("fxr.owed") : t("fxr.held")}</span></td>
                <td>{r.currency}</td>
                <td className="r">{money(Math.abs(r.fc))}</td>
                <td className="r">{money(Math.abs(r.carried))}</td>
                <td className="r">{r.rate}</td>
                <td className="r">{money(Math.abs(r.revalued))}</td>
                <td className="r" style={{ color: r.difference < 0 ? "var(--bad)" : "var(--ok)" }}>
                  {r.difference < 0 ? t("fxr.loss", { v: money(-r.difference) }) : t("fxr.gain", { v: money(r.difference) })}
                </td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={7} className="page-sub">{t("fxr.nothing")}</td></tr>}
          </tbody>
          {rows.length > 0 && (
            <tfoot><tr><td colSpan={6}><strong>{t("fxr.net")}</strong></td>
              <td className="r"><strong>{total < 0 ? t("fxr.loss", { v: money(-total) }) : t("fxr.gain", { v: money(total) })}</strong></td></tr></tfoot>
          )}
        </table>
      </div>

      {mayPost && !standing && rows.length > 0 && plan!.missingRates.length === 0 && (
        <div style={{ margin: "var(--s3) 0" }}>
          <PostRevaluation periodEnd={periodEnd} rates={plan!.rates} />
          <p className="page-sub">{t("fxr.postNote")}</p>
        </div>
      )}
      {mayPost && standing && <div style={{ margin: "var(--s3) 0" }}><VoidRevaluation id={standing.id} /></div>}

      {history.length > 0 && (
        <div className="card" style={{ overflowX: "auto" }}>
          <div className="card-head"><h2>{t("fxr.history")}</h2></div>
          <table>
            <thead><tr><th>{t("fxr.monthEnd")}</th><th>{t("fxr.status")}</th><th className="r">{t("fxr.difference")}</th></tr></thead>
            <tbody>
              {history.map((h: any) => (
                <tr key={h.id}>
                  <td><Link href={`/finance/fx-revaluation?period=${String(h.period_end).slice(0, 10)}`} style={{ color: "var(--link)" }}>{shortDate(h.period_end)}</Link></td>
                  <td>{h.status === "POSTED" ? t("fxr.stPosted") : `${t("fxr.stVoided")}${h.void_reason ? ` — ${h.void_reason}` : ""}`}</td>
                  <td className="r">{h.total < 0 ? t("fxr.loss", { v: money(-h.total) }) : t("fxr.gain", { v: money(h.total) })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
