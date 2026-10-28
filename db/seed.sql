-- seed.sql
-- Demo data: a Yangon FMCG distributor, with complete document chains so the
-- workflow is visible end to end. Idempotent — safe to re-run.

set client_min_messages = warning;

-- ------------------------------------------------------------- seed helper --

-- Posts a balanced journal entry from a jsonb array of lines:
--   [{"code": "1200", "amt": 1000000, "partner": "<uuid>", "loc": "<uuid>"}]
-- Positive amt is a debit, negative a credit.
create or replace function seed_post(
    p_company     uuid,
    p_entry_no    text,
    p_date        date,
    p_source_type text,
    p_source_id   uuid,
    p_memo        text,
    p_lines       jsonb
) returns uuid language plpgsql as $$
declare
    v_entry uuid;
    v_line  jsonb;
    v_no    smallint := 0;
    v_acct  uuid;
begin
    insert into journal_entry (company_id, entry_no, entry_date, fiscal_period_id,
                               source_type, source_id, memo)
    values (p_company, p_entry_no, p_date, null, p_source_type, p_source_id, p_memo)
    returning id into v_entry;

    for v_line in select * from jsonb_array_elements(p_lines) loop
        v_no := v_no + 1;

        select id into v_acct from account
         where company_id = p_company and code = v_line->>'code';

        if v_acct is null then
            raise exception 'seed: no account with code %', v_line->>'code';
        end if;

        insert into journal_line (company_id, journal_entry_id, line_no, account_id,
                                  currency, amount, exchange_rate, base_amount,
                                  partner_id, location_id)
        values (p_company, v_entry, v_no, v_acct, 'MMK',
                (v_line->>'amt')::numeric, 1, (v_line->>'amt')::numeric,
                nullif(v_line->>'partner','')::uuid,
                nullif(v_line->>'loc','')::uuid);
    end loop;

    return v_entry;
end;
$$;

-- =========================================================================

do $seed$
declare
    co        uuid;
    fy        uuid;
    ygn_wh    uuid;  mdy_wh uuid;  ygn uuid;  mdy uuid;
    u_pcs     uuid;  u_ctn  uuid;
    g_bev     uuid;  g_snk  uuid;  g_hou uuid;
    pl_whole  uuid;  pl_retail uuid;
    tax_none  uuid;

    -- partners
    c_shwe uuid; c_aung uuid; c_golden uuid; c_thiri uuid;
    s_bev  uuid; s_snk  uuid; s_hou uuid;

    -- items
    i_cola uuid; i_juice uuid; i_water uuid;
    i_chips uuid; i_peanut uuid; i_deterg uuid; i_soap uuid;

    doc uuid; doc2 uuid; je uuid;
    m   smallint;
begin

if exists (select 1 from company where code = 'SHWE') then
    raise notice 'seed already applied';
    return;
end if;

-- ------------------------------------------------------------- company ----

insert into company (code, name, name_my, base_currency, fiscal_year_start_month)
values ('SHWE', 'Shwe Yadanar Trading Co., Ltd', 'ရွှေရတနာ ကုန်သွယ်ရေး', 'MMK', 4)
returning id into co;

insert into fiscal_year (company_id, code, start_date, end_date)
values (co, '2026-27', '2026-04-01', '2027-03-31')
returning id into fy;

for m in 0..11 loop
    insert into fiscal_period (company_id, fiscal_year_id, period_no, start_date, end_date, status)
    values (co, fy, m + 1,
            (date '2026-04-01' + (m || ' month')::interval)::date,
            ((date '2026-04-01' + ((m + 1) || ' month')::interval) - interval '1 day')::date,
            'OPEN');
end loop;

-- -------------------------------------------------------------- accounts --
-- The MTK chart, generated from db/chart.mjs by scripts/gen-seed-chart.mjs.
-- The same 215 accounts lib/setup.ts scaffolds and scripts/load-coa.mjs
-- loads: the demo and a real company are the same shape, so a report that
-- reads right here reads right there. Regenerate after changing the chart.

-- Sections. Not postable — they are the headings the chart is read under.
insert into account (company_id, code, name, account_type, is_postable) values
    (co, '1',      'Assets',                              'ASSET',     false),
    (co, '2',      'Liabilities',                         'LIABILITY',  false),
    (co, '3',      'Equity',                              'EQUITY',    false),
    (co, '4',      'Revenue',                             'REVENUE',   false),
    (co, '5',      'Cost of Goods Sold',                  'COGS',      false),
    (co, '6',      'Expenses',                            'EXPENSE',   false),
    (co, '7',      'Others',                              'REVENUE',   false);

-- Sections nested 1 deep, under the sections above.
insert into account (company_id, parent_id, code, name, account_type, is_postable)
select co, p.id, x.code, x.name, x.atype, false
from (values
    ('1', '11', 'Fixed Assets',                        'ASSET'::account_type),
    ('1', '13', 'Current Assets',                      'ASSET'::account_type),
    ('1', '16', 'Intangible Assets',                   'ASSET'::account_type),
    ('1', '17', 'Other Assets',                        'ASSET'::account_type),
    ('2', '21', 'Current Liabilities',                 'LIABILITY'::account_type),
    ('2', '23', 'Long-Term Liabilities',               'LIABILITY'::account_type),
    ('3', '31', 'Capital Stock',                       'EQUITY'::account_type),
    ('3', '32', 'Profit & Loss',                       'EQUITY'::account_type),
    ('3', '33', 'Opening Balance',                     'EQUITY'::account_type),
    ('4', '41', 'Sales',                               'REVENUE'::account_type),
    ('4', '43', 'Return In',                           'REVENUE'::account_type),
    ('5', '51', 'Purchase',                            'COGS'::account_type),
    ('5', '52', 'Return Out',                          'COGS'::account_type),
    ('5', '59', 'Adjustment',                          'COGS'::account_type),
    ('6', '61', 'General Expenses',                    'EXPENSE'::account_type),
    ('6', '64', 'Sales & Marketing Expenses',          'EXPENSE'::account_type),
    ('6', '66', 'Admin Expenses',                      'EXPENSE'::account_type),
    ('7', '71', 'Other Income',                        'REVENUE'::account_type),
    ('7', '75', 'Currency Conversion Adjustment',      'REVENUE'::account_type)
) as x(parent, code, name, atype)
join account p on p.company_id = co and p.code = x.parent;

