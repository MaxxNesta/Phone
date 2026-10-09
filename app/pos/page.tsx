import { sql } from "@/lib/db";
import { requirePermission, can, DISCOUNT_CEILING_PCT } from "@/lib/auth";
import { PosTill } from "@/components/pos-till";

export const metadata = { title: "POS" };

export default async function PosPage() {
  const user = await requirePermission("pos.sell");
  const co = user.companyId;

  const [locations, customers, salesmen, accounts, taxCodes, focReasons, volumeDiscounts] = await Promise.all([
    sql`select l.id, l.name, p.name as branch from location l
          left join location p on p.id = l.parent_id
         where l.company_id = ${co} and l.is_stock_location and l.is_active
         -- The shop's main stock first: the one with the most stock on hand.
         order by (select coalesce(sum(qty_on_hand), 0) from v_stock_on_hand v
                    where v.location_id = l.id) desc, l.code`,
    sql`select id, name, code from business_partner
         where company_id = ${co} and is_customer and is_active and code <> 'WALKIN' order by name`,
    sql`select id, name from salesman where company_id = ${co} and is_active order by name`,
    sql`select id, code, name, is_bank_account from account
         where company_id = ${co} and is_cash_account and is_active order by code`,
    sql`select t.id, t.code, t.name, fn_tax_rate_on(t.id, current_date)::float as rate
          from tax_code t where t.company_id = ${co} order by t.code`,
    sql`select id, name from foc_reason where company_id = ${co} order by name`,
    // The bands the sale will be priced with, so the till shows the same total.
    sql`select id, code, name, basis, item_id, item_group_id, min_value, max_value, discount_pct
          from volume_discount
         where company_id = ${co} and is_active
           and valid_from <= current_date and (valid_to is null or valid_to >= current_date)`,
  ]);

  return (
    <>
      <div className="page-head hero">
        <h1>POS / Counter Sale</h1>
        <p className="page-sub">Fast checkout · exact IMEI tracking · receipt-ready</p>
      </div>
      <PosTill
        locations={locations as never}
        customers={customers as never}
        salesmen={salesmen as never}
        accounts={accounts as never}
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
