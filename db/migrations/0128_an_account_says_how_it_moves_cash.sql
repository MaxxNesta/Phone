-- Where an account belongs in a cash flow statement, stored on the account.
--
-- The direct method needs nothing but the cash lines. The indirect method has
-- to know, for every other account, whether its movement is working capital,
-- a non-cash add-back, an investment, a borrowing or the owners' money — and
-- the chart said that only through which folder an account sat in, which is
-- editable data a rename would silently re-classify. So it is two fields:
--
--   cash_flow_class  OPERATING | INVESTING | FINANCING | CASH
--                    CASH is cash and bank: not an activity, the thing the
--                    statement reconciles to.
--   indirect_role    how the indirect method treats the account's movement:
--                    WORKING_CAPITAL   change shown as (increase)/decrease
--                    NON_CASH          P&L charge added back (depreciation)
--                    FIXED_ASSET       purchases / disposals (investing)
--                    BORROWING         loans, current portion included
--                    CAPITAL           owners' capital introduced
--                    DISTRIBUTION      drawings / dividends
--                    INCOME_TAX        income tax payable: cash paid shown
--                    RETAINED_EARNINGS year-end close lands here
--                    OPENING_BALANCE   opening balance equity
--                    OTHER             in its class, no particular line
--
-- Folders and names only SUGGEST the first values (fn_suggest_cash_flow);
-- cash_flow_confirmed stays false until someone sets them, and the chart of
-- accounts flags those for review. Classification of a movement still uses
-- the transaction as well: equipment bought with cash is investing, bought
-- on credit or through a loan is not a cash flow at all until paid.

alter table account
  add column if not exists cash_flow_class text,
  add column if not exists indirect_role text,
  add column if not exists cash_flow_confirmed boolean not null default false;

alter table account drop constraint if exists account_cash_flow_class_check;
alter table account add constraint account_cash_flow_class_check
  check (cash_flow_class in ('OPERATING', 'INVESTING', 'FINANCING', 'CASH'));
alter table account drop constraint if exists account_indirect_role_check;
alter table account add constraint account_indirect_role_check
  check (indirect_role in ('WORKING_CAPITAL', 'NON_CASH', 'FIXED_ASSET', 'BORROWING', 'CAPITAL',
                           'DISTRIBUTION', 'INCOME_TAX', 'RETAINED_EARNINGS', 'OPENING_BALANCE', 'OTHER'));

-- A suggestion from what the account already says about itself: its flags,
-- subledger, system role, type, the folder it sits in, and its name.
create or replace function fn_suggest_cash_flow(p_account uuid, out cls text, out role text)
language plpgsql stable as $$
declare
  a record;
  folder text;
  sys text;
begin
  select * into a from account where id = p_account;
  if not found then return; end if;
  select lower(p.name) into folder from account p where p.id = a.parent_id;
  select string_agg(s.role, ',') into sys from system_account s where s.account_id = a.id;
  folder := coalesce(folder, '');

  if a.is_cash_account or a.is_bank_account then
    cls := 'CASH'; role := null;
  elsif a.account_type in ('REVENUE', 'COGS', 'EXPENSE') then
    cls := 'OPERATING';
    role := case when lower(a.name) ~ 'depreciat|amorti[sz]|impairment' then 'NON_CASH' end;
  elsif a.account_type = 'EQUITY' then
    cls := 'FINANCING';
    role := case
      when sys like '%RETAINED_EARNINGS%' then 'RETAINED_EARNINGS'
      when sys like '%OPENING_BALANCE_EQUITY%' then 'OPENING_BALANCE'
      when lower(a.name) ~ 'drawing|dividend|distribution' then 'DISTRIBUTION'
      else 'CAPITAL' end;
  elsif a.account_type = 'ASSET' then
    if a.subledger is not null or sys is not null then
      cls := 'OPERATING'; role := 'WORKING_CAPITAL';
    elsif folder ~ 'non-current|fixed|intangible|property' or lower(a.name) ~ 'accumulated|land|building|equipment|furniture|vehicle|machinery|software' then
      cls := 'INVESTING'; role := 'FIXED_ASSET';
    else
      cls := 'OPERATING'; role := 'WORKING_CAPITAL';
    end if;
  elsif a.account_type = 'LIABILITY' then
    if lower(a.name) ~ 'income tax' then
      cls := 'OPERATING'; role := 'INCOME_TAX';
    elsif a.subledger is not null or sys is not null then
      cls := 'OPERATING'; role := 'WORKING_CAPITAL';
    elsif lower(a.name) ~ 'loan|borrow|debenture|mortgage' or folder ~ 'long-term|non-current' then
      cls := 'FINANCING'; role := 'BORROWING';
    else
      cls := 'OPERATING'; role := 'WORKING_CAPITAL';
    end if;
  end if;
