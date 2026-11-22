-- New and secondhand stock told apart (0209 records the intake): a unit
-- whose current layer came in on a secondhand receipt carries its grade;
-- new stock carries null. Appended, so every reader of the view is unchanged.
create or replace view v_stock_serial as
SELECT s.company_id,
    s.id AS serial_id,
    s.serial_no AS imei,
    s.imei2,
    s.device_serial,
    s.notes,
    s.item_id,
    i.code AS item_code,
    i.name AS item_name,
    i.parent_item_id,
    COALESCE(p.name, i.name) AS model_name,
    b.name AS brand_name,
    i.barcode,
    l.location_id,
    loc.name AS location_name,
    s.stock_lot_id,
    l.unit_cost + COALESCE(( SELECT sum(a.delta_unit_cost) AS sum
           FROM stock_lot_adjustment a
          WHERE a.lot_id = l.id), 0::numeric) AS unit_cost,
    rd.id AS received_document_id,
    rd.doc_no AS received_on,
    rd.posting_date AS received_date,
    rd.partner_id AS supplier_id,
    sup.name AS supplier_name,
    COALESCE(s.supplier_warranty_months, i.supplier_warranty_months) AS supplier_warranty_months,
    out_.document_id AS out_document_id,
    out_.doc_no AS out_doc_no,
    out_.doc_type AS out_doc_type,
    out_.posting_date AS out_date,
    out_.partner_id AS customer_id,
    cust.name AS customer_name,
    out_.warranty_months,
        CASE
            WHEN out_.warranty_months IS NOT NULL THEN (out_.posting_date + make_interval(months => out_.warranty_months))::date
            ELSE NULL::date
        END AS warranty_expiry,
    h.kind AS hold_kind,
        CASE
            WHEN out_.document_id IS NOT NULL THEN
            CASE out_.doc_type
                WHEN 'SALES_INVOICE'::text THEN 'SOLD'::text
                WHEN 'DELIVERY'::text THEN 'SOLD'::text
                WHEN 'PURCHASE_RETURN'::text THEN 'RETURNED_TO_SUPPLIER'::text
                WHEN 'STOCK_ADJUSTMENT'::text THEN 'WRITTEN_OFF'::text
                ELSE 'ISSUED'::text
            END
            WHEN h.kind IS NOT NULL THEN h.kind
            ELSE 'IN_STOCK'::text
        END AS status,
    (EXISTS ( SELECT 1
           FROM stock_serial_event e
          WHERE e.serial_id = s.id AND e.event = 'CUSTOMER_RETURN'::text)) AS was_returned,
    (EXISTS ( SELECT 1
           FROM stock_serial_event e
          WHERE e.serial_id = s.id AND e.event = 'TRANSFER'::text)) AS was_transferred,
    s.created_at,
    ( SELECT i2.grade
           FROM secondhand_intake i2
          WHERE i2.serial_id = s.id AND i2.receipt_id = rd.id
         LIMIT 1) AS secondhand_grade
   FROM stock_serial s
     JOIN item i ON i.id = s.item_id
     LEFT JOIN item p ON p.id = i.parent_item_id
     LEFT JOIN brand b ON b.id = COALESCE(p.brand_id, i.brand_id)
     JOIN stock_lot l ON l.id = s.stock_lot_id
     LEFT JOIN location loc ON loc.id = l.location_id
     JOIN stock_movement rsm ON rsm.id = s.stock_movement_id
     LEFT JOIN document rd ON rd.id = rsm.document_id
     LEFT JOIN business_partner sup ON sup.id = rd.partner_id
     LEFT JOIN LATERAL ( SELECT d.id AS document_id,
            d.doc_no,
            d.doc_type,
            d.posting_date,
            d.partner_id,
            dl.warranty_months
           FROM stock_serial_issue si
             JOIN stock_movement sm ON sm.id = si.stock_movement_id
             JOIN document d ON d.id = sm.document_id
             LEFT JOIN document_line dl ON dl.id = sm.document_line_id
          WHERE si.serial_id = s.id AND COALESCE(si.lot_id, s.stock_lot_id) = s.stock_lot_id AND fn_serial_issue_stands(si.stock_movement_id)
          ORDER BY si.created_at DESC
         LIMIT 1) out_ ON true
     LEFT JOIN business_partner cust ON cust.id = out_.partner_id
     LEFT JOIN stock_serial_hold h ON h.serial_id = s.id AND h.released_at IS NULL;
