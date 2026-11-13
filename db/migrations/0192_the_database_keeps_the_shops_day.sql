-- The database keeps the shop's day.
--
-- Moments are stored as timestamptz, which is UTC underneath and stays so.
-- What the session time zone changes is the meaning of "today": current_date,
-- now()::date and date_trunc('day', ...) answer in the session's zone, and the
-- server's default is UTC. In Yangon (UTC+06:30) UTC's today is still
-- yesterday until 06:30, so a sale rung up at breakfast fell on the day
-- before, and the dashboard's "today" was the wrong day each morning.
--
-- Set on the database rather than per connection, so pooled connections,
-- scripts and the migration runner all get it. Takes effect on new
-- connections. The app's DISPLAY_TZ (lib/format.ts) names the same zone.

do $$
begin
  execute format('alter database %I set timezone = %L', current_database(), 'Asia/Yangon');
end $$;
