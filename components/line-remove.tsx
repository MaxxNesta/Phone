"use client";

import { Trash2 } from "lucide-react";

/**
 * Takes a line off a document: a red bin, the same on every form with item
 * lines. Always available; removing the last line leaves the form empty,
 * ready for the next search or scan.
 */
export function LineRemove({ onClick, label = "Remove line", disabled }: { onClick: () => void; label?: string; disabled?: boolean }) {
  return (
    <button type="button" className="line-del" onClick={onClick} aria-label={label} title={label} disabled={disabled}>
      <Trash2 size={15} aria-hidden="true" />
    </button>
  );
}
