import { BranchScope } from "@/components/branch-scope";
import { seenLocations } from "@/lib/branch-scope";
import { getCompany } from "@/lib/queries";
import { requireUser, can } from "@/lib/auth";
import { discountReport } from "@/lib/discount-report";
import { resolvePeriod } from "@/lib/period";
import { DiscountReportView } from "@/components/discount-report-view";
import { HelpHint } from "@/components/help-hint";

export const metadata = { title: "Discounts & free goods" };

export default async function DiscountsGiven({ searchParams }: { searchParams: Promise<{ p?: string }> }) {
  const [company, user] = await Promise.all([getCompany(), requireUser()]);
  if (!company) return <div className="empty">No company found.</div>;
  // A discount policy is judged over a year, not a month.
  const period = resolvePeriod((await searchParams).p ?? "12m");
  const r = await discountReport(company.id, "sales", period.from, period.to, await seenLocations());

  return (
    <>
      <div className="page-head">
        <span className="eyebrow">Sales</span>
        <h1>Discounts &amp; free goods</h1>
        <BranchScope />
        <HelpHint>
          Sales post at full price and every discount goes to 4190 Sales Discounts, so the income statement
          shows what was given away. Discounts on the invoice (per line, volume breaks, invoice-wide) and
          discounts agreed afterwards (credit notes marked Discount) are listed here line by line.
          <br /><br />
          Free goods are shown by category: <strong>with a sale</strong> (cost of sales, and an IFRS 15 share
          of the sale&rsquo;s revenue, though the invoice still prints them at 0) or a <strong>standalone
          giveaway</strong> (cost to the reason&rsquo;s own account, posted by a manager).
        </HelpHint>
      </div>
      <DiscountReportView side="sales" r={r} period={period} hrefFor={(k) => `?p=${k}`} seeCost={can(user, "cost.view")} />
    </>
  );
}
