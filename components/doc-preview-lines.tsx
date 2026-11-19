"use client";

import { useMemo, useState } from "react";
import { ArrowUpDown, Search } from "lucide-react";

export type PreviewLine = {
  id: string; code: string; name: string; brand: string | null; qty: number; unit: string;
  price: number; amount: number; free: string | null; imei: boolean;
};
type Key = "name" | "qty" | "price" | "amount";

const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });

/** The invoice's lines: search, sort by any column, free lines marked. */
export function PreviewLines({ lines }: { lines: PreviewLine[] }) {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<{ key: Key; dir: 1 | -1 } | null>(null);
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    const rows = t ? lines.filter((l) => `${l.code} ${l.name} ${l.brand ?? ""}`.toLowerCase().includes(t)) : lines;
    if (!sort) return rows;
    return [...rows].sort((a, b) => (a[sort.key] > b[sort.key] ? 1 : a[sort.key] < b[sort.key] ? -1 : 0) * sort.dir);
  }, [lines, q, sort]);
  const head = (key: Key, label: string, right = false) => (
    <th className={right ? "r" : undefined} aria-sort={sort?.key === key ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
      <button type="button" className="dp-sort" onClick={() => setSort((s) => (s?.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: 1 }))}>
        {label} <ArrowUpDown size={12} aria-hidden="true" />
      </button>
    </th>
  );
  return (
    <div className="dp-lines">
      <div className="dp-lines-bar">
        <span className="dp-count">{lines.length} line{lines.length === 1 ? "" : "s"}</span>
        <label className="dp-search">
          <Search size={14} aria-hidden="true" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search lines" aria-label="Search lines" />
        </label>
      </div>
      <table className="dp-table">
        <thead><tr>{head("name", "Item")}{head("qty", "Qty", true)}{head("price", "Price", true)}{head("amount", "Amount", true)}</tr></thead>
        <tbody>
          {shown.map((l) => (
            <tr key={l.id}>
              <td>
                <span className="dp-item">{l.name}</span>
                <span className="dp-sub">{[l.code, l.brand].filter(Boolean).join(" · ")}{l.imei ? " · IMEI" : ""}</span>
                {l.free && <span className="dp-tag">Free · {l.free}</span>}
              </td>
              <td className="r">{fmt(l.qty)} <span className="dp-sub-in">{l.unit}</span></td>
              <td className="r">{fmt(l.price)}</td>
              <td className="r">{fmt(l.amount)}</td>
            </tr>
          ))}
          {shown.length === 0 && <tr><td colSpan={4} className="dp-empty">No line matches “{q}”.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
