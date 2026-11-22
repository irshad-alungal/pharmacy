-- =============================================================================
-- 0036  Invoice View page (invoice-view.html?id=…) for staff
-- Run once in the Supabase SQL editor after 0026 (Sales) and 0030 (WhatsApp). Safe to run twice.
--
--   invoice_view_info(invoice)        — everything around one bill that invoice_detail() does not give:
--                                       cashier, counter / home delivery, customer ID and type,
--                                       credit outstanding, paid / on credit, returns (credit notes),
--                                       delivery status and rider, previous / next bill, WhatsApp
--                                       message and customer-link status.
--   invoice_lookup(text)              — find bills by invoice number (search box on the page).
--   invoice_share_link(invoice, url)  — the customer's private invoice link (for e-mail / copy),
--                                       without queueing a WhatsApp message.
-- Same roles as the Sales page (Super Admin, Admin, Pharmacist, Billing Staff). Read-only except
-- the share link, which reuses the 180-day links of 0030.
-- =============================================================================

DROP FUNCTION IF EXISTS public.invoice_view_info(uuid);
CREATE FUNCTION public.invoice_view_info(p_invoice uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_branch uuid := public._sales_guard();
  inv public.sales_invoices%ROWTYPE;
  v_cust jsonb; v_del jsonb := NULL; v_prev jsonb; v_next jsonb; v_link jsonb := NULL; v_wa jsonb := NULL;
  v_pay jsonb; v_credit numeric; v_paid numeric; v_ret jsonb; v_returned numeric;
  v_bills int; v_first timestamptz; v_out numeric;
BEGIN
  SELECT * INTO inv FROM public.sales_invoices WHERE id = p_invoice AND branch_id = v_branch;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invoice not found in this branch'; END IF;

  -- payments: methods, paid now and on credit
  SELECT COALESCE(jsonb_agg(jsonb_build_object('method', p.method, 'amount', round(p.amount, 2)) ORDER BY (p.method = 'credit'), p.created_at, p.id), '[]'::jsonb),
         COALESCE(sum(p.amount) FILTER (WHERE p.method = 'credit'), 0),
         COALESCE(sum(p.amount) FILTER (WHERE p.method <> 'credit'), 0)
    INTO v_pay, v_credit, v_paid
  FROM public.payments p WHERE p.invoice_id = inv.id;

  -- returns (credit notes)
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', r.id, 'return_no', r.return_no, 'total', round(r.total, 2), 'refund_method', r.refund_method,
                                               'reason', r.reason, 'created_at', r.created_at) ORDER BY r.created_at), '[]'::jsonb),
         COALESCE(sum(r.total), 0)
    INTO v_ret, v_returned
  FROM public.sales_returns r WHERE r.invoice_id = inv.id AND r.branch_id = v_branch;

  -- customer: ID, type, bills, credit outstanding
  IF inv.customer_id IS NOT NULL THEN
    SELECT count(*) FILTER (WHERE i.status = 'final'), min(i.created_at) INTO v_bills, v_first
    FROM public.sales_invoices i WHERE i.customer_id = inv.customer_id AND i.branch_id = v_branch;
    BEGIN v_out := public.customer_outstanding(inv.customer_id); EXCEPTION WHEN OTHERS THEN v_out := NULL; END;
    SELECT jsonb_build_object('id', c.id, 'customer_no', c.customer_no, 'name', c.name, 'phone', c.phone, 'email', c.email,
             'loyalty_member', COALESCE(c.loyalty_member, false), 'credit_limit', c.credit_limit, 'bills', v_bills, 'first_bill', v_first,
             'outstanding', round(v_out, 2),
             'type', CASE WHEN COALESCE(c.loyalty_member, false) THEN 'Loyalty member' WHEN v_bills > 1 THEN 'Regular' ELSE 'New' END)
      INTO v_cust FROM public.customers c WHERE c.id = inv.customer_id;
  END IF;

  -- delivery
  SELECT jsonb_build_object('status', d.status, 'requested', d.is_requested, 'requested_at', d.requested_at, 'assigned_at', d.assigned_at,
           'out_at', d.out_at, 'delivered_at', d.delivered_at, 'failed_at', d.failed_at, 'failure_reason', d.failure_reason,
           'address', d.delivery_address, 'phone', d.delivery_phone, 'note', d.delivery_note,
           'rider', p.full_name, 'rider_staff_id', p.staff_id::text)
    INTO v_del
  FROM public.delivery_jobs d LEFT JOIN public.profiles p ON p.id = d.assigned_to
  WHERE d.invoice_id = inv.id AND d.branch_id = v_branch
  ORDER BY d.created_at DESC LIMIT 1;

  -- previous (older) / next (newer) bill of this branch
  SELECT jsonb_build_object('id', i.id, 'invoice_no', i.invoice_no) INTO v_prev FROM public.sales_invoices i
  WHERE i.branch_id = v_branch AND (i.created_at, i.id) < (inv.created_at, inv.id) ORDER BY i.created_at DESC, i.id DESC LIMIT 1;
  SELECT jsonb_build_object('id', i.id, 'invoice_no', i.invoice_no) INTO v_next FROM public.sales_invoices i
  WHERE i.branch_id = v_branch AND (i.created_at, i.id) > (inv.created_at, inv.id) ORDER BY i.created_at, i.id LIMIT 1;

  -- customer link and WhatsApp message (0030)
  IF to_regclass('public.invoice_share_links') IS NOT NULL THEN
    SELECT jsonb_build_object('expires_at', l.expires_at, 'views', l.views, 'last_viewed_at', l.last_viewed_at, 'created_at', l.created_at)
      INTO v_link FROM public.invoice_share_links l
    WHERE l.invoice_id = inv.id AND l.branch_id = v_branch AND l.revoked_at IS NULL AND l.expires_at > now()
    ORDER BY l.created_at DESC LIMIT 1;
  END IF;
  IF to_regclass('public.whatsapp_messages') IS NOT NULL THEN
    SELECT jsonb_build_object('status', m.status, 'queued_at', m.queued_at, 'phone', m.phone) INTO v_wa FROM public.whatsapp_messages m
    WHERE m.invoice_id = inv.id AND m.kind = 'invoice' AND m.direction = 'out' AND m.status <> 'skipped'
    ORDER BY m.queued_at DESC LIMIT 1;
  END IF;

  RETURN jsonb_build_object(
    'id', inv.id, 'invoice_no', inv.invoice_no, 'status', inv.status, 'created_at', inv.created_at,
    'cashier', (SELECT jsonb_build_object('name', p.full_name, 'staff_id', p.staff_id::text, 'role', r.code)
                FROM public.profiles p LEFT JOIN public.roles r ON r.id = p.role_id WHERE p.id = inv.created_by),
    'sales_type', CASE WHEN COALESCE((v_del->>'requested')::boolean, false) THEN 'Home Delivery' ELSE 'Counter Sale' END,
    'payments', v_pay, 'paid', round(v_paid, 2), 'on_credit', round(v_credit, 2),
    'payment_status', CASE WHEN inv.status <> 'final' THEN inv.status
                           WHEN v_returned >= inv.total - 0.005 AND inv.total > 0 THEN 'refunded'
                           WHEN v_credit > 0.005 AND v_paid > 0.005 THEN 'partly_paid'
                           WHEN v_credit > 0.005 THEN 'credit'
                           ELSE 'paid' END,
    'returns', v_ret, 'returned', round(v_returned, 2), 'net_total', round(inv.total - v_returned, 2),
    'customer', v_cust, 'delivery', v_del, 'prev', v_prev, 'next', v_next,
    'share_link', v_link, 'whatsapp', v_wa
  );
