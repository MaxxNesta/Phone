"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { Paper } from "@/lib/receipt-config";

/**
 * The copy of a receipt that prints.
 *
 * Mounted straight into <body>, hidden on screen, and — while it is mounted —
 * the only thing on the page a printer sees (globals.css). The page rule is
 * the paper's: A4 gets an A4 sheet and margins; thermal paper gets no page
 * margin, and the receipt is laid out at the printer's own printable width,
 * since 58 mm and 80 mm printers do not all print the same width.
 *
 * Standard browser printing only: the browser's dialog chooses the printer.
 */
export function ReceiptPrintHost({ paper, children }: { paper: Paper; children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setReady(true);
    document.documentElement.setAttribute("data-receipt-print", "");
    return () => document.documentElement.removeAttribute("data-receipt-print");
  }, []);
  if (!ready) return null;
  const page = paper === "A4" ? "@page { size: A4; margin: 12mm 12mm 14mm; }" : "@page { margin: 0; }";
  return createPortal(
    <div className="receipt-print-host" data-paper={paper}>
      <style>{`@media print { ${page} }`}</style>
      {children}
    </div>,
    document.body,
  );
}
