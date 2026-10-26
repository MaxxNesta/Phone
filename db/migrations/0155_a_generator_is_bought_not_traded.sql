-- A generator is bought, not traded
--
-- The cash-flow statement sorts each account by how its money moves. The
-- guess made for the chart (0128) went by name, and seven of the shop's
-- fixed-asset accounts (Generator & Solar, Save, Table & Chair, Computer &
-- Printer, AirCon & Freezer, Phone for shop use, CCTV & Router, Cycle) were
-- left as working capital: buying a generator read as an operating outflow
-- instead of an investment.
--
-- An account filed under a fixed-asset heading is a fixed asset. Only the
-- guesses move: an account somebody has confirmed by hand keeps its setting.

update account a
   set cash_flow_class = 'INVESTING', indirect_role = 'FIXED_ASSET'
  from account p
 where p.id = a.parent_id
   and p.indirect_role = 'FIXED_ASSET'
   and a.account_type = 'ASSET'
   and a.is_postable
   and a.indirect_role = 'WORKING_CAPITAL'
   and not coalesce(a.cash_flow_confirmed, false);
