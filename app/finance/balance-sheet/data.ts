import { sql } from "@/lib/db";
import { scopedBranch, seenBranches } from "@/lib/branch-scope";
import {
  getCompany, getBalanceSheet, getBranches, getUnassignedBranchActivity,
  getAccountTree, UNASSIGNED_BRANCH,
} from "@/lib/queries";
import { buildStatement, type ChartRow, type StatementNode } from "@/lib/report-tree";
import { money } from "@/lib/db";
import type { Section, Summary } from "@/components/statement-table";

/**
 * The balance sheet, computed once for both the screen and the paper. The
 * reasoning is the income statement's: a printed statement that disagreed
 * with the screen it was printed from would be worse than no print button.
 */

export type Params = { asOf?: string; branch?: string };

function today() {
  return new Date().toISOString().slice(0, 10);
}

export async function getBalanceSheetData({ asOf: asOfParam, branch }: Params) {
  const company = await getCompany();
  if (!company) return null;

  const asOf = asOfParam || today();

  const branches = (await seenBranches((await getBranches(company.id)) as unknown as { id: string }[])) as unknown as Array<{
    id: string; code: string; name: string; warehouse_count: number;
  }>;
  const unassignedLines = await getUnassignedBranchActivity(company.id);
  // Someone who sees only their own branch gets it, whatever the link asks for.
  const branchId = await scopedBranch(
    branch === UNASSIGNED_BRANCH ? UNASSIGNED_BRANCH
    : branch && branches.some((b) => b.id === branch) ? branch
    : null);
  const branchName =
    branchId === UNASSIGNED_BRANCH ? "No branch"
    : branches.find((b) => b.id === branchId)?.name ?? "All branches";

  const { rows, netIncome } = await getBalanceSheet(company.id, asOf, branchId);
  const typed = rows as unknown as Array<{
    id: string; code: string; name: string; account_type: "ASSET" | "LIABILITY" | "EQUITY"; amount: string;
  }>;

  const chart = (await getAccountTree(company.id)) as unknown as ChartRow[];
  const amounts = new Map(typed.map((r) => [r.id, Number(r.amount)]));

  /* The clearing accounts are where a step waits for its other half: goods
     in before the bill (GR/IR), a landed cost spread before its bill, goods
     out before the invoice. They sit in the chart under current assets, but
     a credit balance there is something owed, an accrual, and reads as a
     negative asset. Presented by their balance instead: a credit balance
     under liabilities, a debit balance where it is. Nothing is reposted. */
  const clearingIds = new Set((await sql`
    select account_id from system_account
     where company_id = ${company.id} and role in ('GRIR_CLEARING', 'LANDED_COST_CLEARING', 'SHIPPED_NOT_INVOICED')`)
    .map((r) => r.account_id as string));
  const owing = typed.filter((r) => clearingIds.has(r.id) && r.account_type === "ASSET" && Number(r.amount) < -0.00005);
  for (const r of owing) amounts.delete(r.id);

  const assetTree = buildStatement(chart, amounts, ["ASSET"]);
  const liabilityTree = buildStatement(chart, amounts, ["LIABILITY"]);
  if (owing.length > 0) {
    const children: StatementNode[] = owing.map((r) => ({
      id: `clearing-${r.id}`, code: r.code, depth: 1, postable: true, name: r.name, amount: -Number(r.amount), children: [],
    }));
    const amount = children.reduce((t, c) => t + c.amount, 0);
    liabilityTree.nodes.push({ id: "clearing-credit", code: "", depth: 0, postable: false,
      name: "Clearing accounts (awaiting invoices)", amount, children });
    liabilityTree.total += amount;
  }
  const equityTree = buildStatement(chart, amounts, ["EQUITY"]);

  /**
   * This period's result, not yet closed to an equity account — so it belongs
   * in equity but has no account in the chart to hang from. Appended as its
   * own row rather than folded into one, because a reader has to be able to
   * tell what the books recorded from what the statement is adding on their
   * behalf.
   *
   * Named for what it is rather than for where it will end up. Calling it
   * "retained earnings (current, unclosed)" put the words "retained
   * earnings" on a second row directly beneath account 3020 of the same
   * name, and the two read as one figure counted twice — which is the
   * question it actually prompted.
   */
  const retained: StatementNode = {
    id: "retained-earnings-current", code: "", depth: 0, postable: true,
    name: "Current Year Earnings (Unclosed)", amount: netIncome, children: [],
  };
  const equityNodes = netIncome !== 0
    ? [...equityTree.nodes, retained]
    : equityTree.nodes;

  const assets = assetTree.total;
  const liabilities = liabilityTree.total;
  const equity = equityTree.total + netIncome;
  const balanced = Math.abs(assets - (liabilities + equity)) < 0.0001;

  const summaries: Summary[] = [
    { label: "Total assets", value: assets, note: "what the company holds" },
    { label: "Total liabilities", value: liabilities, note: "what it owes" },
    { label: "Total equity", value: equity, note: "including this period's result" },
  ];

  const sections: Section[] = [
    { key: "ASSET", label: "Assets", nodes: assetTree.nodes,
      total: assets, totalLabel: "Total assets" },
    { key: "LIABILITY", label: "Liabilities", nodes: liabilityTree.nodes,
      total: liabilities, totalLabel: "Total liabilities" },
    { key: "EQUITY", label: "Equity", nodes: equityNodes,
      total: equity, totalLabel: "Total equity" },
  ];

  const subtotals = [
    { after: "EQUITY", label: "Total liabilities and equity",
      value: liabilities + equity, strong: true },
  ];

  return {
    company, branches, unassignedLines, branchId, branchName, asOf,
    assets, liabilities, equity, balanced,
    summaries, sections, subtotals,
    scope: `${branchName} · as of ${asOf} · ${
      balanced ? "Balanced" : `Out by ${money(assets - (liabilities + equity))}`}`,
  };
}
