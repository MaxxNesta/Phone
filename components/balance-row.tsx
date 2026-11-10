"use client";

import Link from "next/link";
import { Fragment, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { money, shortDate } from "@/lib/format";
import type { OpenBill } from "@/lib/queries";

/**
 * A partner's line on Payables or Receivables that opens to its open
 * invoices: each with what was paid in money, what an advance covered, what
 * is left, and a button that opens the pay screen with that bill filled in.
 * Under them, the two things people come here to do: settle everything, or
 * use the advance already on account.
 */
export function BalanceRow({ cols, bills, partnerId, advance, kind, children }: {
  cols: number; bills: OpenBill[]; partnerId: string; advance: number; kind: "pay" | "receive";
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const pay = kind === "pay";
  const base = pay ? "/payables/pay" : "/receivables/receive";
  const owed = bills.reduce((t, b) => t + b.outstanding, 0);
  const can = bills.length > 0;
  return (
    <Fragment>
      <tr className={`link bal-row${open ? " open" : ""}`} onClick={(e) => {
        // The row opens; links and buttons inside it keep doing their own thing.
        if (can && !(e.target as HTMLElement).closest("a,button")) setOpen(!open);
      }}>
        <td className="bal-chev">
          {can && (
            <button type="button" className="vicon" aria-expanded={open}
              aria-label={`${open ? "Hide" : "Show"} open ${pay ? "bills" : "invoices"}`} onClick={() => setOpen(!open)}>
              {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            </button>
          )}
        </td>
        {children}
      </tr>
      {open && (
        <tr className="bal-detail">
          <td />
          <td colSpan={cols - 1}>
            <div className="bal-box">
              <table className="bal-bills">
                <thead>
                  <tr>
                    <th>{pay ? "Bill" : "Invoice"}</th><th>Date</th><th>Due</th>
                    <th className="r">Total</th><th className="r">Paid</th><th className="r">Adv. applied</th>
                    <th className="r">Outstanding</th><th />
                  </tr>
                </thead>
                <tbody>
                  {bills.map((b) => (
                    <tr key={b.id}>
                      <td><Link href={`/documents/${b.id}`} className="m">{b.doc_no}</Link></td>
                      <td className="m">{shortDate(b.date)}</td>
                      <td className="m">
                        {b.due ? shortDate(b.due) : "—"}
                        {b.late !== null && b.late > 0 && <span className="pill overdue bal-late">{b.late}d late</span>}
                      </td>
                      <td className="r">{money(b.total)}</td>
                      <td className="r">{b.paid > 0.005 ? money(b.paid) : "—"}</td>
                      <td className="r">{b.adv > 0.005 ? <span className="bal-adv">{money(b.adv)}</span> : "—"}</td>
                      <td className="r"><strong>{money(b.outstanding)}</strong></td>
                      <td className="tight">
                        <Link href={`${base}?partner=${partnerId}&invoice=${b.id}`} className="btn ghost tiny">{pay ? "Pay" : "Receive"}</Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="bal-actions">
                <Link href={`${base}?partner=${partnerId}&all=1`} className="btn tiny">
                  {pay ? "Pay all" : "Receive all"} {bills.length} · {money(owed)}
                </Link>
                {advance > 0.005 && (
                  <Link href={`${base}?partner=${partnerId}&advance=1`} className="btn ghost tiny">
                    Use advance · {money(Math.min(advance, owed))} of {money(advance)} on account
                  </Link>
                )}
              </div>
            </div>
          </td>
        </tr>
      )}
    </Fragment>
  );
}
