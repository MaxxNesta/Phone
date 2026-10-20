import { onlyMyLocations } from "@/lib/branch-scope";
import { sql } from "@/lib/db";
import { requirePermission, can, DISCOUNT_CEILING_PCT } from "@/lib/auth";
import { PosTill } from "@/components/pos-till";
import { channelsAt } from "@/lib/payment-channels";
import { getTranslations } from "next-intl/server";

export async function generateMetadata() {
  return { title: (await getTranslations("pos"))("title") };
}

export default async function PosPage() {
  const user = await requirePermission("pos.sell");
  const co = user.companyId;

  const [locations, customers, salesmen, taxCodes, focReasons, volumeDiscounts] = await Promise.all([
    sql`select l.id, l.name, p.name as branch from location l
          left join location p on p.id = l.parent_id
         where l.company_id = ${co} and l.is_stock_location and l.is_active
         -- The shop's main stock first: the one with the most stock on hand.
         order by (select coalesce(sum(qty_on_hand), 0) from v_stock_on_hand v
                    where v.location_id = l.id) desc, l.code`,
    sql`select id, name, code from business_partner
         where company_id = ${co} and is_customer and is_active and code <> 'WALKIN' order by name`,
    sql`select id, name from salesman where company_id = ${co} and is_active order by name`,
    sql`select t.id, t.code, t.name, fn_tax_rate_on(t.id, current_date)::float as rate
          from tax_code t where t.company_id = ${co} order by t.code`,
    sql`select id, name from foc_reason where company_id = ${co} order by name`,
    // The bands the sale will be priced with, so the till shows the same total.
    sql`select id, code, name, basis, item_id, item_group_id, min_value, max_value, discount_pct
          from volume_discount
         where company_id = ${co} and is_active
           and valid_from <= current_date and (valid_to is null or valid_to >= current_date)`,
  ]);

  const mine = (await onlyMyLocations(locations as unknown as { id: string }[])) as { id: string }[];
  // Each location's branch may pay into its own accounts.
  const channels = Object.fromEntries(await Promise.all(mine.map(async (l) => [l.id, await channelsAt(co, l.id)])));

  return (
    <>
      <PosTill
        locations={mine as never}
        channels={channels}
        customers={customers as never}
        salesmen={salesmen as never}
        taxCodes={taxCodes as never}
        focReasons={focReasons as never}
        volumeDiscounts={volumeDiscounts as never}
        showCost={can(user, "cost.view")}
        discountCeiling={can(user, "discount.unlimited") ? null : DISCOUNT_CEILING_PCT}
        defaultSalesman={null}
      />
    </>
  );
}
