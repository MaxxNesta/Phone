-- A new shop takes cash, bank and MMQR
--
-- 0141 started every company with eight payment methods. Five of them
-- (KBZPay, AYA Pay, WavePay, card, other) had no account, so the till showed
-- them greyed out until someone mapped or hid them. A shop now starts with
-- the three almost every shop uses: Cash, Bank and MMQR, each with its
-- account. A wallet is added in Settings → Payment methods when the shop
-- takes it, and appears on the till as soon as it has an account.
--
-- Only the starting set changes. Existing companies keep their methods as
-- they are; nothing used is touched.

create or replace function fn_seed_payment_channels(p_company uuid) returns void
language plpgsql as $$
declare
    v_cash uuid;
    v_bank uuid;
    v_qr   uuid;
begin
    insert into payment_channel (company_id, code, name, kind, requires_reference, sort_order) values
        (p_company, 'CASH', 'Cash', 'CASH', false, 10),
        (p_company, 'BANK', 'Bank', 'BANK', false, 20),
        (p_company, 'MMQR', 'MMQR', 'QR',   true,  30)
    on conflict do nothing;

    select id into v_cash from account
     where company_id = p_company and is_cash_account and not is_bank_account and is_postable and is_active
     order by (code = '1000') desc, code limit 1;
    select id into v_bank from account
     where company_id = p_company and is_bank_account and is_postable and is_active
     order by (code = '1010') desc, code limit 1;
    -- The chart's own MMQR account when it has one, else the bank.
    select id into v_qr from account
     where company_id = p_company and is_cash_account and is_postable and is_active and name ilike '%mmqr%'
     order by code limit 1;

    insert into payment_channel_account (company_id, channel_id, account_id)
    select p_company, c.id, case c.code when 'CASH' then v_cash when 'BANK' then v_bank else coalesce(v_qr, v_bank) end
      from payment_channel c
     where c.company_id = p_company and c.code in ('CASH', 'BANK', 'MMQR')
       and case c.code when 'CASH' then v_cash when 'BANK' then v_bank else coalesce(v_qr, v_bank) end is not null
    on conflict do nothing;
end $$;
