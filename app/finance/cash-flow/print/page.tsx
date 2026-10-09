import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PrintButton } from "@/components/print-button";
import { StatementSheet, type SheetRow } from "@/components/statement-sheet";
import { getCashFlowData, SECTIONS, type Params } from "../data";
import { getIndirectCashFlow } from "@/lib/indirect-cash-flow";

/**
 * The cash flow statement as paper.
 *
 * The reconciliation goes onto the printed copy too. Ending cash is read
 * straight from the ledger while the movements above it are classified from
 * it, so the two are arrived at independently — printing the movements
 * without the check would hide exactly the errors this statement can make.
 */
export default async function CashFlowPrint({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  const sp = await searchParams;
  const data = await getCashFlowData(sp);
  if (!data) return <div className="empty">No company found.</div>;
  const {
    company, typed, beginningCash, endingCash, netChange, difference,
    unreconciled, scope, range, branchId,
  } = data;

  const indirect = sp.method === "indirect";
  const rows: SheetRow[] = [];
  if (indirect) {
    // The indirect statement as the screen draws it: sub-lines one step in.
    const st = await getIndirectCashFlow(company.id, range.from, range.to, branchId);
    for (const [k, label, total] of [
      ["operating", "Operating activities", st.netOperating],
      ["investing", "Investing activities", st.netInvesting],
      ["financing", "Financing activities", st.netFinancing],
    ] as const) {
      rows.push({ kind: "section", label });
      for (const l of st[k]) rows.push({ kind: "line", label: l.label, depth: l.indent ? 1 : 0, amount: l.amount });
      rows.push({ kind: "total", label: `Net cash from ${label.toLowerCase()}`, amount: total });
    }
    rows.push({ kind: "rule", label: "Net increase / (decrease) in cash", amount: st.netChange });
    rows.push({ kind: "note", label: "Cash and bank at beginning of period", amount: st.beginningCash });
    rows.push({ kind: "rule", label: "Cash and bank at end of period", amount: st.endingCash, strong: true });
    rows.push({ kind: "note", label: Math.abs(st.difference) > 0.01 ? "Unexplained difference" : "Reconciles", amount: st.difference });
  } else {
  for (const sec of SECTIONS) {
    const items = typed.filter((r) => r.section === sec.key);
    if (items.length === 0) continue;
    const total = items.reduce((s, r) => s + Number(r.amount), 0);
    rows.push({ kind: "section", label: sec.label });
    for (const r of items) {
      rows.push({ kind: "line", label: r.category, depth: 0, amount: Number(r.amount) });
    }
    rows.push({ kind: "total", label: `Net ${sec.label.toLowerCase()}`, amount: total });
  }
  rows.push({ kind: "rule", label: "Net change in cash", amount: netChange });
  rows.push({ kind: "note", label: "Cash at beginning of period", amount: Number(beginningCash) });
  rows.push({ kind: "rule", label: "Cash at end of period", amount: Number(endingCash), strong: true });
  rows.push({
    kind: "note",
    label: unreconciled ? "Unexplained difference" : "Reconciles",
    amount: difference,
  });
  }

  return (
    <>
      <div className="actions noprint" style={{ marginBottom: "0.5rem" }}>
        <Link
          href={{ pathname: "/finance/cash-flow", query: {
            from: range.from, to: range.to, ...(branchId ? { branch: branchId } : {}),
            ...(indirect ? { method: "indirect" } : {}),
          } }}
          className="btn ghost tiny"
        >
          <ArrowLeft size={13} aria-hidden="true" /> Back to the statement
        </Link>
        <PrintButton />
      </div>

      <div className="sheetwrap">
        <StatementSheet
          company={{ name: company.name, nameMy: company.name_my }}
          title={indirect ? "Cash flow statement (indirect method)" : "Cash flow statement"}
          scope={scope}
          currency={company.base_currency}
          rows={rows}
        />
      </div>
    </>
  );
}
