"use client";

import { useRouter } from "next/navigation";
import { DataTable, type DataRow, type Column, type Filter } from "./data-table";

/**
 * The Stock page's table, with the page's own choices in its bar.
 *
 * Warehouse and "in stock or everything" change what the server sends, so
 * they navigate; status, category and ownership narrow what is already here,
 * so they are the table's own filters. Both sit on one line after the search,
 * the way the inventory summary reads.
 */
export function StockTable({
  rows, columns, filters, searchPlaceholder, defaultSort, emptyLabel, footerCells, toolbarStart, toolbarEnd, server,
}: {
  /** One page searched and sorted by the server (see DataTable). */
  server?: React.ComponentProps<typeof DataTable>["server"];
  rows: DataRow[];
  columns: Column[];
  filters?: Filter[];
  searchPlaceholder?: string;
  defaultSort?: { key: string; dir: "asc" | "desc" };
  emptyLabel?: string;
  footerCells?: { span: React.ReactNode; cells: Record<string, React.ReactNode> };
  toolbarStart?: React.ReactNode;
  toolbarEnd?: React.ReactNode;
}) {
  return (
    <DataTable
      rows={rows}
      columns={columns}
      filters={filters}
      searchPlaceholder={searchPlaceholder}
      defaultSort={defaultSort}
      emptyLabel={emptyLabel}
      footerCells={footerCells}
      tableClassName="stocktable"
      storageKey="stock2"
      toolbarStart={toolbarStart}
      toolbarEnd={toolbarEnd}
      server={server}
    />
  );
}

/** A select in the table's bar that changes one query parameter of the page. */
export function ParamSelect({ param, value, options, label, keep }: {
  param: string; value: string; label: string;
  options: { value: string; label: string }[];
  /** The other parameters this page is carrying. */
  keep: Record<string, string | undefined>;
}) {
  const router = useRouter();
  return (
    <select aria-label={label} value={value} className={`dt-filter${value ? " dt-filter-on" : ""}`}
      onChange={(e) => {
        const q = new URLSearchParams();
        for (const [k, v] of Object.entries({ ...keep, [param]: e.target.value })) if (v) q.set(k, v);
        const qs = q.toString();
        router.push(`${window.location.pathname}${qs ? `?${qs}` : ""}`, { scroll: false });
      }}>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}
