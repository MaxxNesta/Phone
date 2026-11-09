-- A split is part of an asset's history: the units that left a group, and
-- the group they left, both say so.

alter table fa_event drop constraint if exists fa_event_event_type_check;
alter table fa_event add constraint fa_event_event_type_check check (event_type in (
  'CREATED', 'UPDATED', 'ACTIVATED', 'ESTIMATE_CHANGED', 'TRANSFERRED',
  'DISPOSED', 'DEPRECIATION_POSTED', 'HISTORY_LINKED', 'HISTORY_UNLINKED',
  'CORRECTED', 'EXCEPTION', 'DEACTIVATED', 'REACTIVATED', 'SPLIT'));
