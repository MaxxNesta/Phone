-- An asset can arrive with its history: imported from the shop's register,
-- or keyed with what an older system knew.
--
--   quantity             a row that stands for several of one thing (15
--                        chairs): one asset, one cost for the group.
--   depreciation_start   an explicit first month, kept apart from the
--                        same-month / next-month rule. Null: the rule applies
--                        to the in-service date as before.
--   opening_accumulated  depreciation before MTK, as one figure, through
--   opening_through      the end of this month. A calculation input only:
--                        nothing is posted, and once a journal carrying it is
--                        linked (an OPENING row) that journal takes over.
--   source_ref           where the row came from ("Import 2026-11-08 · row 12"),
--                        to trace an import and catch it twice.

alter table fixed_asset add column if not exists quantity numeric(18,4) not null default 1;
alter table fixed_asset add column if not exists depreciation_start date;
alter table fixed_asset add column if not exists opening_accumulated numeric(18,4);
alter table fixed_asset add column if not exists opening_through date;
alter table fixed_asset add column if not exists source_ref text;

alter table fixed_asset drop constraint if exists fixed_asset_quantity_positive;
alter table fixed_asset add constraint fixed_asset_quantity_positive check (quantity > 0);
alter table fixed_asset drop constraint if exists fixed_asset_start_is_a_month;
alter table fixed_asset add constraint fixed_asset_start_is_a_month
    check (depreciation_start is null or extract(day from depreciation_start) = 1);
alter table fixed_asset drop constraint if exists fixed_asset_opening_complete;
alter table fixed_asset add constraint fixed_asset_opening_complete
    check ((opening_accumulated is null) = (opening_through is null)
           and (opening_through is null or extract(day from opening_through) = 1)
           and (opening_accumulated is null or (opening_accumulated >= 0
                and opening_accumulated <= acquisition_cost - residual_value)));