END;
$$;

DROP FUNCTION IF EXISTS public.invoice_lookup(text);
CREATE FUNCTION public.invoice_lookup(p_q text)
RETURNS TABLE (id uuid, invoice_no text, created_at timestamptz, total numeric, status text, customer_name text)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_branch uuid := public._sales_guard(); v_q text := regexp_replace(trim(COALESCE(p_q, '')), '[%_\\]', '', 'g');
BEGIN
  IF length(v_q) < 2 OR length(v_q) > 40 THEN RETURN; END IF;
  RETURN QUERY
  SELECT i.id, i.invoice_no, i.created_at, round(i.total, 2), i.status, COALESCE(c.name, i.patient_name)
  FROM public.sales_invoices i LEFT JOIN public.customers c ON c.id = i.customer_id
  WHERE i.branch_id = v_branch AND i.invoice_no ILIKE '%' || v_q || '%'
  ORDER BY (upper(i.invoice_no) = upper(v_q)) DESC, i.created_at DESC
  LIMIT 8;
END;
$$;

DROP FUNCTION IF EXISTS public.invoice_share_link(uuid, text);
CREATE FUNCTION public.invoice_share_link(p_invoice uuid, p_base_url text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_branch uuid := public._sales_guard(); v_token text; v_exp timestamptz; v_base text;
BEGIN
  IF to_regclass('public.invoice_share_links') IS NULL THEN RAISE EXCEPTION 'Run migration 0030 (WhatsApp) to create customer invoice links'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.sales_invoices WHERE id = p_invoice AND branch_id = v_branch) THEN RAISE EXCEPTION 'Invoice not found in this branch'; END IF;
  v_base := nullif(trim(COALESCE(p_base_url, '')), '');
  IF v_base IS NOT NULL AND (v_base !~* '^https?://[^ ]+$' OR length(v_base) > 300) THEN v_base := NULL; END IF;
  v_base := regexp_replace(COALESCE(v_base, ''), '[^/]*$', '');
  SELECT token, expires_at INTO v_token, v_exp FROM public.invoice_share_links
  WHERE invoice_id = p_invoice AND branch_id = v_branch AND revoked_at IS NULL AND expires_at > now() ORDER BY created_at DESC LIMIT 1;
  IF v_token IS NULL THEN
    v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
    INSERT INTO public.invoice_share_links (token, branch_id, invoice_id, created_by) VALUES (v_token, v_branch, p_invoice, auth.uid())
    RETURNING expires_at INTO v_exp;
  END IF;
  RETURN jsonb_build_object('token', v_token, 'expires_at', v_exp,
                            'link', CASE WHEN v_base = '' THEN NULL ELSE v_base || 'invoice-view.html?t=' || v_token END);
END;
$$;

REVOKE ALL ON FUNCTION public.invoice_view_info(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.invoice_lookup(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.invoice_share_link(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.invoice_view_info(uuid), public.invoice_lookup(text), public.invoice_share_link(uuid, text) TO authenticated;
