"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, FileSpreadsheet } from "lucide-react";
import { money, shortDate } from "@/lib/format";
import type { PartnerLedger, Side } from "@/lib/partner-ledger";
import { AutoSubmit } from "./auto-submit";
import { exportLedger, periodText } from "./ledger-workbook";

/**
 * The supplier or customer ledger, as the old reports printed it: a band per
 * partner — and, for customers, per township above them, with the township's
 * total — then opening, each document with the running balance, and the total.
 *
 * Each level folds (2026-11-25): a township to its total, a partner to its
 * total, or everything at once from the bar above the table.
 */
export function PartnerLedgerView({ side, ledger, partners, townships, branches = [], sp, base }: {
  side: Side; ledger: PartnerLedger;
  partners: { id: string; code: string; name: string }[];
  townships?: string[];
  /** The branches this person may pick from; one or none hides the choice. */
  branches?: { id: string; code: string; name: string }[];
  sp: { partner?: string; township?: string; from?: string; to?: string; branch?: string };
  base: string;
}) {
  const cust = side === "CUSTOMER";
  const [chargeLabel, settleLabel] = cust ? ["Sales", "Payment"] : ["Purchase", "Payment"];
  const neg = (n: number) => (n < 0 ? "neg" : "");
  // Customers fall under their township, as the old report grouped them.
  const groups = cust
    ? [...new Set(ledger.map((g) => g.township ?? ""))].map((t) => ({ township: t, partners: ledger.filter((g) => (g.township ?? "") === t) }))
    : [{ township: null as string | null, partners: ledger }];

  const all = ledger.reduce((a, g) => ({ c: a.c + g.charges, s: a.s + g.settles, b: a.b + g.closing }), { c: 0, s: 0, b: 0 });
  const [shutTowns, setShutTowns] = useState<Set<string>>(new Set());
  const [shutParts, setShutParts] = useState<Set<string>>(new Set());
  const flip = (set: Set<string>, key: string, put: (s: Set<string>) => void) => {
    const next = new Set(set); if (next.has(key)) next.delete(key); else next.add(key); put(next);
  };
  const [busy, setBusy] = useState(false);

  return (
    <>
      <form className="sl-filter card" action={base}>
        <AutoSubmit />
        {branches.length > 1 && (
          <div className="field">
            <label htmlFor="branch">Branch</label>
            <select id="branch" name="branch" defaultValue={sp.branch ?? ""}>
              <option value="">All branches</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
        )}
        {cust && townships && (
          <div className="field">
            <label htmlFor="township">Township</label>
            <select id="township" name="township" defaultValue={sp.township ?? ""}>
              <option value="">All townships</option>
              {townships.map((t) => <option key={t} value={t}>{t}</option>)}
              <option value="-">No township</option>
            </select>
          </div>
        )}
        <div className="field">
          <label htmlFor="partner">{cust ? "Customer" : "Supplier"}</label>
          <select id="partner" name="partner" defaultValue={sp.partner ?? ""}>
            <option value="">{cust ? "All customers" : "All suppliers"}</option>
            {partners.map((s) => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}
          </select>
        </div>
        <div className="field"><label htmlFor="from">From</label><input id="from" name="from" type="date" defaultValue={sp.from ?? ""} /></div>
        <div className="field"><label htmlFor="to">To</label><input id="to" name="to" type="date" defaultValue={sp.to ?? ""} /></div>
        <div className="actions">
          <button type="button" className="dt-tool" disabled={busy || ledger.length === 0}
            onClick={async () => { setBusy(true); try { await exportLedger(side, ledger, periodText(sp.from, sp.to)); } finally { setBusy(false); } }}>
            <FileSpreadsheet size={15} aria-hidden="true" /> {busy ? "Exporting…" : "Export"}
          </button>
        </div>
      </form>

      {ledger.length === 0 ? (
        <div className="card"><div className="empty">Nothing in this period.</div></div>
      ) : (
        <div className="card">
          <div className="os-fold" role="group" aria-label="Fold">
            <button type="button" onClick={() => { setShutTowns(new Set()); setShutParts(new Set()); }}>Expand all</button>
            <button type="button" onClick={() => { setShutTowns(new Set()); setShutParts(new Set(ledger.map((g) => g.partnerId))); }}>{cust ? "Customers only" : "Suppliers only"}</button>
            {cust && <button type="button" onClick={() => setShutTowns(new Set(groups.map((g) => g.township ?? "")))}>Townships only</button>}
          </div>
          <div className="tablewrap">
            <table className="os os-led">
              <colgroup><col style={{ width: "7.5rem" }} /><col style={{ width: "9rem" }} /><col style={{ width: "9.5rem" }} />
                <col style={{ width: "7.5rem" }} /><col /><col className="c-amt" /><col className="c-amt" /><col className="c-amt" /></colgroup>
              <thead>
                <tr><th>Date</th><th>Type</th><th>Document</th><th>Old ref</th><th>Description</th>
                  <th className="r">{chargeLabel}</th><th className="r">{settleLabel}</th><th className="r">Balance</th></tr>
              </thead>
              {groups.map((grp) => {
                const key = grp.township ?? "";
                const shut = cust && shutTowns.has(key);
                const t = grp.partners.reduce((a, g) => ({ c: a.c + g.charges, s: a.s + g.settles, b: a.b + g.closing }), { c: 0, s: 0, b: 0 });
                return (
                  <tbody key={key || "all"}>
                    {cust && (
                      <tr className="os-town" onClick={() => flip(shutTowns, key, setShutTowns)} aria-expanded={!shut}>
                        <td colSpan={8}>
                          {shut ? <ChevronRight size={16} aria-hidden="true" /> : <ChevronDown size={16} aria-hidden="true" />}
                          <span>Township</span>{grp.township || "No township"}<em>{grp.partners.length} customer{grp.partners.length === 1 ? "" : "s"}</em>
                        </td>
                      </tr>
                    )}
                    {!shut && grp.partners.map((g) => {
                      const closed = shutParts.has(g.partnerId);
                      return (
                        <Fragment key={g.partnerId}>
                          <tr className="os-cust" onClick={() => flip(shutParts, g.partnerId, setShutParts)} aria-expanded={!closed}>
                            <td colSpan={8}>
                              {closed ? <ChevronRight size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
                              <b>{g.code}</b>{g.name}
                              {closed && <i>{g.rows.length} entr{g.rows.length === 1 ? "y" : "ies"}</i>}
                            </td>
                          </tr>
                          {!closed && (
                            <>
                              <tr className="os-open"><td /><td>Opening</td><td colSpan={5} /><td className={`r ${neg(g.opening)}`}>{money(g.opening)}</td></tr>
                              {g.rows.map((r) => (
                                <tr key={`${r.entryNo}-${r.partnerId}`}>
                                  <td className="code">{shortDate(r.date)}</td>
                                  <td>{r.kind}</td>
                                  <td className="code">{r.docId ? <Link href={`/documents/${r.docId}`}>{r.docNo}</Link> : r.entryNo}</td>
                                  <td className="code muted">{r.oldRef ?? ""}</td>
                                  <td className="muted" title={r.description}>{r.description}</td>
                                  <td className="r">{r.charge ? money(r.charge) : ""}</td>
                                  <td className="r">{r.settle ? money(r.settle) : ""}</td>
                                  <td className={`r ${neg(r.balance)}`}>{money(r.balance)}</td>
                                </tr>
                              ))}
                            </>
                          )}
                          <tr className="os-ctotal">
                            <td colSpan={5} className="r">Total {g.name}</td>
                            <td className="r">{money(g.charges)}</td>
                            <td className="r">{money(g.settles)}</td>
                            <td className={`r ${neg(g.closing)}`}>{money(g.closing)}</td>
                          </tr>
                        </Fragment>
                      );
                    })}
                    {cust && (
                      <tr className="os-towntotal">
                        <td colSpan={5} className="r">Total {grp.township || "No township"}</td>
                        <td className="r">{money(t.c)}</td>
                        <td className="r">{money(t.s)}</td>
                        <td className={`r ${neg(t.b)}`}>{money(t.b)}</td>
                      </tr>
                    )}
                  </tbody>
                );
              })}
              {/* Every customer or supplier in view, whatever is folded: the figure the summary's foot shows too. */}
              <tfoot>
                <tr>
                  <td colSpan={5} className="r">Grand total · {ledger.length} {cust ? (ledger.length === 1 ? "customer" : "customers") : (ledger.length === 1 ? "supplier" : "suppliers")}</td>
                  <td className="r">{money(all.c)}</td>
                  <td className="r">{money(all.s)}</td>
                  <td className={`r ${neg(all.b)}`}>{money(all.b)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
