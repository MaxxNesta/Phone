import { sql } from "./db";
import { branchFilterOn } from "./queries";

/**
 * The cash flow statement by the indirect method, read from the ledger.
 *
 * Starts from net profit and reconciles to the change in cash and bank. Every
 * figure is a sum of journal lines; nothing is plugged. It holds because a
 * journal entry balances: the cash lines of an entry equal minus the rest, so
 *
 *   Δcash = −Σ P&L − Σ working capital − Σ investing − Σ financing
 *
 * and each term is shown as a line. Investing and financing are what actually
 * moved through cash: within an entry that touches cash, the investing (then
 * financing) lines take the cash up to their own size, and only when they
 * pull against it — equipment bought for cash is investing; bought on credit
 * or through a loan, the part not paid in cash is a non-cash movement and is
 * not an investing outflow until it is paid (rule 5). The non-cash part is
 * shown as an adjustment, so the statement still adds up.
 *
 * Classification is stored on the account (migration 0128): cash_flow_class
 * and indirect_role. Year-end closing entries are left out whole — they only
 * move profit into retained earnings, touch no cash, and would otherwise
 * zero the net profit line.
 */

type Range = { from: string; to: string };

export type IndirectLine = { key: string; label: string; amount: number; indent?: boolean; bold?: boolean; drill?: boolean };

export type IndirectStatement = {
  operating: IndirectLine[];
  investing: IndirectLine[];
  financing: IndirectLine[];
  netOperating: number; netInvesting: number; netFinancing: number;
  netChange: number; beginningCash: number; endingCash: number; difference: number;
  /** Accounts whose cash flow classification is still only a suggestion. */
  toReview: number;
};

/** Working-capital groups, by what the account says about itself. */
const WC_GROUPS = [
  { key: "wc:ar", label: "(Increase) / Decrease in Accounts Receivable", test: (a: Acc) => a.subledger === "CUSTOMER" },
  { key: "wc:inv", label: "(Increase) / Decrease in Inventory", test: (a: Acc) => a.subledger === "INVENTORY" },
  { key: "wc:ap", label: "Increase / (Decrease) in Accounts Payable", test: (a: Acc) => a.subledger === "SUPPLIER" },
  // Only the part not paid in cash: the paid part is "Income tax paid".
  { key: "wc:tax", label: "Increase / (Decrease) in Income Tax Payable", test: (a: Acc) => a.role === "INCOME_TAX" },
  { key: "wc:oca", label: "(Increase) / Decrease in Other Current Assets", test: (a: Acc) => a.account_type === "ASSET" },
  { key: "wc:ocl", label: "Increase / (Decrease) in Other Current Liabilities", test: () => true },
] as const;

type Acc = { id: string; code: string; name: string; account_type: string; subledger: string | null; role?: string | null };

const wcGroupOf = (a: Acc) => WC_GROUPS.find((g) => g.test(a))!.key;

/** Lines in the period, scoped as every financial report is. */
function periodLines(companyId: string, r: Range, branchId: string | null) {
  return sql`
    select jl.journal_entry_id, jl.account_id, jl.base_amount, jl.id as line_id
      from journal_line jl
      join journal_entry je on je.id = jl.journal_entry_id
     where jl.company_id = ${companyId}
       and je.entry_date between ${r.from}::date and ${r.to}::date
       and not exists (select 1 from document y where y.journal_entry_id = je.id and y.doc_type = 'YEAR_END_CLOSE')
       ${branchFilterOn(sql`jl`, branchId)}`;
}

