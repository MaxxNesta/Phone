-- Depreciation is reviewed, then posted
--
-- The shop's choice (2026-10-27): each month is prepared as a draft, shown
-- with its journal, and posted by someone allowed to post when a popup says it
-- is ready. Fully automatic posting waits for a scheduled job. Manual stays a
-- setting for a company that posts its own journals and links them.
--
-- No company has chosen a mode yet (Settings comes with this change), so the
-- rows made by 0156 move to the new default with it.

alter table fa_setting alter column posting_mode set default 'REVIEW';
update fa_setting set posting_mode = 'REVIEW' where posting_mode = 'MANUAL';
