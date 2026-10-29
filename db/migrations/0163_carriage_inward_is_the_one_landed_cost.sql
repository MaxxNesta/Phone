-- Carriage inward is the one landed cost
--
-- The shop's forwarders bill freight, customs and clearance as one amount,
-- booked as Carriage Inward; nobody splits a shipment into duty, insurance
-- and inspection. The eight seeded types and the template built from them
-- are switched off, not deleted: what was posted with them keeps its names,
-- and a company that does import that way turns them back on in Settings.
-- With only Carriage Inward active, the receipt offers Record carriage
-- inward and not the full landed-cost editor.

update landed_cost_type set is_active = false
 where code in ('FREIGHT', 'INSURANCE', 'DUTY', 'CLEARANCE', 'LOCAL', 'HANDLING', 'INSPECT', 'OTHER');

update landed_cost_template t set is_active = false
 where not exists (select 1 from landed_cost_template_line l join landed_cost_type y on y.id = l.cost_type_id
                    where l.template_id = t.id and y.is_active);
