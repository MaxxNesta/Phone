import Link from "next/link";
import {
  ArrowLeft, ArrowRight, BookOpen, CheckCircle2, FileText,
  Scale, TriangleAlert, X,
} from "lucide-react";
import { money } from "@/lib/db";
import { AutoApply } from "@/components/auto-apply";
import {
  getCompany, getTrialBalanceAsOf, getHealth,
  getUnassignedBranchActivity, UNASSIGNED_BRANCH,
} from "@/lib/queries";
import { getFinanceData } from "@/lib/actions";
import { HelpHint } from "@/components/help-hint";
import { paginate } from "@/lib/paging";
import { Pager } from "@/components/pager";

/**
 * The trial balance: every account that moved, and the two columns agreeing.
 *
 * The agreement is the whole point — it is what makes this a check rather
 * than a list — so the difference is stated as its own figure rather than
 * left to be worked out from two totals, and it says which it is in words.
 */

const TYPES: [string, string][] = [
  ["", "All accounts"],
  ["ASSET", "Assets"],
  ["LIABILITY", "Liabilities"],
  ["EQUITY", "Equity"],
  ["REVENUE", "Revenue"],
  ["COGS", "Cost of sales"],
  ["EXPENSE", "Expenses"],
];

/** Which side an account of this type is expected to sit on. */
const NORMAL: Record<string, "Debit" | "Credit"> = {
  ASSET: "Debit", EXPENSE: "Debit", COGS: "Debit",
  LIABILITY: "Credit", EQUITY: "Credit", REVENUE: "Credit",
};

