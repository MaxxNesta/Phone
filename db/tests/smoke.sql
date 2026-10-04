-- smoke.sql
-- Proves the database enforces the five accounting invariants by itself.
-- Every negative test below MUST be rejected by Postgres, not by application
-- code. Run against a scratch database:
--
--   psql "$DATABASE_URL" -f db/tests/smoke.sql
--
-- Expected output: every line reads PASS.

\set ON_ERROR_STOP on
\set QUIET on
set client_min_messages = warning;

begin;

-- ============================================================ seed data ===

insert into company (id, code, name, base_currency)
values ('11111111-1111-1111-1111-111111111111', 'TEST', 'Test Trading Co', 'MMK');

insert into fiscal_year (id, company_id, code, start_date, end_date)
values ('22222222-2222-2222-2222-222222222222',
        '11111111-1111-1111-1111-111111111111', '2026-27', '2026-04-01', '2027-03-31');

insert into fiscal_period (id, company_id, fiscal_year_id, period_no, start_date, end_date, status)
values
  ('33333333-3333-3333-3333-333333333331',
   '11111111-1111-1111-1111-111111111111',
   '22222222-2222-2222-2222-222222222222', 1, '2026-04-01', '2026-04-30', 'OPEN'),
  ('33333333-3333-3333-3333-333333333332',
   '11111111-1111-1111-1111-111111111111',
   '22222222-2222-2222-2222-222222222222', 2, '2026-05-01', '2026-05-31', 'CLOSED');

insert into account (id, company_id, code, name, account_type, is_control) values
  ('44444444-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   '1300', 'Inventory',           'ASSET',   false),
  ('44444444-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   '1200', 'Accounts Receivable', 'ASSET',   true),
  ('44444444-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111',
   '1100', 'Bank - KBZ',          'ASSET',   false),
  ('44444444-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111',
   '5000', 'Cost of Goods Sold',  'COGS',    false),
  ('44444444-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111',
   '4000', 'Sales Revenue',       'REVENUE', false);

-- A heading account, to prove non-postable accounts are rejected.
insert into account (id, company_id, code, name, account_type, is_postable)
values ('44444444-0000-0000-0000-000000000009',
        '11111111-1111-1111-1111-111111111111', '1000', 'Current Assets', 'ASSET', false);

insert into location (id, company_id, code, name, is_stock_location)
values ('55555555-5555-5555-5555-555555555555',
        '11111111-1111-1111-1111-111111111111', 'WH01', 'Main Warehouse', true),
       ('55555555-5555-5555-5555-555555555556',
        '11111111-1111-1111-1111-111111111111', 'OFF01', 'Head Office', false);

insert into uom (id, company_id, code, name)
values ('66666666-6666-6666-6666-666666666666',
        '11111111-1111-1111-1111-111111111111', 'PCS', 'Pieces');

-- Codes compose from segment; `code` is overwritten by trigger.
insert into item_group (id, company_id, segment, code, name)
values ('77777777-7777-7777-7777-777777777777',
        '11111111-1111-1111-1111-111111111111', '01', 'x', 'Beverages');

insert into item (id, company_id, item_group_id, serial, code, name, base_uom_id)
values ('88888888-8888-8888-8888-888888888888',
        '11111111-1111-1111-1111-111111111111',
        '77777777-7777-7777-7777-777777777777', '001', 'x', 'Test Item',
        '66666666-6666-6666-6666-666666666666');

insert into business_partner (id, company_id, code, name, is_customer)
values ('99999999-9999-9999-9999-999999999999',
        '11111111-1111-1111-1111-111111111111', 'CUST01', 'City Mart', true);

-- ========================================================= test harness ===

-- SET CONSTRAINTS persists for the remainder of the transaction, so each test
-- must re-defer before running or a preceding successful test leaves the
-- deferred triggers firing immediately and the next entry fails before its
-- lines are inserted.

create or replace function t_expect_fail(p_sql text, p_label text)
returns text language plpgsql as $$
begin
    set constraints all deferred;
    execute p_sql;
    -- Force deferred constraint triggers to fire now rather than at commit.
    set constraints all immediate;
    set constraints all deferred;
    return 'FAIL  ' || p_label || '  (no error raised)';
exception when others then
    return 'PASS  ' || p_label;
end;
$$;

create or replace function t_expect_ok(p_sql text, p_label text)
returns text language plpgsql as $$
begin
    set constraints all deferred;
    execute p_sql;
    set constraints all immediate;
    set constraints all deferred;
    return 'PASS  ' || p_label;
exception when others then
    return 'FAIL  ' || p_label || '  -> ' || left(sqlerrm, 90);
end;
$$;

\set QUIET off
\echo ''
\echo '=== INVARIANT 1 — every entry balances ==='

select t_expect_fail($sql$
    insert into journal_entry (id, company_id, entry_no, entry_date, fiscal_period_id, source_type, source_id)
    values ('aaaaaaaa-0000-0000-0000-000000000001',
            '11111111-1111-1111-1111-111111111111', 'JE-UNBAL', '2026-04-15', null, 'TEST', gen_random_uuid());
    insert into journal_line (company_id, journal_entry_id, line_no, account_id, currency, amount, base_amount)
    values ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001',
            1, '44444444-0000-0000-0000-000000000001', 'MMK', 100000, 100000);
    insert into journal_line (company_id, journal_entry_id, line_no, account_id, currency, amount, base_amount)
    values ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001',
            2, '44444444-0000-0000-0000-000000000003', 'MMK', -99999, -99999);
$sql$, 'unbalanced entry is rejected');

