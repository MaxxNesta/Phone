"use client";

import { useEffect } from "react";
import { Printer } from "lucide-react";

/** The only interactive thing on a printed page, and it prints it. */
export function PrintButton() {
  return (
    <button type="button" className="tiny" onClick={() => window.print()}>
      <Printer size={13} aria-hidden="true" /> Print
    </button>
  );
}

/**
 * Opens the print dialog once, when the page is reached from a Receipt button.
 * The Print button stays on the page for the second copy, and for a browser
 * that declines to print without being asked.
 */
export function AutoPrint() {
  useEffect(() => {
    const t = window.setTimeout(() => window.print(), 400);
    return () => window.clearTimeout(t);
  }, []);
  return null;
}
