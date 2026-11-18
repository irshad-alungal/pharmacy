-- Medicine master write permissions and optional per-medicine discount.
-- Run after migrations 0017 and 20261113_medicine_master_fields.sql.
BEGIN;

ALTER TABLE public.medicines
  ADD COLUMN IF NOT EXISTS discount_percentage numeric(5,2);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.medicines'::regclass
      AND conname = 'medicines_discount_percentage_range'
  ) THEN
    ALTER TABLE public.medicines
      ADD CONSTRAINT medicines_discount_percentage_range
      CHECK (discount_percentage IS NULL OR discount_percentage BETWEEN 0 AND 100);
  END IF;
END $$;

-- Keep purchase_price protected. Rebuild only the explicit column privileges
-- required by the medicine master page and its bulk-import flow.
REVOKE ALL ON public.medicines FROM PUBLIC, anon, authenticated;

GRANT SELECT (
  id, branch_id, name, ingredients, need_doctor_sheet,
  brand, generic_name, composition, strength, dosage_form,
  barcode, sku, mrp, selling_price, tax_rate, reorder_level,
  shelf_location, rack, active, category_id, manufacturer_id,
  storage_location_id, base_unit_id, discount_percentage, created_at
) ON public.medicines TO authenticated;

GRANT INSERT (
  branch_id, name, ingredients, need_doctor_sheet,
  brand, generic_name, composition, strength, dosage_form,
  barcode, sku, mrp, selling_price, tax_rate, reorder_level,
  shelf_location, rack, active, category_id, manufacturer_id,
  storage_location_id, base_unit_id, discount_percentage
) ON public.medicines TO authenticated;

GRANT UPDATE (
  name, ingredients, need_doctor_sheet,
  brand, generic_name, composition, strength, dosage_form,
  barcode, sku, mrp, selling_price, tax_rate, reorder_level,
  shelf_location, rack, active, category_id, manufacturer_id,
  storage_location_id, base_unit_id, discount_percentage
) ON public.medicines TO authenticated;

-- Ensure branch-scoped write policy supports the inventory_staff role used
-- by the current frontend, without granting access to other branches.
DROP POLICY IF EXISTS alza_med_write ON public.medicines;
CREATE POLICY alza_med_write
ON public.medicines
FOR ALL
TO authenticated
USING (
  branch_id = public.my_branch_id()
  AND public.my_role() IN
    ('super_admin','admin','pharmacist','inventory','inventory_staff')
)
WITH CHECK (
  branch_id = public.my_branch_id()
  AND public.my_role() IN
    ('super_admin','admin','pharmacist','inventory','inventory_staff')
);

COMMIT;
