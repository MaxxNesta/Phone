import { BranchScope } from "@/components/branch-scope";
import { seenLocations } from "@/lib/branch-scope";
import { getCompany } from "@/lib/queries";
import { requireUser, can } from "@/lib/auth";
import { discountReport } from "@/lib/discount-report";
import { resolvePeriod } from "@/lib/period";
import { DiscountReportView } from "@/components/discount-report-view";
import { HelpHint } from "@/components/help-hint";

export const metadata = { title: "Discounts & free goods received" };

export default async function DiscountsReceived({ searchParams }: { searchParams: Promise<{ p?: string }> }) {
  const [company, user] = await Promise.all([getCompany(), requireUser()]);
  if (!company) return <div className="empty">No company found.</div>;
  const period = resolvePeriod((await searchParams).p ?? "12m");
  const r = await discountReport(company.id, "purchases", period.from, period.to, await seenLocations());

  return (
    <>
      <div className="page-head">
        <span className="eyebrow">Purchases</span>
        <h1>Discounts &amp; free goods received</h1>
        <BranchScope />
        <HelpHint>
          A supplier&rsquo;s discount lowers what the goods cost (net method, IAS 2), so it reaches profit as
          each phone is sold rather than sitting in its own account. Discounts on the bill and discounts agreed
          afterwards (debit notes marked Discount) are listed here, with where each one landed: stock still
          held, cost of sales for goods already sold, or price variance for goods not yet received.
          <br /><br />
          Free units from a supplier share the price of the paid ones, so they carry a cost of their own.
        </HelpHint>
      </div>
      <DiscountReportView side="purchases" r={r} period={period} hrefFor={(k) => `?p=${k}`} seeCost={can(user, "cost.view")} />
    </>
  );
}
