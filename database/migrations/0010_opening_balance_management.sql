-- ============================================================
-- PALLIKKAL PHARMACY
-- 0010_opening_balance_management.sql
--
-- This migration adds customer/distributor opening balances,
-- opening-balance equity postings, reversals, and advance support.
-- Apply only after taking a database backup.
-- ============================================================

BEGIN;

-- Preserve the live account list and add the opening equity account.
ALTER TABLE public.financial_ledger
DROP CONSTRAINT IF EXISTS financial_ledger_account_check;

ALTER TABLE public.financial_ledger
ADD CONSTRAINT financial_ledger_account_check
CHECK (account = ANY (ARRAY[
  'cash','upi','card','bank','receivables','payables','sales',
  'sales_returns','purchases','purchase_returns','expenses',
  'opening_balance_equity'
]::text[]));

CREATE TABLE IF NOT EXISTS public.party_opening_balances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES public.branches(id),
  party_type text NOT NULL CHECK (party_type IN ('customer','distributor')),
  customer_id uuid REFERENCES public.customers(id),
  distributor_id uuid REFERENCES public.distributors(id),
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  balance_side text NOT NULL CHECK (balance_side IN ('debit','credit')),
  as_of_date date NOT NULL DEFAULT CURRENT_DATE,
  note text,
  status text NOT NULL DEFAULT 'posted' CHECK (status IN ('posted','reversed')),
  journal_id uuid,
  reversal_journal_id uuid,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  reversed_by uuid,
  reversed_at timestamptz,
  reversal_reason text,
  CONSTRAINT party_opening_balance_party_check CHECK (
    (party_type = 'customer' AND customer_id IS NOT NULL AND distributor_id IS NULL)
    OR
    (party_type = 'distributor' AND distributor_id IS NOT NULL AND customer_id IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS party_opening_balance_customer_active_idx
ON public.party_opening_balances(branch_id, customer_id)
WHERE party_type = 'customer' AND status = 'posted';

CREATE UNIQUE INDEX IF NOT EXISTS party_opening_balance_distributor_active_idx
ON public.party_opening_balances(branch_id, distributor_id)
WHERE party_type = 'distributor' AND status = 'posted';

CREATE INDEX IF NOT EXISTS party_opening_balance_branch_idx
ON public.party_opening_balances(branch_id, status);

ALTER TABLE public.party_opening_balances ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS party_opening_balance_select_policy
ON public.party_opening_balances;

CREATE POLICY party_opening_balance_select_policy
ON public.party_opening_balances
FOR SELECT TO authenticated
USING (
  branch_id = public.my_branch_id()
  AND COALESCE(public.my_role(), '') IN ('super_admin','admin')
);

REVOKE ALL ON public.party_opening_balances FROM anon, authenticated;
GRANT SELECT ON public.party_opening_balances TO authenticated;

-- Update journal validation to preserve all live accounts.
CREATE OR REPLACE FUNCTION public.post_journal(
  p_ref_type text,
  p_ref_id uuid,
  p_memo text,
  p_lines jsonb,
  p_reversal_of uuid DEFAULT NULL::uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_branch uuid := public.my_branch_id();
  v_journal uuid := gen_random_uuid();
  v_line jsonb;
  v_debit numeric := 0;
  v_credit numeric := 0;
  v_account text;
  v_d numeric;
  v_c numeric;
  v_party_type text;
  v_party_id uuid;
BEGIN
  IF auth.uid() IS NULL OR v_branch IS NULL THEN
    RAISE EXCEPTION 'Login and active branch required';
  END IF;

  IF COALESCE(public.my_role(),'') NOT IN (
    'super_admin','admin','pharmacist','billing','billing_staff','inventory'
  ) THEN
    RAISE EXCEPTION 'Not authorised';
  END IF;

  IF jsonb_typeof(p_lines) <> 'array'
     OR jsonb_array_length(p_lines) < 2 THEN
    RAISE EXCEPTION 'Journal requires at least two lines';
  END IF;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    v_account := v_line->>'account';
    v_d := COALESCE(NULLIF(v_line->>'debit','')::numeric,0);
    v_c := COALESCE(NULLIF(v_line->>'credit','')::numeric,0);

    IF v_account NOT IN (
      'cash','upi','card','bank','receivables','payables','sales',
      'sales_returns','purchases','purchase_returns','expenses',
      'opening_balance_equity'
    )
    OR v_d < 0 OR v_c < 0
    OR NOT ((v_d > 0 AND v_c = 0) OR (v_c > 0 AND v_d = 0)) THEN
      RAISE EXCEPTION 'Invalid journal line';
    END IF;

    IF NULLIF(v_line->>'party_type','') IS NOT NULL
       AND NULLIF(v_line->>'party_type','') NOT IN ('customer','distributor') THEN
      RAISE EXCEPTION 'Invalid party type';
    END IF;

    v_debit := v_debit + v_d;
    v_credit := v_credit + v_c;
  END LOOP;

  IF v_debit <= 0 OR round(v_debit,2) <> round(v_credit,2) THEN
    RAISE EXCEPTION 'Unbalanced journal (debit %, credit %)', v_debit, v_credit;
  END IF;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    v_party_type := NULLIF(v_line->>'party_type','');
    v_party_id := NULLIF(v_line->>'party_id','')::uuid;

    INSERT INTO public.financial_ledger (
      branch_id,journal_id,account,debit,credit,party_type,party_id,
      ref_type,ref_id,memo,reversal_of,created_by
    )
    VALUES (
      v_branch,v_journal,v_line->>'account',
      COALESCE(NULLIF(v_line->>'debit','')::numeric,0),
      COALESCE(NULLIF(v_line->>'credit','')::numeric,0),
      v_party_type,v_party_id,p_ref_type,p_ref_id,p_memo,p_reversal_of,auth.uid()
    );
  END LOOP;

  RETURN v_journal;
END;
$function$;

-- Create one opening balance for a party/branch.
CREATE OR REPLACE FUNCTION public.record_party_opening_balance(
  p_party_type text,
  p_party_id uuid,
  p_amount numeric,
  p_balance_side text,
  p_as_of_date date DEFAULT CURRENT_DATE,
  p_note text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_branch uuid := public.my_branch_id();
  v_id uuid := gen_random_uuid();
  v_journal uuid := gen_random_uuid();
  v_party_name text;
  v_debit_account text;
  v_credit_account text;
  v_debit_party_type text;
  v_debit_party_id uuid;
  v_credit_party_type text;
  v_credit_party_id uuid;
  v_entry_at timestamptz;
BEGIN
  IF auth.uid() IS NULL OR v_branch IS NULL THEN
    RAISE EXCEPTION 'Login and active branch required';
  END IF;

  IF COALESCE(public.my_role(),'') NOT IN ('super_admin','admin') THEN
    RAISE EXCEPTION 'Only Admin can record opening balances';
  END IF;

  IF p_party_type NOT IN ('customer','distributor') THEN
    RAISE EXCEPTION 'Invalid party type';
  END IF;

  IF p_balance_side NOT IN ('debit','credit') THEN
    RAISE EXCEPTION 'Choose Debit or Credit';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Opening balance must be greater than zero';
  END IF;

  IF p_as_of_date IS NULL OR p_as_of_date > CURRENT_DATE THEN
    RAISE EXCEPTION 'Invalid opening balance date';
  END IF;

  IF p_party_type = 'customer' THEN
    SELECT name INTO v_party_name
    FROM public.customers
    WHERE id = p_party_id AND branch_id = v_branch AND active = true
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Customer not found or inactive in this branch';
    END IF;

    v_debit_account := 'receivables';
    v_credit_account := 'opening_balance_equity';

    IF p_balance_side = 'debit' THEN
      v_debit_party_type := 'customer';
      v_debit_party_id := p_party_id;
    ELSE
      v_debit_account := 'opening_balance_equity';
      v_credit_account := 'receivables';
      v_credit_party_type := 'customer';
      v_credit_party_id := p_party_id;
    END IF;
  ELSE
    SELECT name INTO v_party_name
    FROM public.distributors
    WHERE id = p_party_id AND branch_id = v_branch AND active = true
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Distributor not found or inactive in this branch';
    END IF;

    v_debit_account := 'payables';
    v_credit_account := 'opening_balance_equity';

    IF p_balance_side = 'credit' THEN
      v_debit_account := 'opening_balance_equity';
      v_credit_account := 'payables';
      v_credit_party_type := 'distributor';
      v_credit_party_id := p_party_id;
    ELSE
      v_debit_party_type := 'distributor';
      v_debit_party_id := p_party_id;
    END IF;
  END IF;

  INSERT INTO public.party_opening_balances (
    id,branch_id,party_type,customer_id,distributor_id,amount,
    balance_side,as_of_date,note,status,journal_id,created_by
  )
  VALUES (
    v_id,v_branch,p_party_type,
    CASE WHEN p_party_type = 'customer' THEN p_party_id ELSE NULL END,
    CASE WHEN p_party_type = 'distributor' THEN p_party_id ELSE NULL END,
    p_amount,p_balance_side,p_as_of_date,NULLIF(TRIM(p_note), ''),
    'posted',v_journal,auth.uid()
  );

  v_entry_at := p_as_of_date::timestamp AT TIME ZONE 'Asia/Kolkata';

  INSERT INTO public.financial_ledger (
    branch_id,journal_id,entry_at,account,debit,credit,
    party_type,party_id,ref_type,ref_id,memo,created_by
  )
  VALUES
  (
    v_branch,v_journal,v_entry_at,v_debit_account,p_amount,0,
    v_debit_party_type,v_debit_party_id,'opening_balance',v_id,
    'Opening balance - ' || v_party_name,auth.uid()
  ),
  (
    v_branch,v_journal,v_entry_at,v_credit_account,0,p_amount,
    v_credit_party_type,v_credit_party_id,'opening_balance',v_id,
    'Opening balance - ' || v_party_name,auth.uid()
  );

  RETURN v_id;
END;
$function$;

-- Reverse a posted opening balance by appending opposite ledger lines.
CREATE OR REPLACE FUNCTION public.reverse_party_opening_balance(
  p_entry_id uuid,
  p_reason text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_branch uuid := public.my_branch_id();
  v_entry public.party_opening_balances%rowtype;
  v_reversal_journal uuid := gen_random_uuid();
  v_line_count integer;
BEGIN
  IF auth.uid() IS NULL OR v_branch IS NULL THEN
    RAISE EXCEPTION 'Login and active branch required';
  END IF;

  IF COALESCE(public.my_role(),'') NOT IN ('super_admin','admin') THEN
    RAISE EXCEPTION 'Only Admin can reverse opening balances';
  END IF;

  IF COALESCE(TRIM(p_reason),'') = '' THEN
    RAISE EXCEPTION 'A reversal reason is required';
  END IF;

  SELECT * INTO v_entry
  FROM public.party_opening_balances
  WHERE id = p_entry_id AND branch_id = v_branch
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Opening balance not found in this branch';
  END IF;

  IF v_entry.status <> 'posted' THEN
    RAISE EXCEPTION 'Opening balance is already reversed';
  END IF;

  SELECT count(*) INTO v_line_count
  FROM public.financial_ledger
  WHERE branch_id = v_branch AND journal_id = v_entry.journal_id;

  IF v_line_count <> 2 THEN
    RAISE EXCEPTION 'Original opening journal is missing or invalid';
  END IF;

  INSERT INTO public.financial_ledger (
    branch_id,journal_id,entry_at,account,debit,credit,party_type,party_id,
    ref_type,ref_id,memo,reversal_of,created_by
  )
  SELECT
    branch_id,v_reversal_journal,now(),account,credit,debit,party_type,party_id,
    'opening_balance',v_entry.id,
    'Opening balance reversal: ' || TRIM(p_reason),
    v_entry.journal_id,auth.uid()
  FROM public.financial_ledger
  WHERE branch_id = v_branch AND journal_id = v_entry.journal_id;

  UPDATE public.party_opening_balances
  SET status = 'reversed',
      reversal_journal_id = v_reversal_journal,
      reversed_by = auth.uid(),
      reversed_at = now(),
      reversal_reason = TRIM(p_reason)
  WHERE id = p_entry_id AND branch_id = v_branch;

  RETURN v_reversal_journal;
END;
$function$;

-- Include opening receivables in customer outstanding.
CREATE OR REPLACE FUNCTION public.customer_outstanding(p_customer uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE
    WHEN auth.uid() IS NOT NULL
      AND public.my_branch_id() IS NOT NULL
      AND COALESCE(public.my_role(), '') IN (
        'super_admin','admin','pharmacist','billing_staff'
      )
    THEN
      COALESCE((
        SELECT SUM(p.amount)
        FROM public.payments p
        JOIN public.sales_invoices i ON i.id = p.invoice_id
        WHERE p.branch_id = public.my_branch_id()
          AND i.branch_id = public.my_branch_id()
          AND i.customer_id = p_customer
          AND p.method = 'credit'
          AND i.status = 'final'
      ),0)
      -
      COALESCE((
        SELECT SUM(r.amount)
        FROM public.customer_receipts r
        WHERE r.branch_id = public.my_branch_id()
          AND r.customer_id = p_customer
          AND r.status = 'posted'
      ),0)
      +
      COALESCE((
        SELECT SUM(l.debit - l.credit)
        FROM public.financial_ledger l
        WHERE l.branch_id = public.my_branch_id()
          AND l.account = 'receivables'
          AND l.party_type = 'customer'
          AND l.party_id = p_customer
          AND l.ref_type = 'opening_balance'
      ),0)
    ELSE 0
  END;
$function$;

-- Allow customer receipts to exceed dues; excess becomes a customer advance.
CREATE OR REPLACE FUNCTION public.record_customer_receipt(
  p_customer uuid,
  p_amount numeric,
  p_method text,
  p_note text DEFAULT NULL::text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_branch uuid := public.my_branch_id();
  v_customer public.customers%rowtype;
  v_id uuid;
  v_no text;
  v_journal uuid;
BEGIN
  IF auth.uid() IS NULL OR v_branch IS NULL THEN
    RAISE EXCEPTION 'Login and active branch required';
  END IF;

  IF COALESCE(public.my_role(), '') NOT IN (
    'super_admin','admin','pharmacist','billing_staff'
  ) THEN
    RAISE EXCEPTION 'Not authorised';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0
     OR p_method NOT IN ('cash','upi') THEN
    RAISE EXCEPTION 'Enter a positive amount and choose Cash or UPI';
  END IF;

  SELECT * INTO v_customer
  FROM public.customers
  WHERE id = p_customer AND branch_id = v_branch AND active = true
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Customer not found or inactive in this branch';
  END IF;

  v_no := public.finance_next_doc('RCPT');

  INSERT INTO public.customer_receipts (
    branch_id,receipt_no,customer_id,amount,method,note,created_by
  )
  VALUES (
    v_branch,v_no,p_customer,p_amount,p_method,
    NULLIF(TRIM(p_note),''),auth.uid()
  )
  RETURNING id INTO v_id;

  v_journal := public.post_journal(
    'customer_receipt',v_id,
    'Receipt ' || v_no || ' from ' || v_customer.name,
    jsonb_build_array(
      jsonb_build_object('account',p_method,'debit',p_amount,'credit',0),
      jsonb_build_object(
        'account','receivables','debit',0,'credit',p_amount,
        'party_type','customer','party_id',p_customer
      )
    )
  );

  UPDATE public.customer_receipts
  SET journal_id = v_journal
  WHERE id = v_id AND branch_id = v_branch;

  INSERT INTO public.audit_logs (
    branch_id,user_id,action,entity_type,entity_id,reason,
    before_data,after_data,at
  )
  VALUES (
    v_branch,auth.uid(),'customer_receipt_recorded',
    'customer_receipt',v_id::text,'Customer dues receipt',NULL,
    jsonb_build_object(
      'receipt_no',v_no,'customer_id',p_customer,
      'amount',p_amount,'method',p_method
    ),now()
  );

  RETURN v_id;
END;
$function$;

-- Allow supplier payments to exceed payables; excess becomes supplier advance.
CREATE OR REPLACE FUNCTION public.record_supplier_payment(
  p_distributor uuid,
  p_amount numeric,
  p_method text,
  p_reference text DEFAULT NULL::text,
  p_note text DEFAULT NULL::text,
  p_purchase uuid DEFAULT NULL::uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_branch uuid := public.my_branch_id();
  v_distributor public.distributors%rowtype;
  v_id uuid;
  v_no text;
  v_journal uuid;
BEGIN
  IF auth.uid() IS NULL OR v_branch IS NULL THEN
    RAISE EXCEPTION 'Login and active branch required';
  END IF;

  IF COALESCE(public.my_role(),'') NOT IN ('super_admin','admin') THEN
    RAISE EXCEPTION 'Not authorised';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0
     OR p_method NOT IN ('cash','upi') THEN
    RAISE EXCEPTION 'Enter a positive amount and choose Cash or UPI';
  END IF;

  SELECT * INTO v_distributor
  FROM public.distributors
  WHERE id = p_distributor AND branch_id = v_branch AND active = true
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Distributor not found or inactive in this branch';
  END IF;

  IF p_purchase IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.purchase_invoices
    WHERE id = p_purchase
      AND branch_id = v_branch
      AND distributor_id = p_distributor
  ) THEN
    RAISE EXCEPTION 'Purchase invoice does not belong to this distributor and branch';
  END IF;

  v_no := public.finance_next_doc('SP');

  INSERT INTO public.supplier_payments (
    branch_id,payment_no,distributor_id,purchase_invoice_id,
    amount,method,reference,note,created_by
  )
  VALUES (
    v_branch,v_no,p_distributor,p_purchase,p_amount,p_method,
    NULLIF(TRIM(p_reference),''),NULLIF(TRIM(p_note),''),auth.uid()
  )
  RETURNING id INTO v_id;

  v_journal := public.post_journal(
    'supplier_payment',v_id,
    'Payment ' || v_no || ' to ' || v_distributor.name,
    jsonb_build_array(
      jsonb_build_object(
        'account','payables','debit',p_amount,'credit',0,
        'party_type','distributor','party_id',p_distributor
      ),
      jsonb_build_object(
        'account',p_method,'debit',0,'credit',p_amount
      )
    )
  );

  UPDATE public.supplier_payments
  SET journal_id = v_journal
  WHERE id = v_id AND branch_id = v_branch;

  INSERT INTO public.audit_logs (
    branch_id,user_id,action,entity_type,entity_id,reason,
    before_data,after_data,at
  )
  VALUES (
    v_branch,auth.uid(),'supplier_payment_recorded',
    'supplier_payment',v_id::text,'Supplier payment',NULL,
    jsonb_build_object(
      'payment_no',v_no,'distributor_id',p_distributor,
      'amount',p_amount,'method',p_method
    ),now()
  );

  RETURN v_id;
END;
$function$;

REVOKE ALL ON FUNCTION
public.record_party_opening_balance(text,uuid,numeric,text,date,text)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION
public.record_party_opening_balance(text,uuid,numeric,text,date,text)
TO authenticated;

REVOKE ALL ON FUNCTION
public.reverse_party_opening_balance(uuid,text)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION
public.reverse_party_opening_balance(uuid,text)
TO authenticated;

COMMIT;
