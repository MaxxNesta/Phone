import { requirePermission, can } from "@/lib/auth";
import { sql } from "@/lib/db";
import { getFormData, type PickerItem } from "@/lib/actions";
import { allCategories } from "@/lib/tree";
import { todayLocal } from "@/lib/format";
import { seenLocations } from "@/lib/branch-scope";
import { createTradeIn } from "@/lib/secondhand-actions";
import { TradeInForm } from "@/components/secondhand-forms";
import { HelpHint } from "@/components/help-hint";

export const metadata = { title: "Trade-in" };

export default async function NewTradeIn() {
  const user = await requirePermission("sales.post");
  const locs = await seenLocations();
  const [form, locations, cash, categories] = await Promise.all([
    getFormData(),
    sql`select id, name from location where company_id = ${user.companyId} and is_stock_location and is_active and not is_quarantine
          ${locs ? sql`and id = any(${locs})` : sql``} order by code`,
    sql`select id, code, name from account where company_id = ${user.companyId} and is_cash_account and is_postable and is_active order by code`,
    allCategories(user.companyId),
  ]);
  // Phones only: a unit taken in is named by its IMEI.
  const catalog = { items: (form.items as unknown as PickerItem[]).filter((i) => i.tracks_serial), categories, uoms: form.uoms } as never;
  return (
    <>
      <div className="page-head">
        <span className="eyebrow">Sales</span>
        <h1>New trade-in</h1>
        <HelpHint>Sell a phone and take the customer&rsquo;s old one against it. The old phone is bought at its inspected value, the new one is sold, and the two settle against each other through Trade-in Clearing; the customer pays only the difference. A promotion above the inspected value is a discount on the new phone. Everything posts together, or not at all.</HelpHint>
      </div>
      <TradeInForm action={createTradeIn} catalog={catalog} locations={locations as never}
        cashAccounts={cash as never} today={todayLocal()} canPayOut={can(user, "purchase.post")} />
    </>
  );
}
