import { requirePermission } from "@/lib/auth";
import { sql } from "@/lib/db";
import { getFormData, type PickerItem } from "@/lib/actions";
import { allCategories } from "@/lib/tree";
import { todayLocal } from "@/lib/format";
import { seenLocations } from "@/lib/branch-scope";
import { createSecondhandBuy } from "@/lib/secondhand-actions";
import { BuySecondhandForm } from "@/components/secondhand-forms";
import { HelpHint } from "@/components/help-hint";

export const metadata = { title: "Buy secondhand" };

export default async function BuySecondhand() {
  const user = await requirePermission("purchase.post");
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
        <span className="eyebrow">Purchases</span>
        <h1>Buy secondhand</h1>
        <HelpHint>Record a phone bought from a customer or another shop. It is a purchase with its goods receipt: the phone goes on the shelf at the buyback price, as secondhand, with its inspection. A phone we sold before comes back as a new purchase and keeps its history; if the customer is returning that sale, record a customer return instead.</HelpHint>
      </div>
      <BuySecondhandForm action={createSecondhandBuy} catalog={catalog} locations={locations as never}
        cashAccounts={cash as never} today={todayLocal()} />
    </>
  );
}