-- Sections nested 2 deep, under the sections above.
insert into account (company_id, parent_id, code, name, account_type, is_postable)
select co, p.id, x.code, x.name, x.atype, false
from (values
    ('11', '113', 'Machinery',                           'ASSET'::account_type),
    ('11', '114', 'Furniture and Office Equipment',      'ASSET'::account_type),
    ('11', '115', 'Vehicles',                            'ASSET'::account_type),
    ('11', '121', 'Accumulated Depreciation',            'ASSET'::account_type),
    ('13', '131', 'Cash',                                'ASSET'::account_type),
    ('13', '132', 'Bank',                                'ASSET'::account_type),
    ('13', '133', 'Credit Card',                         'ASSET'::account_type),
    ('13', '135', 'Accounts Receivable',                 'ASSET'::account_type),
    ('13', '138', 'Advance (Other Department)',          'ASSET'::account_type),
    ('13', '141', 'Inventory',                           'ASSET'::account_type),
    ('13', '142', 'I.B.S.T',                             'ASSET'::account_type),
    ('13', '143', 'Clearing & Tax',                      'ASSET'::account_type),
    ('13', '151', 'Advance Paid',                        'ASSET'::account_type),
    ('13', '152', 'Prepaid Expenses',                    'ASSET'::account_type),
    ('16', '161', 'Software',                            'ASSET'::account_type),
    ('17', '171', 'Deferred Expenses',                   'ASSET'::account_type),
    ('21', '211', 'Accounts Payable',                    'LIABILITY'::account_type),
    ('21', '213', 'Advance Received',                    'LIABILITY'::account_type),
    ('21', '214', 'Consign Stock',                       'LIABILITY'::account_type),
    ('21', '215', 'Tax Payable',                         'LIABILITY'::account_type),
    ('23', '230', 'Long-Term Liabilities',               'LIABILITY'::account_type),
    ('31', '311', 'Founding Shares',                     'EQUITY'::account_type),
    ('31', '312', 'Ordinary Shares',                     'EQUITY'::account_type),
    ('32', '322', 'Profit and Loss',                     'EQUITY'::account_type),
    ('33', '331', 'Opening Balance',                     'EQUITY'::account_type),
    ('41', '411', 'Sales',                               'REVENUE'::account_type),
    ('41', '412', 'Sale Discount',                       'REVENUE'::account_type),
    ('41', '413', 'Other Incomes',                       'REVENUE'::account_type),
    ('43', '431', 'Return In',                           'REVENUE'::account_type),
    ('51', '511', 'Purchase',                            'COGS'::account_type),
    ('51', '512', 'Purchase Discount',                   'COGS'::account_type),
    ('51', '513', 'Purchase Commission',                 'COGS'::account_type),
    ('52', '521', 'Return Out',                          'COGS'::account_type),
    ('59', '599', 'Adjustment',                          'COGS'::account_type),
    ('61', '612', 'Selling & Distribution Expenses',     'EXPENSE'::account_type),
    ('61', '615', 'Inventory Expense',                   'EXPENSE'::account_type),
    ('64', '641', 'Marketing Expenses',                  'EXPENSE'::account_type),
    ('66', '660', 'Phone Service Expenses',              'EXPENSE'::account_type),
    ('66', '661', 'Administration Expenses',             'EXPENSE'::account_type),
    ('66', '663', 'Machinery Depreciation Expenses',     'EXPENSE'::account_type),
    ('66', '664', 'Furniture & Office Equipment Depr; Exp;',  'EXPENSE'::account_type),
    ('66', '665', 'Vehicles Depreciation Exp;',          'EXPENSE'::account_type),
    ('66', '666', 'Galaxy Amortisation',                 'EXPENSE'::account_type),
    ('71', '712', 'Tax Received',                        'REVENUE'::account_type),
    ('71', '714', 'Cash Service Income',                 'REVENUE'::account_type),
    ('75', '755', 'Currency Conversion Adjustment',      'REVENUE'::account_type)
) as x(parent, code, name, atype)
join account p on p.company_id = co and p.code = x.parent;

-- Postable accounts, each under the section it follows in the chart.
insert into account (company_id, parent_id, code, name, account_type,
                     is_control, is_cash_account, is_bank_account)
