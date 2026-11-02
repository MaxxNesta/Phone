"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight } from "lucide-react";
import { ExportCsvButton } from "./export-csv";

export type DetailLine = {
  date: string; docId: string | null; docNo: string | null; entryNo: string;
  contra: { account: string; amount: number }[]; text: string; debit: number; credit: number;
};
export type DetailBlock = {
  key: string; accountCode: string; accountName: string; partnerName: string | null; split: boolean;
  opening: number; debits: number; credits: number; closing: number; lines: DetailLine[];
};

const money = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });
const fig = (n: number) => (n ? money(n) : "");
/** A balance as the books read it: debit or credit, never a minus sign. */
const bal = (n: number) => (n === 0 ? "0" : `${money(Math.abs(n))} ${n > 0 ? "Dr" : "Cr"}`);

/**
 * General Ledger Details [Account], as the legacy books print it, with each
 * account's block behind a tinted header that folds it to one line: code,
 * name, how many movements and the closing balance. Under each open block,
 * the total, the opening brought down on its own side and the closing carried
 * down on the other, so the block balances the way the old report's did.
 */
export function LedgerDetails({ blocks, title, allHref }: { blocks: DetailBlock[]; title: string; allHref: string | null }) {
  const [shut, setShut] = useState<Set<string>>(new Set());
  const toggle = (k: string) => setShut((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const allShut = blocks.length > 0 && shut.size === blocks.length;
  const name = (b: DetailBlock) => `${b.accountName}${b.split ? ` – ${b.partnerName ?? "No customer or supplier"}` : ""}`;
  // The export is this layout: each block's lines, then its total, opening and closing.
  const csv: (string | number)[][] = [["Account code", "Account", "Date", "Document", "Account name (other side)", "Description", "Debit", "Credit"],
    ...blocks.flatMap((b) => [
      ...b.lines.map((l) => [b.accountCode, name(b), l.date, l.docNo ?? l.entryNo, l.contra.map((c) => c.account).join(" / "), l.text, l.debit || "", l.credit || ""]),
      [b.accountCode, name(b), "", "", "", "Total", b.debits, b.credits],
      [b.accountCode, name(b), "", "", "", "Opening", b.opening > 0 ? b.opening : "", b.opening < 0 ? -b.opening : ""],
      [b.accountCode, name(b), "", "", "", "Closing", b.closing < 0 ? -b.closing : "", b.closing > 0 ? b.closing : ""],
    ])];

  return (
    <section className="card ledger-details">
      <div className="card-head"><h2>General ledger details · {title}</h2>
        <span className="actions">
          <span className="page-sub">{blocks.length} block{blocks.length === 1 ? "" : "s"}</span>
          {blocks.length > 0 && (
            <button type="button" className="btn ghost tiny"
              onClick={() => setShut(allShut ? new Set() : new Set(blocks.map((b) => b.key)))}>
              {allShut ? "Expand all" : "Collapse all"}
            </button>
          )}
          {allHref && <Link href={allHref} className="btn ghost tiny">All accounts</Link>}
          <ExportCsvButton name="general-ledger-details" rows={csv} />
        </span>
      </div>
      {blocks.length === 0 ? <div className="empty">Nothing on these accounts in this period.</div> : (
        <div className="tablewrap">
          <table>
            <thead><tr><th>Date</th><th>Acct code</th><th>Account name</th><th>Document</th><th>Description</th>
              <th className="r">Debit</th><th className="r">Credit</th></tr></thead>
            {blocks.map((b) => {
              const open = !shut.has(b.key);
              return (
                <tbody key={b.key} className="ld-block" data-open={open || undefined}>
                  <tr className="ld-head">
                    <td colSpan={7}>
                      <button type="button" aria-expanded={open} onClick={() => toggle(b.key)}>
                        {open ? <ChevronDown size={15} aria-hidden="true" /> : <ChevronRight size={15} aria-hidden="true" />}
                        <span className="ld-code">{b.accountCode}</span>
                        <strong>{name(b)}</strong>
                        <span className="ld-meta">{b.lines.length} movement{b.lines.length === 1 ? "" : "s"}</span>
                        <span className="ld-closing">Closing {bal(b.closing)}</span>
                      </button>
                    </td>
                  </tr>
                  {open && b.lines.map((l, i) => (
                    <tr key={i}>
                      <td className="code">{new Date(l.date).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}</td>
                      <td className="code">{b.accountCode}</td>
                      {/* The main account on the other side (a sale: Sales); hover lists every account with its amount. */}
                      <td className="ledger-desc" title={l.contra.map((c) => `${c.account}  ${money(c.amount)}`).join("\n") || undefined}>
                        <span className="clip">{l.contra[0]?.account ?? "—"}</span>
                      </td>
                      <td className="code">{l.docId ? <Link href={`/documents/${l.docId}`} style={{ color: "var(--link)" }}>{l.docNo}</Link> : l.entryNo}</td>
                      <td className="ledger-desc" title={l.text}><span className="clip">{l.text}</span></td>
                      <td className="r dr">{fig(l.debit)}</td>
                      <td className="r cr">{fig(l.credit)}</td>
                    </tr>
                  ))}
                  {open && <>
                    <tr className="ld-total">
                      <td colSpan={5} className="r">Total</td>
                      <td className="r">{money(b.debits)}</td><td className="r">{money(b.credits)}</td>
                    </tr>
                    {/* Brought down on its own side, carried down on the other, so the block balances. */}
                    <tr className="ld-bal">
                      <td colSpan={5} className="r">Opening ▸</td>
                      <td className="r">{b.opening > 0 ? fig(b.opening) : ""}</td><td className="r">{b.opening < 0 ? fig(-b.opening) : ""}</td>
                    </tr>
                    <tr className="ld-bal">
                      <td colSpan={5} className="r">Closing ▸</td>
                      <td className="r">{b.closing < 0 ? fig(-b.closing) : ""}</td><td className="r">{b.closing > 0 ? fig(b.closing) : ""}</td>
                    </tr>
                  </>}
                </tbody>
              );
            })}
          </table>
        </div>
      )}
    </section>
  );
}
