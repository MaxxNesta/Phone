-- Freight is billed by the kilo: a box of chargers weighs ten phones. An
-- item may carry its weight in kg (optional), and a landed cost charge may
-- be spread in proportion to weight × quantity. A unit with no weight is
-- refused, the way Split by item cost refuses goods that cost nothing.

alter table item add column if not exists weight_kg numeric(12,4) check (weight_kg > 0);

alter table landed_cost_charge drop constraint if exists landed_cost_charge_method_check;
alter table landed_cost_charge add constraint landed_cost_charge_method_check
  check (method = any (array['VALUE', 'EQUAL', 'MANUAL', 'WEIGHT']));

alter table landed_cost_template_line drop constraint if exists landed_cost_template_line_method_check;
alter table landed_cost_template_line add constraint landed_cost_template_line_method_check
  check (method = any (array['VALUE', 'EQUAL', 'MANUAL', 'WEIGHT']));

alter table landed_cost_type drop constraint if exists landed_cost_type_default_method_check;
alter table landed_cost_type add constraint landed_cost_type_default_method_check
  check (default_method = any (array['VALUE', 'EQUAL', 'MANUAL', 'WEIGHT']));