select co, p.id, x.code, x.name, x.atype, x.ctrl, x.cash, x.bank
from (values
    ('113', '11301', 'Generator & Solar',                   'ASSET'::account_type,   false,  false,  false),
    ('114', '11401', 'Save/မီးခံသေတ္တာ',                    'ASSET'::account_type,   false,  false,  false),
    ('114', '11402', 'Table, Chair & Locker',               'ASSET'::account_type,   false,  false,  false),
    ('114', '11403', 'Computer & Printer',                  'ASSET'::account_type,   false,  false,  false),
    ('114', '11404', 'AirCon & Freezer',                    'ASSET'::account_type,   false,  false,  false),
    ('114', '11405', 'Phone',                               'ASSET'::account_type,   false,  false,  false),
    ('114', '11406', 'Office Equipment',                    'ASSET'::account_type,   false,  false,  false),
    ('114', '11407', 'CCTV & Router',                       'ASSET'::account_type,   false,  false,  false),
    ('115', '11501', 'Cycle & EV Cycle',                    'ASSET'::account_type,   false,  false,  false),
    ('121', '12101', 'Accumulated Dep; Save/မီးခံသေတ္တာ',   'ASSET'::account_type,   false,  false,  false),
    ('121', '12102', 'Accumulated Dep; Table, Chair & Locker',  'ASSET'::account_type,   false,  false,  false),
    ('121', '12103', 'Accumulated Dep; Computer & Printer',  'ASSET'::account_type,   false,  false,  false),
    ('121', '12104', 'Accumulated Dep; AirCon & Freezer',   'ASSET'::account_type,   false,  false,  false),
    ('121', '12105', 'Accumulated Dep; Phone',              'ASSET'::account_type,   false,  false,  false),
    ('121', '12106', 'Accumulated Dep; Office Equipment',   'ASSET'::account_type,   false,  false,  false),
    ('121', '12107', 'Accumulated Dep; Cycle & EV Cycle',   'ASSET'::account_type,   false,  false,  false),
    ('121', '12108', 'Accumulated Dep; CCTV & Router',      'ASSET'::account_type,   false,  false,  false),
    ('121', '12109', 'Accumulated Dep; Generator & Solar',  'ASSET'::account_type,   false,  false,  false),
    ('121', '12110', 'Accumulated Amor; Galaxy Software',   'ASSET'::account_type,   false,  false,  false),
    ('131', '13101', 'Cash Account',                        'ASSET'::account_type,   false,  true,   false),
    ('131', '13102', 'Suspense Cash',                       'ASSET'::account_type,   false,  true,   false),
    ('131', '13103', 'Yuan Cash',                           'ASSET'::account_type,   false,  true,   false),
    ('132', '13201', 'UAB Bank Call Account',               'ASSET'::account_type,   false,  true,   true),
    ('132', '13202', 'KBZ Bank Current Account',            'ASSET'::account_type,   false,  true,   true),
    ('132', '13203', 'Yoma Bank Flexi Account',             'ASSET'::account_type,   false,  true,   true),
    ('132', '13204', 'AYA Bank Account',                    'ASSET'::account_type,   false,  true,   true),
    ('132', '13205', 'CB Bank Account',                     'ASSET'::account_type,   false,  true,   true),
    ('132', '13206', 'Daw Nan Yu War',                      'ASSET'::account_type,   false,  true,   true),
    ('132', '13207', 'MMQR (UAB)',                          'ASSET'::account_type,   false,  true,   true),
    ('132', '13208', 'UAB Bank (Cheque) Account',           'ASSET'::account_type,   false,  true,   true),
    ('132', '13209', 'KBZ Bank (Cheque) Account',           'ASSET'::account_type,   false,  true,   true),
    ('132', '13210', 'Yoma Bank (Cheque) Account',          'ASSET'::account_type,   false,  true,   true),
    ('132', '13211', 'AYA Bank (Cheque) Account',           'ASSET'::account_type,   false,  true,   true),
    ('132', '13212', 'CB Bank (Cheque) Account',            'ASSET'::account_type,   false,  true,   true),
    ('133', '13301', 'Credit Card',                         'ASSET'::account_type,   false,  true,   true),
    ('135', '13501', 'Accounts Receivable',                 'ASSET'::account_type,   true,   false,  false),
    ('138', '13801', 'Advance',                             'ASSET'::account_type,   false,  false,  false),
    ('141', '14101', 'Inventory (Opening)',                 'ASSET'::account_type,   false,  false,  false),
    ('142', '14201', 'Branch Stock Transfer',               'ASSET'::account_type,   false,  false,  false),
    ('143', '14301', 'GR/IR Clearing',                      'ASSET'::account_type,   false,  false,  false),
    ('143', '14302', 'Input Commercial Tax',                'ASSET'::account_type,   false,  false,  false),
    ('143', '14303', 'Goods Shipped Not Invoiced',          'ASSET'::account_type,   false,  false,  false),
    ('143', '14304', 'Landed Cost Clearing',                'ASSET'::account_type,   false,  false,  false),
    ('151', '15101', 'Prepayment (Sup)',                    'ASSET'::account_type,   false,  false,  false),
    ('151', '15102', 'Purchase Advance',                    'ASSET'::account_type,   false,  false,  false),
    ('152', '15201', 'Prepaid Rent',                        'ASSET'::account_type,   false,  false,  false),
    ('152', '15202', 'Prepaid Tax',                         'ASSET'::account_type,   false,  false,  false),
    ('152', '15203', 'Prepaid Delivery',                    'ASSET'::account_type,   false,  false,  false),
    ('161', '16101', 'Galaxy Software Installation',        'ASSET'::account_type,   false,  false,  false),
    ('171', '17101', 'Staff Loan',                          'ASSET'::account_type,   false,  false,  false),
    ('211', '21101', 'Accounts Payable',                    'LIABILITY'::account_type,  true,   false,  false),
    ('211', '21108', 'Payable Expenses',                    'LIABILITY'::account_type,  false,  false,  false),
    ('211', '21109', 'Payable (Other)',                     'LIABILITY'::account_type,  false,  false,  false),
    ('211', '21110', 'Accrued Expense',                     'LIABILITY'::account_type,  false,  false,  false),
    ('213', '21301', 'Sale Advance',                        'LIABILITY'::account_type,  false,  false,  false),
    ('213', '21302', 'Prereceive Customer',                 'LIABILITY'::account_type,  false,  false,  false),
    ('213', '21307', 'Sale Cash',                           'LIABILITY'::account_type,  false,  false,  false),
    ('214', '21401', 'Consign Stock',                       'LIABILITY'::account_type,  false,  false,  false),
    ('214', '21402', 'Unpaid Sold Consign',                 'LIABILITY'::account_type,  false,  false,  false),
    ('215', '21501', 'Commercial Tax Payable',              'LIABILITY'::account_type,  false,  false,  false),
    ('230', '23001', 'Loan',                                'LIABILITY'::account_type,  false,  false,  false),
    ('311', '31104', 'Capital Stock',                       'EQUITY'::account_type,  false,  false,  false),
    ('311', '31105', 'Capital',                             'EQUITY'::account_type,  false,  false,  false),
    ('312', '31203', 'Shares -Royal',                       'EQUITY'::account_type,  false,  false,  false),
    ('312', '31204', 'Shares -ACT',                         'EQUITY'::account_type,  false,  false,  false),
    ('312', '31205', 'Shares -RD',                          'EQUITY'::account_type,  false,  false,  false),
    ('322', '32201', 'Profit and Loss',                     'EQUITY'::account_type,  false,  false,  false),
    ('331', '33101', 'Opening Balance Equity',              'EQUITY'::account_type,  false,  false,  false),
    ('411', '41101', 'Sales (Default)',                     'REVENUE'::account_type,  false,  false,  false),
    ('411', '41102', 'Sales(Consign)',                      'REVENUE'::account_type,  false,  false,  false),
    ('411', '41105', 'FOC',                                 'REVENUE'::account_type,  false,  false,  false),
    ('411', '41106', 'Delivery Income',                     'REVENUE'::account_type,  false,  false,  false),
    ('412', '41201', 'Sales Discounts',                     'REVENUE'::account_type,  false,  false,  false),
    ('412', '41202', 'Sales Comm',                          'REVENUE'::account_type,  false,  false,  false),
    ('413', '41301', 'Other Incomes',                       'REVENUE'::account_type,  false,  false,  false),
    ('431', '43101', 'Return In',                           'REVENUE'::account_type,  false,  false,  false),
    ('431', '43103', 'ReturnIn Discount',                   'REVENUE'::account_type,  false,  false,  false),
    ('431', '43104', 'ReturnInFOC',                         'REVENUE'::account_type,  false,  false,  false),
    ('431', '43105', 'Return In (Charges)',                 'REVENUE'::account_type,  false,  false,  false),
    ('511', '51101', 'Branch Transfer (Stock)',             'COGS'::account_type,    false,  false,  false),
    ('511', '51105', 'Purchase (Consignment)',              'COGS'::account_type,    false,  false,  false),
    ('511', '51107', 'Pur Consign Opening',                 'COGS'::account_type,    false,  false,  false),
    ('511', '51108', 'Purchase',                            'COGS'::account_type,    false,  false,  false),
    ('511', '51109', 'Purchase(Consign Adjust)',            'COGS'::account_type,    false,  false,  false),
    ('511', '51110', 'Carriage Inward',                     'COGS'::account_type,    false,  false,  false),
    ('512', '51201', 'Purchase Discounts',                  'COGS'::account_type,    false,  false,  false),
    ('512', '51202', 'FOC Received',                        'COGS'::account_type,    false,  false,  false),
    ('513', '51301', 'Purchase Commission',                 'COGS'::account_type,    false,  false,  false),
    ('521', '52101', 'Purchase Return',                     'COGS'::account_type,    false,  false,  false),
    ('521', '52102', 'ReturnOut FOC',                       'COGS'::account_type,    false,  false,  false),
    ('599', '59902', 'Adjust amount',                       'COGS'::account_type,    false,  false,  false),
    ('599', '59905', 'Inventory Damage',                    'COGS'::account_type,    false,  false,  false),
    ('599', '59906', 'Damage Control A/C',                  'COGS'::account_type,    false,  false,  false),
    ('599', '59907', 'Purchase Price Variance',             'COGS'::account_type,    false,  false,  false),
    ('612', '61252', 'Salary',                              'EXPENSE'::account_type,  false,  false,  false),
    ('612', '61253', 'Overtime',                            'EXPENSE'::account_type,  false,  false,  false),
    ('612', '61254', 'Carriage Outward',                    'EXPENSE'::account_type,  false,  false,  false),
    ('615', '61504', 'Inventory Loss',                      'EXPENSE'::account_type,  false,  false,  false),
    ('615', '61506', 'Office Use',                          'EXPENSE'::account_type,  false,  false,  false),
    ('641', '64102', 'Sample',                              'EXPENSE'::account_type,  false,  false,  false),
    ('641', '64103', 'Money Adjust',                        'EXPENSE'::account_type,  false,  false,  false),
    ('641', '64104', 'Promotion',                           'EXPENSE'::account_type,  false,  false,  false),
    ('641', '64105', 'Packing Materials',                   'EXPENSE'::account_type,  false,  false,  false),
    ('660', '66001', 'Exg.Rate Gain/Loss',                  'EXPENSE'::account_type,  false,  false,  false),
    ('660', '66002', 'Warranty Service Expenses',           'EXPENSE'::account_type,  false,  false,  false),
    ('661', '66101', 'General Expenses',                    'EXPENSE'::account_type,  false,  false,  false),
    ('661', '66102', 'Municipal Tax',                       'EXPENSE'::account_type,  false,  false,  false),
    ('661', '66103', 'Training Expenses',                   'EXPENSE'::account_type,  false,  false,  false),
    ('661', '66104', 'Entertainment Expenses',              'EXPENSE'::account_type,  false,  false,  false),
    ('661', '66105', 'Rental Charges',                      'EXPENSE'::account_type,  false,  false,  false),
    ('661', '66106', 'Internet & Email',                    'EXPENSE'::account_type,  false,  false,  false),
    ('661', '66107', 'Cleaning Expenses',                   'EXPENSE'::account_type,  false,  false,  false),
    ('661', '66108', 'Insurance Expenses',                  'EXPENSE'::account_type,  false,  false,  false),
    ('661', '66109', 'Bank Charges',                        'EXPENSE'::account_type,  false,  false,  false),
    ('661', '66110', 'Tax & Rate : Government Fees',        'EXPENSE'::account_type,  false,  false,  false),
    ('661', '66111', 'Software Maintenance Expenses',       'EXPENSE'::account_type,  false,  false,  false),
    ('661', '66112', 'Meter Bill',                          'EXPENSE'::account_type,  false,  false,  false),
    ('661', '66113', 'Printing & Stationery Expenses',      'EXPENSE'::account_type,  false,  false,  false),
    ('661', '66114', 'Repair & Maintenance -Office Equipment',  'EXPENSE'::account_type,  false,  false,  false),
    ('661', '66115', 'Transportation Expenses',             'EXPENSE'::account_type,  false,  false,  false),
    ('661', '66116', 'Job Advertising Expenses',            'EXPENSE'::account_type,  false,  false,  false),
    ('661', '66117', 'Professional Fees',                   'EXPENSE'::account_type,  false,  false,  false),
    ('661', '66118', 'Phone Bill',                          'EXPENSE'::account_type,  false,  false,  false),
    ('661', '66119', 'Staff Welfare',                       'EXPENSE'::account_type,  false,  false,  false),
    ('661', '66120', 'Refreshment (water)',                 'EXPENSE'::account_type,  false,  false,  false),
    ('661', '66121', 'Cash Excess/ Deficit',                'EXPENSE'::account_type,  false,  false,  false),
    ('661', '66122', 'Service Charges',                     'EXPENSE'::account_type,  false,  false,  false),
    ('661', '66123', 'Other Materials',                     'EXPENSE'::account_type,  false,  false,  false),
    ('663', '66301', 'Depreciation For Generator/Solar',    'EXPENSE'::account_type,  false,  false,  false),
    ('664', '66401', 'Depreciation For Save/ မီးခံသေတ္တာ',  'EXPENSE'::account_type,  false,  false,  false),
    ('664', '66402', 'Depreciation For Table, Chair & Locker',  'EXPENSE'::account_type,  false,  false,  false),
    ('664', '66403', 'Depreciation For Computer & Printer',  'EXPENSE'::account_type,  false,  false,  false),
    ('664', '66404', 'Depreciation For AirCon & Freezer',   'EXPENSE'::account_type,  false,  false,  false),
    ('664', '66405', 'Depreciation For Phone',              'EXPENSE'::account_type,  false,  false,  false),
    ('664', '66406', 'Depreciation For Office Equipment',   'EXPENSE'::account_type,  false,  false,  false),
    ('664', '66407', 'Depreciation For CCTV & Router',      'EXPENSE'::account_type,  false,  false,  false),
    ('665', '66501', 'Depreciation For Cycle & EV Cycle',   'EXPENSE'::account_type,  false,  false,  false),
    ('666', '66601', 'Amortisation For Galaxy software',    'EXPENSE'::account_type,  false,  false,  false),
    ('712', '71204', 'Sale Tax',                            'REVENUE'::account_type,  false,  false,  false),
    ('714', '71401', 'Service Income',                      'REVENUE'::account_type,  false,  false,  false),
    ('714', '71402', 'Bank Interest',                       'REVENUE'::account_type,  false,  false,  false),
    ('755', '75501', 'Currency Conversion Adjust',          'REVENUE'::account_type,  false,  false,  false),
    ('755', '75502', 'Trial Adjust',                        'REVENUE'::account_type,  false,  false,  false)
) as x(parent, code, name, atype, ctrl, cash, bank)
join account p on p.company_id = co and p.code = x.parent;

