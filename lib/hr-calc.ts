/**
 * Payroll arithmetic, on exact ten-thousandths (bigint units from
 * lib/fa-engine), with no database: what a payslip comes to, what an advance
 * suggests recovering, and the journal a run posts. lib/hr.ts feeds it.
 */

export const EARNINGS = ["BASIC", "ALLOWANCE", "OVERTIME", "COMMISSION", "BONUS", "OTHER_EARNING"] as const;
export const DEDUCTIONS = ["ADVANCE", "TAX", "STATUTORY", "OTHER_DEDUCTION"] as const;
export type Kind = (typeof EARNINGS)[number] | (typeof DEDUCTIONS)[number];
export const KINDS: Kind[] = [...EARNINGS, ...DEDUCTIONS];

export const KIND_LABEL: Record<Kind, string> = {
  BASIC: "Basic salary", ALLOWANCE: "Allowance", OVERTIME: "Overtime", COMMISSION: "Commission", BONUS: "Bonus",
  OTHER_EARNING: "Other earning", ADVANCE: "Advance recovery", TAX: "Income tax", STATUTORY: "Employee contribution",
  OTHER_DEDUCTION: "Other deduction",
};

/** The settings column holding each kind's account. */
export const KIND_ACCOUNT: Record<Kind, string> = {
  BASIC: "basic_account_id", ALLOWANCE: "allowance_account_id", OVERTIME: "overtime_account_id",
  COMMISSION: "commission_account_id", BONUS: "bonus_account_id", OTHER_EARNING: "other_earning_account_id",
  ADVANCE: "advance_account_id", TAX: "tax_account_id", STATUTORY: "statutory_account_id",
  OTHER_DEDUCTION: "other_deduction_account_id",
};

export const isEarning = (k: string) => (EARNINGS as readonly string[]).includes(k);

export type Line = { kind: Kind; amount: bigint; advanceId?: string | null };

/** Gross, deductions and net of one payslip. */
export function slipTotals(lines: Line[]) {
  let gross = 0n, deductions = 0n;
  for (const l of lines) {
    if (l.amount <= 0n) throw new Error("Every payslip line must be more than zero");
    if (isEarning(l.kind)) gross += l.amount; else deductions += l.amount;
  }
  return { gross, deductions, net: gross - deductions };
}

export type OpenAdvance = { id: string; outstanding: bigint; method: "FULL" | "FIXED" | "MANUAL"; fixed: bigint | null; firstPeriod: string };

/**
 * What to take back from each open advance this period, oldest first: all of
 * it (FULL), the fixed amount (FIXED) or nothing (MANUAL), never more than is
 * outstanding and never more than leaves net pay at zero. Only a suggestion:
 * the draft payslip can change it before posting.
 */
export function suggestRecovery(advances: OpenAdvance[], periodStart: string, room: bigint): { id: string; amount: bigint }[] {
  const out: { id: string; amount: bigint }[] = [];
  let left = room > 0n ? room : 0n;
  for (const a of advances) {
    if (a.firstPeriod > periodStart || a.outstanding <= 0n || a.method === "MANUAL") continue;
    let want = a.method === "FULL" ? a.outstanding : (a.fixed! < a.outstanding ? a.fixed! : a.outstanding);
    if (want > left) want = left;
    if (want > 0n) { out.push({ id: a.id, amount: want }); left -= want; }
  }
  return out;
}

/**
 * A run's journal: one line per account, never per person. Earnings debit
 * their expense accounts, deductions credit theirs, and net pay credits
 * salary payable, so it balances by construction. Missing accounts are
 * returned rather than guessed.
 */
export function runJournal(lines: Line[], accounts: Record<string, string | null>, payableAccountId: string | null) {
  const by = new Map<string, bigint>();
  const missing = new Set<string>();
  let net = 0n;
  for (const l of lines) {
    const acct = accounts[KIND_ACCOUNT[l.kind]];
    if (!acct) { missing.add(KIND_LABEL[l.kind]); continue; }
    const signed = isEarning(l.kind) ? l.amount : -l.amount;
    by.set(acct, (by.get(acct) ?? 0n) + signed);
    net += signed;
  }
  if (!payableAccountId) missing.add("Salary payable");
  if (missing.size) return { missing: [...missing], lines: [] as { accountId: string; amount: bigint }[] };
  if (net !== 0n) by.set(payableAccountId!, (by.get(payableAccountId!) ?? 0n) - net);
  return { missing: [], lines: [...by].filter(([, a]) => a !== 0n).map(([accountId, amount]) => ({ accountId, amount })) };
}

/** Kyat as the pages show them. */
export const kyat = (v: string | number | null | undefined) => Number(v ?? 0).toLocaleString("en-US", { maximumFractionDigits: 2 });
