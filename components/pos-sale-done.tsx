"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Check, Printer, FileDown } from "lucide-react";
import { money } from "@/lib/format";
import type { ReceiptView } from "@/lib/receipt";
import { ReceiptSlip } from "./receipt-slip";
import { ReceiptPrintHost } from "./receipt-print";

/**
 * Shown the moment a counter sale posts: it says so plainly, previews the very
 * receipt that will print, and offers what a cashier does next. The sale is
 * already posted, so the way out is Done, not Cancel — nothing here can undo
 * it, and printing never posts anything again.
 *
 * The template decides the rest: whether Print is offered, whether the browser
 * is asked to print at once, and whether Save as PDF is offered.
 */
export function PosSaleDone({ view, logoUrl, onClose }: {
  view: ReceiptView; logoUrl: string | null; onClose: () => void;
}) {
  const sheet = useRef<HTMLDivElement>(null);
  const printRef = useRef<HTMLButtonElement>(null);
  const doneRef = useRef<HTMLButtonElement>(null);
  const { data, config, identity, paper } = view;
  const g = config.general;

  const print = (asPdf = false) => {
    // A PDF saved from the dialog takes the page title as its name.
    const title = document.title;
    if (asPdf) document.title = `Receipt ${data.docNo}`;
    window.print();
    document.title = title;
  };

  useEffect(() => {
    (printRef.current ?? doneRef.current)?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // Asked once, as the sheet opens; the browser may still decline or show its dialog.
    const auto = g.autoPrint ? window.setTimeout(() => window.print(), 350) : 0;
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); return; }
      if (e.key !== "Tab") return;
      // Keep Tab inside the sheet's buttons, as a sheet should.
      const buttons = [...(sheet.current?.querySelectorAll<HTMLButtonElement>(".sale-done-actions button") ?? [])];
      if (buttons.length === 0) return;
      const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
      e.preventDefault();
      const next = at < 0 ? 0 : (at + (e.shiftKey ? -1 : 1) + buttons.length) % buttons.length;
      buttons[next].focus();
    };
    document.addEventListener("keydown", key);
    return () => {
      window.clearTimeout(auto);
      document.removeEventListener("keydown", key);
      document.body.style.overflow = overflow;
    };
  }, [onClose, g.autoPrint]);

  const paidBy = data.paid.map((p) => p.name).join(" + ");
  const slip = <ReceiptSlip data={data} config={config} identity={identity} paper={paper} logoUrl={logoUrl} />;

  return (
    <>
      {createPortal(
        <div className="sale-done-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
          <div ref={sheet} className="sale-done" role="dialog" aria-modal="true" aria-labelledby="sale-done-title">
            <header className="sale-done-head">
              <span className="sale-done-check" aria-hidden="true"><Check size={26} strokeWidth={3} /></span>
              <h2 id="sale-done-title">Sale complete</h2>
              <p className="sale-done-sub">
                <span className="m">{data.docNo}</span> · {money(data.total)}
                {paidBy ? ` · ${paidBy}` : data.onAccount > 0.005 ? " · on account" : ""}
              </p>
            </header>

            <div className={`sale-done-paper rc-preview rc-preview-${paper}`} role="region" aria-label="Receipt preview">
              {slip}
            </div>

            <footer className="sale-done-actions">
              <button ref={doneRef} type="button" className="btn ghost" onClick={onClose}>Done</button>
              {g.allowPdf && (
                <button type="button" className="btn ghost" onClick={() => print(true)}
                  title="Opens the print dialog — choose “Save as PDF” there">
                  <FileDown size={17} aria-hidden="true" /> PDF
                </button>
              )}
              {g.showPrintButton && (
                <button ref={printRef} type="button" className="btn" onClick={() => print()}>
                  <Printer size={17} aria-hidden="true" /> Print
                </button>
              )}
            </footer>
          </div>
        </div>,
        document.body,
      )}
      <ReceiptPrintHost paper={paper}>{slip}</ReceiptPrintHost>
    </>
  );
}