insert into system_account (company_id, role, account_id)
select co, r.role, a.id
from (values
    ('GRIR_CLEARING',               '14301'),
    ('OPENING_BALANCE_EQUITY',      '33101'),
    ('RETAINED_EARNINGS',           '32201'),
    ('PURCHASE_PRICE_VARIANCE',     '59907'),
    ('PURCHASE_DISCOUNT_RECEIVED',  '51201'),
    ('SALES_DISCOUNT_ALLOWED',      '41201'),
    ('PROMOTION_EXPENSE',           '64104'),
    ('STOCK_ADJUSTMENT',            '59902'),
    ('FX_GAIN',                     '66001'),
    ('FX_LOSS',                     '66001'),
    ('ROUNDING_DIFFERENCE',         '66121'),
    ('DELIVERY_INCOME',             '41106'),
    ('SHIPPED_NOT_INVOICED',        '14303'),
    ('LANDED_COST_CLEARING',        '14304'),
    ('OTHER_PAYABLE',               '21109'),
    ('CUSTOMER_ADVANCE',            '21301'),
    ('SUPPLIER_ADVANCE',            '15102'),
    ('OUTPUT_TAX',                  '21501'),
    ('INPUT_TAX',                   '14302')
) as r(role, code)
join account a on a.company_id = co and a.code = r.code;

-- ------------------------------------------------------------- locations --

insert into location (company_id, code, name, name_my, is_stock_location)
values (co, 'YGN', 'Yangon Branch', 'ရန်ကုန်', false) returning id into ygn;
insert into location (company_id, parent_id, code, name, is_stock_location)
values (co, ygn, 'YGN-WH', 'Yangon Main Warehouse', true) returning id into ygn_wh;

insert into location (company_id, code, name, name_my, is_stock_location)
values (co, 'MDY', 'Mandalay Branch', 'မန္တလေး', false) returning id into mdy;
insert into location (company_id, parent_id, code, name, is_stock_location)
values (co, mdy, 'MDY-WH', 'Mandalay Warehouse', true) returning id into mdy_wh;

-- --------------------------------------------------- units, groups, items --

insert into uom (company_id, code, name) values (co, 'PCS', 'Pieces') returning id into u_pcs;
insert into uom (company_id, code, name) values (co, 'CTN', 'Carton')  returning id into u_ctn;

-- Segments compose into the full code: 01, 02, 03 at the top level.
insert into item_group (company_id, segment, code, name, name_my)
values (co, '01', 'x', 'Beverages', 'အအေးများ') returning id into g_bev;
insert into item_group (company_id, segment, code, name, name_my)
values (co, '02', 'x', 'Snacks', 'မုန့်များ') returning id into g_snk;
insert into item_group (company_id, segment, code, name, name_my)
values (co, '03', 'x', 'Household', 'အိမ်သုံး') returning id into g_hou;

insert into item (company_id, item_group_id, serial, code, name, name_my, base_uom_id) values
    (co, g_bev, '001', 'x', 'Cola 330ml Can', 'ကိုလာ ၃၃၀ml', u_pcs) returning id into i_cola;
insert into item (company_id, item_group_id, serial, code, name, base_uom_id) values
    (co, g_bev, '002', 'x', 'Orange Juice 1L', u_pcs) returning id into i_juice;
insert into item (company_id, item_group_id, serial, code, name, base_uom_id) values
    (co, g_bev, '003', 'x', 'Drinking Water 500ml', u_pcs) returning id into i_water;
insert into item (company_id, item_group_id, serial, code, name, base_uom_id) values
    (co, g_snk, '001', 'x', 'Potato Chips 45g', u_pcs) returning id into i_chips;
insert into item (company_id, item_group_id, serial, code, name, base_uom_id) values
    (co, g_snk, '002', 'x', 'Peanut Snack 60g', u_pcs) returning id into i_peanut;
