import { sql } from "@/lib/db";
import { requirePermission, can, DISCOUNT_CEILING_PCT } from "@/lib/auth";
import { PosTill } from "@/components/pos-till";

export const metadata = { title: "POS" };

export default async function PosPage() {
  const user = await requirePermission("pos.sell");
  const co = user.companyId;

  const [locations, customers, salesmen, accounts, taxCodes] = await Promise.all([
    sql`select l.id, l.name, p.name as branch from location l
          left join location p on p.id = l.parent_id
         where l.company_id = ${co} and l.is_stock_location and l.is_active order by l.code`,
    sql`select id, name, code from business_partner
         where company_id = ${co} and is_customer and is_active and code <> 'WALKIN' order by name`,
    sql`select id, name from salesman where company_id = ${co} and is_active order by name`,
    sql`select id, code, name, is_bank_account from account
         where company_id = ${co} and is_cash_account and is_active order by code`,
    sql`select t.id, t.code, t.name, fn_tax_rate_on(t.id, current_date)::float as rate
          from tax_code t where t.company_id = ${co} order by t.code`,
  ]);

  return (
    <>
      <div className="page-head">
        <h1>POS / Counter Sale</h1>
        <p className="page-sub">Fast checkout · exact IMEI tracking · receipt-ready</p>
      </div>
      <PosTill
        locations={locations as never}
        customers={customers as never}
        salesmen={salesmen as never}
        accounts={accounts as never}
        taxCodes={taxCodes as never}
        showCost={can(user, "cost.view")}
        discountCeiling={can(user, "discount.unlimited") ? null : DISCOUNT_CEILING_PCT}
        defaultSalesman={null}
      />
    </>
  );
}
