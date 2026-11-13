import { todayLocal } from "@/lib/format";
import Link from "next/link";
import { scopedBranch, seenBranches } from "@/lib/branch-scope";
import { getCompany, getBranches, getCashConversionCycle } from "@/lib/queries";
import { getFinancialRatios, type Compare } from "@/lib/financial-ratios";
import { CashCycle } from "@/components/cash-cycle";
import { FinancialRatios, type RatioTab } from "@/components/financial-ratios";
import { AutoApply } from "@/components/auto-apply";

type Tab = RatioTab | "ccc";

const TABS: [Tab, string][] = [
  ["overview", "Overview"],
  ["liquidity", "Liquidity"],
  ["working-capital", "Working capital"],
  ["ccc", "Cash conversion cycle"],
  ["profitability", "Profitability"],
  ["risk", "Risk & leverage"],
];

const isDate = (d?: string) => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d);
const dayAfter = (d: string) => new Date(new Date(d).getTime() + 86_400_000).toISOString().slice(0, 10);

export default async function FinancialRatiosPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; from?: string; to?: string; compare?: string; branch?: string }>;
}) {
  const p = await searchParams;
  const company = await getCompany();
  if (!company) return <div className="empty">No company found.</div>;

  const tab = (TABS.find(([k]) => k === p.tab)?.[0] ?? "overview") as Tab;
  const today = todayLocal();
  const from = isDate(p.from) ? p.from! : `${today.slice(0, 4)}-01-01`;
  let to = isDate(p.to) ? p.to! : today;
  if (to < from) to = from;
  const compare: Compare = p.compare === "year" ? "year" : "previous";

  const branches = (await seenBranches((await getBranches(company.id)) as unknown as { id: string }[])) as unknown as Array<{
    id: string; code: string; name: string;
  }>;
  const branchId = await scopedBranch(p.branch && branches.some((b) => b.id === p.branch) ? p.branch : null);

  const link = (over: Record<string, string | undefined>) => {
    const q = new URLSearchParams();
    const all = { tab, from, to, compare, branch: branchId ?? undefined, ...over };
    for (const [k, v] of Object.entries(all)) if (v) q.set(k, String(v));
    return `/reports/financial-ratios?${q.toString()}`;
  };

  // Only what the open tab needs: the cycle has its own page of figures, and
  // the ratios tabs read the ledger once between them.
  const end = dayAfter(to);
  const cycle = tab === "ccc" || tab === "overview" || tab === "working-capital"
    ? await getCashConversionCycle(company.id, from, end) : null;
  const ratios = tab === "ccc" ? null : await getFinancialRatios(company.id, { from, to: end, compare, branchId });

  return (
    <div className="reportpage">
      <div className="reporthead">
        <div className="page-head">
          <span className="eyebrow">Reports</span>
          <h1>Financial ratios</h1>
          <p className="page-sub">How liquid, efficient, profitable and geared the business is, from the ledger.</p>
        </div>
        <div className="erp-tabs">
          {TABS.map(([k, t]) => (
            <Link key={k} href={link({ tab: k })} className={`erp-tab ${tab === k ? "here" : ""}`}>{t}</Link>
          ))}
        </div>
      </div>

      <form className="row" style={{ margin: 0, alignItems: "flex-end" }}>
        <input type="hidden" name="tab" value={tab} />
        <div className="field">
          <label htmlFor="from">From</label>
          <input id="from" name="from" type="date" defaultValue={from} />
        </div>
        <div className="field">
          <label htmlFor="to">To</label>
          <input id="to" name="to" type="date" defaultValue={to} />
        </div>
        {tab !== "ccc" && (
          <div className="field">
            <label htmlFor="compare">Compare</label>
            <select id="compare" name="compare" defaultValue={compare}>
              <option value="previous">Previous period</option>
              <option value="year">Same period last year</option>
            </select>
          </div>
        )}
        {tab !== "ccc" && branches.length > 1 && (
          <div className="field">
            <label htmlFor="branch">Branch</label>
            <select id="branch" name="branch" defaultValue={branchId ?? ""}>
              <option value="">All branches</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.code} · {b.name}</option>)}
            </select>
          </div>
        )}
        <div className="actions">
          <AutoApply />
          <button type="submit" data-apply>Update</button>
        </div>
      </form>

      {tab === "ccc" ? (
        <CashCycle current={cycle!.current} previous={cycle!.previous} trend={cycle!.trend} currency={company.base_currency} />
      ) : (
        <FinancialRatios
          tab={tab}
          current={ratios!.current}
          previous={ratios!.previous}
          trend={ratios!.trend}
          cycle={cycle ? { now: cycle.current, before: cycle.previous } : null}
          currency={company.base_currency}
          cycleHref={link({ tab: "ccc" })}
        />
      )}
    </div>
  );
}