insert into item (company_id, item_group_id, serial, code, name, base_uom_id) values
    (co, g_hou, '001', 'x', 'Laundry Detergent 1kg', u_pcs) returning id into i_deterg;
insert into item (company_id, item_group_id, serial, code, name, base_uom_id) values
    (co, g_hou, '002', 'x', 'Dish Soap 500ml', u_pcs) returning id into i_soap;

-- Carton conversions: the three-tier unit hierarchy in practice.
insert into item_uom (company_id, item_id, uom_id, factor) values
    (co, i_cola, u_ctn, 24), (co, i_water, u_ctn, 24), (co, i_chips, u_ctn, 60);

insert into price_level (company_id, code, name, sort_order)
values (co, 'WHOLE', 'Wholesale', 1) returning id into pl_whole;
insert into price_level (company_id, code, name, sort_order)
values (co, 'RETAIL', 'Retail', 2) returning id into pl_retail;

insert into item_price (company_id, item_id, price_level_id, uom_id, currency, price)
select co, x.item, pl_whole, u_pcs, 'MMK', x.price from (values
    (i_cola, 1000), (i_juice, 2800), (i_water, 350), (i_chips, 800),
    (i_peanut, 600), (i_deterg, 4500), (i_soap, 2400)
) as x(item, price);

-- Tax engine deferred; the shape is reserved. Every line points here for now.
insert into tax_code (company_id, code, name, rate)
values (co, 'NONE', 'No Commercial Tax', 0) returning id into tax_none;

-- ---------------------------------------------------- account determination --

insert into account_determination (company_id, role, item_group_id, account_id)
select co, r.role, null, a.id
from (values
    ('AR_CONTROL',                  '13501'),
    ('AP_CONTROL',                  '21101'),
    ('INVENTORY',                   '14101'),
    ('COGS',                        '51108'),
    ('REVENUE',                     '41101'),
    ('SALES_RETURN',                '43101')
) as r(role, code)
join account a on a.company_id = co and a.code = r.code;

-- Which balances a subledger owns, so the demo enforces the same rule the
-- product does: a journal voucher cannot revalue inventory or move AR.
-- Derived from the roles above, never from account codes.
update account a set subledger = 'CUSTOMER'
  from account_determination d
 where d.account_id = a.id and d.company_id = co and d.role = 'AR_CONTROL';
update account a set subledger = 'SUPPLIER'
  from account_determination d
 where d.account_id = a.id and d.company_id = co and d.role = 'AP_CONTROL';
update account a set subledger = 'INVENTORY'
  from account_determination d
 where d.account_id = a.id and d.company_id = co and d.role = 'INVENTORY';
update account a set subledger = 'PURCHASE_MATCHING'
  from system_account s
 where s.account_id = a.id and s.company_id = co and s.role = 'GRIR_CLEARING';

-- ------------------------------------------------------------- partners --

insert into business_partner (company_id, code, name, name_my, is_customer, township, payment_terms_days, price_level_id)
values (co, 'C-001', 'Shwe Yaung Ni Trading', 'ရွှေရောင်နီ', true, 'Lanmadaw', 30, pl_whole) returning id into c_shwe;
insert into business_partner (company_id, code, name, is_customer, township, payment_terms_days, price_level_id)
values (co, 'C-002', 'Aung Mingalar Mini Mart', true, 'Hlaing', 15, pl_whole) returning id into c_aung;
insert into business_partner (company_id, code, name, is_customer, township, payment_terms_days, price_level_id)
values (co, 'C-003', 'Golden Land Superstore', true, 'Bahan', 45, pl_whole) returning id into c_golden;
insert into business_partner (company_id, code, name, is_customer, township, payment_terms_days, price_level_id)
values (co, 'C-004', 'Thiri Retail (Mandalay)', true, 'Chanayethazan', 30, pl_whole) returning id into c_thiri;

insert into business_partner (company_id, code, name, is_supplier, payment_terms_days)
values (co, 'S-001', 'Myanmar Beverage Industries', true, 30) returning id into s_bev;
insert into business_partner (company_id, code, name, is_supplier, payment_terms_days)
values (co, 'S-002', 'Asia Snack Manufacturing', true, 30) returning id into s_snk;
insert into business_partner (company_id, code, name, is_supplier, payment_terms_days)
values (co, 'S-003', 'Yangon Household Goods', true, 45) returning id into s_hou;

-- ------------------------------------------------------------- salesmen --

insert into salesman (company_id, code, name, name_my, location_id, commission_pct) values
    (co, 'SM-01', 'Ko Myat Thu',  'ကိုမြတ်သူ',  ygn_wh, 2),
    (co, 'SM-02', 'Ma Thida Win', 'မသီတာဝင်း', ygn_wh, 2),
    (co, 'SM-03', 'Ko Zaw Lin',   null,         mdy_wh, 1.5),
    (co, 'SM-04', 'Counter Sale', null,         ygn_wh, 0);

-- ----------------------------------------------------------- promotions --

insert into promotion (company_id, code, name, discount_pct, valid_from) values
    (co, 'PROMO-THINGYAN', 'Thingyan 5% off',   5, '2026-04-01'),
    (co, 'PROMO-BULK',     'Bulk order 3% off', 3, '2026-04-01');

insert into promotion (company_id, code, name, item_group_id, buy_qty, free_qty, valid_from)
values (co, 'PROMO-B10G1', 'Buy 10 get 1 free', g_bev, 10, 1, '2026-04-01');

-- Cash and bank flags come with the chart above (131 Cash, 132 Bank), so
-- there is nothing to set here.

-- How customers pay: cash, bank, card and the Myanmar wallets (0141).
perform fn_seed_payment_channels(co);

-- Free-of-charge reasons. Stock still leaves, but the cost lands in expense
-- rather than COGS, so a giveaway is visible instead of quietly eroding
-- gross margin.
insert into foc_reason (company_id, code, name, name_my, account_id)
select co, r.code, r.name, r.name_my, a.id
from (values
    ('PROMOTION', 'Promotional giveaway', 'ကြော်ငြာအတွက်', '64104'),
    ('SAMPLE',    'Customer sample',      null,            '64104'),
    ('OFFICE',    'Office use',           null,            '64104'),
    ('DAMAGED',   'Damaged or expired',   null,            '59902')
) as r(code, name, name_my, acct)
join account a on a.company_id = co and a.code = r.acct;

-- ------------------------------------------------------- numbering series --

insert into number_series (company_id, document_type, fiscal_year_id, prefix, next_value)
select co, t.dt, fy, t.px, t.nv from (values
    ('PURCHASE_ORDER','PO-',3), ('GOODS_RECEIPT','GR-',4), ('PURCHASE_INVOICE','PI-',3),
    ('SUPPLIER_PAYMENT','PAY-',2), ('SALES_ORDER','SO-',5), ('DELIVERY','DO-',5),
    ('SALES_INVOICE','SI-',5), ('CUSTOMER_RECEIPT','RC-',3),
    ('PURCHASE_RETURN','PR-',1), ('SALES_RETURN','SR-',1),
    ('STOCK_ADJUSTMENT','ADJ-',1), ('STOCK_TRANSFER','TRF-',1), ('OPENING_BALANCE','OB-',2),
    ('CASH_VOUCHER','CV-',1), ('BANK_VOUCHER','BV-',1),
    ('JOURNAL_VOUCHER','JV-',1), ('CASH_TRANSFER','CT-',1), ('JOURNAL','JE-',1)
) as t(dt, px, nv);

-- =========================== DOCUMENTS ====================================
-- Opening capital, then complete purchase and sales chains.

-- Opening capital injection.
insert into document (company_id, doc_type, doc_no, fiscal_year_id, doc_date, posting_date,
                      currency, status, net_total, gross_total, memo, posted_at)
