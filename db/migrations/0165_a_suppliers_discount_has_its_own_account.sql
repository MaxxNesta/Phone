-- A supplier's discount has its own account
--
-- Purchase bills can now carry a discount, on a line and/or on the whole
-- bill. How it reaches the books is a company policy, because two shops
-- account for it two ways:
--
--   GROSS  The phones keep the price they were bought at, the supplier is
--          owed the discounted amount, and the difference is credited to
--          Purchase Discounts (the PURCHASE_DISCOUNT_RECEIVED account,
--          51201 here). The P&L shows the discount as its own deduction.
--          This is the legacy Ultra X practice and this company's choice.
--   NET    The discount lowers what the phones cost. Not available yet;
--          the engine refuses a discounted bill under it rather than
--          guessing.
--
-- The policy is read at posting time and never re-applied to a bill already
-- posted, so changing it cannot rewrite history. The app refuses a change
-- once any purchase bill carries a discount.

alter table company add column if not exists purchase_discount_policy text not null default 'GROSS';

do $$ begin
  alter table company add constraint company_purchase_discount_policy_check
    check (purchase_discount_policy in ('GROSS', 'NET'));
exception when duplicate_object then null; end $$;

comment on column company.purchase_discount_policy is
  'How a supplier''s discount on a purchase bill posts: GROSS (stock at the price before discount, '
  'discount credited to PURCHASE_DISCOUNT_RECEIVED) or NET (discount lowers stock cost; not yet available).';