select t_expect_fail($sql$
    insert into journal_entry (id, company_id, entry_no, entry_date, fiscal_period_id, source_type, source_id)
    values ('aaaaaaaa-0000-0000-0000-000000000002',
            '11111111-1111-1111-1111-111111111111', 'JE-ONELINE', '2026-04-15', null, 'TEST', gen_random_uuid());
    insert into journal_line (company_id, journal_entry_id, line_no, account_id, currency, amount, base_amount)
    values ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000002',
            1, '44444444-0000-0000-0000-000000000001', 'MMK', 0.0000, 0.0000);
$sql$, 'single-line / zero-amount entry is rejected');

\echo ''
\echo '=== INVARIANT 5 — nothing posts into a closed period ==='

select t_expect_fail($sql$
    insert into journal_entry (company_id, entry_no, entry_date, fiscal_period_id, source_type, source_id)
    values ('11111111-1111-1111-1111-111111111111', 'JE-CLOSED', '2026-05-15', null, 'TEST', gen_random_uuid());
$sql$, 'posting into a CLOSED period is rejected');

select t_expect_fail($sql$
    insert into journal_entry (company_id, entry_no, entry_date, fiscal_period_id, source_type, source_id)
    values ('11111111-1111-1111-1111-111111111111', 'JE-NOPERIOD', '2030-01-01', null, 'TEST', gen_random_uuid());
$sql$, 'posting where no period exists is rejected');

\echo ''
\echo '=== Account guards ==='

select t_expect_fail($sql$
    insert into journal_entry (id, company_id, entry_no, entry_date, fiscal_period_id, source_type, source_id)
    values ('aaaaaaaa-0000-0000-0000-000000000003',
            '11111111-1111-1111-1111-111111111111', 'JE-HEADING', '2026-04-15', null, 'TEST', gen_random_uuid());
    insert into journal_line (company_id, journal_entry_id, line_no, account_id, currency, amount, base_amount)
    values ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000003',
            1, '44444444-0000-0000-0000-000000000009', 'MMK', 100, 100);
$sql$, 'posting to a non-postable heading account is rejected');

select t_expect_fail($sql$
    insert into journal_entry (id, company_id, entry_no, entry_date, fiscal_period_id)
    values ('aaaaaaaa-0000-0000-0000-000000000004',
            '11111111-1111-1111-1111-111111111111', 'JE-MANUAL-AR', '2026-04-15', null);
    insert into journal_line (company_id, journal_entry_id, line_no, account_id, currency, amount, base_amount, partner_id)
    values ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000004',
            1, '44444444-0000-0000-0000-000000000002', 'MMK', 100, 100,
            '99999999-9999-9999-9999-999999999999');
$sql$, 'manual journal entry to a control account is rejected');

\echo ''
\echo '=== Stock guards ==='

select t_expect_fail($sql$
    insert into stock_movement (company_id, item_id, location_id, movement_date, qty, unit_cost, total_cost)
    values ('11111111-1111-1111-1111-111111111111',
            '88888888-8888-8888-8888-888888888888',
            '55555555-5555-5555-5555-555555555556', '2026-04-15', 10, 100, 1000);
$sql$, 'stock movement into a non-stock location is rejected');

\echo ''
\echo '=== Valid postings succeed ==='