values (co, 'OPENING_BALANCE', 'OB-000001', fy, '2026-04-01', '2026-04-01',
        'MMK', 'POSTED', 50000000, 50000000, 'Opening capital', now())
returning id into doc;
je := seed_post(co, 'JE-000001', '2026-04-01', 'OPENING_BALANCE', doc, 'Opening capital',
      jsonb_build_array(
        jsonb_build_object('code','13201','amt', 50000000),
        jsonb_build_object('code','31105','amt',-50000000)));
update document set journal_entry_id = je where id = doc;

-- ---- PURCHASE CHAIN 1 (complete): PO -> GR -> PI -> Payment --------------

insert into document (company_id, doc_type, doc_no, fiscal_year_id, doc_date, posting_date,
                      partner_id, location_id, currency, status, net_total, gross_total, posted_at)
values (co, 'PURCHASE_ORDER', 'PO-000001', fy, '2026-07-02', '2026-07-02',
        s_bev, ygn_wh, 'MMK', 'POSTED', 8500000, 8500000, now())
returning id into doc;
insert into document_line (company_id, document_id, line_no, item_id, location_id,
                           entered_qty, entered_uom_id, base_qty, unit_price,
                           net_amount, tax_code_id, gross_amount)
values (co, doc, 1, i_cola,  ygn_wh, 5000, u_pcs, 5000, 850, 4250000, tax_none, 4250000),
       (co, doc, 2, i_water, ygn_wh,10000, u_pcs,10000, 250, 2500000, tax_none, 2500000),
       (co, doc, 3, i_juice, ygn_wh,  800, u_pcs,  800,2200, 1760000, tax_none, 1760000);
doc2 := doc;

-- Goods receipt against that PO.
insert into document (company_id, doc_type, doc_no, fiscal_year_id, doc_date, posting_date,
                      partner_id, location_id, currency, status, source_document_id,
                      net_total, gross_total, posted_at)
values (co, 'GOODS_RECEIPT', 'GR-000001', fy, '2026-07-10', '2026-07-10',
        s_bev, ygn_wh, 'MMK', 'POSTED', doc2, 8510000, 8510000, now())
returning id into doc;
insert into document_line (company_id, document_id, line_no, item_id, location_id,
                           entered_qty, entered_uom_id, base_qty, unit_price,
                           net_amount, tax_code_id, gross_amount)
values (co, doc, 1, i_cola,  ygn_wh, 5000, u_pcs, 5000, 850, 4250000, tax_none, 4250000),
       (co, doc, 2, i_water, ygn_wh,10000, u_pcs,10000, 250, 2500000, tax_none, 2500000),
       (co, doc, 3, i_juice, ygn_wh,  800, u_pcs,  800,2200, 1760000, tax_none, 1760000);

insert into stock_movement (company_id, item_id, location_id, movement_date, qty, unit_cost, total_cost, document_id)
values (co, i_cola,  ygn_wh, '2026-07-10',  5000,  850, 4250000, doc),
       (co, i_water, ygn_wh, '2026-07-10', 10000,  250, 2500000, doc),
       (co, i_juice, ygn_wh, '2026-07-10',   800, 2200, 1760000, doc);

je := seed_post(co, 'JE-000002', '2026-07-10', 'GOODS_RECEIPT', doc, 'GR-000001 from Myanmar Beverage',
      jsonb_build_array(
        jsonb_build_object('code','14101','amt', 8510000,'loc',ygn_wh),
        jsonb_build_object('code','14301','amt',-8510000)));
update document set journal_entry_id = je where id = doc;

-- Supplier invoice: billed 8,530,000 against a 8,510,000 receipt.
-- The 20,000 difference lands in Purchase Price Variance (decision D1).
insert into document (company_id, doc_type, doc_no, fiscal_year_id, doc_date, posting_date, due_date,
                      partner_id, currency, status, source_document_id,
                      net_total, gross_total, posted_at)
values (co, 'PURCHASE_INVOICE', 'PI-000001', fy, '2026-07-12', '2026-07-12', '2026-08-11',
        s_bev, 'MMK', 'POSTED', doc, 8530000, 8530000, now())
returning id into doc;
je := seed_post(co, 'JE-000003', '2026-07-12', 'PURCHASE_INVOICE', doc, 'PI-000001',
      jsonb_build_array(
        jsonb_build_object('code','14301','amt', 8510000),
        jsonb_build_object('code','59907','amt',   20000),
        jsonb_build_object('code','21101','amt',-8530000,'partner',s_bev)));
update document set journal_entry_id = je where id = doc;
doc2 := doc;

insert into document (company_id, doc_type, doc_no, fiscal_year_id, doc_date, posting_date,
                      partner_id, currency, status, net_total, gross_total, posted_at)
values (co, 'SUPPLIER_PAYMENT', 'PAY-000001', fy, '2026-08-05', '2026-08-05',
        s_bev, 'MMK', 'POSTED', 8530000, 8530000, now())
returning id into doc;
insert into payment_allocation (company_id, payment_id, invoice_id, amount, base_amount)
values (co, doc, doc2, 8530000, 8530000);
je := seed_post(co, 'JE-000004', '2026-08-05', 'SUPPLIER_PAYMENT', doc, 'PAY-000001 settling PI-000001',
      jsonb_build_array(
        jsonb_build_object('code','21101','amt', 8530000,'partner',s_bev),
        jsonb_build_object('code','13201','amt',-8530000)));
update document set journal_entry_id = je where id = doc;

-- ---- PURCHASE CHAIN 2 (goods in, invoice not yet received) ---------------
-- Leaves a balance in GR/IR — the working report that flags missing bills.

insert into document (company_id, doc_type, doc_no, fiscal_year_id, doc_date, posting_date,
                      partner_id, location_id, currency, status,
                      net_total, gross_total, posted_at)
values (co, 'GOODS_RECEIPT', 'GR-000002', fy, '2026-08-03', '2026-08-03',
        s_snk, ygn_wh, 'MMK', 'POSTED', 3300000, 3300000, now())
returning id into doc;
insert into document_line (company_id, document_id, line_no, item_id, location_id,
                           entered_qty, entered_uom_id, base_qty, unit_price,
                           net_amount, tax_code_id, gross_amount)
values (co, doc, 1, i_chips,  ygn_wh, 4000, u_pcs, 4000, 600, 2400000, tax_none, 2400000),
       (co, doc, 2, i_peanut, ygn_wh, 2000, u_pcs, 2000, 450,  900000, tax_none,  900000);
insert into stock_movement (company_id, item_id, location_id, movement_date, qty, unit_cost, total_cost, document_id)
values (co, i_chips,  ygn_wh, '2026-08-03', 4000, 600, 2400000, doc),
       (co, i_peanut, ygn_wh, '2026-08-03', 2000, 450,  900000, doc);
je := seed_post(co, 'JE-000005', '2026-08-03', 'GOODS_RECEIPT', doc, 'GR-000002 — supplier invoice outstanding',
      jsonb_build_array(
        jsonb_build_object('code','14101','amt', 3300000,'loc',ygn_wh),
        jsonb_build_object('code','14301','amt',-3300000)));
update document set journal_entry_id = je where id = doc;

-- Household goods, invoiced and paid.
insert into document (company_id, doc_type, doc_no, fiscal_year_id, doc_date, posting_date,
                      partner_id, location_id, currency, status,
                      net_total, gross_total, posted_at)
values (co, 'GOODS_RECEIPT', 'GR-000003', fy, '2026-07-20', '2026-07-20',
        s_hou, ygn_wh, 'MMK', 'POSTED', 6100000, 6100000, now())
