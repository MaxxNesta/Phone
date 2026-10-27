-- A link can be undone; a posting cannot
--
-- Reconciliation ties an existing journal to an asset's month. Getting that
-- wrong is a mistake in the subledger, not in the books, so it can be undone.
-- A voucher this module posted is the books, and is never deleted: a later
-- change is a correction with an entry of its own.
--
-- is_link says which is which, rather than guessing from the source: a
-- correction can be linked from history or posted here.

alter table fa_depreciation add column if not exists is_link boolean not null default false;
update fa_depreciation set is_link = true where source = 'HISTORICAL';

create or replace function fn_fa_depreciation_posted_is_fixed() returns trigger
language plpgsql as $$
begin
    if tg_op = 'UPDATE' and old.journal_line_id is not null
       and (new.amount, new.asset_id, new.period_month, new.journal_line_id, new.is_link)
           is distinct from (old.amount, old.asset_id, old.period_month, old.journal_line_id, old.is_link) then
        raise exception 'Posted depreciation is not edited; record a correction instead.';
    end if;
    if tg_op = 'DELETE' and old.journal_line_id is not null and not old.is_link then
        raise exception 'Posted depreciation is not deleted; record a correction instead.';
    end if;
    return coalesce(new, old);
end $$;
