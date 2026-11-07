-- An asset depreciates from the month it goes into service, in full.
--
-- Put in use on 29 January, it depreciates for the whole of January. The
-- company default was the month after (NEXT_MONTH); it is now SAME_MONTH,
-- for new companies and for any company still on the old default.
--
-- An asset that already has depreciation recorded and follows the company
-- default is pinned to the rule it was depreciated under first, so no
-- posted month is recalculated.

update fixed_asset a
   set start_convention = s.start_convention
  from fa_setting s
 where s.company_id = a.company_id
   and a.start_convention is null
   and exists (select 1 from fa_depreciation d where d.asset_id = a.id);

update fa_setting set start_convention = 'SAME_MONTH' where start_convention = 'NEXT_MONTH';

alter table fa_setting alter column start_convention set default 'SAME_MONTH';