export default async function TrialBalance({
  searchParams,
}: {
  searchParams: Promise<{
    asOf?: string; location?: string; type?: string; account?: string; back?: string;
    voided?: string;
    /** "" adjusted (the default), "unadjusted", or "worksheet": both side by side. */
    version?: string;
    page?: string;
  }>;
}) {
  const p = await searchParams;
  const company = await getCompany();
  if (!company) return <div className="empty">No company found.</div>;

  const [all, health, finance, unassigned] = await Promise.all([
    getTrialBalanceAsOf(company.id, {
      asOf: p.asOf, locationId: p.location, accountType: p.type,
      showVoided: p.voided === "1",
    }) as Promise<any[]>,
    getHealth(company.id),
    getFinanceData(),
    getUnassignedBranchActivity(company.id),
  ]);
  const locations = finance.branches as never as { id: string; code: string; name: string }[];

  /* Unadjusted: the ledger after the routine postings. Adjusted: those plus
     the period-end adjusting entries (depreciation, and journal vouchers
     marked as adjustments). Both before the year-end close. */
  const version = p.version === "unadjusted" || p.version === "worksheet" ? p.version : "";
  const n = (v: unknown) => Number(v) || 0;
  const rows = (all as any[]).map((r) => version === "unadjusted"
    ? { ...r, debit: n(r.debit) - n(r.adj_debit), credit: n(r.credit) - n(r.adj_credit), balance: n(r.balance) - n(r.adj_balance) }
    : r).filter((r) => n(r.debit) !== 0 || n(r.credit) !== 0);
  const adjustments = (all as any[]).filter((r) => n(r.adj_debit) || n(r.adj_credit));
  const side = (b: number) => ({ dr: b > 0 ? b : 0, cr: b < 0 ? -b : 0 });
  const ws = (all as any[]).map((r) => ({ ...r, un: side(n(r.balance) - n(r.adj_balance)), aj: { dr: n(r.adj_debit), cr: n(r.adj_credit) }, ad: side(n(r.balance)) }));
  const wsTotal = ws.reduce((t, r) => ({ unDr: t.unDr + r.un.dr, unCr: t.unCr + r.un.cr, ajDr: t.ajDr + r.aj.dr, ajCr: t.ajCr + r.aj.cr, adDr: t.adDr + r.ad.dr, adCr: t.adCr + r.ad.cr }),
    { unDr: 0, unCr: 0, ajDr: 0, ajCr: 0, adDr: 0, adCr: 0 });

  // The worksheet is in balances, so its cards are the adjusted column; the other views total the movements.
  const totalDr = version === "worksheet" ? wsTotal.adDr : rows.reduce((s, r) => s + Number(r.debit), 0);
  const totalCr = version === "worksheet" ? wsTotal.adCr : rows.reduce((s, r) => s + Number(r.credit), 0);
  const difference = totalDr - totalCr;
  const balanced = Math.abs(difference) < 0.0001 && health.trialBalance === 0;

  // Only a path within this app is accepted — a `back` that could point
  // anywhere is an open redirect wearing a breadcrumb.
  const backHref = p.back?.startsWith("/") && !p.back.startsWith("//") ? p.back : null;

  const keep = (over: Record<string, string | undefined>) => {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...p, ...over })) if (v) next.set(k, String(v));
    const s = next.toString();
    return `/ledger${s ? `?${s}` : ""}`;
  };

  // The ledger, filtered to whatever this page is showing, so following the
  // link does not start the reader's filtering again.
  const glHref = (accountId?: string, view?: "account") => {
    const q = new URLSearchParams();
    if (view) q.set("view", view);
    if (accountId) q.set("account", accountId);
    if (p.asOf) q.set("to", p.asOf);
    if (p.location) q.set("location", p.location);
    const s = q.toString();
    return `/finance/general-ledger${s ? `?${s}` : ""}`;
  };

  const selected = p.account ? rows.find((r) => r.id === p.account) : null;

  const pg = paginate(rows, p.page);
  return (
    <>
      <div className="page-head">
        <span className="eyebrow">
          {backHref
            ? <Link href={backHref} className="backlink">
                <ArrowLeft size={13} aria-hidden="true" /> General ledger
              </Link>
            : "Accounting"}
        </span>
        <h1>{version === "unadjusted" ? "Unadjusted trial balance" : version === "worksheet" ? "Trial balance worksheet" : "Adjusted trial balance"}</h1>
        <HelpHint>
          Summary of debit and credit balances, read from the ledger and never
          from the documents. Unadjusted: after the routine postings. Adjusted:
          with the period-end adjusting entries too — depreciation, and journal
          vouchers marked as adjusting (accruals, deferrals, prepaid write-offs).
          Both are before the year-end close.
        </HelpHint>
        <span className="actions">
          <Link href={glHref()} className="btn ghost tiny">
            <BookOpen size={13} aria-hidden="true" /> General ledger
            <ArrowRight size={13} aria-hidden="true" />
          </Link>
        </span>
      </div>

      {/* Each version is its own page; switching keeps the date, branch and other filters. */}
      <div className="tb-switch">
        <div className="vtabs pay-tabs" role="tablist" aria-label="Trial balance version">
          {([["", "Adjusted"], ["unadjusted", "Unadjusted"], ["worksheet", "Worksheet"]] as const).map(([v, label]) => (
            <Link key={v} href={keep({ version: v || undefined, page: undefined })} role="tab" aria-selected={version === v}
              className={version === v ? "on" : undefined}>{label}</Link>
          ))}
        </div>
        <span className="hint">
          {adjustments.length ? `${adjustments.length} account${adjustments.length === 1 ? "" : "s"} touched by adjusting entries` : "No adjusting entries yet"}
          {" · "}depreciation and journal vouchers marked adjusting
        </span>
      </div>

      <form method="get" className="card doc-meta" style={{ marginBottom: "1rem" }}>
        {version && <input type="hidden" name="version" value={version} />}
        {backHref && <input type="hidden" name="back" value={backHref} />}
        {p.account && <input type="hidden" name="account" value={p.account} />}
        <div className="card-body">
          <div className="row">
            <div className="field">
              <label htmlFor="asOf">As of date</label>
              <input id="asOf" name="asOf" type="date" defaultValue={p.asOf ?? ""} />
              <span className="hint">Blank means everything posted</span>
            </div>
            {locations.length > 1 && (
              <div className="field">
                {/* Branches only — the list is branches, and calling it
                    "warehouse" invited someone to look for one and conclude the
                    filter was broken when no warehouse was there. */}
                <label htmlFor="location">Branch</label>
                <select id="location" name="location" defaultValue={p.location ?? ""}>
                  <option value="">All branches</option>
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>{l.code} · {l.name}</option>
                  ))}
                  {unassigned.lines > 0 && (
                    <option value={UNASSIGNED_BRANCH}>— No branch ({unassigned.lines} lines) —</option>
                  )}
                </select>
              </div>
            )}
            <div className="field">
              <label htmlFor="type">Account type</label>
              <select id="type" name="type" defaultValue={p.type ?? ""}>
                {TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div className="field">
              {/* Off by default. A void writes a mirror of what it undid, so
                  both sit in the ledger and the movement columns count a
                  cancelled entry twice over. The balances are right either
                  way — the pair nets to nothing — so this changes what the
                  report shows, never what it says the accounts are worth. */}
              <label htmlFor="voided">Voided entries</label>
              <select id="voided" name="voided" defaultValue={p.voided ?? ""}>
                <option value="">Hidden</option>
                <option value="1">Shown</option>
              </select>
            </div>
            <div className="field">
              <label>Currency</label>
              {/* Not a dropdown. Every balance here is base currency by
                  construction — base_amount is what the ledger stores — and
                  offering a choice of one is a control that cannot answer. */}
              <div className="staticfield m">{company.base_currency}</div>
            </div>
            <div className="field">
              {/* No label of its own, but the column needs one: without it
                  this sits a line lower than the boxes it belongs to, on any
                  row where another field carries a hint underneath. */}
              <label aria-hidden="true">&nbsp;</label>
              <div className="actions">
                <AutoApply />
                <button type="submit" className="tiny" data-apply>Apply</button>
                {(p.asOf || p.location || p.type) && (
                  <a href="/ledger" className="btn ghost tiny">Clear</a>
                )}
              </div>
            </div>
          </div>
        </div>
      </form>

      {unassigned.lines > 0 && !p.location && (
        <p className="hint" style={{ margin: "0 0 1rem" }}>
          {money(unassigned.debits)} of activity carries no branch — opening
          balances, and anything posted without one. It is in these totals and
          in none of the branches, so the branches will not add up to what is
          shown here. Choose &ldquo;No branch&rdquo; above to see exactly what.
        </p>
      )}

      {/* Debits, credits, and the figure that decides whether this report is
          worth reading at all. */}
      <div className="tb-stats">
        <div className="card tb-stat">
          <div className="card-body">
            <span className="tb-icon dr"><FileText size={17} aria-hidden="true" /></span>
            <div>
              <span className="erp-settle-label">Total debits</span>
              <div className="tb-figure dr">{money(totalDr)} <span className="tb-unit">{company.base_currency}</span></div>
            </div>
          </div>
        </div>
        <div className="card tb-stat">
          <div className="card-body">
            <span className="tb-icon cr"><Scale size={17} aria-hidden="true" /></span>
            <div>
              <span className="erp-settle-label">Total credits</span>
              <div className="tb-figure cr">{money(totalCr)} <span className="tb-unit">{company.base_currency}</span></div>
            </div>
          </div>
        </div>
        <div className="card tb-stat">
          <div className="card-body">
            <span className={`tb-icon ${balanced ? "ok" : "bad"}`}>
              {balanced ? <CheckCircle2 size={17} aria-hidden="true" />
                        : <TriangleAlert size={17} aria-hidden="true" />}
            </span>
            <div>
              <span className="erp-settle-label">Difference</span>
              <div className="tb-figure">{money(difference)} <span className="tb-unit">{company.base_currency}</span></div>
              <span className="hint" style={{ color: balanced ? "var(--ok)" : "var(--bad)" }}>
                {balanced ? "Trial balance is balanced" : "Debits and credits disagree"}
              </span>
            </div>
          </div>
        </div>
      </div>

      {version === "worksheet" ? (
        <section>
          <div className="card">
            <div className="card-head">
              <h2>Worksheet</h2>
              <span className="page-sub">Unadjusted, the adjusting entries, and the adjusted balances</span>
            </div>
            <div className="tablewrap">
              <table className="tb-ws">
                <thead>
                  <tr><th rowSpan={2}>Code</th><th rowSpan={2}>Account</th>
                    <th colSpan={2} className="c">Unadjusted</th><th colSpan={2} className="c">Adjustments</th><th colSpan={2} className="c">Adjusted</th></tr>
                  <tr><th className="r">Debit</th><th className="r">Credit</th><th className="r">Debit</th><th className="r">Credit</th><th className="r">Debit</th><th className="r">Credit</th></tr>
                </thead>
                <tbody>
                  {ws.filter((r) => r.un.dr || r.un.cr || r.aj.dr || r.aj.cr || r.ad.dr || r.ad.cr).map((r) => (
                    <tr key={r.id} className={r.aj.dr || r.aj.cr ? "tb-ws-adj" : undefined}>
                      <td className="code"><Link href={glHref(r.id, "account")} style={{ color: "var(--link)" }}>{r.code}</Link></td>
                      <td>{r.name}</td>
                      <td className="r dr">{r.un.dr ? money(r.un.dr) : "–"}</td><td className="r cr">{r.un.cr ? money(r.un.cr) : "–"}</td>
                      <td className="r dr">{r.aj.dr ? money(r.aj.dr) : ""}</td><td className="r cr">{r.aj.cr ? money(r.aj.cr) : ""}</td>
                      <td className="r dr">{r.ad.dr ? money(r.ad.dr) : "–"}</td><td className="r cr">{r.ad.cr ? money(r.ad.cr) : "–"}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr><td colSpan={2}>Total</td>
                    <td className="r dr">{money(wsTotal.unDr)}</td><td className="r cr">{money(wsTotal.unCr)}</td>
                    <td className="r dr">{money(wsTotal.ajDr)}</td><td className="r cr">{money(wsTotal.ajCr)}</td>
                    <td className="r dr">{money(wsTotal.adDr)}</td><td className="r cr">{money(wsTotal.adCr)}</td></tr>
                </tfoot>
              </table>
            </div>
          </div>
          <div className={`tb-verdict ${Math.abs(wsTotal.unDr - wsTotal.unCr) < 0.0001 && Math.abs(wsTotal.adDr - wsTotal.adCr) < 0.0001 ? "ok" : "bad"}`}>
            <CheckCircle2 size={16} aria-hidden="true" />
            <div>
              <strong>Each column balances on its own</strong>
              <div className="hint">Unadjusted {money(wsTotal.unDr)} = {money(wsTotal.unCr)} · Adjustments {money(wsTotal.ajDr)} = {money(wsTotal.ajCr)} · Adjusted {money(wsTotal.adDr)} = {money(wsTotal.adCr)}</div>
            </div>
          </div>
        </section>
      ) : (
      <div className={selected ? "tb-split" : ""}>
        <section>
          <div className="card">
            <div className="card-head">
              <h2>Accounts</h2>
              <span className="page-sub">
                {rows.length} account{rows.length === 1 ? "" : "s"} with movement
              </span>
            </div>
            {rows.length === 0 ? (
              <div className="empty">Nothing has been posted yet.</div>
            ) : (
              <div className="tablewrap">
                <table>
                  <thead>
                    <tr>
                      <th>Code</th><th>Account</th><th>Type</th>
                      <th className="r">Debit</th><th className="r">Credit</th>
                      <th className="r">Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pg.rows.map((r) => {
                      const bal = Number(r.balance);
                      const side = bal > 0 ? "Dr" : "Cr";
                      return (
                        <tr key={r.id} className={r.id === p.account ? "tb-selected" : undefined}>
                          <td className="code">
                            <Link href={keep({ account: r.id })} style={{ color: "var(--link)" }}>
                              {r.code}
                            </Link>
                          </td>
                          <td>
                            <Link href={keep({ account: r.id })} style={{ color: "var(--link)" }}>
                              {r.name}
                            </Link>
                          </td>
                          <td style={{ color: "var(--muted)" }}>{r.section}</td>
                          <td className="r dr">{Number(r.debit) ? money(r.debit) : "–"}</td>
                          <td className="r cr">{Number(r.credit) ? money(r.credit) : "–"}</td>
                          <td className="r">
                            {money(Math.abs(bal))}
                            {/* An account that moved and came back to nil has
                                no side to sit on, and "0 Dr" claims one. */}
                            {bal !== 0 && (
                              <> <span className={bal > 0 ? "dr" : "cr"}>{side}</span></>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={3}>Total</td>
                      <td className="r dr">{money(totalDr)}</td>
                      <td className="r cr">{money(totalCr)}</td>
                      <td className="r">{difference === 0 ? "–" : money(difference)}</td>
                    </tr>
                  </tfoot>
                </table>
                <Pager p={pg} params={p} />
              </div>
            )}
          </div>

          <div className={`tb-verdict ${balanced ? "ok" : "bad"}`}>
            {balanced ? <CheckCircle2 size={16} aria-hidden="true" />
                      : <TriangleAlert size={16} aria-hidden="true" />}
            <div>
              <strong>
                {balanced ? "Trial balance is balanced" : "Trial balance does not balance"}
              </strong>
              <div className="hint">
                {balanced
                  ? "Total debits = total credits."
                  : `Debits exceed credits by ${money(difference)}. Every entry is`
                    + " balanced on its own, so a difference here means this view is"
                    + " filtered to one side of an entry — check the branch filter."}
              </div>
            </div>
          </div>
        </section>

        {selected && (
          <aside className="card tb-aside">
            <div className="card-head">
              <h2>Account summary</h2>
              <Link href={keep({ account: undefined })} className="expander"
                    aria-label="Close account summary">
                <X size={14} aria-hidden="true" />
              </Link>
            </div>
            <div className="card-body">
              <div className="tb-aside-head">
                <span className="code" style={{ color: "var(--muted)" }}>{selected.code}</span>
                <strong>{selected.name}</strong>
                <span className="pill">{selected.section}</span>
              </div>
              <div className="tb-figure" style={{ marginBottom: "1rem" }}>
                {money(Math.abs(Number(selected.balance)))}
                {Number(selected.balance) !== 0 && (
                  <> <span className={Number(selected.balance) > 0 ? "dr" : "cr"}>
                    {Number(selected.balance) > 0 ? "Dr" : "Cr"}
                  </span></>
                )}
              </div>

              <dl className="kv">
                <dt>Debits</dt><dd className="r dr">{money(selected.debit)}</dd>
                <dt>Credits</dt><dd className="r cr">{money(selected.credit)}</dd>
                <dt>Normal balance</dt>
                <dd>{NORMAL[selected.account_type] ?? "—"}</dd>
                <dt>On the expected side</dt>
                <dd>
                  {/* Worth saying plainly. An asset sitting in credit is not
                      an error the ledger can catch — it balances perfectly —
                      but it is nearly always worth a look. */}
                  {(NORMAL[selected.account_type] === "Debit") === (Number(selected.balance) >= 0)
                    ? "Yes"
                    : <span className="cr">No — sitting on the other side</span>}
                </dd>
              </dl>

              <div className="actions" style={{ marginTop: "1rem", flexDirection: "column", alignItems: "stretch" }}>
                <Link href={glHref(selected.id, "account")} className="btn">
                  <BookOpen size={14} aria-hidden="true" /> View general ledger
                  <ArrowRight size={13} aria-hidden="true" />
                </Link>
                <Link href={glHref(selected.id)} className="btn ghost">
                  <FileText size={14} aria-hidden="true" /> View journal entries
                </Link>
              </div>
            </div>
          </aside>
        )}
      </div>
      )}
    </>
  );
}