end $$;

-- New accounts arrive suggested, never blank.
create or replace function fn_account_suggest_cash_flow() returns trigger
language plpgsql as $$
declare s record;
begin
  if new.cash_flow_class is null then
    -- The row is not in the table yet; suggest from a copy of it.
    select * into s from fn_suggest_cash_flow_row(new);
    new.cash_flow_class := s.cls;
    new.indirect_role := coalesce(new.indirect_role, s.role);
  end if;
  return new;
end $$;

-- The same rules over a row value, for the insert trigger.
create or replace function fn_suggest_cash_flow_row(a account, out cls text, out role text)
language plpgsql stable as $$
declare folder text;
begin
  select lower(p.name) into folder from account p where p.id = a.parent_id;
  folder := coalesce(folder, '');
  if a.is_cash_account or a.is_bank_account then
    cls := 'CASH';
  elsif a.account_type in ('REVENUE', 'COGS', 'EXPENSE') then
    cls := 'OPERATING';
    role := case when lower(a.name) ~ 'depreciat|amorti[sz]|impairment' then 'NON_CASH' end;
  elsif a.account_type = 'EQUITY' then
    cls := 'FINANCING';
    role := case when lower(a.name) ~ 'drawing|dividend|distribution' then 'DISTRIBUTION'
                 when lower(a.name) ~ 'retained' then 'RETAINED_EARNINGS'
                 when lower(a.name) ~ 'opening balance' then 'OPENING_BALANCE'
                 else 'CAPITAL' end;
  elsif a.account_type = 'ASSET' then
    if a.subledger is null and (folder ~ 'non-current|fixed|intangible|property'
        or lower(a.name) ~ 'accumulated|land|building|equipment|furniture|vehicle|machinery|software') then
      cls := 'INVESTING'; role := 'FIXED_ASSET';
    else
      cls := 'OPERATING'; role := 'WORKING_CAPITAL';
    end if;
  elsif a.account_type = 'LIABILITY' then
    if lower(a.name) ~ 'income tax' then cls := 'OPERATING'; role := 'INCOME_TAX';
    elsif a.subledger is null and (lower(a.name) ~ 'loan|borrow|debenture|mortgage' or folder ~ 'long-term|non-current') then
      cls := 'FINANCING'; role := 'BORROWING';
    else cls := 'OPERATING'; role := 'WORKING_CAPITAL';
    end if;
  end if;
end $$;

drop trigger if exists account_suggest_cash_flow on account;
create trigger account_suggest_cash_flow
  before insert on account
  for each row execute function fn_account_suggest_cash_flow();

-- Existing accounts: suggested, flagged for review.
update account a set cash_flow_class = s.cls, indirect_role = s.role
  from (select id, (fn_suggest_cash_flow(id)).* from account) s
 where s.id = a.id and a.cash_flow_class is null;

comment on column account.cash_flow_class is
  'Cash flow statement activity: OPERATING, INVESTING, FINANCING, or CASH (cash/bank, reconciled to). See migration 0128.';
comment on column account.indirect_role is
  'How the indirect cash flow method treats the account''s movement. See migration 0128.';
comment on column account.cash_flow_confirmed is
  'False while the classification is only a suggestion; the chart of accounts flags it for review.';
