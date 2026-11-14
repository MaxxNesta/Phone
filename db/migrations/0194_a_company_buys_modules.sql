-- A company buys modules as well as a package.
--
-- The package (0100) says how deep each area goes: Essential, Standard,
-- Advanced. The modules say which areas were bought at all: a shop can buy
-- only Sales. Every existing company keeps every module, so nothing changes
-- until a module is taken away.
--
-- Gates the menu (lib/plans.ts hasModule), never the ledger: a sale still
-- moves stock and books its cost whether or not Inventory was bought.

alter table company
  add column if not exists modules text[] not null
    default array['sales', 'purchases', 'inventory', 'accounting', 'fixed_assets', 'hr', 'equity', 'logistics'];

alter table company
  add constraint company_modules_known check (
    modules <@ array['sales', 'purchases', 'inventory', 'accounting', 'fixed_assets', 'hr', 'equity', 'logistics']
  );
