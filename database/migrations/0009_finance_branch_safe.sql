-- ALZA PHARMACY - Finance-only migration
-- Adapted for the existing branch-scoped schema. Does NOT create/alter Returns tables
-- and does NOT replace any Billing, Inventory, customer-return, or purchase-return RPC.
-- Run once in Supabase SQL Editor after taking a database backup.

begin;

-- Document numbering isolated from the existing Returns numbering.
create sequence if not exists public.finance_doc_seq;
create or replace function public.finance_next_doc(p_prefix text)
returns text
language sql
volatile
security definer
set search_path = public, pg_temp
as $$
  select p_prefix || '-' || to_char(now() at time zone 'Asia/Kolkata', 'YYMM') || '-' ||
         lpad(nextval('public.finance_doc_seq')::text, 6, '0');
$$;

-- Append-only double-entry ledger. Supports existing Cash, UPI and Card sales, plus receivables/payables.
create table if not exists public.financial_ledger (
  id bigserial primary key,
  branch_id uuid not null references public.branches(id),
  journal_id uuid not null,
  entry_at timestamptz not null default now(),
  account text not null check (account in
    ('cash','upi','card','receivables','payables','sales','sales_returns','purchases','purchase_returns')),
  debit numeric(14,2) not null default 0 check (debit >= 0),
  credit numeric(14,2) not null default 0 check (credit >= 0),
  check ((debit > 0 and credit = 0) or (credit > 0 and debit = 0)),
  party_type text check (party_type in ('customer','distributor')),
  party_id uuid,
  ref_type text not null,
  ref_id uuid,
  memo text,
  reversal_of uuid,
  created_by uuid
);
create index if not exists financial_ledger_branch_entry_idx on public.financial_ledger(branch_id, entry_at desc);
create index if not exists financial_ledger_branch_account_idx on public.financial_ledger(branch_id, account, entry_at);
create index if not exists financial_ledger_journal_idx on public.financial_ledger(branch_id, journal_id);
create index if not exists financial_ledger_party_idx on public.financial_ledger(branch_id, party_type, party_id);

create table if not exists public.customer_receipts (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id),
  receipt_no text not null,
  customer_id uuid not null references public.customers(id),
  amount numeric(12,2) not null check (amount > 0),
  method text not null check (method in ('cash','upi')),
  note text,
  status text not null default 'posted' check (status in ('posted','reversed')),
  journal_id uuid,
  reversed_at timestamptz,
  reversal_reason text,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (branch_id, receipt_no)
);
create index if not exists customer_receipts_branch_date_idx on public.customer_receipts(branch_id, created_at desc);
create index if not exists customer_receipts_customer_idx on public.customer_receipts(branch_id, customer_id, status);

create table if not exists public.supplier_payments (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id),
  payment_no text not null,
  distributor_id uuid not null references public.distributors(id),
  purchase_invoice_id uuid references public.purchase_invoices(id),
  amount numeric(12,2) not null check (amount > 0),
  method text not null check (method in ('cash','upi')),
  reference text,
  note text,
  status text not null default 'posted' check (status in ('posted','reversed')),
  journal_id uuid,
  reversed_at timestamptz,
  reversal_reason text,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (branch_id, payment_no)
);
create index if not exists supplier_payments_branch_date_idx on public.supplier_payments(branch_id, created_at desc);
create index if not exists supplier_payments_distributor_idx on public.supplier_payments(branch_id, distributor_id, status);

-- RLS: users can only read Finance rows for their active branch. Writes are RPC-only.
alter table public.financial_ledger enable row level security;
alter table public.customer_receipts enable row level security;
alter table public.supplier_payments enable row level security;
revoke all on public.financial_ledger, public.customer_receipts, public.supplier_payments from anon;
revoke insert, update, delete on public.financial_ledger, public.customer_receipts, public.supplier_payments from authenticated;
grant select on public.financial_ledger, public.customer_receipts, public.supplier_payments to authenticated;

