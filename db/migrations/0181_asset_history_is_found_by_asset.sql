-- An asset's changes of estimate and journal links are found by the asset.
--
-- Every schedule load reads fa_estimate_change by asset_id = any(...), and the
-- register and acquisitions report read fa_journal_link by asset and kind;
-- both tables were indexed only from the other side. With a few hundred
-- assets each of those became a scan per page.

create index if not exists fa_estimate_change_asset on fa_estimate_change (asset_id, effective_month);
create index if not exists fa_journal_link_asset on fa_journal_link (asset_id, kind);
