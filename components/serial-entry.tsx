"use client";

import { useState } from "react";
import { FileUp, ScanLine, X } from "lucide-react";

export type ScannedSerial = { serial: string; imei2?: string | null };

/**
 * IMEI entry for one form line. A barcode scanner types the number and
 * presses Enter, so each Enter adds a unit; a pasted list works the same way.
 * "IMEI1 IMEI2" (space, comma or tab) on one line records a dual-SIM phone's
 * second IMEI when `withImei2` is on.
 *
 * Checked here only for what the form can see — the count against the
 * quantity, and repeats within this line. Whether an IMEI exists, is free or
 * is on this shelf is the server's answer.
 */
export function SerialEntry({ qty, value, onChange, withImei2 = false, label, suggestions }: {
  qty: number;
  value: ScannedSerial[];
  onChange: (v: ScannedSerial[]) => void;
  withImei2?: boolean;
  label: string;
  /** IMEIs to offer with one tap — the units on this shelf, or on that invoice. */
  suggestions?: string[];
}) {
  const [draft, setDraft] = useState("");

  const add = (text: string) => {
    const next = [...value];
    for (const row of text.split(/\r?\n/)) {
      const parts = row.split(/[\s,;]+/).map((p) => p.trim()).filter(Boolean);
      if (parts.length === 0) continue;
      if (withImei2) {
        if (!next.some((s) => s.serial === parts[0])) next.push({ serial: parts[0], imei2: parts[1] ?? null });
      } else {
        for (const p of parts) if (!next.some((s) => s.serial === p)) next.push({ serial: p });
      }
    }
    onChange(next);
    setDraft("");
  };

  /* A CSV from the supplier's packing list: one phone per row, IMEI first
     (IMEI 2 second, where the form takes it). Rows with no digit in the
     first cell are headers and are skipped. */
  const importCsv = async (file: File) => {
    const rows = (await file.text()).split(/\r?\n/)
      .map((r) => r.split(/[,;\t]/).map((c) => c.trim().replace(/^"|"$/g, "")))
      .filter((c) => /\d/.test(c[0] ?? ""))
      .map((c) => (withImei2 && c[1] ? `${c[0]} ${c[1]}` : c[0]));
    add(rows.join("\n"));
  };

  const remove = (serial: string) => onChange(value.filter((s) => s.serial !== serial));
  const short = qty > 0 && value.length !== qty;
  const offered = (suggestions ?? []).filter((s) => !value.some((v) => v.serial === s));

  const n = value.length;
  return (
    <div className="serialentry">
      <div className="serialentry-head">
        <strong>{label}</strong>
        <span className={`pill ${qty > 0 && !short ? "ok" : "warn"}`} aria-live="polite">
          {qty > 0 ? `${n} of ${qty}` : `${n} scanned`}
        </span>
        <label className="btn ghost tiny serialentry-csv">
          <FileUp size={14} aria-hidden="true" /> Import CSV
          <input type="file" accept=".csv,.txt,text/csv,text/plain" hidden
            onChange={(e) => { const f = e.target.files?.[0]; if (f) importCsv(f); e.target.value = ""; }} />
        </label>
      </div>
      <div className="serialentry-input">
        <ScanLine size={16} aria-hidden="true" />
        <textarea
          rows={1}
          value={draft}
          aria-label={`${label}: scan or type, Enter after each`}
          placeholder={withImei2 ? "Scan or type an IMEI (and IMEI 2)" : "Scan or type an IMEI"}
          onChange={(e) => {
            // A paste of several lines arrives at once.
            if (e.target.value.includes("\n")) add(e.target.value);
            else setDraft(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); if (draft.trim()) add(draft); }
          }}
          onBlur={() => { if (draft.trim()) add(draft); }}
        />
      </div>
      <p className="serialentry-hint">Press Enter after each, or paste a list.</p>
      {n > 0 && (
        <ul className="serialentry-list">
          {value.map((s) => (
            <li key={s.serial}>
              <span className="m">{s.serial}{s.imei2 ? ` / ${s.imei2}` : ""}</span>
              <button type="button" onClick={() => remove(s.serial)} aria-label={`Remove ${s.serial}`}>
                <X size={13} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {offered.length > 0 && (
        <div className="serialentry-offer">
          <span className="serialentry-hint">On this shelf — tap to add</span>
          <div>
            {offered.slice(0, 40).map((s) => (
              <button type="button" key={s} className="chip" onClick={() => add(s)}>{s}</button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
