"use client";

import { useMemo, useState } from "react";
import { Layers, Home, Users } from "lucide-react";
import { DataTable, type DataRow, type Column } from "./data-table";
import { useTranslations } from "next-intl";

type Scope = "all" | "owned" | "consigned";

/**
 * Wraps DataTable with the ownership picker.
 *
 * Two checkboxes said the same thing three ways: both ticked, neither ticked,
 * one ticked. Neither ticked is a table showing nothing, which is a state
 * worth having only if somebody wants it, and nobody does. Three exclusive
 * tabs carry the same choices with one fewer, and each one says how many rows
 * it holds before it is picked — a Consignment tab reading 0 answers the
 * question without being clicked.
 */
export function StockTable({
  rows,
  consignmentItemIds,
  columns,
  searchPlaceholder,
  defaultSort,
  emptyLabel,
  footerCells,
}: {
  rows: DataRow[];
  /** Row keys (item ids) that currently carry consigned stock. */
  consignmentItemIds: string[];
  columns: Column[];
  searchPlaceholder?: string;
  defaultSort?: { key: string; dir: "asc" | "desc" };
  emptyLabel?: string;
  footerCells?: { span: React.ReactNode; cells: Record<string, React.ReactNode> };
}) {
  const t = useTranslations("inventory");
  const [scope, setScope] = useState<Scope>("all");

  const consigned = useMemo(() => new Set(consignmentItemIds), [consignmentItemIds]);

  const counts = {
    all: rows.length,
    consigned: rows.filter((r) => consigned.has(r.key)).length,
    owned: rows.filter((r) => !consigned.has(r.key)).length,
  };

  const filtered = useMemo(
    () => rows.filter((r) =>
      scope === "all" ? true : consigned.has(r.key) ? scope === "consigned" : scope === "owned"),
    [rows, consigned, scope]
  );

  const tabs: { key: Scope; label: string; icon: React.ReactNode }[] = [
    { key: "all", label: t("stk.allStock"), icon: <Layers size={14} aria-hidden="true" /> },
    { key: "owned", label: t("stk.companyOwned"), icon: <Home size={14} aria-hidden="true" /> },
    { key: "consigned", label: t("stk.consignment"), icon: <Users size={14} aria-hidden="true" /> },
  ];

  return (
    <>
      <div className="scopetabs" role="group" aria-label={t("stk.colOwnership")}>
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            className="scopetab"
            data-active={scope === tab.key}
            aria-pressed={scope === tab.key}
            onClick={() => setScope(tab.key)}
          >
            {tab.icon}
            {tab.label}
            <span className="scopetab-n">{counts[tab.key]}</span>
          </button>
        ))}
      </div>
      <DataTable
        rows={filtered}
        columns={columns}
        searchPlaceholder={searchPlaceholder}
        defaultSort={defaultSort}
        emptyLabel={
          scope === "consigned" ? t("stk.nothingConsigned")
            : scope === "owned" ? t("stk.nothingOwned")
              : emptyLabel
        }
        footerCells={footerCells}
        tableClassName="stocktable"
        storageKey="stock"
      />
    </>
  );
}
