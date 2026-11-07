-- A category belongs to a broad report group.
--
-- The shop's Excel register groups assets by type (Machinery, Office
-- equipment, Vehicles…) and then by a finer category (Generator & Solar,
-- Computer & Printer…). The categories are the finer level; the group is a
-- label above them, used by reports and by the asset import to match the
-- file's "Types" column. Editable in Fixed Asset Settings.

alter table fa_category add column if not exists report_group text;

update fa_category set report_group = case
    when asset_class = 'INTANGIBLE' or name ~* 'software'           then 'Intangible assets'
    when name ~* 'generator|solar|inverter|machine'                   then 'Machinery'
    when name ~* 'table|chair|locker|save|safe|furniture|fitting'     then 'Furniture & fittings'
    when name ~* 'cycle|vehicle|car|motor|bike'                       then 'Vehicles'
    else 'Office equipment'
  end
 where report_group is null;
