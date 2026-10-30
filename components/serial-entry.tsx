"use client";

import { useRef, useState } from "react";
import { ChevronDown, FileUp, ScanLine, X, ChevronUp } from "lucide-react";

export type ScannedSerial = { serial: string; imei2?: string | null };

/**
 * IMEI entry for one form line, as a token field: the IMEIs chosen sit as
 * tokens inside the box and the cursor waits after them for the next scan.
 * A barcode scanner types the number and presses Enter, so each Enter adds a
 * unit; a pasted list works the same way. "IMEI1 IMEI2" (space, comma or tab)
 * on one line records a dual-SIM phone's second IMEI when `withImei2` is on.
 *
 * The units on this shelf are offered, not spread across the form: typing a
 * few digits shows the matching ones, and "on this shelf" opens the list.
 *
 * Checked here only for what the form can see — the count against the
 * quantity, and repeats within this line. Whether an IMEI exists, is free or
 * is on this shelf is the server's answer.
 */
export function SerialEntry({ qty, value, onChange, withImei2 = false, label, suggestions, onDone }: {
  qty: number;
  value: ScannedSerial[];
  onChange: (v: ScannedSerial[]) => void;
  withImei2?: boolean;
  label: string;
  /** IMEIs to offer with one tap — the units on this shelf, or on that invoice. */
  suggestions?: string[];
  /** Folds the entry away; offered once every unit is named. */
  onDone?: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [browsing, setBrowsing] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);

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
  // Three digits are enough to narrow a shelf; the list is what the shelf holds.
  const typed = draft.trim();
  const matches = typed.length >= 3 ? offered.filter((s) => s.includes(typed)).slice(0, 6) : [];
  const list = browsing ? offered : matches;
  const pick = (s: string) => { add(s); setBrowsing(false); input.current?.focus(); };

  const n = value.length;
  return (
    <div className="serialentry">
      <div className="serialentry-head">
        <strong>{label}</strong>
        <span className={`pill ${qty > 0 && !short ? "ok" : "warn"}`} aria-live="polite">
          {qty > 0 ? `${n} of ${qty}` : `${n} scanned`}
        </span>
        <span className="serialentry-tools">
          {onDone && n > 0 && !short && (
            <button type="button" className="serialentry-done" onClick={onDone}><ChevronUp size={15} aria-hidden="true" /> Collapse</button>
          )}
        </span>
      </div>

      <div className="serialentry-field" onClick={() => input.current?.focus()}>
        <ScanLine size={16} aria-hidden="true" />
        <textarea
          ref={input}
          rows={1}
          value={draft}
          aria-label={`${label}: scan or type, Enter after each`}
          placeholder={n === 0 ? (withImei2 ? "Scan, type or paste IMEIs (and IMEI 2)" : "Scan, type or paste IMEIs") : ""}
          onChange={(e) => {
            // A paste of several lines arrives at once.
            if (e.target.value.includes("\n")) add(e.target.value);
            else setDraft(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              // One match left for what was typed: take it.
              if (matches.length === 1 && typed.length < 15) pick(matches[0]);
              else if (typed) add(draft);
            } else if (e.key === "Backspace" && !draft && n > 0) {
              remove(value[n - 1].serial);
            } else if (e.key === "Escape") setBrowsing(false);
          }}
          onBlur={() => { if (typed && !matches.length) add(draft); }}
        />
        <label className="serialentry-icon" title="Import a CSV of IMEIs" onClick={(e) => e.stopPropagation()}>
          <FileUp size={15} aria-hidden="true" />
          <span className="sr-only">Import CSV</span>
          <input type="file" accept=".csv,.txt,text/csv,text/plain" hidden
            onChange={(e) => { const f = e.target.files?.[0]; if (f) importCsv(f); e.target.value = ""; }} />
        </label>
      </div>

      {n > 0 && (
        <div className="serialentry-tokens">
          {value.map((s) => (
            <span key={s.serial} className="serialentry-token">
              <span className="m">{s.serial}{s.imei2 ? ` / ${s.imei2}` : ""}</span>
              <button type="button" onClick={() => remove(s.serial)} aria-label={`Remove ${s.serial}`}>
                <X size={13} aria-hidden="true" />
              </button>
            </span>
          ))}
        </div>
      )}

      {offered.length > 0 && (
        <div className="serialentry-offer">
          <button type="button" className="serialentry-browse" aria-expanded={browsing}
            onClick={() => setBrowsing((b) => !b)}>
            {offered.length} on this shelf <ChevronDown size={14} aria-hidden="true" />
          </button>
          {list.length > 0 && (
            <ul className="serialentry-menu" role="listbox" aria-label="IMEIs on this shelf">
              {list.slice(0, 40).map((s) => (
                <li key={s}>
                  <button type="button" role="option" aria-selected={false} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(s)}>
                    <span className="m">{s}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