/** Per entry: the sums the allocation needs. */
async function entrySums(companyId: string, r: Range, branchId: string | null) {
  return sql<{
    entry_id: string; entry_date: string; entry_no: string | null; source_id: string | null; memo: string | null;
    c: number; p: number; d: number; t: number; inv: number; inv_fa: number;
    fin: number; fin_borrow: number; fin_capital: number; fin_dist: number;
  }[]>`
    select l.journal_entry_id::text as entry_id, je.entry_date::text as entry_date, je.entry_no,
           je.source_id::text as source_id, je.memo,
      coalesce(sum(l.base_amount) filter (where a.cash_flow_class = 'CASH'), 0)::float as c,
      coalesce(sum(l.base_amount) filter (where a.account_type in ('REVENUE','COGS','EXPENSE')), 0)::float as p,
      coalesce(sum(l.base_amount) filter (where a.account_type in ('REVENUE','COGS','EXPENSE') and a.indirect_role = 'NON_CASH'), 0)::float as d,
      coalesce(sum(l.base_amount) filter (where a.indirect_role = 'INCOME_TAX' and a.account_type not in ('REVENUE','COGS','EXPENSE')), 0)::float as t,
      coalesce(sum(l.base_amount) filter (where a.cash_flow_class = 'INVESTING' and a.account_type not in ('REVENUE','COGS','EXPENSE')), 0)::float as inv,
      coalesce(sum(l.base_amount) filter (where a.cash_flow_class = 'INVESTING' and a.indirect_role = 'FIXED_ASSET'), 0)::float as inv_fa,
      coalesce(sum(l.base_amount) filter (where a.cash_flow_class = 'FINANCING' and a.account_type not in ('REVENUE','COGS','EXPENSE')), 0)::float as fin,
      coalesce(sum(l.base_amount) filter (where a.cash_flow_class = 'FINANCING' and a.indirect_role = 'BORROWING'), 0)::float as fin_borrow,
      coalesce(sum(l.base_amount) filter (where a.cash_flow_class = 'FINANCING' and a.indirect_role in ('CAPITAL')), 0)::float as fin_capital,
      coalesce(sum(l.base_amount) filter (where a.cash_flow_class = 'FINANCING' and a.indirect_role = 'DISTRIBUTION'), 0)::float as fin_dist
      from (${periodLines(companyId, r, branchId)}) l
      join account a on a.id = l.account_id
      join journal_entry je on je.id = l.journal_entry_id
     group by l.journal_entry_id, je.entry_date, je.entry_no, je.source_id, je.memo`;
}

/** The cash a class of lines X takes from the cash R still unexplained in an
 *  entry: only when X pulls against the cash, and never more than either. */
const take = (x: number, r: number) =>
  x * r < 0 ? Math.sign(r) * Math.min(Math.abs(x), Math.abs(r)) : 0;

export type EntryFlow = {
  entryId: string; date: string; entryNo: string | null; sourceId: string | null; memo: string | null;
  cash: number; tax: number; inv: number; fin: number; dep: number; nonCash: number;
  invFa: number; invOther: number; borrow: number; capital: number; dist: number; finOther: number;
};

/** Each entry, its cash split into tax, investing and financing, and what
 *  was not cash. Shared by the statement and every drill-down. */
async function entryFlows(companyId: string, r: Range, branchId: string | null): Promise<EntryFlow[]> {
  const rows = await entrySums(companyId, r, branchId);
  const share = (part: number, whole: number, amt: number) => (whole ? amt * (part / whole) : 0);
  return rows.map((e) => {
    let rest = e.c;
    const tax = take(e.t, rest); rest -= tax;
    const inv = take(e.inv, rest); rest -= inv;
    const fin = take(e.fin, rest);
    const finOtherPart = e.fin - e.fin_borrow - e.fin_capital - e.fin_dist;
    return {
      entryId: e.entry_id, date: e.entry_date, entryNo: e.entry_no, sourceId: e.source_id, memo: e.memo,
      cash: e.c, tax, inv, fin, dep: e.d,
      // Investing and financing that did not go through cash. Depreciation is
      // taken out of it because it has its own line (the expense's add-back).
      nonCash: (-e.inv - inv) + (-e.fin - fin) - e.d,
      invFa: share(e.inv_fa, e.inv, inv), invOther: share(e.inv - e.inv_fa, e.inv, inv),
      borrow: share(e.fin_borrow, e.fin, fin), capital: share(e.fin_capital, e.fin, fin),
      dist: share(e.fin_dist, e.fin, fin), finOther: share(finOtherPart, e.fin, fin),
    };
  });
}

/** Working-capital and income-tax accounts' movement in the period. */
async function wcMovements(companyId: string, r: Range, branchId: string | null) {
  return sql<(Acc & { role: string | null; delta: number })[]>`
    select a.id::text as id, a.code, a.name, a.account_type, a.subledger, a.indirect_role as role,
           sum(l.base_amount)::float as delta
      from (${periodLines(companyId, r, branchId)}) l
      join account a on a.id = l.account_id
     where coalesce(a.cash_flow_class, 'OPERATING') = 'OPERATING'
       and a.account_type not in ('REVENUE', 'COGS', 'EXPENSE')
     group by a.id, a.code, a.name, a.account_type, a.subledger, a.indirect_role`;
}

async function cashAt(companyId: string, op: "<" | "<=", date: string, branchId: string | null) {
  const [row] = await sql`
    select coalesce(sum(jl.base_amount), 0)::float as balance
      from journal_line jl
      join journal_entry je on je.id = jl.journal_entry_id
      join account a on a.id = jl.account_id
     where jl.company_id = ${companyId} and a.cash_flow_class = 'CASH'
       and ${op === "<" ? sql`je.entry_date < ${date}::date` : sql`je.entry_date <= ${date}::date`}
       ${branchFilterOn(sql`jl`, branchId)}`;
  return Number(row.balance);
}

