"use client";

import { useEffect, useRef } from "react";
import { ArrowRight, Package, User, Wallet, X } from "lucide-react";
import type { MoneyPreview } from "@/lib/refund";

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
const signed = (n: number) => (n > 0 ? "+" : n < 0 ? "−" : "") + fmt(Math.abs(n));
/** What a customer balance means in words: they owe, we owe, or square. */
const owes = (n: number) =>
  Math.abs(n) < 0.5 ? "Settled" : n > 0 ? `Owes ${fmt(n)}` : `Owed ${fmt(-n)}`;
const TYPE: Record<string, string> = { SALES_RETURN: "Customer return", CUSTOMER_REFUND: "Refund" };

/**
 * What a posting is about to do, as the engine itself worked it out (a dry
 * run, rolled back): where money goes, what each balance becomes, what comes
 * back on the shelf, and the ledger entries. Nothing is saved until Confirm.
 */
export function MoneyPreviewDialog({ preview, title, confirmLabel, busy, onConfirm, onClose }: {
  preview: MoneyPreview; title: string; confirmLabel: string; busy: boolean;
  onConfirm: () => void; onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  const p = preview;

  return (
    <dialog ref={ref} className="mp" onClose={onClose} aria-labelledby="mp-title">
      <header className="mp-head">
        <div>
          <h2 id="mp-title">{title}</h2>
          <p>Nothing is saved until you confirm.</p>
        </div>
        <button type="button" className="mp-x" aria-label="Close" onClick={() => ref.current?.close()}><X size={16} /></button>
      </header>

      <div className="mp-body">
        {p.refund && (
          <section className="mp-flow" aria-label="Money going back">
            <div className="mp-node">
              <span className="mp-ico wallet"><Wallet size={18} aria-hidden="true" /></span>
              <span><strong>{p.refund.channel}</strong><small>{p.refund.account}</small></span>
            </div>
            <div className="mp-arrow">
              <span className="mp-amount">{fmt(p.refund.amount)} <small>MMK</small></span>
              <ArrowRight size={18} aria-hidden="true" />
              {p.refund.reference && <small>ID {p.refund.reference}</small>}
            </div>
            <div className="mp-node">
              <span className="mp-ico"><User size={18} aria-hidden="true" /></span>
              <span><strong>{p.customer.name}</strong><small>Customer</small></span>
            </div>
          </section>
        )}

        <section className="mp-balances" aria-label="Balances">
          {p.cash.map((c) => (
            <div className="mp-bal" key={c.code}>
              <span className="mp-label">{c.code} · {c.name}</span>
              <span className="mp-move">{fmt(c.before)} <ArrowRight size={13} aria-hidden="true" /> <b>{fmt(c.after)}</b></span>
              <span className={`mp-delta ${c.after < c.before ? "out" : "in"}`}>{signed(c.after - c.before)}</span>
            </div>
          ))}
          <div className="mp-bal">
            <span className="mp-label">
              {p.customer.name}{p.customer.docNo ? ` · ${p.customer.docNo}` : " · on account"}
            </span>
            <span className="mp-move">{owes(p.customer.before)} <ArrowRight size={13} aria-hidden="true" /> <b>{owes(p.customer.after)}</b></span>
          </div>
        </section>

        {p.stock.length > 0 && (
          <section className="mp-stock" aria-label="Stock">
            <Package size={16} aria-hidden="true" />
            <span>
              Back on the shelf: {p.stock.map((s) => `${s.qty} × ${s.item}`).join(", ")}
              {p.stock[0] && <> at <b>{p.stock[0].location}</b></>}
            </span>
          </section>
        )}

        {!p.refund && p.refundableAfter > 0.5 && (
          <p className="mp-note">
            This leaves <b>{fmt(p.refundableAfter)} MMK</b> owed to the customer. Refund it now, or later from the return.
          </p>
        )}

        <details className="mp-ledger" open>
          <summary>Ledger entries</summary>
          {p.entries.map((e) => {
            const dr = e.lines.reduce((s, l) => s + l.debit, 0);
            const cr = e.lines.reduce((s, l) => s + l.credit, 0);
            return (
              <table key={e.docNo}>
                <caption>{TYPE[e.docType] ?? e.docType} <span className="m">{e.docNo}</span></caption>
                <thead><tr><th>Account</th><th className="r">Debit</th><th className="r">Credit</th></tr></thead>
                <tbody>
                  {e.lines.map((l) => (
                    <tr key={l.code + l.debit + l.credit}>
                      <td><span className="m">{l.code}</span> {l.name}</td>
                      <td className="r">{l.debit ? fmt(l.debit) : ""}</td>
                      <td className="r">{l.credit ? fmt(l.credit) : ""}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr><td>Total</td><td className="r">{fmt(dr)}</td><td className="r">{fmt(cr)}</td></tr></tfoot>
              </table>
            );
          })}
        </details>
      </div>

      <footer className="mp-foot">
        <button type="button" className="btn ghost" onClick={() => ref.current?.close()} disabled={busy}>Back</button>
        <button type="button" className="btn" onClick={onConfirm} disabled={busy} autoFocus>
          {busy ? "Posting…" : confirmLabel}
        </button>
      </footer>
    </dialog>
  );
}
