"use client";

import { useRef, useState } from "react";
import { ScanLine, ClipboardPaste, FileUp, Trash2, CheckCircle2 } from "lucide-react";

export type UnitRow = { serial: string; imei2?: string | null; deviceSerial?: string | null };

/** Luhn, the check digit every IMEI carries in its fifteenth place. */
export function imeiCheckOk(v: string) {
  if (!/^\d{15}$/.test(v)) return false;
  let sum = 0;
  for (let i = 0; i < 15; i++) {
    let d = Number(v[14 - i]);
    if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return sum % 10 === 0;
}

type Status = { ok: boolean; label: string };

/**
 * What one row says about itself. A fifteen-digit number whose check digit
 * is wrong is a typo and stops the receipt; anything that is not fifteen
 * digits is taken as a serial number — an iPad without cellular has a serial
 * and no IMEI, and it is still one unit with one name.
 */
function statusOf(row: UnitRow, all: UnitRow[]): Status | null {
  const v = row.serial.trim();
  if (!v) return null;
  const twice = all.filter((r) => r.serial.trim() === v || r.imei2?.trim() === v).length > 1;
  if (twice) return { ok: false, label: "Repeated" };
  if (/^\d{15}$/.test(v)) return imeiCheckOk(v) ? { ok: true, label: "Valid" } : { ok: false, label: "Check digit wrong" };
  if (/^\d+$/.test(v)) return { ok: false, label: `${v.length} digits, IMEI has 15` };
  return { ok: true, label: "Serial" };
}

export function rowsProblem(rows: UnitRow[]) {
  return rows.some((r) => statusOf(r, rows)?.ok === false)
    || rows.some((r) => r.imei2 && /^\d{15}$/.test(r.imei2.trim()) && !imeiCheckOk(r.imei2.trim()));
}

/**
 * The units on one receipt line, one row each: IMEI 1, IMEI 2, the maker's
 * serial. Three ways in: Scan mode (a barcode scanner types and presses
 * Enter, which moves to the next empty row), Paste list (one phone per line,
 * "IMEI1 IMEI2 serial") and a CSV in the same column order.
 */
export function ImeiPanel({ title, qty, rows, onChange }: {
  title: string;
  qty: number;
  rows: UnitRow[];
  onChange: (rows: UnitRow[]) => void;
}) {
  const [pasting, setPasting] = useState(false);
  const [paste, setPaste] = useState("");
  const table = useRef<HTMLTableSectionElement>(null);
  const filled = rows.filter((r) => r.serial.trim()).length;

  // Always one row per unit received, keeping what is typed.
  const padded: UnitRow[] = Array.from({ length: Math.max(qty, 0) },
    (_, i) => rows[i] ?? { serial: "", imei2: "", deviceSerial: "" });

  const set = (i: number, patch: Partial<UnitRow>) =>
    onChange(padded.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const focusCell = (i: number) => {
    const el = table.current?.querySelector<HTMLInputElement>(`input[data-row="${i}"][data-col="0"]`);
    el?.focus();
  };
  const scanMode = () => {
    const i = padded.findIndex((r) => !r.serial.trim());
    focusCell(i === -1 ? 0 : i);
  };

  // Fills empty rows first, in order; a list longer than the quantity stops.
  const take = (text: string) => {
    const parsed = text.split(/\r?\n/)
      .map((r) => r.split(/[,;\t]|\s+/).map((c) => c.trim().replace(/^"|"$/g, "")).filter(Boolean))
      .filter((c) => c.length && /\d/.test(c[0]));
    const next = [...padded];
    let at = 0;
    for (const c of parsed) {
      while (at < next.length && next[at].serial.trim()) at++;
      if (at >= next.length) break;
      next[at] = { serial: c[0], imei2: c[1] ?? "", deviceSerial: c[2] ?? "" };
    }
    onChange(next);
  };

  return (
    <div className="imeipanel">
      <div className="imeipanel-head">
        <div>
          <h3>IMEI entry — {title}</h3>
          <span className="subline">
            Receive quantity: <strong className={filled === qty && qty > 0 ? "ok-qty" : "low"}>{filled} / {qty} entered</strong>
            {filled === qty && qty > 0 && <CheckCircle2 size={15} className="ok-qty" aria-hidden="true" />}
          </span>
        </div>
        <div className="imeipanel-tools">
          <button type="button" className="dt-tool" onClick={scanMode}><ScanLine size={15} aria-hidden="true" /> Scan mode</button>
          <button type="button" className="dt-tool" onClick={() => setPasting((v) => !v)} aria-expanded={pasting}>
            <ClipboardPaste size={15} aria-hidden="true" /> Paste list
          </button>
          <label className="dt-tool">
            <FileUp size={15} aria-hidden="true" /> Import CSV
            <input type="file" accept=".csv,.txt,text/csv,text/plain" hidden
              onChange={async (e) => { const f = e.target.files?.[0]; if (f) take(await f.text()); e.target.value = ""; }} />
          </label>
        </div>
      </div>

      {pasting && (
        <div className="imeipanel-paste">
          <textarea value={paste} onChange={(e) => setPaste(e.target.value)} rows={4}
            placeholder={"One phone per line: IMEI 1, IMEI 2, serial\n356789123456789 356789123456797 C6KJ2A1234"} />
          <div className="actions">
            <button type="button" onClick={() => { take(paste); setPaste(""); setPasting(false); }}>Add to list</button>
            <button type="button" className="ghost" onClick={() => setPasting(false)}>Cancel</button>
          </div>
        </div>
      )}

      {qty > 0 ? (
        <div className="tablewrap">
          <table className="imeitable">
            <thead>
              <tr><th className="r">#</th><th>IMEI 1</th><th>IMEI 2</th><th>Serial no.</th><th>Status</th><th /></tr>
            </thead>
            <tbody ref={table}>
              {padded.map((r, i) => {
                const st = statusOf(r, padded);
                const imei2Bad = !!r.imei2 && /^\d{15}$/.test(r.imei2.trim()) && !imeiCheckOk(r.imei2.trim());
                return (
                  <tr key={i}>
                    <td className="r subline">{i + 1}</td>
                    <td>
                      <input type="text" inputMode="numeric" value={r.serial} data-row={i} data-col={0}
                        aria-label={`IMEI 1, unit ${i + 1}`} autoComplete="off"
                        onChange={(e) => set(i, { serial: e.target.value })}
                        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); focusCell(i + 1); } }} />
                    </td>
                    <td>
                      <input type="text" inputMode="numeric" value={r.imei2 ?? ""} aria-label={`IMEI 2, unit ${i + 1}`}
                        autoComplete="off" onChange={(e) => set(i, { imei2: e.target.value })}
                        style={imei2Bad ? { borderColor: "var(--bad)" } : undefined} />
                    </td>
                    <td>
                      <input type="text" value={r.deviceSerial ?? ""} aria-label={`Serial number, unit ${i + 1}`}
                        autoComplete="off" onChange={(e) => set(i, { deviceSerial: e.target.value })} />
                    </td>
                    <td>
                      {st ? <span className={`pill ${st.ok && !imei2Bad ? "ok" : "overdue"}`}>{imei2Bad ? "IMEI 2 check digit" : st.label}</span>
                        : <span className="subline">—</span>}
                    </td>
                    <td className="tight">
                      <button type="button" className="danger tiny" aria-label={`Clear unit ${i + 1}`}
                        onClick={() => set(i, { serial: "", imei2: "", deviceSerial: "" })}>
                        <Trash2 size={15} aria-hidden="true" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="subline" style={{ padding: "0 16px 16px" }}>Enter the receive quantity first — one row appears per phone.</p>
      )}
    </div>
  );
}