export async function getIndirectCashFlow(
  companyId: string, from: string, to: string, branchId: string | null,
): Promise<IndirectStatement> {
  const r = { from, to };
  const [flows, wc, beginningCash, endingCash, [review]] = await Promise.all([
    entryFlows(companyId, r, branchId),
    wcMovements(companyId, r, branchId),
    cashAt(companyId, "<", from, branchId),
    cashAt(companyId, "<=", to, branchId),
    sql`select count(*)::int as n from account where company_id = ${companyId} and is_postable and not cash_flow_confirmed`,
  ]);
  const sum = (f: (e: EntryFlow) => number) => flows.reduce((s, e) => s + f(e), 0);

  const [pl] = await sql`
    select coalesce(sum(l.base_amount) filter (where a.account_type in ('REVENUE','COGS','EXPENSE')), 0)::float as p
      from (${periodLines(companyId, r, branchId)}) l join account a on a.id = l.account_id`;
  const netProfit = -Number(pl.p);
  const dep = sum((e) => e.dep);
  const nonCash = sum((e) => e.nonCash);
  const taxPaid = sum((e) => e.tax);

  // Working capital: the change of each account, as a cash adjustment.
  const groupTotals = new Map<string, number>();
  for (const a of wc) {
    const key = wcGroupOf(a);
    groupTotals.set(key, (groupTotals.get(key) ?? 0) - a.delta);
  }
  // Income tax payable counts here only for what was not paid in cash; the
  // cash part is its own line, "Income tax paid".
  groupTotals.set("wc:tax", (groupTotals.get("wc:tax") ?? 0) - taxPaid);
  const wcTotal = [...groupTotals.values()].reduce((s, v) => s + v, 0);

  const cashFromOps = netProfit + dep + nonCash + wcTotal;
  const netOperating = cashFromOps + taxPaid;

  const invPurchase = sum((e) => Math.min(0, e.invFa));
  const invProceeds = sum((e) => Math.max(0, e.invFa));
  const invOther = sum((e) => e.invOther);
  const loanIn = sum((e) => Math.max(0, e.borrow));
  const loanOut = sum((e) => Math.min(0, e.borrow));
  const capital = sum((e) => e.capital);
  const dist = sum((e) => e.dist);
  const finOther = sum((e) => e.finOther);
  const netInvesting = invPurchase + invProceeds + invOther;
  const netFinancing = loanIn + loanOut + capital + dist + finOther;
  const netChange = netOperating + netInvesting + netFinancing;

  return {
    operating: [
      { key: "np", label: "Net profit for the period", amount: netProfit, drill: true },
      { key: "adj", label: "Adjustments for non-cash items", amount: dep + nonCash },
      { key: "dep", label: "Depreciation and amortisation", amount: dep, indent: true, drill: true },
      { key: "noncash", label: "Other non-cash items", amount: nonCash, indent: true, drill: true },
      { key: "wc", label: "Change in working capital", amount: wcTotal },
      ...WC_GROUPS
        // Income tax payable only when it moved: most periods it is all paid.
        .filter((g) => g.key !== "wc:tax" || Math.abs(groupTotals.get(g.key) ?? 0) > 0.004)
        .map((g) => ({ key: g.key, label: g.label, amount: groupTotals.get(g.key) ?? 0, indent: true, drill: true })),
      { key: "cfo", label: "Cash generated from operations", amount: cashFromOps, bold: true },
      { key: "tax", label: "Income tax paid", amount: taxPaid, drill: true },
    ],
    investing: [
      { key: "inv:purchase", label: "Purchase of fixed assets", amount: invPurchase, drill: true },
      { key: "inv:proceeds", label: "Proceeds from sale of fixed assets", amount: invProceeds, drill: true },
      { key: "inv:other", label: "Other investing cash flows", amount: invOther, drill: true },
    ],
    financing: [
      { key: "fin:loan_in", label: "Loan proceeds", amount: loanIn, drill: true },
      { key: "fin:loan_out", label: "Loan repayments", amount: loanOut, drill: true },
      { key: "fin:capital", label: "Owner capital", amount: capital, drill: true },
      { key: "fin:dist", label: "Drawings / dividends paid", amount: dist, drill: true },
      { key: "fin:other", label: "Other financing cash flows", amount: finOther, drill: true },
    ],
    netOperating, netInvesting, netFinancing, netChange,
    beginningCash, endingCash,
    difference: endingCash - (beginningCash + netChange),
    toReview: review.n as number,
  };
}