select t_expect_ok($sql$
    insert into journal_entry (id, company_id, entry_no, entry_date, fiscal_period_id, source_type, source_id)
    values ('bbbbbbbb-0000-0000-0000-000000000001',
            '11111111-1111-1111-1111-111111111111', 'JE-DELIVERY', '2026-04-28', null, 'DELIVERY', gen_random_uuid());
    insert into journal_line (company_id, journal_entry_id, line_no, account_id, currency, amount, base_amount, location_id)
    values ('11111111-1111-1111-1111-111111111111', 'bbbbbbbb-0000-0000-0000-000000000001',
            1, '44444444-0000-0000-0000-000000000004', 'MMK', 600000, 600000, '55555555-5555-5555-5555-555555555555'),
           ('11111111-1111-1111-1111-111111111111', 'bbbbbbbb-0000-0000-0000-000000000001',
            2, '44444444-0000-0000-0000-000000000001', 'MMK', -600000, -600000, '55555555-5555-5555-5555-555555555555');
$sql$, 'balanced delivery posting (Dr COGS / Cr Inventory)');

select t_expect_ok($sql$
    insert into journal_entry (id, company_id, entry_no, entry_date, fiscal_period_id, source_type, source_id)
    values ('bbbbbbbb-0000-0000-0000-000000000002',
            '11111111-1111-1111-1111-111111111111', 'JE-INVOICE', '2026-04-30', null, 'SALES_INVOICE', gen_random_uuid());
    insert into journal_line (company_id, journal_entry_id, line_no, account_id, currency, amount, base_amount, partner_id)
    values ('11111111-1111-1111-1111-111111111111', 'bbbbbbbb-0000-0000-0000-000000000002',
            1, '44444444-0000-0000-0000-000000000002', 'MMK', 1000000, 1000000, '99999999-9999-9999-9999-999999999999');
    insert into journal_line (company_id, journal_entry_id, line_no, account_id, currency, amount, base_amount)
    values ('11111111-1111-1111-1111-111111111111', 'bbbbbbbb-0000-0000-0000-000000000002',
            2, '44444444-0000-0000-0000-000000000005', 'MMK', -1000000, -1000000);
$sql$, 'sales invoice posting to AR control from a source document');

select t_expect_ok($sql$
    insert into stock_movement (company_id, item_id, location_id, movement_date, qty, unit_cost, total_cost)
    values ('11111111-1111-1111-1111-111111111111',
            '88888888-8888-8888-8888-888888888888',
            '55555555-5555-5555-5555-555555555555', '2026-04-20', 100, 6000, 600000);
$sql$, 'stock receipt into a stock location');

\echo ''
\echo '=== Immutability — corrections are reversals, never edits ==='

select t_expect_fail(
    $sql$ update journal_entry set memo = 'tampered'
           where id = 'bbbbbbbb-0000-0000-0000-000000000001'; $sql$,
    'UPDATE of a posted journal entry is rejected');

select t_expect_fail(
    $sql$ delete from journal_entry
           where id = 'bbbbbbbb-0000-0000-0000-000000000001'; $sql$,
    'DELETE of a posted journal entry is rejected');

select t_expect_fail(
    $sql$ update journal_line set base_amount = 1
           where journal_entry_id = 'bbbbbbbb-0000-0000-0000-000000000001'; $sql$,
    'UPDATE of a journal line is rejected');

select t_expect_fail(
    $sql$ delete from stock_movement
           where item_id = '88888888-8888-8888-8888-888888888888'; $sql$,
    'DELETE of a stock movement is rejected');

select t_expect_ok(
    $sql$ update journal_entry set reversed_by_entry_id = 'bbbbbbbb-0000-0000-0000-000000000002'
           where id = 'bbbbbbbb-0000-0000-0000-000000000001'; $sql$,
    'linking a reversal to a posted entry is permitted');

\echo ''
\echo '=== Derived state ==='

select 'trial balance rows: ' || count(*)::text as result from v_trial_balance;
select 'unbalanced entries (must be 0): ' || count(*)::text as result
  from v_check_unbalanced_entries;
select 'stock on hand qty: ' || coalesce(sum(qty_on_hand), 0)::text
     || ', value: ' || coalesce(sum(value_on_hand), 0)::text as result
  from v_stock_on_hand;
select 'moving average cost: ' || fn_moving_average_cost(
        '11111111-1111-1111-1111-111111111111',
        '88888888-8888-8888-8888-888888888888')::text as result;

\echo ''
rollback;
