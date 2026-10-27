-- An asset older than the books opens with its history
--
-- A generator bought in 2022 came into this system with its accumulated
-- depreciation in the opening balance: one figure, not forty monthly ones.
-- An OPENING row carries that figure for an asset up to and including a
-- month; every month before it counts as carried, and depreciation runs from
-- the month after. One per asset, linked to the opening journal's line like
-- any other history, so it is undone the same way.

alter table fa_depreciation drop constraint if exists fa_depreciation_source_check;
alter table fa_depreciation add constraint fa_depreciation_source_check
    check (source in ('RUN', 'HISTORICAL', 'CORRECTION', 'OPENING'));

drop index if exists fa_depreciation_once_per_month;
create unique index fa_depreciation_once_per_month
    on fa_depreciation (asset_id, period_month) where source in ('RUN', 'HISTORICAL', 'OPENING');
create unique index if not exists fa_depreciation_one_opening
    on fa_depreciation (asset_id) where source = 'OPENING';