// ------------------------------------------------------------- drill-down --

export type DrillRow = {
  date: string; entryId: string; entryNo: string | null;
  documentId: string | null; docNo: string | null; partner: string | null;
  description: string | null; account?: string; amount: number; balance?: number;
};

export type IndirectDrill = {
  title: string; total: number;
  /** Working capital: the balances the adjustment is computed from. */
  balances?: { opening: number; closing: number; change: number; adjustment: number; liability: boolean };
  accounts?: { id: string; code: string; name: string; opening: number; closing: number; change: number }[];
  rows: DrillRow[];
};

async function describeEntries(ids: string[]) {
  if (ids.length === 0) return new Map<string, { documentId: string | null; docNo: string | null; partner: string | null; docType: string | null }>();
  const rows = await sql`
    select je.id::text as entry_id, d.id::text as document_id, d.doc_no, d.doc_type,
           coalesce(bp.name, (select bp2.name from journal_line jl join business_partner bp2 on bp2.id = jl.partner_id
                               where jl.journal_entry_id = je.id and jl.partner_id is not null limit 1)) as partner
      from journal_entry je
      left join document d on d.id = je.source_id
      left join business_partner bp on bp.id = d.partner_id
     where je.id = any(${ids}::uuid[])`;
  return new Map(rows.map((x) => [x.entry_id as string, {
    documentId: x.document_id as string | null, docNo: x.doc_no as string | null,
    partner: x.partner as string | null, docType: x.doc_type as string | null,
  }]));
}

const KIND_LABEL: Record<string, string> = {
  SALES_INVOICE: "Sales invoice", CUSTOMER_RECEIPT: "Customer receipt", PURCHASE_INVOICE: "Purchase invoice",
  SUPPLIER_PAYMENT: "Supplier payment", GOODS_RECEIPT: "Goods receipt", SALES_RETURN: "Sales return",
  PURCHASE_RETURN: "Supplier return", STOCK_ADJUSTMENT: "Stock adjustment", STOCK_TRANSFER: "Stock transfer",
  JOURNAL: "Journal", OPENING_BALANCE: "Opening balance", DELIVERY: "Delivery",
};

