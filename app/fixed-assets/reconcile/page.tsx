import Link from "next/link";
import { HelpHint } from "@/components/help-hint";
import { canPostFa, isCompanyLevel } from "@/lib/fa-access";
import { Search, ArrowUpRight, X } from "lucide-react";
import { requirePermission } from "@/lib/auth";
import { sql } from "@/lib/db";
import { seenLocations } from "@/lib/branch-scope";
import { reconLines, lineAllocations, reconIssues } from "@/lib/fa-reconcile";
import { loadSchedules } from "@/lib/fa-schedule";
import { fromUnits, toUnits } from "@/lib/fa-engine";
import { linkJournalLine, unlinkAllocation } from "@/lib/fa-actions";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { AutoApply } from "@/components/auto-apply";
import { FaLinkForm } from "@/components/fa-link-form";

export const metadata = { title: "Journal Reconciliation" };

type SP = Record<string, string | undefined>;
const money = (s: string) => Number(s).toLocaleString("en-US", { maximumFractionDigits: 0 });
const KIND: Record<string, string> = { OPENING: "Opening, accumulated to", HISTORICAL: "Depreciation", CORRECTION: "Correction", RUN: "Depreciation run", ACQUISITION: "Acquisition", OTHER: "Linked" };

/**
 * The ledger's existing fixed-asset journals, tied to the register without
 * reposting a thing: acquisitions to assets, depreciation history to asset
 * months, adjustments as corrections. Each line goes back to its journal and
 * to its account in the General Ledger.
 */
