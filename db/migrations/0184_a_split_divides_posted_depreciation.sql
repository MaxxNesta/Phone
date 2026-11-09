-- A split divides posted depreciation between a group and the units that
-- leave it, and nothing else may edit a posted row.
--
-- The split (lib/fa-split.ts) moves the units' share of each posted month to
-- the new asset: a new row on the same journal line for the share, the
-- group's row reduced by it. Per journal line the total is unchanged, so the
-- ledger and the reconciliation are untouched. It switches this on only for
-- its own transaction (set local fa.split = 'on'); the asset, month and
-- journal line of a posted row still never change, and no row is deleted.

create or replace function fn_fa_depreciation_posted_is_fixed() returns trigger
language plpgsql as $$
begin
    if tg_op = 'UPDATE' and old.journal_line_id is not null
       and (new.amount, new.asset_id, new.period_month, new.journal_line_id)
           is distinct from (old.amount, old.asset_id, old.period_month, old.journal_line_id) then
        if not (coalesce(current_setting('fa.split', true), '') = 'on'
                and (new.asset_id, new.period_month, new.journal_line_id) is not distinct from (old.asset_id, old.period_month, old.journal_line_id)
                and new.amount >= 0 and new.amount <= old.amount) then
            raise exception 'Posted depreciation is not edited; record a correction instead.';
        end if;
    end if;
    if tg_op = 'DELETE' and old.journal_line_id is not null and old.source <> 'HISTORICAL' then
        raise exception 'Posted depreciation is not deleted; record a correction instead.';
    end if;
    return coalesce(new, old);
end $$;
