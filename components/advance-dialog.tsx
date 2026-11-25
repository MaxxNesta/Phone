"use client";

import { useEffect, useRef } from "react";
import { Wallet } from "lucide-react";

const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });

/**
 * The popup an advance is decided in (2026-11-25), so nobody opens the
 * advance form for it: the figures, a sentence saying in so many words what
 * becomes (or pays) an advance for whom, and the buttons that post.
 */
export function AdvanceDialog({
  open, title, rows, note, primary, onPrimary, secondary, onSecondary, onCancel, unit = "MMK",
}: {
  open: boolean;
  title: React.ReactNode;
  /** Label, amount; the last one marked `strong` is the one this is about. */
  rows: { label: string; amount: number; strong?: boolean }[];
  note: React.ReactNode;
  primary: string;
  onPrimary: () => void;
  secondary?: string;
  onSecondary?: () => void;
  onCancel: () => void;
  unit?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog ref={ref} className="confirm adv-dialog"
      onCancel={(e) => { e.preventDefault(); onCancel(); }}
      onClick={(e) => { if (e.target === ref.current) onCancel(); }}>
      <div className="confirm-panel">
        <div className="confirm-icon adv-dialog-icon" aria-hidden="true"><Wallet size={19} strokeWidth={2.25} /></div>
        <h2 className="confirm-title">{title}</h2>
        <dl className="adv-dialog-rows">
          {rows.map((r) => (
            <div key={r.label} className={r.strong ? "strong" : undefined}>
              <dt>{r.label}</dt><dd>{fmt(r.amount)} <small>{unit}</small></dd>
            </div>
          ))}
        </dl>
        <p className="confirm-detail">{note}</p>
        <div className="confirm-actions">
          <button type="button" className="ghost" onClick={onCancel}>Go back</button>
          {secondary && onSecondary && <button type="button" className="ghost" onClick={onSecondary}>{secondary}</button>}
          <button type="button" onClick={onPrimary}>{primary}</button>
        </div>
      </div>
    </dialog>
  );
}