drop policy if exists financial_ledger_branch_read on public.financial_ledger;
create policy financial_ledger_branch_read on public.financial_ledger
for select to authenticated using (
  branch_id = public.my_branch_id() and coalesce(public.my_role(),'') in ('super_admin','admin')
);
drop policy if exists customer_receipts_branch_read on public.customer_receipts;
create policy customer_receipts_branch_read on public.customer_receipts
for select to authenticated using (
  branch_id = public.my_branch_id() and coalesce(public.my_role(),'') in ('super_admin','admin','pharmacist','billing')
);
drop policy if exists supplier_payments_branch_read on public.supplier_payments;
create policy supplier_payments_branch_read on public.supplier_payments
for select to authenticated using (
  branch_id = public.my_branch_id() and coalesce(public.my_role(),'') in ('super_admin','admin')
);

-- Ledger cannot be edited or deleted; use reversal RPCs.
create or replace function public.finance_ledger_immutable()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  raise exception 'Financial ledger is append-only; post a reversal instead';
end;
$$;
drop trigger if exists finance_ledger_immutable_trg on public.financial_ledger;
create trigger finance_ledger_immutable_trg
before update or delete on public.financial_ledger
for each row execute function public.finance_ledger_immutable();

-- Core journal writer. All rows in a journal are branch-bound and balanced.
create or replace function public.post_journal(
  p_ref_type text, p_ref_id uuid, p_memo text, p_lines jsonb, p_reversal_of uuid default null
) returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
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
begin
  if auth.uid() is null or v_branch is null then raise exception 'Login and active branch required'; end if;
  if coalesce(public.my_role(),'') not in ('super_admin','admin','pharmacist','billing','inventory') then raise exception 'Not authorised'; end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) < 2 then raise exception 'Journal requires at least two lines'; end if;
  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_account := v_line->>'account';
    v_d := coalesce(nullif(v_line->>'debit','')::numeric,0);
    v_c := coalesce(nullif(v_line->>'credit','')::numeric,0);
    if v_account not in ('cash','upi','receivables','payables','sales','sales_returns','purchases','purchase_returns')
       or v_d < 0 or v_c < 0 or not ((v_d > 0 and v_c = 0) or (v_c > 0 and v_d = 0)) then
      raise exception 'Invalid journal line';
    end if;
    v_debit := v_debit + v_d;
    v_credit := v_credit + v_c;
  end loop;
  if v_debit <= 0 or round(v_debit,2) <> round(v_credit,2) then
    raise exception 'Unbalanced journal (debit %, credit %)', v_debit, v_credit;
  end if;
  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_party_type := nullif(v_line->>'party_type','');
    v_party_id := nullif(v_line->>'party_id','')::uuid;
    insert into public.financial_ledger(
      branch_id,journal_id,account,debit,credit,party_type,party_id,ref_type,ref_id,memo,reversal_of,created_by
    ) values (
      v_branch,v_journal,v_line->>'account',coalesce(nullif(v_line->>'debit','')::numeric,0),
      coalesce(nullif(v_line->>'credit','')::numeric,0),v_party_type,v_party_id,
      p_ref_type,p_ref_id,p_memo,p_reversal_of,auth.uid()
    );
  end loop;
  return v_journal;
end;
$$;

