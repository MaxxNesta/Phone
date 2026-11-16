-- The chart of accounts, renumbered: four-digit accounts in three levels.
--
-- The customer's chart came over from a periodic system with five-digit
-- codes and up to four levels of heading (5 → 51 → 511 → 51108 "Purchase"),
-- so getting from a class to an account took three steps and the names said
-- what the old system did, not what this one does. Now every account is two
-- steps from its class and its code says where it sits:
--
--   class (1 digit) → group (2 digits) → account (4 digits)
--   4 Revenue → 41 Sales → 4110 Sales, 4180 Sales Returns, 4190 Sales Discounts
--   5 Cost of Sales → 51 Cost of Goods Sold → 5110 Cost of Goods Sold, 5120 Carriage Inward
--
-- Accounts are renumbered in place. Every posting, system role, account
-- determination, FOC reason and payment channel points at an account's id,
-- never its code, so history, balances and statements are untouched; only
-- the labels move. The old code stays on the account as legacy_code, for
-- anyone reconciling against the old system.
--
-- Two names change because they were wrong for a perpetual ledger:
-- 14101 "Inventory (Opening)" is the one inventory account (1310 Inventory),
-- and 51108 "Purchase" is the FIFO cost of what was sold (5110 Cost of Goods
-- Sold). Others are tidied ("ReturnInFOC" → "Sales Returns - FOC").
--
-- Only a company still on the legacy chart is touched (it has 51108 and no
-- 5110), so running this again, or on a database scaffolded from the new
-- db/chart.mjs, does nothing. An account the map does not know — a wallet
-- added from Settings, say — follows its old heading into the new group and
-- takes the next free code there (13213 KBZPay → 1141). A heading the map
-- does not know stops the migration rather than guess where it belongs.
--
-- db/chart.mjs carries the same chart (with each account's legacy code), so
-- a new company is set up in the new shape.

alter table account add column if not exists legacy_code text;
comment on column account.legacy_code is
  'The code this account had before 0203 renumbered the chart; null for accounts made after it.';

create temp table coa_target (
  code     text primary key,
  name     text not null,
  atype    account_type not null,
  postable boolean not null,
  under    text,
  legacy   text[] not null
) on commit drop;

insert into coa_target (code, name, atype, postable, under, legacy) values
  ('1', 'Assets', 'ASSET', false, null, array['1']::text[]),
  ('11', 'Cash and Bank', 'ASSET', false, '1', array['131', '132', '133']::text[]),
  ('1110', 'Cash Account', 'ASSET', true, '11', array['13101']::text[]),
  ('1111', 'Suspense Cash', 'ASSET', true, '11', array['13102']::text[]),
  ('1112', 'Yuan Cash', 'ASSET', true, '11', array['13103']::text[]),
  ('1120', 'UAB Bank Call Account', 'ASSET', true, '11', array['13201']::text[]),
  ('1121', 'KBZ Bank Current Account', 'ASSET', true, '11', array['13202']::text[]),
  ('1122', 'Yoma Bank Flexi Account', 'ASSET', true, '11', array['13203']::text[]),
  ('1123', 'AYA Bank Account', 'ASSET', true, '11', array['13204']::text[]),
  ('1124', 'CB Bank Account', 'ASSET', true, '11', array['13205']::text[]),
  ('1125', 'Daw Nan Yu War', 'ASSET', true, '11', array['13206']::text[]),
  ('1126', 'MMQR (UAB)', 'ASSET', true, '11', array['13207']::text[]),
  ('1127', 'UAB Bank (Cheque) Account', 'ASSET', true, '11', array['13208']::text[]),
  ('1128', 'KBZ Bank (Cheque) Account', 'ASSET', true, '11', array['13209']::text[]),
  ('1129', 'Yoma Bank (Cheque) Account', 'ASSET', true, '11', array['13210']::text[]),
  ('1130', 'AYA Bank (Cheque) Account', 'ASSET', true, '11', array['13211']::text[]),
  ('1131', 'CB Bank (Cheque) Account', 'ASSET', true, '11', array['13212']::text[]),
  ('1140', 'Credit Card', 'ASSET', true, '11', array['13301']::text[]),
  ('12', 'Receivables', 'ASSET', false, '1', array['135', '138']::text[]),
  ('1210', 'Accounts Receivable', 'ASSET', true, '12', array['13501']::text[]),
  ('1220', 'Advance (Other Department)', 'ASSET', true, '12', array['13801']::text[]),
  ('13', 'Inventory', 'ASSET', false, '1', array['141', '142']::text[]),
  ('1310', 'Inventory', 'ASSET', true, '13', array['14101']::text[]),
  ('1320', 'Branch Stock Transfer', 'ASSET', true, '13', array['14201']::text[]),
  ('14', 'Clearing and Tax', 'ASSET', false, '1', array['143']::text[]),
  ('1410', 'GR/IR Clearing', 'ASSET', true, '14', array['14301']::text[]),
  ('1420', 'Goods Shipped Not Invoiced', 'ASSET', true, '14', array['14303']::text[]),
  ('1430', 'Landed Cost Clearing', 'ASSET', true, '14', array['14304']::text[]),
  ('1440', 'Input Commercial Tax', 'ASSET', true, '14', array['14302']::text[]),
  ('15', 'Advances and Prepayments', 'ASSET', false, '1', array['13', '151', '152']::text[]),
  ('1510', 'Prepayment (Sup)', 'ASSET', true, '15', array['15101']::text[]),
  ('1520', 'Purchase Advance', 'ASSET', true, '15', array['15102']::text[]),
  ('1530', 'Prepaid Rent', 'ASSET', true, '15', array['15201']::text[]),
  ('1540', 'Prepaid Tax', 'ASSET', true, '15', array['15202']::text[]),
  ('1550', 'Prepaid Delivery', 'ASSET', true, '15', array['15203']::text[]),
  ('16', 'Property, Plant and Equipment', 'ASSET', false, '1', array['11', '113', '114', '115']::text[]),
  ('1610', 'Generator & Solar', 'ASSET', true, '16', array['11301']::text[]),
  ('1620', 'Save/မီးခံသေတ္တာ', 'ASSET', true, '16', array['11401']::text[]),
  ('1621', 'Table, Chair & Locker', 'ASSET', true, '16', array['11402']::text[]),
  ('1622', 'Computer & Printer', 'ASSET', true, '16', array['11403']::text[]),
  ('1623', 'AirCon & Freezer', 'ASSET', true, '16', array['11404']::text[]),
  ('1624', 'Phone', 'ASSET', true, '16', array['11405']::text[]),
  ('1625', 'Office Equipment', 'ASSET', true, '16', array['11406']::text[]),
  ('1626', 'CCTV & Router', 'ASSET', true, '16', array['11407']::text[]),
  ('1630', 'Cycle & EV Cycle', 'ASSET', true, '16', array['11501']::text[]),
  ('17', 'Accumulated Depreciation and Amortisation', 'ASSET', false, '1', array['121']::text[]),
  ('1710', 'Accumulated Dep; Generator & Solar', 'ASSET', true, '17', array['12109']::text[]),
  ('1720', 'Accumulated Dep; Save/မီးခံသေတ္တာ', 'ASSET', true, '17', array['12101']::text[]),
  ('1721', 'Accumulated Dep; Table, Chair & Locker', 'ASSET', true, '17', array['12102']::text[]),
  ('1722', 'Accumulated Dep; Computer & Printer', 'ASSET', true, '17', array['12103']::text[]),
  ('1723', 'Accumulated Dep; AirCon & Freezer', 'ASSET', true, '17', array['12104']::text[]),
  ('1724', 'Accumulated Dep; Phone', 'ASSET', true, '17', array['12105']::text[]),
  ('1725', 'Accumulated Dep; Office Equipment', 'ASSET', true, '17', array['12106']::text[]),
  ('1726', 'Accumulated Dep; CCTV & Router', 'ASSET', true, '17', array['12108']::text[]),
  ('1730', 'Accumulated Dep; Cycle & EV Cycle', 'ASSET', true, '17', array['12107']::text[]),
  ('1740', 'Accumulated Amor; Galaxy Software', 'ASSET', true, '17', array['12110']::text[]),
  ('18', 'Intangible Assets', 'ASSET', false, '1', array['16', '161']::text[]),
  ('1810', 'Galaxy Software Installation', 'ASSET', true, '18', array['16101']::text[]),
  ('19', 'Other Non-current Assets', 'ASSET', false, '1', array['17', '171']::text[]),
  ('1910', 'Staff Loan', 'ASSET', true, '19', array['17101']::text[]),
  ('2', 'Liabilities', 'LIABILITY', false, null, array['2']::text[]),
  ('21', 'Trade and Other Payables', 'LIABILITY', false, '2', array['21', '211']::text[]),
  ('2110', 'Accounts Payable', 'LIABILITY', true, '21', array['21101']::text[]),
  ('2120', 'Payable Expenses', 'LIABILITY', true, '21', array['21108']::text[]),
  ('2130', 'Payable (Other)', 'LIABILITY', true, '21', array['21109']::text[]),
  ('2140', 'Accrued Expense', 'LIABILITY', true, '21', array['21110']::text[]),
  ('22', 'Advances and Deferred Revenue', 'LIABILITY', false, '2', array['213']::text[]),
  ('2210', 'Sale Advance', 'LIABILITY', true, '22', array['21301']::text[]),
  ('2220', 'Prereceive Customer', 'LIABILITY', true, '22', array['21302']::text[]),
  ('2230', 'Billed Not Delivered (Unearned Revenue)', 'LIABILITY', true, '22', array['21303']::text[]),
  ('2240', 'Sale Cash', 'LIABILITY', true, '22', array['21307']::text[]),
  ('23', 'Consignment', 'LIABILITY', false, '2', array['214']::text[]),
  ('2310', 'Consign Stock', 'LIABILITY', true, '23', array['21401']::text[]),
  ('2320', 'Unpaid Sold Consign', 'LIABILITY', true, '23', array['21402']::text[]),
  ('24', 'Tax Payable', 'LIABILITY', false, '2', array['215']::text[]),
  ('2410', 'Commercial Tax Payable', 'LIABILITY', true, '24', array['21501']::text[]),
  ('25', 'Long-term Borrowings', 'LIABILITY', false, '2', array['23', '230']::text[]),
  ('2510', 'Loan', 'LIABILITY', true, '25', array['23001']::text[]),
  ('3', 'Equity', 'EQUITY', false, null, array['3']::text[]),
  ('31', 'Share Capital', 'EQUITY', false, '3', array['31', '311', '312']::text[]),
  ('3110', 'Capital Stock', 'EQUITY', true, '31', array['31104']::text[]),
  ('3120', 'Capital', 'EQUITY', true, '31', array['31105']::text[]),
  ('3130', 'Shares -Royal', 'EQUITY', true, '31', array['31203']::text[]),
  ('3140', 'Shares -ACT', 'EQUITY', true, '31', array['31204']::text[]),
  ('3150', 'Shares -RD', 'EQUITY', true, '31', array['31205']::text[]),
  ('32', 'Retained Earnings', 'EQUITY', false, '3', array['32', '322']::text[]),
  ('3210', 'Profit and Loss', 'EQUITY', true, '32', array['32201']::text[]),
  ('33', 'Opening Balance', 'EQUITY', false, '3', array['33', '331']::text[]),
  ('3310', 'Opening Balance Equity', 'EQUITY', true, '33', array['33101']::text[]),
  ('4', 'Revenue', 'REVENUE', false, null, array['4']::text[]),
  ('41', 'Sales', 'REVENUE', false, '4', array['41', '411', '412', '43', '431']::text[]),
  ('4110', 'Sales', 'REVENUE', true, '41', array['41101']::text[]),
  ('4120', 'Sales (Consignment)', 'REVENUE', true, '41', array['41102']::text[]),
  ('4130', 'Delivery Income', 'REVENUE', true, '41', array['41106']::text[]),
  ('4140', 'FOC', 'REVENUE', true, '41', array['41105']::text[]),
  ('4180', 'Sales Returns', 'REVENUE', true, '41', array['43101']::text[]),
  ('4181', 'Sales Returns - Discount', 'REVENUE', true, '41', array['43103']::text[]),
  ('4182', 'Sales Returns - FOC', 'REVENUE', true, '41', array['43104']::text[]),
  ('4183', 'Sales Returns - Charges', 'REVENUE', true, '41', array['43105']::text[]),
  ('4190', 'Sales Discounts', 'REVENUE', true, '41', array['41201']::text[]),
  ('4191', 'Sales Commission', 'REVENUE', true, '41', array['41202']::text[]),
  ('42', 'Other Operating Income', 'REVENUE', false, '4', array['413']::text[]),
  ('4210', 'Other Incomes', 'REVENUE', true, '42', array['41301']::text[]),
  ('5', 'Cost of Sales', 'COGS', false, null, array['5']::text[]),
  ('51', 'Cost of Goods Sold', 'COGS', false, '5', array['51', '511', '512', '513', '52', '521']::text[]),
  ('5110', 'Cost of Goods Sold', 'COGS', true, '51', array['51108']::text[]),
  ('5120', 'Carriage Inward', 'COGS', true, '51', array['51110']::text[]),
  ('5130', 'Purchase Discounts', 'COGS', true, '51', array['51201']::text[]),
  ('5140', 'FOC Received', 'COGS', true, '51', array['51202']::text[]),
  ('5150', 'Purchase Commission', 'COGS', true, '51', array['51301']::text[]),
  ('5160', 'Purchase Returns', 'COGS', true, '51', array['52101']::text[]),
  ('5161', 'Purchase Returns - FOC', 'COGS', true, '51', array['52102']::text[]),
  ('5170', 'Purchase (Consignment)', 'COGS', true, '51', array['51105']::text[]),
  ('5171', 'Purchase Consignment Opening', 'COGS', true, '51', array['51107']::text[]),
  ('5172', 'Purchase (Consignment Adjust)', 'COGS', true, '51', array['51109']::text[]),
  ('5180', 'Branch Transfer (Stock)', 'COGS', true, '51', array['51101']::text[]),
  ('59', 'Inventory Adjustments', 'COGS', false, '5', array['59', '599']::text[]),
  ('5910', 'Adjust Amount', 'COGS', true, '59', array['59902']::text[]),
  ('5920', 'Inventory Damage', 'COGS', true, '59', array['59905']::text[]),
  ('5930', 'Damage Control A/C', 'COGS', true, '59', array['59906']::text[]),
  ('5940', 'Purchase Price Variance', 'COGS', true, '59', array['59907']::text[]),
  ('6', 'Operating Expenses', 'EXPENSE', false, null, array['6']::text[]),
  ('61', 'Selling and Distribution', 'EXPENSE', false, '6', array['61', '612']::text[]),
  ('6110', 'Salary', 'EXPENSE', true, '61', array['61252']::text[]),
  ('6120', 'Overtime', 'EXPENSE', true, '61', array['61253']::text[]),
  ('6130', 'Carriage Outward', 'EXPENSE', true, '61', array['61254']::text[]),
  ('62', 'Marketing', 'EXPENSE', false, '6', array['64', '641']::text[]),
  ('6210', 'Sample', 'EXPENSE', true, '62', array['64102']::text[]),
  ('6220', 'Money Adjust', 'EXPENSE', true, '62', array['64103']::text[]),
  ('6230', 'Promotion', 'EXPENSE', true, '62', array['64104']::text[]),
  ('6240', 'Packing Materials', 'EXPENSE', true, '62', array['64105']::text[]),
  ('63', 'Administrative', 'EXPENSE', false, '6', array['66', '661', '615', '660']::text[]),
  ('6301', 'General Expenses', 'EXPENSE', true, '63', array['66101']::text[]),
  ('6302', 'Municipal Tax', 'EXPENSE', true, '63', array['66102']::text[]),
  ('6303', 'Training Expenses', 'EXPENSE', true, '63', array['66103']::text[]),
  ('6304', 'Entertainment Expenses', 'EXPENSE', true, '63', array['66104']::text[]),
  ('6305', 'Rental Charges', 'EXPENSE', true, '63', array['66105']::text[]),
  ('6306', 'Internet & Email', 'EXPENSE', true, '63', array['66106']::text[]),
  ('6307', 'Cleaning Expenses', 'EXPENSE', true, '63', array['66107']::text[]),
  ('6308', 'Insurance Expenses', 'EXPENSE', true, '63', array['66108']::text[]),
  ('6309', 'Bank Charges', 'EXPENSE', true, '63', array['66109']::text[]),
  ('6310', 'Tax & Rate : Government Fees', 'EXPENSE', true, '63', array['66110']::text[]),
  ('6311', 'Software Maintenance Expenses', 'EXPENSE', true, '63', array['66111']::text[]),
  ('6312', 'Meter Bill', 'EXPENSE', true, '63', array['66112']::text[]),
  ('6313', 'Printing & Stationery Expenses', 'EXPENSE', true, '63', array['66113']::text[]),
  ('6314', 'Repair & Maintenance -Office Equipment', 'EXPENSE', true, '63', array['66114']::text[]),
  ('6315', 'Transportation Expenses', 'EXPENSE', true, '63', array['66115']::text[]),
  ('6316', 'Job Advertising Expenses', 'EXPENSE', true, '63', array['66116']::text[]),
  ('6317', 'Professional Fees', 'EXPENSE', true, '63', array['66117']::text[]),
  ('6318', 'Phone Bill', 'EXPENSE', true, '63', array['66118']::text[]),
  ('6319', 'Staff Welfare', 'EXPENSE', true, '63', array['66119']::text[]),
  ('6320', 'Refreshment (water)', 'EXPENSE', true, '63', array['66120']::text[]),
  ('6321', 'Cash Excess/ Deficit', 'EXPENSE', true, '63', array['66121']::text[]),
  ('6322', 'Service Charges', 'EXPENSE', true, '63', array['66122']::text[]),
  ('6323', 'Other Materials', 'EXPENSE', true, '63', array['66123']::text[]),
  ('6330', 'Inventory Loss', 'EXPENSE', true, '63', array['61504']::text[]),
  ('6331', 'Office Use', 'EXPENSE', true, '63', array['61506']::text[]),
  ('6340', 'Exchange Rate Gain/Loss', 'EXPENSE', true, '63', array['66001']::text[]),
  ('6350', 'Warranty Service Expenses', 'EXPENSE', true, '63', array['66002']::text[]),
  ('64', 'Depreciation and Amortisation', 'EXPENSE', false, '6', array['663', '664', '665', '666']::text[]),
  ('6410', 'Depreciation For Generator/Solar', 'EXPENSE', true, '64', array['66301']::text[]),
  ('6420', 'Depreciation For Save/ မီးခံသေတ္တာ', 'EXPENSE', true, '64', array['66401']::text[]),
  ('6421', 'Depreciation For Table, Chair & Locker', 'EXPENSE', true, '64', array['66402']::text[]),
  ('6422', 'Depreciation For Computer & Printer', 'EXPENSE', true, '64', array['66403']::text[]),
  ('6423', 'Depreciation For AirCon & Freezer', 'EXPENSE', true, '64', array['66404']::text[]),
  ('6424', 'Depreciation For Phone', 'EXPENSE', true, '64', array['66405']::text[]),
  ('6425', 'Depreciation For Office Equipment', 'EXPENSE', true, '64', array['66406']::text[]),
  ('6426', 'Depreciation For CCTV & Router', 'EXPENSE', true, '64', array['66407']::text[]),
  ('6430', 'Depreciation For Cycle & EV Cycle', 'EXPENSE', true, '64', array['66501']::text[]),
  ('6440', 'Amortisation For Galaxy software', 'EXPENSE', true, '64', array['66601']::text[]),
  ('69', 'Finance Costs', 'EXPENSE', false, '6', array['67', '671']::text[]),
  ('6910', 'Interest Expense', 'EXPENSE', true, '69', array['67101']::text[]),
  ('7', 'Other Income', 'REVENUE', false, null, array['7']::text[]),
  ('71', 'Other Income', 'REVENUE', false, '7', array['71', '712', '714', '75', '755']::text[]),
  ('7110', 'Service Income', 'REVENUE', true, '71', array['71401']::text[]),
  ('7120', 'Bank Interest', 'REVENUE', true, '71', array['71402']::text[]),
  ('7130', 'Sale Tax', 'REVENUE', true, '71', array['71204']::text[]),
  ('7140', 'Currency Conversion Adjust', 'REVENUE', true, '71', array['75501']::text[]),
  ('7150', 'Trial Adjust', 'REVENUE', true, '71', array['75502']::text[]);

do $$
declare
  co      record;
  r       record;
  gcode   text;
  gid     uuid;
  walk    uuid;
  lc      text;
  nxt     int;
  left_   text;
begin
  for co in
    select c.id from company c
     where exists (select 1 from account a where a.company_id = c.id and a.code = '51108')
       and not exists (select 1 from account a where a.company_id = c.id and a.code = '5110')
  loop
    -- Park every code out of the way, so no new code can collide with an
    -- old one mid-way (old heading 13 Current Assets vs new group 13 Inventory).
    update account set legacy_code = code, code = '~' || code where company_id = co.id;

    -- Classes keep their rows and their codes.
    update account a set code = t.code, name = t.name
      from coa_target t
     where a.company_id = co.id and length(t.code) = 1 and a.code = '~' || t.code;
    insert into account (company_id, code, name, account_type, is_postable)
    select co.id, t.code, t.name, t.atype, false from coa_target t
     where length(t.code) = 1
       and not exists (select 1 from account a where a.company_id = co.id and a.code = t.code);

    -- Groups are new headings under their class.
    insert into account (company_id, parent_id, code, name, account_type, is_postable)
    select co.id, p.id, t.code, t.name, t.atype, false
      from coa_target t join account p on p.company_id = co.id and p.code = t.under
     where length(t.code) = 2;

    -- Known accounts: new code, new name, filed under their group.
    update account a set code = t.code, name = t.name, parent_id = g.id
      from coa_target t join account g on g.company_id = co.id and g.code = t.under
     where a.company_id = co.id and length(t.code) = 4 and a.code = '~' || t.legacy[1];

    -- Accounts the map does not know follow their old heading.
    for r in
      select a.id, a.parent_id, a.legacy_code, a.account_type from account a
       where a.company_id = co.id and a.code like '~%' and a.is_postable
       order by a.legacy_code
    loop
      gcode := null; walk := r.parent_id;
      while walk is not null and gcode is null loop
        select a.legacy_code, a.parent_id into lc, walk from account a where a.id = walk;
        select t.code into gcode from coa_target t where length(t.code) = 2 and lc = any(t.legacy);
      end loop;
      if gcode is null then
        select min(t.code) into gcode from coa_target t where length(t.code) = 2 and t.atype = r.account_type;
      end if;
      select id into gid from account where company_id = co.id and code = gcode;
      select coalesce(max(code::int), (gcode || '00')::int) + 1 into nxt
        from account where company_id = co.id and code ~ ('^' || gcode || '[0-9]{2}$');
      if nxt > (gcode || '99')::int then
        raise exception 'Group % has no free code left for %', gcode, r.legacy_code;
      end if;
      update account set code = nxt::text, parent_id = gid where id = r.id;
    end loop;

    -- The old headings are empty now. One statement, so a heading and the
    -- sub-heading under it go together.
    select string_agg(a.legacy_code || ' ' || a.name, ', ') into left_ from account a
     where a.company_id = co.id and a.code like '~%'
       and not exists (select 1 from coa_target t where length(t.code) = 2 and a.legacy_code = any(t.legacy));
    if left_ is not null then
      raise exception 'Headings the new chart does not place: %. Add them to 0203 first.', left_;
    end if;
    delete from account where company_id = co.id and code like '~%';
  end loop;
end $$;