returning id into doc;
insert into document_line (company_id, document_id, line_no, item_id, location_id,
                           entered_qty, entered_uom_id, base_qty, unit_price,
                           net_amount, tax_code_id, gross_amount)
values (co, doc, 1, i_deterg, ygn_wh, 1000, u_pcs, 1000, 3500, 3500000, tax_none, 3500000),
       (co, doc, 2, i_soap,   ygn_wh, 1500, u_pcs, 1500, 1800, 2700000, tax_none, 2700000);
insert into stock_movement (company_id, item_id, location_id, movement_date, qty, unit_cost, total_cost, document_id)
values (co, i_deterg, ygn_wh, '2026-07-20', 1000, 3500, 3500000, doc),
       (co, i_soap,   ygn_wh, '2026-07-20', 1500, 1800, 2700000, doc);
je := seed_post(co, 'JE-000006', '2026-07-20', 'GOODS_RECEIPT', doc, 'GR-000003',
      jsonb_build_array(
        jsonb_build_object('code','14101','amt', 6200000,'loc',ygn_wh),
        jsonb_build_object('code','14301','amt',-6200000)));
update document set journal_entry_id = je where id = doc;

insert into document (company_id, doc_type, doc_no, fiscal_year_id, doc_date, posting_date, due_date,
                      partner_id, currency, status, source_document_id, net_total, gross_total, posted_at)
values (co, 'PURCHASE_INVOICE', 'PI-000002', fy, '2026-07-22', '2026-07-22', '2026-09-05',
        s_hou, 'MMK', 'POSTED', doc, 6200000, 6200000, now())
returning id into doc;
je := seed_post(co, 'JE-000007', '2026-07-22', 'PURCHASE_INVOICE', doc, 'PI-000002',
      jsonb_build_array(
        jsonb_build_object('code','14301','amt', 6200000),
        jsonb_build_object('code','21101','amt',-6200000,'partner',s_hou)));
update document set journal_entry_id = je where id = doc;

-- ---- SALES CHAIN 1 (complete): SO -> Delivery -> Invoice -> Receipt ------

insert into document (company_id, doc_type, doc_no, fiscal_year_id, doc_date, posting_date,
                      partner_id, location_id, currency, status, net_total, gross_total, posted_at)
values (co, 'SALES_ORDER', 'SO-000001', fy, '2026-07-25', '2026-07-25',
        c_shwe, ygn_wh, 'MMK', 'POSTED', 3400000, 3400000, now())
returning id into doc;
insert into document_line (company_id, document_id, line_no, item_id, location_id,
                           entered_qty, entered_uom_id, base_qty, unit_price,
                           net_amount, tax_code_id, gross_amount)
values (co, doc, 1, i_cola,  ygn_wh, 2000, u_pcs, 2000, 1000, 2000000, tax_none, 2000000),
       (co, doc, 2, i_water, ygn_wh, 4000, u_pcs, 4000,  350, 1400000, tax_none, 1400000);
doc2 := doc;

insert into document (company_id, doc_type, doc_no, fiscal_year_id, doc_date, posting_date,
                      partner_id, location_id, currency, status, source_document_id,
                      net_total, gross_total, posted_at)
values (co, 'DELIVERY', 'DO-000001', fy, '2026-07-28', '2026-07-28',
        c_shwe, ygn_wh, 'MMK', 'POSTED', doc2, 3400000, 3400000, now())
returning id into doc;
insert into document_line (company_id, document_id, line_no, item_id, location_id,
                           entered_qty, entered_uom_id, base_qty, unit_price,
                           net_amount, tax_code_id, gross_amount)
values (co, doc, 1, i_cola,  ygn_wh, 2000, u_pcs, 2000, 1000, 2000000, tax_none, 2000000),
       (co, doc, 2, i_water, ygn_wh, 4000, u_pcs, 4000,  350, 1400000, tax_none, 1400000);
insert into stock_movement (company_id, item_id, location_id, movement_date, qty, unit_cost, total_cost, document_id)
values (co, i_cola,  ygn_wh, '2026-07-28', -2000, 850, -1700000, doc),
       (co, i_water, ygn_wh, '2026-07-28', -4000, 250, -1000000, doc);
je := seed_post(co, 'JE-000008', '2026-07-28', 'DELIVERY', doc, 'DO-000001 — cost recognised',
      jsonb_build_array(
        jsonb_build_object('code','51108','amt', 2700000,'loc',ygn_wh),
        jsonb_build_object('code','14101','amt',-2700000,'loc',ygn_wh)));
update document set journal_entry_id = je where id = doc;

insert into document (company_id, doc_type, doc_no, fiscal_year_id, doc_date, posting_date, due_date,
                      partner_id, currency, status, source_document_id, net_total, gross_total, posted_at)
values (co, 'SALES_INVOICE', 'SI-000001', fy, '2026-07-30', '2026-07-30', '2026-08-29',
        c_shwe, 'MMK', 'POSTED', doc, 3400000, 3400000, now())
returning id into doc;
je := seed_post(co, 'JE-000009', '2026-07-30', 'SALES_INVOICE', doc, 'SI-000001 — revenue recognised',
      jsonb_build_array(
        jsonb_build_object('code','13501','amt', 3400000,'partner',c_shwe),
        jsonb_build_object('code','41101','amt',-3400000)));
update document set journal_entry_id = je where id = doc;
doc2 := doc;

insert into document (company_id, doc_type, doc_no, fiscal_year_id, doc_date, posting_date,
                      partner_id, currency, status, net_total, gross_total, posted_at)
values (co, 'CUSTOMER_RECEIPT', 'RC-000001', fy, '2026-08-08', '2026-08-08',
        c_shwe, 'MMK', 'POSTED', 3400000, 3400000, now())
returning id into doc;
insert into payment_allocation (company_id, payment_id, invoice_id, amount, base_amount)
values (co, doc, doc2, 3400000, 3400000);
je := seed_post(co, 'JE-000010', '2026-08-08', 'CUSTOMER_RECEIPT', doc, 'RC-000001 settling SI-000001',
      jsonb_build_array(
        jsonb_build_object('code','13201','amt', 3400000),
        jsonb_build_object('code','13501','amt',-3400000,'partner',c_shwe)));
update document set journal_entry_id = je where id = doc;

-- ---- SALES CHAIN 2 (invoiced, overdue, partly paid) ----------------------

insert into document (company_id, doc_type, doc_no, fiscal_year_id, doc_date, posting_date,
                      partner_id, location_id, currency, status, net_total, gross_total, posted_at)
values (co, 'DELIVERY', 'DO-000002', fy, '2026-07-05', '2026-07-05',
        c_golden, ygn_wh, 'MMK', 'POSTED', 5250000, 5250000, now())
returning id into doc;
insert into document_line (company_id, document_id, line_no, item_id, location_id,
                           entered_qty, entered_uom_id, base_qty, unit_price,
                           net_amount, tax_code_id, gross_amount)
values (co, doc, 1, i_deterg, ygn_wh, 500, u_pcs, 500, 4500, 2250000, tax_none, 2250000),
       (co, doc, 2, i_soap,   ygn_wh,1250, u_pcs,1250, 2400, 3000000, tax_none, 3000000);
insert into stock_movement (company_id, item_id, location_id, movement_date, qty, unit_cost, total_cost, document_id)
values (co, i_deterg, ygn_wh, '2026-07-05', -500, 3500, -1750000, doc),
       (co, i_soap,   ygn_wh, '2026-07-05',-1250, 1800, -2250000, doc);
