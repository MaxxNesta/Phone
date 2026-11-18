-- Management Reports: an add-on module (Standard and Advanced), starting with
-- the Executive dashboard. Off until a company buys it: existing companies'
-- module lists do not name it.
alter table company drop constraint if exists company_modules_known;
alter table company add constraint company_modules_known check (
  modules <@ array['sales', 'purchases', 'inventory', 'landed_cost', 'accounting', 'fixed_assets', 'hr', 'equity', 'logistics', 'management']
);
