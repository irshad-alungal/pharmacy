-- =============================================================================
-- 0038  Billing uses the discount set on the medicine (version 79)
-- Run once in the Supabase SQL editor (after 0037). Safe to run again.
--
-- Medicines → Discount "10%" or "5" (₹ off each unit) must appear in Billing
-- automatically. This migration makes sure, whatever state the database is in:
--   • medicines.discount_amount exists and the pages may read / write it;
--   • one rule decides the discount:  a percentage above 0 → that %;
--     otherwise a ₹ amount above 0 → that amount as a % of the unit MRP;
--     otherwise the old rule (MRP vs selling price);
--   • the billing engine (_billing_fefo_compute, finalize_sale_v3, finalize_sale_v2)
--     calls that rule. Functions still on the old rule are patched in place.
-- =============================================================================

ALTER TABLE public.medicines ADD COLUMN IF NOT EXISTS discount_amount numeric;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'medicines_discount_amount_check') THEN
    ALTER TABLE public.medicines ADD CONSTRAINT medicines_discount_amount_check CHECK (discount_amount IS NULL OR discount_amount >= 0);
  END IF;
END $$;
GRANT SELECT (discount_percentage, discount_amount), INSERT (discount_percentage, discount_amount), UPDATE (discount_percentage, discount_amount)
  ON public.medicines TO authenticated;

-- A % of 0 no longer hides a ₹ amount entered later.
CREATE OR REPLACE FUNCTION public.billing_medicine_discount_pct(
  p_pct numeric, p_amount numeric, p_unit_mrp numeric, p_med_mrp numeric, p_med_selling numeric)
RETURNS numeric LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE
    WHEN COALESCE(p_pct, 0) > 0 THEN round(least(p_pct, 100), 2)
    WHEN COALESCE(p_amount, 0) > 0 AND COALESCE(p_unit_mrp, 0) > 0 THEN round(least(p_amount * 100 / p_unit_mrp, 100), 2)
    WHEN p_pct IS NOT NULL THEN 0
    ELSE public.billing_default_discount_pct(p_med_mrp, p_med_selling, NULL)
  END
$$;
GRANT EXECUTE ON FUNCTION public.billing_medicine_discount_pct(numeric, numeric, numeric, numeric, numeric) TO authenticated;

-- Patch the billing engine functions that still use the old rule.
DO $$
DECLARE
  f record; v_def text; v_new text; v_mrp_var text;
  v_old constant text := 'public.billing_default_discount_pct(m.mrp, m.selling_price, m.discount_percentage)';
BEGIN
  FOR f IN
    SELECT p.oid, p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN ('_billing_fefo_compute', 'finalize_sale_v3', 'finalize_sale_v2')
  LOOP
    v_def := pg_get_functiondef(f.oid);
    v_mrp_var := CASE WHEN f.proname = '_billing_fefo_compute' THEN 'v_mrp' ELSE 'v_def_mrp' END;
    v_new := replace(v_def, v_old,
      format('public.billing_medicine_discount_pct(m.discount_percentage, m.discount_amount, %s, m.mrp, m.selling_price)', v_mrp_var));
    -- The cart shows "₹5" instead of "16.67%" when the discount is a ₹ amount.
    IF f.proname = '_billing_fefo_compute' AND position('''discount_amount''' IN v_new) = 0 THEN
      v_new := replace(v_new, '''default_discount_pct'', v_def_disc,',
        '''default_discount_pct'', v_def_disc, ''discount_amount'', CASE WHEN COALESCE(m.discount_percentage, 0) = 0 THEN m.discount_amount END,');
    END IF;
    IF v_new <> v_def THEN
      EXECUTE v_new;
      RAISE NOTICE 'patched %', f.proname;
    END IF;
  END LOOP;
END $$;

-- Cart label: ₹ amount only when no percentage is set.
DO $$
DECLARE f record; v_def text; v_new text;
BEGIN
  FOR f IN SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public' AND p.proname = '_billing_fefo_compute' LOOP
    v_def := pg_get_functiondef(f.oid);
    v_new := replace(v_def, '''discount_amount'', CASE WHEN m.discount_percentage IS NULL THEN m.discount_amount END',
                            '''discount_amount'', CASE WHEN COALESCE(m.discount_percentage, 0) = 0 THEN m.discount_amount END');
    IF v_new <> v_def THEN EXECUTE v_new; END IF;
  END LOOP;
END $$;

-- -----------------------------------------------------------------------------
-- Check (read-only): medicines that have a discount, and what Billing will use.
-- Every row should show billing_discount_pct above 0.
-- -----------------------------------------------------------------------------
SELECT m.name, m.discount_percentage AS discount_pct_set, m.discount_amount AS discount_rupees_set,
       b.batch_no, COALESCE(b.mrp, NULLIF(m.mrp, 0), m.selling_price) AS unit_mrp,
       public.billing_medicine_discount_pct(m.discount_percentage, m.discount_amount,
         COALESCE(b.mrp, NULLIF(m.mrp, 0), m.selling_price), m.mrp, m.selling_price) AS billing_discount_pct,
       (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public' AND p.proname IN ('_billing_fefo_compute', 'finalize_sale_v3')
           AND p.prosrc LIKE '%billing_medicine_discount_pct%') = 2 AS engine_uses_medicine_discount
FROM public.medicines m
LEFT JOIN LATERAL (SELECT * FROM public.medicine_batches x WHERE x.medicine_id = m.id AND x.qty > 0
                   ORDER BY x.expiry LIMIT 1) b ON true
WHERE COALESCE(m.discount_percentage, 0) > 0 OR COALESCE(m.discount_amount, 0) > 0
ORDER BY m.name
LIMIT 50;
