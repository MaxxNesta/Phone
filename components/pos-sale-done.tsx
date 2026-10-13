"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Check, Printer } from "lucide-react";
import { money } from "@/lib/format";
import type { ReceiptData } from "@/lib/receipt";
import { ReceiptSlip } from "./receipt-slip";

/**
 * Shown the moment a counter sale posts: it says so plainly, previews the very
 * receipt that will print, and offers the two things a cashier does next.
 * Print goes first in reach (focused, so Enter prints); Cancel and Escape put
 * it away. The sale is already posted either way: nothing here can undo it.
 */
export function PosSaleDone({ data, onClose }: { data: ReceiptData; onClose: () => void }) {
  const printRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    printRef.current?.focus();
    // While it is open the printed page is the receipt alone (see globals.css).
    document.documentElement.setAttribute("data-sale-open", "");
    const scrollY = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); return; }
      // Two buttons: keep Tab inside them, as a sheet should.
      if (e.key === "Tab") {
        const active = document.activeElement;
        if (e.shiftKey && active === printRef.current) { e.preventDefault(); cancelRef.current?.focus(); }
        else if (!e.shiftKey && active === cancelRef.current) { e.preventDefault(); printRef.current?.focus(); }
        else if (active !== printRef.current && active !== cancelRef.current) { e.preventDefault(); printRef.current?.focus(); }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      document.documentElement.removeAttribute("data-sale-open");
      document.body.style.overflow = scrollY;
    };
  }, [onClose]);

  const paidBy = data.paid.map((p) => p.name).join(" + ");

  return createPortal(
    <div className="sale-done-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sale-done" role="dialog" aria-modal="true" aria-labelledby="sale-done-title">
        <header className="sale-done-head">
          <span className="sale-done-check" aria-hidden="true"><Check size={26} strokeWidth={3} /></span>
          <h2 id="sale-done-title">Sale complete</h2>
          <p className="sale-done-sub">
            <span className="m">{data.docNo}</span> · {money(data.total)}
            {paidBy ? ` · ${paidBy}` : data.onAccount > 0.005 ? " · on account" : ""}
          </p>
        </header>

        <div className="sale-done-paper" role="region" aria-label="Receipt preview">
          <ReceiptSlip data={data} />
        </div>

        <footer className="sale-done-actions">
          <button ref={cancelRef} type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button ref={printRef} type="button" className="btn" onClick={() => window.print()}>
            <Printer size={17} aria-hidden="true" /> Print
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