je := seed_post(co, 'JE-000011', '2026-07-05', 'DELIVERY', doc, 'DO-000002',
      jsonb_build_array(
        jsonb_build_object('code','51108','amt', 4000000,'loc',ygn_wh),
        jsonb_build_object('code','14101','amt',-4000000,'loc',ygn_wh)));
update document set journal_entry_id = je where id = doc;

insert into document (company_id, doc_type, doc_no, fiscal_year_id, doc_date, posting_date, due_date,
                      partner_id, currency, status, source_document_id, net_total, gross_total, posted_at)
values (co, 'SALES_INVOICE', 'SI-000002', fy, '2026-07-06', '2026-07-06', '2026-07-21',
        c_golden, 'MMK', 'POSTED', doc, 5250000, 5250000, now())
returning id into doc;
je := seed_post(co, 'JE-000012', '2026-07-06', 'SALES_INVOICE', doc, 'SI-000002',
      jsonb_build_array(
        jsonb_build_object('code','13501','amt', 5250000,'partner',c_golden),
        jsonb_build_object('code','41101','amt',-5250000)));
update document set journal_entry_id = je where id = doc;
doc2 := doc;

-- Partial payment: 2,000,000 of 5,250,000. Open-item matching means the
-- remaining 3,250,000 stays attached to this specific invoice.
insert into document (company_id, doc_type, doc_no, fiscal_year_id, doc_date, posting_date,
                      partner_id, currency, status, net_total, gross_total, posted_at)
values (co, 'CUSTOMER_RECEIPT', 'RC-000002', fy, '2026-08-01', '2026-08-01',
        c_golden, 'MMK', 'POSTED', 2000000, 2000000, now())
returning id into doc;
insert into payment_allocation (company_id, payment_id, invoice_id, amount, base_amount)
values (co, doc, doc2, 2000000, 2000000);
je := seed_post(co, 'JE-000013', '2026-08-01', 'CUSTOMER_RECEIPT', doc, 'RC-000002 part payment of SI-000002',
      jsonb_build_array(
        jsonb_build_object('code','13201','amt', 2000000),
        jsonb_build_object('code','13501','amt',-2000000,'partner',c_golden)));
update document set journal_entry_id = je where id = doc;

-- ---- SALES CHAIN 3 (invoiced, unpaid, not yet due) -----------------------

insert into document (company_id, doc_type, doc_no, fiscal_year_id, doc_date, posting_date,
                      partner_id, location_id, currency, status, net_total, gross_total, posted_at)
values (co, 'DELIVERY', 'DO-000003', fy, '2026-08-06', '2026-08-06',
        c_aung, ygn_wh, 'MMK', 'POSTED', 1560000, 1560000, now())
returning id into doc;
insert into document_line (company_id, document_id, line_no, item_id, location_id,
                           entered_qty, entered_uom_id, base_qty, unit_price,
                           net_amount, tax_code_id, gross_amount)
values (co, doc, 1, i_chips,  ygn_wh, 1200, u_pcs, 1200, 800, 960000, tax_none, 960000),
       (co, doc, 2, i_peanut, ygn_wh, 1000, u_pcs, 1000, 600, 600000, tax_none, 600000);
insert into stock_movement (company_id, item_id, location_id, movement_date, qty, unit_cost, total_cost, document_id)
values (co, i_chips,  ygn_wh, '2026-08-06', -1200, 600, -720000, doc),
       (co, i_peanut, ygn_wh, '2026-08-06', -1000, 450, -450000, doc);
je := seed_post(co, 'JE-000014', '2026-08-06', 'DELIVERY', doc, 'DO-000003',
      jsonb_build_array(
        jsonb_build_object('code','51108','amt', 1170000,'loc',ygn_wh),
        jsonb_build_object('code','14101','amt',-1170000,'loc',ygn_wh)));
update document set journal_entry_id = je where id = doc;

insert into document (company_id, doc_type, doc_no, fiscal_year_id, doc_date, posting_date, due_date,
                      partner_id, currency, status, source_document_id, net_total, gross_total, posted_at)
values (co, 'SALES_INVOICE', 'SI-000003', fy, '2026-08-07', '2026-08-07', '2026-08-22',
        c_aung, 'MMK', 'POSTED', doc, 1560000, 1560000, now())
returning id into doc;
je := seed_post(co, 'JE-000015', '2026-08-07', 'SALES_INVOICE', doc, 'SI-000003',
      jsonb_build_array(
        jsonb_build_object('code','13501','amt', 1560000,'partner',c_aung),
        jsonb_build_object('code','41101','amt',-1560000)));
update document set journal_entry_id = je where id = doc;

-- ---- SALES CHAIN 4 (open order, nothing delivered) ----------------------

insert into document (company_id, doc_type, doc_no, fiscal_year_id, doc_date, posting_date,
                      partner_id, location_id, currency, status, net_total, gross_total)
values (co, 'SALES_ORDER', 'SO-000004', fy, '2026-08-11', '2026-08-11',
        c_thiri, mdy_wh, 'MMK', 'DRAFT', 2740000, 2740000)
returning id into doc;
insert into document_line (company_id, document_id, line_no, item_id, location_id,
                           entered_qty, entered_uom_id, base_qty, unit_price,
                           net_amount, tax_code_id, gross_amount)
values (co, doc, 1, i_juice,  mdy_wh, 500, u_pcs, 500, 2800, 1400000, tax_none, 1400000),
       (co, doc, 2, i_deterg, mdy_wh, 200, u_pcs, 200, 4500,  900000, tax_none,  900000),
       (co, doc, 3, i_cola,   mdy_wh, 440, u_pcs, 440, 1000,  440000, tax_none,  440000);

-- ---- Free of charge: promotion stock, cost to expense not COGS ----------

insert into document (company_id, doc_type, doc_no, fiscal_year_id, doc_date, posting_date,
                      partner_id, location_id, currency, status, net_total, gross_total, posted_at)
values (co, 'DELIVERY', 'DO-000004', fy, '2026-08-09', '2026-08-09',
        c_aung, ygn_wh, 'MMK', 'POSTED', 0, 0, now())
returning id into doc;
insert into document_line (company_id, document_id, line_no, item_id, location_id,
                           entered_qty, entered_uom_id, base_qty, unit_price,
                           net_amount, tax_code_id, gross_amount, foc_reason_id)
select co, doc, 1, i_cola, ygn_wh, 200, u_pcs, 200, 0, 0, tax_none, 0, f.id
  from foc_reason f where f.company_id = co and f.code = 'PROMOTION';
insert into stock_movement (company_id, item_id, location_id, movement_date, qty, unit_cost, total_cost, document_id)
values (co, i_cola, ygn_wh, '2026-08-09', -200, 850, -170000, doc);
je := seed_post(co, 'JE-000016', '2026-08-09', 'DELIVERY', doc, 'DO-000004 — promotional stock',
      jsonb_build_array(
        jsonb_build_object('code','64104','amt', 170000,'loc',ygn_wh),
        jsonb_build_object('code','14101','amt',-170000,'loc',ygn_wh)));
update document set journal_entry_id = je where id = doc;

-- ---- Operating expenses -------------------------------------------------

je := seed_post(co, 'JE-000017', '2026-07-31', null, null, 'July salaries',
      jsonb_build_array(
        jsonb_build_object('code','61252','amt', 4200000),
        jsonb_build_object('code','13201','amt',-4200000)));
je := seed_post(co, 'JE-000018', '2026-07-31', null, null, 'July warehouse rent',
      jsonb_build_array(
        jsonb_build_object('code','66105','amt', 1500000),
        jsonb_build_object('code','13201','amt',-1500000)));

raise notice 'seed complete';
end
$seed$;
