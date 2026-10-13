import { Fragment } from "react";
import { money, shortDate } from "@/lib/format";
import type { ReceiptData } from "@/lib/receipt";

/**
 * The receipt itself: what the receipt page prints and what the sale popup
 * previews. One component, so what is shown is what comes out of the printer.
 * No hooks and no server imports, so a client component may draw it too.
 */
export function ReceiptSlip({ data: r }: { data: ReceiptData }) {
  return (
    <div className="receipt">
      <h1>{r.company}</h1>
      <p>{r.location} · {shortDate(r.date)}</p>
      <p>
        Receipt <strong>{r.docNo}{r.version > 1 ? ` v${r.version}` : ""}</strong>
        {r.status === "REVERSED" && " — VOIDED"}
      </p>
      <p>Customer: {r.customer}{r.salesman ? ` · Sold by ${r.salesman}` : ""}</p>
      <table>
        <thead><tr><th>Item</th><th className="num">Qty</th><th className="num">Amount</th></tr></thead>
        <tbody>
          {r.lines.map((l) => (
            <tr key={l.lineNo}>
              <td>
                {l.name}
                {l.imeis && <div className="m">IMEI {l.imeis}</div>}
                {l.warrantyMonths ? <div>Warranty {l.warrantyMonths} months</div> : null}
                {l.discountPct > 0 && <div>Discount {l.discountPct}%</div>}
                {l.freeReason && <div>FREE · {l.freeReason}</div>}
              </td>
              <td className="num">{l.qty}</td>
              <td className="num">{l.freeReason ? "FREE" : money(l.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <dl className="pos-totals">
        <dt>Subtotal</dt><dd className="num">{money(r.subtotal)}</dd>
        {r.discount > 0.005 && <><dt>Discount</dt><dd className="num">-{money(r.discount)}</dd></>}
        {r.freeCount > 0 && (
          <><dt>Free items ({r.freeCount})</dt>
            <dd className="num">{r.freeValue > 0 ? `${money(r.freeValue)} not charged` : "not charged"}</dd></>
        )}
        <dt>Net</dt><dd className="num">{money(r.net)}</dd>
        <dt>Tax</dt><dd className="num">{money(r.tax)}</dd>
        <dt className="pos-grand">Total</dt><dd className="num pos-grand">{money(r.total)}</dd>
        {r.paid.map((p, i) => <Fragment key={i}><dt>Paid · {p.name}</dt><dd className="num">{money(p.amount)}</dd></Fragment>)}
        {r.onAccount > 0.005 && <><dt>On account</dt><dd className="num">{money(r.onAccount)}</dd></>}
      </dl>
      {r.cashier && <p>Served by {r.cashier}</p>}
    </div>
  );
}