export default async function Reconcile({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const user = await requirePermission("accounting.view");
  const co = user.companyId;
  const canLink = canPostFa(user);
  // Historical journals are company-level and may carry no branch at all, so
  // tying them to assets is for someone who sees every branch.
  if (!(await isCompanyLevel())) {
    return (
      <div className="fa">
        <Breadcrumbs trail={[{ label: "Fixed Assets", href: "/fixed-assets" }, { label: "Journal Reconciliation" }]} />
        <div className="fa-empty"><strong>Company-level work</strong>
          <span>Linking the ledger&apos;s historical journals to assets is done by someone who sees every branch, because those journals belong to the company, not to one branch.</span></div>
      </div>
    );
  }
  const f = { branch: sp.branch || undefined, accountId: sp.account || undefined, from: sp.from || undefined, to: sp.to || undefined,
              month: sp.month || undefined, amount: sp.amount || undefined, q: sp.q || undefined, open: sp.open !== "0" };
  const [lines, accounts, issues, branchList] = await Promise.all([
    reconLines(co, f),
    sql`select distinct a.id, a.code, a.name from account a
          join fa_category c on a.id in (c.asset_account_id, c.accum_account_id) where c.company_id = ${co} order by a.code`,
    reconIssues(co),
    sql`select id, name from location where company_id = ${co} and parent_id is null and is_active order by code`,
  ]);
  const href = (patch: SP) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...sp, ...patch })) if (v) q.set(k, v);
    return `/fixed-assets/reconcile?${q}`;
  };

  // The selected line, what it already carries, and the assets it could go to.
  const [line] = sp.line ? await reconLines(co, {}, sp.line) : [];
  let panel: React.ReactNode = null;
  if (line) {
    const [allocs, candidates] = await Promise.all([
      lineAllocations(co, line.id),
      sql`select f.id from fixed_asset f join fa_category c on c.id = f.category_id
           where f.company_id = ${co} and f.status <> 'DRAFT'
             and ${line.role === "ASSET" ? sql`c.asset_account_id` : sql`c.accum_account_id`} = ${line.accountId}`,
    ]);
    const seen = await seenLocations();
    const scheds = (await loadSchedules(co, { branches: seen })).filter((a) => (candidates as any[]).some((c) => c.id === a.id));
    const credit = line.amount.startsWith("-");
    // A match the amounts give away: depreciation for the line's month that
    // adds up to what is left of the line, at its branch (or any, if none).
    const month = line.date.slice(0, 7);
    const planned = scheds
      .filter((a) => !line.branch || a.postBranch === line.branch)
      .map((a) => ({ a, r: a.rows.find((r) => r.month === month && r.state === "PLANNED" && r.amount > 0n) }))
      .filter((x) => x.r);
    const left = toUnits(line.remaining);
    const one = planned.find((x) => x.r!.amount === left);
    const all = planned.reduce((s, x) => s + x.r!.amount, 0n) === left;
    const suggested = line.role !== "ACCUM" || !credit || left <= 0n ? []
      : (one ? [one] : all ? planned : []).map((x) => ({ assetId: x.a.id, month, amount: fromUnits(x.r!.amount).replace(/\.?0+$/, "") }));
    panel = (
      <aside className="card far-panel">
        <div className="fac-panel-head">
          <div>
            <h2>{line.docNo ?? line.entryNo} <span className="fa-pill none fa-src-pill">{line.generated ? "Generated" : "Manual"}</span></h2>
            <p>{line.date} · {line.accountCode} {line.accountName}{line.branch ? ` · ${line.branch}` : ""}</p>
          </div>
          <Link href={href({ line: undefined })} className="fac-x" aria-label="Close"><X size={16} /></Link>
        </div>
        <dl className="fac-sum">
          <div><dt>{credit ? "Credit" : "Debit"}</dt><dd>{money(line.amount.replace("-", ""))}</dd></div>
          <div><dt>Linked</dt><dd>{money(line.allocated)}</dd></div>
          <div><dt>Left</dt><dd>{money(line.remaining)}</dd></div>
          <div><dt>Carries</dt><dd>{line.role === "ASSET" ? "Cost" : credit ? "Depreciation" : "Reversal"}</dd></div>
        </dl>
        <p className="far-links">
          {line.docId && <Link href={`/documents/${line.docId}`} className="ie-link">Open journal <ArrowUpRight size={13} /></Link>}
          <Link href={`/finance/general-ledger?view=account&account=${line.accountId}&from=${line.date}&to=${line.date}`} className="ie-link">
            {line.accountCode} in the General Ledger <ArrowUpRight size={13} /></Link>
        </p>
        {line.memo && <p className="fa-muted">{line.memo}</p>}

        {allocs.length > 0 && (
          <>
            <h3 className="far-h">Already linked</h3>
            <ul className="far-allocs">
              {allocs.map((a) => (
                <li key={a.id}>
                  <span><Link href={`/fixed-assets/${a.asset_id}`}>{a.code}</Link> {a.name}<small>{KIND[a.kind] ?? a.kind}{a.month ? ` · ${a.month}` : ""}</small></span>
                  <b>{money(a.amount)}</b>
                  {canLink && a.kind !== "RUN" && (
                    <form action={unlinkAllocation}><input type="hidden" name="id" value={a.id} /><input type="hidden" name="type" value={a.type} />
                      <button className="far-unlink" title="Undo this link; nothing is posted or reversed">Unlink</button></form>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
        {canLink && Number(line.remaining) > 0 && (
          <>
            <h3 className="far-h">Link to assets</h3>
            <FaLinkForm action={linkJournalLine} lineId={line.id} role={line.role} credit={credit}
              remaining={line.remaining} defaultMonth={line.date.slice(0, 7)} suggested={suggested}
              assets={scheds.map((a) => ({ id: a.id, code: a.code, name: a.name,
                expected: Object.fromEntries(a.rows.map((r) => [r.month, fromUnits(r.amount)])) }))} />
          </>
        )}
      </aside>
    );
  }

  return (
    <div className="fa">
      <Breadcrumbs trail={[{ label: "Fixed Assets", href: "/fixed-assets" }, { label: "Journal Reconciliation" }]} />
      <div className="fa-head">
        <div>
          <h1>Journal Reconciliation <HelpHint label="About Journal Reconciliation">Tie the ledger&apos;s existing fixed-asset journals to assets. Nothing is posted or reposted.</HelpHint></h1>
        </div>
      </div>
      {issues.unlinked.n > 0 && (
        <p className="fa-pinned">{issues.unlinked.n} accumulated-depreciation credit{issues.unlinked.n === 1 ? "" : "s"} ({money(issues.unlinked.amount)} MMK)
          {" "}are on the ledger but not yet tied to any asset month.</p>
      )}

      <form method="get" className="fac-bar">
        <select name="account" defaultValue={sp.account ?? ""} aria-label="Account" className={`dt-filter${sp.account ? " dt-filter-on" : ""}`}>
          <option value="">All fixed-asset accounts</option>
          {(accounts as any[]).map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
        </select>
        <input type="month" name="month" defaultValue={sp.month ?? ""} aria-label="Period" className="dt-filter" />
        <input type="date" name="from" defaultValue={sp.from ?? ""} aria-label="From" className="dt-filter" />
        <input type="date" name="to" defaultValue={sp.to ?? ""} aria-label="To" className="dt-filter" />
        <input name="amount" defaultValue={sp.amount ?? ""} placeholder="Amount" inputMode="decimal" aria-label="Amount" className="dt-filter far-amt" />
        <select name="branch" defaultValue={sp.branch ?? ""} aria-label="Branch" className={`dt-filter${sp.branch ? " dt-filter-on" : ""}`}>
          <option value="">All branches</option>
          <option value="company">Company level (no branch)</option>
          {(branchList as any[]).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <select name="open" defaultValue={sp.open ?? ""} aria-label="Show" className="dt-filter">
          <option value="">Not fully linked</option><option value="0">All lines</option>
        </select>
        <label className="dt-search"><Search size={15} aria-hidden="true" />
          <input name="q" type="search" defaultValue={sp.q ?? ""} data-live placeholder="Journal no., reference, memo…" aria-label="Search" /></label>
        <AutoApply />
      </form>

      <div className={line ? "far-layout" : undefined}>
        <section className="card">
          {lines.length === 0 ? <div className="fa-empty"><strong>No journal lines</strong>
            <span>Nothing on a fixed-asset account matches. Assets are linked when their accounts carry posted journals.</span></div> : (
            <div className="tablewrap">
              <table className="far-table">
                <thead><tr><th>Date</th><th>Journal</th><th>Account</th><th>Looks like</th><th>Memo / reference</th><th className="r">Debit</th><th className="r">Credit</th><th className="r">Linked</th><th /></tr></thead>
                <tbody>{lines.map((l) => {
                  const credit = l.amount.startsWith("-");
                  const full = Number(l.remaining) <= 0;
                  return (
                    <tr key={l.id} aria-current={l.id === sp.line ? "true" : undefined}>
                      <td className="nowrap">{l.date}</td>
                      <td>{l.docId ? <Link href={`/documents/${l.docId}`} style={{ color: "var(--link)" }}>{l.docNo ?? l.entryNo}</Link> : l.entryNo}</td>
                      <td><Link href={`/finance/general-ledger?view=account&account=${l.accountId}`} className="far-acct">{l.accountCode}</Link> {l.accountName}</td>
                      <td className="far-looks">{l.looks}{l.branch ? "" : <small>Company level</small>}</td>
                      <td className="wrap far-memo">{[l.memo, l.reference].filter(Boolean).join(" · ") || "—"}</td>
                      <td className="r">{credit ? "" : money(l.amount)}</td>
                      <td className="r">{credit ? money(l.amount.slice(1)) : ""}</td>
                      <td className="r"><span className={`fa-pill ${full ? "posted" : "unreconciled"}`}>{full ? "Linked" : Number(l.allocated) > 0 ? `${money(l.remaining)} unlinked` : "Unlinked"}</span></td>
                      <td><Link href={href({ line: l.id })} className="ie-link">{canLink && !full ? "Link" : "View"}</Link></td>
                    </tr>);
                })}</tbody>
              </table>
            </div>
          )}
        </section>
        {panel}
      </div>
    </div>
  );
}
