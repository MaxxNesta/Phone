-- Landed cost is a module of its own (0194 made the others).
--
-- A company without it does not see Landed costs, its settings, or the
-- carriage section on goods receipts and purchase bills. Every company that
-- exists keeps it, as with the other modules.

alter table company drop constraint if exists company_modules_known;

update company set modules = array_append(modules, 'landed_cost')
 where not ('landed_cost' = any(modules));

alter table company alter column modules
  set default array['sales', 'purchases', 'inventory', 'landed_cost', 'accounting', 'fixed_assets', 'hr', 'equity', 'logistics'];

alter table company
  add constraint company_modules_known check (
    modules <@ array['sales', 'purchases', 'inventory', 'landed_cost', 'accounting', 'fixed_assets', 'hr', 'equity', 'logistics']
  );
