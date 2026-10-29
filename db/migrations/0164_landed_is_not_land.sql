-- "Landed" is not land
--
-- The cash-flow guess files an asset as a fixed asset when its name says
-- land, building, equipment and so on. "Landed Cost Clearing" matched on
-- "land", so the freight paid into it read on the cash-flow statement as
-- cash paid for fixed assets. The word is matched whole now, and the
-- clearing accounts (goods in before the bill, a landed cost before its
-- bill, goods out before the invoice) are working capital, as their
-- neighbours GR/IR and Goods Shipped Not Invoiced already were. An account
-- somebody set by hand keeps its setting.

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
    elsif folder ~ 'non-current|fixed|intangible|property' or lower(a.name) ~ 'accumulated|\mland\M|building|equipment|furniture|vehicle|machinery|software' then
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
        or lower(a.name) ~ 'accumulated|\mland\M|building|equipment|furniture|vehicle|machinery|software') then
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

update account a set cash_flow_class = 'OPERATING', indirect_role = 'WORKING_CAPITAL'
  from system_account s
 where s.account_id = a.id
   and s.role in ('GRIR_CLEARING', 'LANDED_COST_CLEARING', 'SHIPPED_NOT_INVOICED')
   and not coalesce(a.cash_flow_confirmed, false)
   and (a.cash_flow_class is distinct from 'OPERATING' or a.indirect_role is distinct from 'WORKING_CAPITAL');
