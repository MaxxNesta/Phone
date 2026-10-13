import { Fragment } from "react";
import { money, shortDate } from "@/lib/format";
import {
  maskImei, type Paper, type ReceiptConfig, type ReceiptData, type ReceiptIdentity,
} from "@/lib/receipt-config";

/**
 * The receipt: what the till previews, the receipt page prints, and the
 * template editor shows. One component, so what is previewed is what prints.
 * No hooks and no server imports, so the browser and the server both draw it.
 *
 * Every text a template supplies is plain text (React escapes it). The receipt
 * number, date, the items, the grand total, any tax charged and VOIDED always
 * print, whatever the template says.
 */
export function ReceiptSlip({ data: r, config: c, identity: id, paper, logoUrl, sample }: {
  data: ReceiptData; config: ReceiptConfig; identity: ReceiptIdentity; paper: Paper;
  logoUrl?: string | null; sample?: boolean;
}) {
  const imei = (s: string) => (c.product.imeiMode === "masked" ? maskImei(s) : s);
  const name = c.identity.displayName || id.companyName;
  const cls = [
    "rc", paper === "A4" ? "rc-a4" : `rc-thermal rc-${paper}`, `rc-fs-${c.style.fontSize}`,
    `rc-align-${c.style.headerAlign}`, `rc-line-${c.style.lineStyle}`, `rc-${c.style.density}`,
  ].join(" ");
  const style = paper === "A4" ? undefined : ({ "--rc-width": `${c.general.printableWidthMm}mm` } as React.CSSProperties);
  const showTax = r.tax !== 0 || c.transaction.showTaxWhenZero;
  const when = `${shortDate(r.date)}${r.time ? ` ${r.time}` : ""}`;
  const t = c.transaction, p = c.product;

  const header = (
    <header className="rc-head">
      {c.identity.showLogo && id.hasLogo && logoUrl && <img className="rc-logo" src={logoUrl} alt="" />}
      <div className="rc-name">{name}</div>
      {c.identity.showBranchName && id.branchName && <div>{id.branchName}</div>}
      {c.identity.showAddress && id.address && <div className="rc-pre">{id.address}</div>}
      {c.identity.showPhone && id.phone && <div>Tel: {id.phone}</div>}
      {c.identity.extraContact && <div className="rc-pre">{c.identity.extraContact}</div>}
      {c.custom.headerText && <div className="rc-pre rc-note">{c.custom.headerText}</div>}
    </header>
  );

  const meta: Array<[string, string]> = [
    ["Receipt", `${r.docNo}${r.version > 1 ? ` v${r.version}` : ""}`],
    ["Date", when],
    ...(t.showCashier && r.cashier ? [["Cashier", r.cashier] as [string, string]] : []),
    ...(t.showSalesman && r.salesman ? [["Sold by", r.salesman] as [string, string]] : []),
    ...(t.showCustomer && r.customer ? [["Customer", r.customer] as [string, string]] : []),
    ...(t.showPaymentMethod ? [["Payment", r.paymentMethod] as [string, string]] : []),
  ];

  const lineDetails = (l: ReceiptData["lines"][number]) => (
    <>
      {p.showVariant && l.variant && <div className="rc-sub">{l.variant}</div>}
      {p.showImei && l.imeis.map((s) => <div key={s} className="rc-sub rc-imei">IMEI {imei(s)}</div>)}
      {c.warranty.show && l.warrantyMonths ? (
        <div className="rc-sub">
          {c.warranty.showPeriod && <>Warranty {l.warrantyMonths} month{l.warrantyMonths === 1 ? "" : "s"}</>}
          {c.warranty.showDates && l.warrantyEnd && <>{c.warranty.showPeriod ? " · " : "Warranty "}{shortDate(r.date)} – {shortDate(l.warrantyEnd)}</>}
        </div>
      ) : null}
      {p.showDiscount && l.discountPct > 0 && !l.freeReason && <div className="rc-sub">Discount {l.discountPct}%</div>}
      {l.freeReason && <div className="rc-sub">FREE · {l.freeReason}</div>}
    </>
  );
  const itemName = (l: ReceiptData["lines"][number]) => (p.showVariant && l.variant ? l.productName : l.itemName);

  const totals = (
    <dl className="rc-totals">
      {t.showSubtotal && <><dt>Subtotal</dt><dd>{money(r.subtotal)}</dd></>}
      {t.showDiscounts && r.discount > 0.005 && <><dt>Discount</dt><dd>-{money(r.discount)}</dd></>}
      {r.freeCount > 0 && (
        <><dt>Free items ({r.freeCount})</dt><dd>{r.freeValue > 0 ? `${money(r.freeValue)} not charged` : "not charged"}</dd></>
      )}
      {showTax && <><dt>Tax</dt><dd>{money(r.tax)}</dd></>}
      <dt className="rc-grand">Total</dt><dd className="rc-grand">{money(r.total)}</dd>
      {t.showPaymentBreakdown && r.paid.map((x, i) => (
        <Fragment key={i}><dt>Paid · {x.name}</dt><dd>{money(x.amount)}</dd></Fragment>
      ))}
      {r.onAccount > 0.005 && <><dt>On account</dt><dd>{money(r.onAccount)}</dd></>}
    </dl>
  );

  const footer = (
    <footer className="rc-foot">
      {c.warranty.show && c.warranty.policyText && <div className="rc-pre rc-policy">{c.warranty.policyText}</div>}
      {c.custom.returnPolicy && <div className="rc-pre rc-policy">{c.custom.returnPolicy}</div>}
      {c.custom.thankYou && <div className="rc-pre rc-thanks">{c.custom.thankYou}</div>}
      {c.custom.footerText && <div className="rc-pre">{c.custom.footerText}</div>}
    </footer>
  );

  if (paper === "A4") {
    return (
      <div className={cls}>
        {sample && <div className="rc-sample">Sample data — not a sale</div>}
        {r.status === "REVERSED" && <div className="rc-void">VOIDED</div>}
        <div className="rc-a4-top">
          {header}
          <div className="rc-a4-doc">
            <div className="rc-a4-title">Receipt</div>
            <dl className="rc-meta">{meta.map(([k, v]) => <Fragment key={k}><dt>{k}</dt><dd>{v}</dd></Fragment>)}</dl>
          </div>
        </div>
        <table className="rc-table">
          <thead>
            <tr>
              <th>#</th><th>Item</th>
              {p.showQuantity && <th className="rc-num">Qty</th>}
              {p.showUnitPrice && <th className="rc-num">Unit price</th>}
              {p.showLineTotal && <th className="rc-num">Amount</th>}
            </tr>
          </thead>
          <tbody>
            {r.lines.map((l, i) => (
              <tr key={l.lineNo}>
                <td>{i + 1}</td>
                <td><div className="rc-item">{itemName(l)}</div>{lineDetails(l)}</td>
                {p.showQuantity && <td className="rc-num">{l.qty}</td>}
                {p.showUnitPrice && <td className="rc-num">{l.freeReason ? "—" : money(l.unitPrice)}</td>}
                {p.showLineTotal && <td className="rc-num">{l.freeReason ? "FREE" : money(l.amount)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
        <div className="rc-a4-end">{totals}</div>
        {footer}
      </div>
    );
  }

  return (
    <div className={cls} style={style}>
      {sample && <div className="rc-sample">Sample data — not a sale</div>}
      {header}
      <hr className="rc-rule" />
      {r.status === "REVERSED" && <div className="rc-void">VOIDED</div>}
      <dl className="rc-meta">{meta.map(([k, v]) => <Fragment key={k}><dt>{k}</dt><dd>{v}</dd></Fragment>)}</dl>
      <hr className="rc-rule" />
      <div className="rc-lines">
        {r.lines.map((l) => (
          <div key={l.lineNo} className="rc-line">
            <div className="rc-item">{itemName(l)}</div>
            {lineDetails(l)}
            <div className="rc-row">
              <span>
                {p.showQuantity && <>{l.qty}{p.showUnitPrice && !l.freeReason ? ` × ${money(l.unitPrice)}` : ""}</>}
              </span>
              {p.showLineTotal && <span className="rc-amt">{l.freeReason ? "FREE" : money(l.amount)}</span>}
            </div>
          </div>
        ))}
      </div>
      <hr className="rc-rule" />
      {totals}
      <hr className="rc-rule" />
      {footer}
    </div>
  );
}
