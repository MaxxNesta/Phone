"use client";
import { todayLocal } from "@/lib/format";
import { csvCell } from "@/lib/csv";

import { Download } from "lucide-react";

/** Rows to a CSV file, in the browser: what is on screen is what is saved. */
export function toCsv(rows: (string | number)[][]) {
  return rows
    .map((r) => r.map(csvCell).join(","))
    .join("\n");
}

export function downloadCsv(name: string, rows: (string | number)[][]) {
  // The BOM lets Excel read Myanmar text as UTF-8 rather than garbling it.
  const url = URL.createObjectURL(new Blob(["﻿" + toCsv(rows)], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name}-${todayLocal()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function ExportCsvButton({ name, rows, label = "Export" }: { name: string; rows: (string | number)[][]; label?: string }) {
  return (
    <button type="button" className="ghost tiny" onClick={() => downloadCsv(name, rows)} disabled={rows.length <= 1}>
      <Download size={13} aria-hidden="true" /> {label}
    </button>
  );
}