create or replace function public.reverse_journal(p_journal uuid, p_memo text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_branch uuid := public.my_branch_id();
  v_ref_type text;
  v_ref_id uuid;
  v_lines jsonb;
begin
  if auth.uid() is null or v_branch is null then raise exception 'Login and active branch required'; end if;
  if coalesce(public.my_role(),'') not in ('super_admin','admin') then raise exception 'Not authorised'; end if;
  if exists(select 1 from public.financial_ledger where branch_id=v_branch and reversal_of=p_journal) then
    raise exception 'This journal has already been reversed';
  end if;
  select ref_type,ref_id into v_ref_type,v_ref_id
  from public.financial_ledger where branch_id=v_branch and journal_id=p_journal limit 1;
  if v_ref_type is null then raise exception 'Journal not found in this branch'; end if;
  select jsonb_agg(jsonb_build_object('account',account,'debit',credit,'credit',debit,'party_type',party_type,'party_id',party_id))
  into v_lines from public.financial_ledger where branch_id=v_branch and journal_id=p_journal;
  return public.post_journal(v_ref_type,v_ref_id,p_memo,v_lines,p_journal);
end;
$$;

-- Automatic postings for finalized sales and confirmed purchases.
create or replace function public.finance_post_sale_journal(p_invoice uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_branch uuid := public.my_branch_id();
  v_inv public.sales_invoices%rowtype;
  v_lines jsonb;
begin
  select * into v_inv from public.sales_invoices where id=p_invoice and branch_id=v_branch;
  if not found or v_inv.total <= 0 or v_inv.status <> 'final' then return; end if;
  if exists(select 1 from public.financial_ledger where branch_id=v_branch and ref_type='sales_invoice' and ref_id=p_invoice) then return; end if;
  select jsonb_agg(x) into v_lines from (
    select jsonb_build_object(
      'account',case when p.method='credit' then 'receivables' else p.method end,
      'debit',p.amount,'credit',0,
      'party_type',case when p.method='credit' then 'customer' else null end,
      'party_id',case when p.method='credit' then v_inv.customer_id else null end
    ) as x
    from public.payments p where p.invoice_id=p_invoice and p.branch_id=v_branch
    union all
    select jsonb_build_object('account','sales','debit',0,'credit',v_inv.total)
  ) q;
  if v_lines is not null then perform public.post_journal('sales_invoice',p_invoice,'Sale '||v_inv.invoice_no,v_lines); end if;
end;
$$;

create or replace function public.finance_post_purchase_journal(p_invoice uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_branch uuid := public.my_branch_id();
  v_inv public.purchase_invoices%rowtype;
begin
  select * into v_inv from public.purchase_invoices where id=p_invoice and branch_id=v_branch;
  if not found or v_inv.total <= 0 or v_inv.status <> 'confirmed' then return; end if;
  if exists(select 1 from public.financial_ledger where branch_id=v_branch and ref_type='purchase_invoice' and ref_id=p_invoice) then return; end if;
  perform public.post_journal('purchase_invoice',p_invoice,'Purchase '||v_inv.supplier_invoice_no,jsonb_build_array(
    jsonb_build_object('account','purchases','debit',v_inv.total,'credit',0),
    jsonb_build_object('account','payables','debit',0,'credit',v_inv.total,'party_type','distributor','party_id',v_inv.distributor_id)
  ));
end;
$$;

create or replace function public.finance_sales_invoice_trg()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.total > 0 and new.status='final' then perform public.finance_post_sale_journal(new.id); end if;
  return new;
end;
$$;
create or replace function public.finance_purchase_invoice_trg()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.total > 0 and new.status='confirmed' then perform public.finance_post_purchase_journal(new.id); end if;
  return new;
end;
$$;
drop trigger if exists finance_sales_invoice_post_trg on public.sales_invoices;
create trigger finance_sales_invoice_post_trg after insert or update of total,status on public.sales_invoices
for each row execute function public.finance_sales_invoice_trg();
drop trigger if exists finance_purchase_invoice_post_trg on public.purchase_invoices;
create trigger finance_purchase_invoice_post_trg after insert or update of total,status on public.purchase_invoices
for each row execute function public.finance_purchase_invoice_trg();

-- Post existing returns to ledger when their totals are finalized. Uses the live table columns.
create or replace function public.finance_sales_return_post_trg()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.total > 0 and not exists(select 1 from public.financial_ledger where branch_id=new.branch_id and ref_type='sales_return' and ref_id=new.id) then
    if new.refund_method not in ('cash','upi') then raise exception 'Finance supports cash or UPI customer refunds only'; end if;
    perform public.post_journal('sales_return',new.id,'Customer return '||new.return_no,jsonb_build_array(
      jsonb_build_object('account','sales_returns','debit',new.total,'credit',0),
      jsonb_build_object('account',new.refund_method,'debit',0,'credit',new.total)
    ));
  end if;
  return new;
end;
$$;
create or replace function public.finance_purchase_return_post_trg()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.total_value > 0 and not exists(select 1 from public.financial_ledger where branch_id=new.branch_id and ref_type='purchase_return' and ref_id=new.id) then
    perform public.post_journal('purchase_return',new.id,'Supplier return '||new.return_no,jsonb_build_array(
      jsonb_build_object('account','payables','debit',new.total_value,'credit',0,'party_type','distributor','party_id',new.distributor_id),
      jsonb_build_object('account','purchase_returns','debit',0,'credit',new.total_value)
    ));
  end if;
  return new;
end;
$$;
drop trigger if exists finance_sales_return_post_trg on public.sales_returns;
create trigger finance_sales_return_post_trg after insert or update of total on public.sales_returns
for each row execute function public.finance_sales_return_post_trg();
drop trigger if exists finance_purchase_return_post_trg on public.purchase_returns;
create trigger finance_purchase_return_post_trg after insert or update of total_value on public.purchase_returns
for each row execute function public.finance_purchase_return_post_trg();

-- Customer and distributor balances are calculated from branch ledger/source rows.
create or replace function public.customer_outstanding(p_customer uuid)
returns numeric language sql stable security definer set search_path = public, pg_temp as $$
  select case when coalesce(public.my_role(),'') in ('super_admin','admin','pharmacist','billing') then
    coalesce((select sum(p.amount) from public.payments p join public.sales_invoices i on i.id=p.invoice_id
      where p.branch_id=public.my_branch_id() and i.branch_id=public.my_branch_id() and i.customer_id=p_customer
        and p.method='credit' and i.status='final'),0)
    - coalesce((select sum(r.amount) from public.customer_receipts r
      where r.branch_id=public.my_branch_id() and r.customer_id=p_customer and r.status='posted'),0)
  else 0 end;
$$;
create or replace function public.distributor_balance(p_distributor uuid)
returns numeric language sql stable security definer set search_path = public, pg_temp as $$
  select case when coalesce(public.my_role(),'') in ('super_admin','admin') then
    coalesce((select sum(l.credit-l.debit) from public.financial_ledger l
      where l.branch_id=public.my_branch_id() and l.account='payables' and l.party_type='distributor' and l.party_id=p_distributor),0)
  else 0 end;
$$;

-- Customer dues and supplier payable list for Finance UI.
create or replace function public.customer_dues()
returns table(customer_id uuid,name text,phone text,outstanding numeric,credit_limit numeric)
language sql stable security definer set search_path = public, pg_temp as $$
  select c.id,c.name,c.phone,public.customer_outstanding(c.id),c.credit_limit
  from public.customers c where c.branch_id=public.my_branch_id()
    and coalesce(public.my_role(),'') in ('super_admin','admin','pharmacist','billing')
    and public.customer_outstanding(c.id)>0 order by 4 desc;
$$;
create or replace function public.payable_balances()
returns table(distributor_id uuid,name text,balance numeric)
language sql stable security definer set search_path = public, pg_temp as $$
  select d.id,d.name,public.distributor_balance(d.id)
  from public.distributors d where d.branch_id=public.my_branch_id()
    and coalesce(public.my_role(),'') in ('super_admin','admin')
    and public.distributor_balance(d.id)<>0 order by 3 desc;
$$;
create or replace function public.ledger_summary(p_from date default null,p_to date default null)
returns table(account text,debit numeric,credit numeric)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null or public.my_branch_id() is null then raise exception 'Login and active branch required'; end if;
  if coalesce(public.my_role(),'') not in ('super_admin','admin') then raise exception 'Not authorised'; end if;
  return query select l.account,sum(l.debit),sum(l.credit) from public.financial_ledger l
    where l.branch_id=public.my_branch_id()
      and (p_from is null or (l.entry_at at time zone 'Asia/Kolkata')::date>=p_from)
      and (p_to is null or (l.entry_at at time zone 'Asia/Kolkata')::date<=p_to)
    group by l.account order by l.account;
end;
$$;

-- Record money received from a customer against existing credit dues.
create or replace function public.record_customer_receipt(p_customer uuid,p_amount numeric,p_method text,p_note text default null)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_branch uuid := public.my_branch_id();
  v_customer public.customers%rowtype;
  v_id uuid;
  v_no text;
  v_journal uuid;
begin
  if auth.uid() is null or v_branch is null then raise exception 'Login and active branch required'; end if;
  if coalesce(public.my_role(),'') not in ('super_admin','admin','pharmacist','billing') then raise exception 'Not authorised'; end if;
  if p_amount is null or p_amount<=0 or p_method not in ('cash','upi') then raise exception 'Enter a positive amount and choose Cash or UPI'; end if;
  select * into v_customer from public.customers where id=p_customer and branch_id=v_branch and active=true for update;
  if not found then raise exception 'Customer not found or inactive in this branch'; end if;
  if p_amount > public.customer_outstanding(p_customer) then raise exception 'Receipt exceeds customer outstanding balance'; end if;
  v_no := public.finance_next_doc('RCPT');
  insert into public.customer_receipts(branch_id,receipt_no,customer_id,amount,method,note,created_by)
  values(v_branch,v_no,p_customer,p_amount,p_method,nullif(trim(p_note),''),auth.uid()) returning id into v_id;
  v_journal := public.post_journal('customer_receipt',v_id,'Receipt '||v_no||' from '||v_customer.name,jsonb_build_array(
    jsonb_build_object('account',p_method,'debit',p_amount,'credit',0),
    jsonb_build_object('account','receivables','debit',0,'credit',p_amount,'party_type','customer','party_id',p_customer)
  ));
  update public.customer_receipts set journal_id=v_journal where id=v_id and branch_id=v_branch;
  insert into public.audit_logs(branch_id,user_id,action,entity_type,entity_id,reason,before_data,after_data,at)
  values(v_branch,auth.uid(),'customer_receipt_recorded','customer_receipt',v_id::text,'Customer dues receipt',null,
    jsonb_build_object('receipt_no',v_no,'customer_id',p_customer,'amount',p_amount,'method',p_method),now());
  return v_id;
end;
$$;

-- Record money paid to a distributor against outstanding payables.
create or replace function public.record_supplier_payment(
  p_distributor uuid,p_amount numeric,p_method text,p_reference text default null,p_note text default null,p_purchase uuid default null
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_branch uuid := public.my_branch_id();
  v_distributor public.distributors%rowtype;
  v_id uuid;
  v_no text;
  v_journal uuid;
begin
  if auth.uid() is null or v_branch is null then raise exception 'Login and active branch required'; end if;
  if coalesce(public.my_role(),'') not in ('super_admin','admin') then raise exception 'Not authorised'; end if;
  if p_amount is null or p_amount<=0 or p_method not in ('cash','upi') then raise exception 'Enter a positive amount and choose Cash or UPI'; end if;
  select * into v_distributor from public.distributors where id=p_distributor and branch_id=v_branch and active=true for update;
  if not found then raise exception 'Distributor not found or inactive in this branch'; end if;
  if p_purchase is not null and not exists(select 1 from public.purchase_invoices where id=p_purchase and branch_id=v_branch and distributor_id=p_distributor) then
    raise exception 'Purchase invoice does not belong to this distributor and branch';
  end if;
  if p_amount > public.distributor_balance(p_distributor) then raise exception 'Payment exceeds distributor outstanding balance'; end if;
  v_no := public.finance_next_doc('SP');
  insert into public.supplier_payments(branch_id,payment_no,distributor_id,purchase_invoice_id,amount,method,reference,note,created_by)
  values(v_branch,v_no,p_distributor,p_purchase,p_amount,p_method,nullif(trim(p_reference),''),nullif(trim(p_note),''),auth.uid()) returning id into v_id;
  v_journal := public.post_journal('supplier_payment',v_id,'Payment '||v_no||' to '||v_distributor.name,jsonb_build_array(
    jsonb_build_object('account','payables','debit',p_amount,'credit',0,'party_type','distributor','party_id',p_distributor),
    jsonb_build_object('account',p_method,'debit',0,'credit',p_amount)
  ));
  update public.supplier_payments set journal_id=v_journal where id=v_id and branch_id=v_branch;
  insert into public.audit_logs(branch_id,user_id,action,entity_type,entity_id,reason,before_data,after_data,at)
  values(v_branch,auth.uid(),'supplier_payment_recorded','supplier_payment',v_id::text,'Supplier payment',null,
    jsonb_build_object('payment_no',v_no,'distributor_id',p_distributor,'amount',p_amount,'method',p_method),now());
  return v_id;
end;
$$;

create or replace function public.reverse_receipt(p_id uuid,p_reason text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_branch uuid:=public.my_branch_id(); v_receipt public.customer_receipts%rowtype;
begin
  if auth.uid() is null or v_branch is null then raise exception 'Login and active branch required'; end if;
  if coalesce(public.my_role(),'') not in ('super_admin','admin') then raise exception 'Not authorised'; end if;
  if coalesce(trim(p_reason),'')='' then raise exception 'A reason is required'; end if;
  select * into v_receipt from public.customer_receipts where id=p_id and branch_id=v_branch for update;
  if not found then raise exception 'Receipt not found in this branch'; end if;
  if v_receipt.status<>'posted' or v_receipt.journal_id is null then raise exception 'Receipt already reversed or journal missing'; end if;
  perform public.reverse_journal(v_receipt.journal_id,'Reversal of '||v_receipt.receipt_no||': '||trim(p_reason));
  update public.customer_receipts set status='reversed',reversed_at=now(),reversal_reason=trim(p_reason)
    where id=p_id and branch_id=v_branch;
  insert into public.audit_logs(branch_id,user_id,action,entity_type,entity_id,reason,before_data,after_data,at)
  values(v_branch,auth.uid(),'customer_receipt_reversed','customer_receipt',p_id::text,trim(p_reason),
    jsonb_build_object('status','posted'),jsonb_build_object('status','reversed'),now());
end;
$$;
create or replace function public.reverse_supplier_payment(p_id uuid,p_reason text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_branch uuid:=public.my_branch_id(); v_payment public.supplier_payments%rowtype;
begin
  if auth.uid() is null or v_branch is null then raise exception 'Login and active branch required'; end if;
  if coalesce(public.my_role(),'') not in ('super_admin','admin') then raise exception 'Not authorised'; end if;
  if coalesce(trim(p_reason),'')='' then raise exception 'A reason is required'; end if;
  select * into v_payment from public.supplier_payments where id=p_id and branch_id=v_branch for update;
  if not found then raise exception 'Payment not found in this branch'; end if;
  if v_payment.status<>'posted' or v_payment.journal_id is null then raise exception 'Payment already reversed or journal missing'; end if;
  perform public.reverse_journal(v_payment.journal_id,'Reversal of '||v_payment.payment_no||': '||trim(p_reason));
  update public.supplier_payments set status='reversed',reversed_at=now(),reversal_reason=trim(p_reason)
    where id=p_id and branch_id=v_branch;
  insert into public.audit_logs(branch_id,user_id,action,entity_type,entity_id,reason,before_data,after_data,at)
  values(v_branch,auth.uid(),'supplier_payment_reversed','supplier_payment',p_id::text,trim(p_reason),
    jsonb_build_object('status','posted'),jsonb_build_object('status','reversed'),now());
end;
$$;

-- Restrict all Finance RPCs to authenticated users; functions perform role + branch checks internally.
revoke all on function public.finance_next_doc(text) from public, anon, authenticated;
revoke all on function public.post_journal(text,uuid,text,jsonb,uuid) from public, anon, authenticated;
revoke all on function public.reverse_journal(uuid,text) from public, anon, authenticated;
revoke all on function public.finance_post_sale_journal(uuid) from public, anon, authenticated;
revoke all on function public.finance_post_purchase_journal(uuid) from public, anon, authenticated;
revoke all on function public.customer_outstanding(uuid) from public, anon;
revoke all on function public.distributor_balance(uuid) from public, anon;
revoke all on function public.customer_dues() from public, anon;
revoke all on function public.payable_balances() from public, anon;
revoke all on function public.ledger_summary(date,date) from public, anon;
revoke all on function public.record_customer_receipt(uuid,numeric,text,text) from public, anon;
revoke all on function public.record_supplier_payment(uuid,numeric,text,text,text,uuid) from public, anon;
revoke all on function public.reverse_receipt(uuid,text) from public, anon;
revoke all on function public.reverse_supplier_payment(uuid,text) from public, anon;
grant execute on function public.customer_outstanding(uuid), public.distributor_balance(uuid), public.customer_dues(),
  public.payable_balances(), public.ledger_summary(date,date), public.record_customer_receipt(uuid,numeric,text,text),
  public.record_supplier_payment(uuid,numeric,text,text,text,uuid), public.reverse_receipt(uuid,text),
  public.reverse_supplier_payment(uuid,text) to authenticated;

-- Backfill historical rows for every branch. This migration-time block does not
-- depend on auth.uid(); runtime RPCs and triggers remain branch-scoped.
do $$
declare
  r record;
  p record;
  j uuid;
  paid numeric;
  v_lines jsonb;
begin
  for r in select * from public.sales_invoices where status='final' and total>0 loop
    if not exists(select 1 from public.financial_ledger where branch_id=r.branch_id and ref_type='sales_invoice' and ref_id=r.id) then
      select coalesce(sum(amount),0) into paid from public.payments where invoice_id=r.id and branch_id=r.branch_id;
      if round(paid,2)=round(r.total,2) then
        j:=gen_random_uuid();
        for p in select method,amount from public.payments where invoice_id=r.id and branch_id=r.branch_id loop
          insert into public.financial_ledger(branch_id,journal_id,account,debit,credit,party_type,party_id,ref_type,ref_id,memo,created_by)
          values(r.branch_id,j,case when p.method='credit' then 'receivables' else p.method end,p.amount,0,
            case when p.method='credit' then 'customer' else null end,case when p.method='credit' then r.customer_id else null end,
            'sales_invoice',r.id,'Sale '||r.invoice_no,r.created_by);
        end loop;
        insert into public.financial_ledger(branch_id,journal_id,account,debit,credit,ref_type,ref_id,memo,created_by)
        values(r.branch_id,j,'sales',0,r.total,'sales_invoice',r.id,'Sale '||r.invoice_no,r.created_by);
      end if;
    end if;
  end loop;

  for r in select * from public.purchase_invoices where status='confirmed' and total>0 loop
    if not exists(select 1 from public.financial_ledger where branch_id=r.branch_id and ref_type='purchase_invoice' and ref_id=r.id) then
      j:=gen_random_uuid();
      insert into public.financial_ledger(branch_id,journal_id,account,debit,credit,ref_type,ref_id,memo,created_by)
      values(r.branch_id,j,'purchases',r.total,0,'purchase_invoice',r.id,'Purchase '||r.supplier_invoice_no,r.created_by);
      insert into public.financial_ledger(branch_id,journal_id,account,debit,credit,party_type,party_id,ref_type,ref_id,memo,created_by)
      values(r.branch_id,j,'payables',0,r.total,'distributor',r.distributor_id,'purchase_invoice',r.id,'Purchase '||r.supplier_invoice_no,r.created_by);
    end if;
  end loop;

  for r in select * from public.sales_returns where total>0 loop
    if not exists(select 1 from public.financial_ledger where branch_id=r.branch_id and ref_type='sales_return' and ref_id=r.id) then
      if r.refund_method in ('cash','upi') then
        j:=gen_random_uuid();
        insert into public.financial_ledger(branch_id,journal_id,account,debit,credit,ref_type,ref_id,memo,created_by)
        values(r.branch_id,j,'sales_returns',r.total,0,'sales_return',r.id,'Customer return '||r.return_no,r.created_by);
        insert into public.financial_ledger(branch_id,journal_id,account,debit,credit,ref_type,ref_id,memo,created_by)
        values(r.branch_id,j,r.refund_method,0,r.total,'sales_return',r.id,'Customer return '||r.return_no,r.created_by);
      end if;
    end if;
  end loop;

  for r in select * from public.purchase_returns where total_value>0 loop
    if not exists(select 1 from public.financial_ledger where branch_id=r.branch_id and ref_type='purchase_return' and ref_id=r.id) then
      j:=gen_random_uuid();
      insert into public.financial_ledger(branch_id,journal_id,account,debit,credit,party_type,party_id,ref_type,ref_id,memo,created_by)
      values(r.branch_id,j,'payables',r.total_value,0,'distributor',r.distributor_id,'purchase_return',r.id,'Supplier return '||r.return_no,r.created_by);
      insert into public.financial_ledger(branch_id,journal_id,account,debit,credit,ref_type,ref_id,memo,created_by)
      values(r.branch_id,j,'purchase_returns',0,r.total_value,'purchase_return',r.id,'Supplier return '||r.return_no,r.created_by);
    end if;
  end loop;
end;
$$;

commit;