export async function getIndirectDrill(
  companyId: string, from: string, to: string, branchId: string | null, key: string,
): Promise<IndirectDrill | null> {
  const r = { from, to };

  // Working capital: balances and every movement on the group's accounts.
  if (key.startsWith("wc:")) {
    const group = WC_GROUPS.find((g) => g.key === key);
    if (!group) return null;
    const accs = (await sql<Acc[]>`
      select id::text as id, code, name, account_type, subledger, indirect_role as role from account
       where company_id = ${companyId} and coalesce(cash_flow_class, 'OPERATING') = 'OPERATING'
         and account_type in ('ASSET', 'LIABILITY', 'EQUITY')`).filter((a) => wcGroupOf(a) === key);
    const ids = accs.map((a) => a.id);
    if (ids.length === 0) return { title: group.label, total: 0, rows: [], accounts: [],
      balances: { opening: 0, closing: 0, change: 0, adjustment: 0, liability: key !== "wc:ar" && key !== "wc:inv" && key !== "wc:oca" } };
    const liability = accs.every((a) => a.account_type !== "ASSET");
    const sign = liability ? -1 : 1; // shown the way the balance is read
    const bal = await sql`
      select jl.account_id::text as id,
             coalesce(sum(jl.base_amount) filter (where je.entry_date < ${from}::date), 0)::float as opening,
             coalesce(sum(jl.base_amount) filter (where je.entry_date <= ${to}::date), 0)::float as closing
        from journal_line jl join journal_entry je on je.id = jl.journal_entry_id
       where jl.company_id = ${companyId} and jl.account_id = any(${ids}::uuid[])
         and not exists (select 1 from document y where y.journal_entry_id = je.id and y.doc_type = 'YEAR_END_CLOSE')
         ${branchFilterOn(sql`jl`, branchId)}
       group by jl.account_id`;
    const byId = new Map(bal.map((b) => [b.id as string, b]));
    const accounts = accs.map((a) => {
      const b = byId.get(a.id);
      const opening = sign * Number(b?.opening ?? 0), closing = sign * Number(b?.closing ?? 0);
      return { id: a.id, code: a.code, name: a.name, opening, closing, change: closing - opening };
    }).filter((a) => a.opening || a.closing);
    const opening = accounts.reduce((s, a) => s + a.opening, 0);
    const closing = accounts.reduce((s, a) => s + a.closing, 0);
    const lines = await sql`
      select je.entry_date::text as date, je.id::text as entry_id, je.entry_no, coalesce(jl.memo, je.memo) as memo,
             je.source_type, a.code || ' ' || a.name as account, jl.base_amount::float as amount
        from journal_line jl
        join journal_entry je on je.id = jl.journal_entry_id
        join account a on a.id = jl.account_id
       where jl.company_id = ${companyId} and jl.account_id = any(${ids}::uuid[])
         and je.entry_date between ${from}::date and ${to}::date
         and not exists (select 1 from document y where y.journal_entry_id = je.id and y.doc_type = 'YEAR_END_CLOSE')
         ${branchFilterOn(sql`jl`, branchId)}
       order by je.entry_date, je.entry_no, jl.line_no`;
    const desc = await describeEntries([...new Set(lines.map((l) => l.entry_id as string))]);
    let run = opening;
    const rows: DrillRow[] = lines.map((l) => {
      const d = desc.get(l.entry_id as string);
      const amount = sign * Number(l.amount);
      run += amount;
      return { date: l.date as string, entryId: l.entry_id as string, entryNo: l.entry_no as string | null,
        documentId: d?.documentId ?? null, docNo: d?.docNo ?? null, partner: d?.partner ?? null,
        description: (l.memo as string | null) ?? KIND_LABEL[(l.source_type as string) ?? ""] ?? l.source_type as string,
        account: l.account as string, amount, balance: run };
    });
    // The statement's figure for the group, from the same allocation.
    const stmt = await getIndirectCashFlow(companyId, from, to, branchId);
    const total = stmt.operating.find((x) => x.key === key)?.amount ?? 0;
    return { title: group.label, total, accounts, rows,
      balances: { opening, closing, change: closing - opening, adjustment: total, liability } };
  }

  // Net profit: the P&L lines by account.
  if (key === "np") {
    const rows = await sql`
      select a.code, a.name, a.account_type, -sum(l.base_amount)::float as amount
        from (${periodLines(companyId, r, branchId)}) l join account a on a.id = l.account_id
       where a.account_type in ('REVENUE', 'COGS', 'EXPENSE')
       group by a.code, a.name, a.account_type order by a.code`;
    return {
      title: "Net profit for the period",
      total: rows.reduce((s, x) => s + Number(x.amount), 0),
      rows: rows.map((x) => ({ date: "", entryId: "", entryNo: null, documentId: null, docNo: null, partner: null,
        description: `${x.code} ${x.name}`, account: x.account_type as string, amount: Number(x.amount) })),
    };
  }

  // Everything else is a per-entry figure from the shared allocation.
  const flows = await entryFlows(companyId, r, branchId);
  const pick: Record<string, { title: string; f: (e: EntryFlow) => number }> = {
    dep: { title: "Depreciation and amortisation", f: (e) => e.dep },
    noncash: { title: "Other non-cash items", f: (e) => e.nonCash },
    tax: { title: "Income tax paid", f: (e) => e.tax },
    "inv:purchase": { title: "Purchase of fixed assets", f: (e) => Math.min(0, e.invFa) },
    "inv:proceeds": { title: "Proceeds from sale of fixed assets", f: (e) => Math.max(0, e.invFa) },
    "inv:other": { title: "Other investing cash flows", f: (e) => e.invOther },
    "fin:loan_in": { title: "Loan proceeds", f: (e) => Math.max(0, e.borrow) },
    "fin:loan_out": { title: "Loan repayments", f: (e) => Math.min(0, e.borrow) },
    "fin:capital": { title: "Owner capital", f: (e) => e.capital },
    "fin:dist": { title: "Drawings / dividends paid", f: (e) => e.dist },
    "fin:other": { title: "Other financing cash flows", f: (e) => e.finOther },
  };
  const p = pick[key];
  if (!p) return null;
  const hits = flows.map((e) => ({ e, amount: p.f(e) })).filter((x) => Math.abs(x.amount) > 0.004)
    .sort((a, b) => b.e.date.localeCompare(a.e.date));
  const desc = await describeEntries(hits.map((h) => h.e.entryId));
  return {
    title: p.title,
    total: hits.reduce((s, h) => s + h.amount, 0),
    rows: hits.map(({ e, amount }) => {
      const d = desc.get(e.entryId);
      return { date: e.date, entryId: e.entryId, entryNo: e.entryNo, documentId: d?.documentId ?? null,
        docNo: d?.docNo ?? null, partner: d?.partner ?? null,
        description: e.memo ?? KIND_LABEL[d?.docType ?? ""] ?? null, amount };
    }),
  };
}
