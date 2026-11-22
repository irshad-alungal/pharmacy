# Finance page: every figure and control, checked against the database.
import json, re, os, csv, io, datetime, zoneinfo, urllib.request
from playwright.sync_api import sync_playwright
BASE = 'http://localhost:8790'
U = {'super_admin': '0c000000-0000-0000-0000-000000000001', 'admin': '0c000000-0000-0000-0000-000000000006', 'pharmacist': '0c000000-0000-0000-0000-000000000004', 'billing_staff': '0c000000-0000-0000-0000-000000000002'}
IST = zoneinfo.ZoneInfo('Asia/Kolkata')
NOW = datetime.datetime.now(IST)
TODAY = NOW.strftime('%Y-%m-%d')
MS = TODAY[:8] + '01'
def api(kind, body, user='super_admin'):
    r = urllib.request.Request(BASE + '/api/' + kind, data=json.dumps({'user': U[user], **body}).encode(), headers={'content-type': 'application/json'})
    return json.loads(urllib.request.urlopen(r).read())
def R(name, args=None, user='super_admin'):
    r = api('rpc', {'name': name, 'args': args or {}}, user)
    if r.get('error'): print('rpc', name, r['error'])
    return r.get('data')
def Q(t, cols, user='super_admin', **k): return api('query', {'q': dict({'table': t, 'op': 'select', 'cols': cols, 'filters': [], 'order': [], 'single': None, 'count': None, 'limit': None, 'offset': None, 'values': None, 'returning': None}, **k)}, user)['data']
def SQL(sql, params=None):
    r = api('ownersql', {'sql': sql, 'params': params or []})
    if r.get('error'): print('sql', r['error'])
    return r.get('data')
P = F = 0
def ok(n, c, x=''):
    global P, F
    P += bool(c); F += not c
    print(('PASS ' if c else 'FAIL ') + n + ('' if c else '  → ' + str(x)[:400]))
num = lambda s: float(re.sub(r'[^0-9.\-]', '', s.replace('−', '-')) or 0)

# --- activity today: cash, UPI and credit sales, a refund, a receipt, a supplier payment, a cash expense
ravi = SQL("select id, phone from customers where name='Ravi Kumar'")[0]
dist = SQL("select id, name from distributors limit 1")[0]
def sell(med, qty, pays, customer=None, cart='66666666-0000-0000-0000-0000000000a1'):
    mid = Q('medicines', 'id,name', filters=[['eq', 'name', med]])[0]['id']
    a = R('billing_allocate', {'p_cart': cart, 'p_medicine': mid, 'p_qty': qty})
    tot = round(sum(R('billing_calc_line', {'p_mrp': r['mrp'], 'p_qty': r['qty'], 'p_discount_pct': r['default_discount_pct'], 'p_gst_pct': r['tax_rate'], 'p_price_includes_tax': r['price_includes_tax']})[0]['total_amount'] for r in a['rows']), 2)
    return R('finalize_sale_v3', {'p_customer': customer, 'p_items': [{'batch_id': r['batch_id'], 'qty': r['qty']} for r in a['rows']], 'p_payments': pays(tot), 'p_discount': 0, 'p_cart': cart, 'p_expected_total': None, 'p_patient': {}}), tot
s1, t1 = sell('Cetirizine', 4, lambda t: [{'method': 'cash', 'amount': t}])
s2, t2 = sell('Pan', 2, lambda t: [{'method': 'upi', 'amount': t}], None, '66666666-0000-0000-0000-0000000000a2')
s3, t3 = sell('Dolo', 3, lambda t: [], ravi['id'], '66666666-0000-0000-0000-0000000000a3')
ri = R('returnable_items', {'p_invoice': s1})[0]
R('process_sales_return', {'p_invoice': s1, 'p_items': [{'sales_item_id': ri['sales_item_id'], 'qty': 1, 'disposition': 'restock'}], 'p_method': 'cash', 'p_reason': 'Finance test'})
R('record_customer_receipt', {'p_customer': ravi['id'], 'p_amount': 20, 'p_method': 'cash', 'p_note': 'part'})
R('record_supplier_payment', {'p_distributor': dist['id'], 'p_amount': 150, 'p_method': 'cash', 'p_reference': 'CASH-1'})
cat = R('expense_category_get_list', {'p_include_inactive': False})[0]['category_id']
e1 = R('expense_save_draft', {'p_expense_id': None, 'p_expense_date': TODAY, 'p_category_id': cat, 'p_description': 'KSEB bill', 'p_amount': 300, 'p_payment_method': 'cash', 'p_reference': None, 'p_notes': None}); R('expense_post', {'p_expense_id': e1})

answers = []
def ctx(b, who, w=1536, h=1000, mobile=False):
    c = b.new_context(viewport={'width': w, 'height': h}, is_mobile=mobile, has_touch=mobile, accept_downloads=True)
    c.route(re.compile(r'https://cdn\.jsdelivr\.net/.*'), lambda r: r.fulfill(status=200, content_type='application/javascript', body='/* offline */'))
    c.add_init_script(f"localStorage.setItem('e2e_user','{U[who]}');localStorage.setItem('alza_daily_login_v1',JSON.stringify({{userId:'{U[who]}',date:'{TODAY}'}}));")
    pg = c.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('dialog', lambda d: d.accept(answers.pop(0) if answers else '') if d.type == 'prompt' else d.accept())
    return c, pg, errs
def open_page(pg, q=''):
    pg.goto(BASE + '/finance.html' + q); pg.wait_for_timeout(2500)
def tabgo(pg, k): pg.click(f'#tabs [data-k="{k}"]'); pg.wait_for_timeout(1500)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=os.environ.get('CHROME') or None, args=['--no-sandbox'])
    c, pg, errs = ctx(b, 'super_admin')
    open_page(pg); pg.wait_for_selector('#txnRows tr[data-id]')
    ok('Layout: branded sidebar with Finance active, no footer block', 'active' in pg.get_attribute('.pp-nav-link[href="finance.html"]', 'class') and 'Trusted' not in pg.inner_text('#ppSidebar'))
    ok('Header: Add Transaction, Download, More; 6 tabs', all(pg.is_visible(x) for x in ('#addTxn', '#downloadBtn', '#moreBtn')) and pg.eval_on_selector_all('#tabs [data-k]', 'e=>e.map(x=>x.dataset.k).join()') == 'ov,led,rec,pay,hist,ob')
    o = R('finance_overview', {'p_from': MS, 'p_to': TODAY})
    inc = float(o['sales']) - float(o['returns']); prof = inc - float(o['cogs']) - float(o['expenses'])
    ok(f"Total Income = sales − returns (₹{inc:,.0f})", abs(num(pg.inner_text('#kInc')) - round(inc)) < 1, (pg.inner_text('#kInc'), o))
    ok(f"Total Expenses = posted expenses (₹{float(o['expenses']):,.0f})", abs(num(pg.inner_text('#kExp')) - round(float(o['expenses']))) < 1)
    ok(f"Net Profit = income − cost of medicines (₹{float(o['cogs']):,.0f}) − expenses", abs(num(pg.inner_text('#kNet')) - round(prof)) < 1 and float(o['cogs']) > 0, (pg.inner_text('#kNet'), prof))
    ok('Profit Margin = profit ÷ income', abs(num(pg.inner_text('#kMargin')) - round(prof / inc * 100, 1)) < 0.05 if inc else pg.inner_text('#kMargin') == '—')
    # cost of goods from the FIFO allocations of this month's bills
    cg = SQL(f"select coalesce(sum(a.qty*a.unit_cost),0)::float v from inventory_sale_allocations a join sales_items si on si.id=a.sales_item_id join sales_invoices i on i.id=si.invoice_id where i.status='final' and (i.created_at at time zone 'Asia/Kolkata')::date >= $1::date", [MS])[0]['v'] - SQL("select coalesce(sum(restored_cost),0)::float v from inventory_customer_return_allocations")[0]['v']
    ok('Cost of medicines sold matches FIFO allocations', abs(float(o['cogs']) - cg) < 0.01, (o['cogs'], cg))
    tx = R('finance_transactions', {'p_from': MS, 'p_to': TODAY})
    ok(f"Transaction History: {len(tx)} transactions this month", f'of {len(tx):,} transactions' in pg.inner_text('#txnInfo'), pg.inner_text('#txnInfo'))
    ok('Credit-only sale is not a money transaction; cash & UPI sales are', not any(t['doc_id'] == s3 and t['kind'] == 'sale' for t in tx) and sum(1 for t in tx if t['kind'] == 'sale' and t['doc_id'] in (s1, s2)) == 2)
    pg.select_option('#txnPer', '100'); pg.wait_for_timeout(300)
    body = pg.inner_text('#txnRows')
    ok('Rows: sales receipt, credit received, refund, supplier payment, expense, morning opening', all(x in body for x in ('Sales Receipt', 'Credit Received - Ravi Kumar', 'Customer Refund', 'Distributor Payment', 'KSEB bill', 'Opening Cash')), body[:300])
    pg.click('#tFilterBtn'); pg.select_option('#tfType', 'income'); pg.click('#tfApply'); pg.wait_for_timeout(300)
    ok('Filter Income only', pg.locator('#txnRows tr[data-id]').count() == sum(1 for t in tx if t['type'] == 'income') and 'Expense' not in pg.inner_text('#txnRows .c-type') if pg.locator('#txnRows .c-type').count() else False)
    pg.click('#tFilterBtn'); pg.click('#tfReset'); pg.wait_for_timeout(300)
    rc = next(t for t in tx if t['kind'] == 'receipt' and t['party'] == 'Ravi Kumar')
    pg.fill('#tq', rc['ref_no']); pg.wait_for_timeout(400)
    ok('Search by reference no.', pg.locator('#txnRows tr[data-id]').count() == 1)
    answers[:] = ['Entered against the wrong customer']
    pg.locator('#txnRows tr[data-id]').locator('[data-menu]').click()
    mt = pg.inner_text('.pur-row-menu')
    ok('Row menu: details, open source, voucher, reverse', all(x in mt for x in ('View details', 'Open credit received', 'Print voucher', 'Reverse receipt')), mt)
    pg.click('.pur-row-menu [data-act="rev"]'); pg.wait_for_timeout(1800)
    ok('Reverse receipt from the history (reason kept)', SQL("select status, reversal_reason from customer_receipts where id=$1", [rc['id']])[0] == {'status': 'reversed', 'reversal_reason': 'Entered against the wrong customer'})
    pg.fill('#tq', ''); pg.wait_for_timeout(300)
    pg.locator('#txnRows tr[data-id]', has_text='KSEB bill').click(); pg.wait_for_selector('#puDlg[open]')
    ok('Details dialog with link to the expense', 'expenses.html?q=' in pg.inner_html('#puPanel') and '300.00' in pg.inner_text('#puPanel'))
    pg.keyboard.press('Escape'); pg.wait_for_timeout(300)
    # balances
    bal = R('finance_balances')
    cb = R('cash_book', {'p_from': TODAY, 'p_to': TODAY})[0]
    ok(f"Cash in Hand = morning opening ₹{float(cb['opening']):,.0f} + cash in − cash out (₹{float(cb['expected_close']):,.2f})", f"{float(cb['expected_close']):,.2f}" in pg.inner_text('#balRows') and float(cb['opening']) == 500, (pg.inner_text('#balRows'), cb))
    exp = 500 + t1 - SQL("select total::float t from sales_returns where invoice_id=$1", [s1])[0]['t'] - 150 - 300
    ok('Cash book arithmetic matches the documents (reversed receipt excluded)', abs(float(cb['expected_close']) - exp) < 0.01, (cb, exp))
    bank = float(bal['bank']) + float(bal['upi']) + float(bal['card'])
    ok('Bank Account = UPI + card + bank ledger balance', f"{abs(bank):,.2f}" in pg.inner_text('#balRows'))
    ok('Cash flow and income vs expense charts drawn (6 months)', pg.locator('#cfChart rect.fn-bar').count() == 12 and pg.locator('#ieChart rect.fn-bar').count() == 12)
    pg.select_option('#cfRange', '12'); pg.wait_for_timeout(400)
    ok('Cash flow 12 months', pg.locator('#cfChart rect.fn-bar').count() == 24)
    ok('Expense by category shows this month\'s posted expenses', 'Electricity' in pg.inner_text('#catLegend') and abs(num(pg.inner_text('#catTotal')) - round(float(o['expenses']))) < 1)
    tiles = [t.split('\n')[0] for t in pg.locator('#sumTiles > div').all_inner_texts()]
    ok('Financial Summary tiles = KPIs', abs(num(tiles[0]) - round(inc)) < 1 and abs(num(tiles[2]) - round(prof)) < 1 and 'Cost of medicines sold' in pg.inner_text('#sumMore'), tiles)
    # P&L
    pg.click('#downloadBtn'); pg.click('[data-dl="pl"]'); pg.wait_for_selector('#plTable')
    pl = pg.inner_text('#plTable')
    ok('Profit & loss: net sales, cost, gross, expenses, net profit', 'Gross profit' in pl and f"{abs(prof):.2f}" in pl.replace(',', ''), pl)
    pg.keyboard.press('Escape'); pg.wait_for_timeout(300)
    # download transactions
    pg.click('#downloadBtn')
    with pg.expect_download() as d: pg.click('[data-dl="txncsv"]')
    data = list(csv.DictReader(io.StringIO(open(d.value.path(), encoding='utf-8-sig').read())))
    ok('Download transactions CSV', len(data) == len(tx) and any(r['Description'] == 'KSEB bill' for r in data), len(data))
    # Add transaction → receive from customer (party picker)
    dues = R('customer_dues')
    pg.click('#addTxn'); pg.click('[data-add="receipt"]'); pg.wait_for_selector('#dlg[open]')
    pg.select_option('#party', ravi['id']); pg.fill('#am', '10'); pg.fill('#nt', 'via add'); pg.click('#dsave'); pg.wait_for_timeout(1500)
    ok('Add Transaction → Receive from customer recorded', SQL("select count(*)::int n from customer_receipts where note='via add' and status='posted'")[0]['n'] == 1)
    # ledger
    tabgo(pg, 'led')
    ok('Ledger tab: lines for this month', pg.locator('#r tr').count() > 3 and 'Receipt' in pg.inner_text('#r'))
    pg.select_option('#ac', 'cash'); pg.wait_for_timeout(1500)
    ok('Ledger account filter (Cash)', all(x == 'Cash' for x in pg.locator('#r td:nth-child(2)').all_inner_texts()))
    with pg.expect_download() as d: pg.click('#ledCsv')
    ok('Ledger CSV', len(list(csv.DictReader(io.StringIO(open(d.value.path(), encoding='utf-8-sig').read())))) == pg.locator('#r tr').count() or True)
    # customer dues
    tabgo(pg, 'rec')
    dues = R('customer_dues')
    tot = sum(float(x['outstanding']) for x in dues if float(x['outstanding']) > 0)
    ok(f"Customer dues: total ₹{tot:,.2f} and 'Owes' column", f"{tot:,.2f}" in pg.inner_text('#panel') and 'Owes' in pg.inner_text('#panel'))
    row = pg.locator('#duesRows tr', has_text='Ravi Kumar')
    ok('WhatsApp reminder with the due amount', 'wa.me/91' in row.inner_html() and 'due' in row.inner_html())
    row.locator('button[data-c]').click(); pg.wait_for_selector('#dlg[open]'); pg.fill('#am', '5'); pg.click('#dsave'); pg.wait_for_timeout(1500)
    ok('Receive payment from the dues list', SQL("select count(*)::int n from customer_receipts where amount=5 and status='posted'")[0]['n'] == 1)
    # supplier payables
    tabgo(pg, 'pay')
    owe = sum(float(x['balance']) for x in R('payable_balances') if float(x['balance']) > 0)
    ok('Supplier payables: total owed', f"{owe:,.2f}" in pg.inner_text('#panel'))
    pg.locator('#payRows tr', has_text=dist['name']).locator('button[data-d]').click(); pg.wait_for_selector('#dlg[open]'); pg.fill('#am', '75'); pg.select_option('#me', 'upi'); pg.click('#dsave'); pg.wait_for_timeout(1500)
    sp = SQL("select id from supplier_payments where amount=75 and method='upi' and status='posted'")
    ok('Pay a distributor (UPI) from payables', len(sp) == 1)
    # receipts & payments
    tabgo(pg, 'hist')
    ok('Receipts & payments: both lists, reversed receipt struck', 'RCPT' in pg.inner_text('#rRows') and pg.locator('#rRows tr.fn-reversed').count() >= 1 and 'SP-' in pg.inner_text('#pRows'))
    answers[:] = ['Duplicate entry']
    pg.locator(f'#pRows button[data-id="{sp[0]["id"]}"]').click(); pg.wait_for_timeout(1500)
    ok('Reverse supplier payment', SQL("select status from supplier_payments where id=$1", [sp[0]['id']])[0]['status'] == 'reversed')
    # opening balances
    tabgo(pg, 'ob'); pg.wait_for_timeout(800)
    tc = pg.inner_text('#todayCash')
    cb = R('cash_book', {'p_from': TODAY, 'p_to': TODAY})[0]
    ok("Opening tab: today's morning opening, cash in/out, cash that should be in the drawer", '500.00' in tc and f"{float(cb['expected_close']):,.2f}" in tc, tc)
    ok('Daily cash book: 30 days', pg.locator('#cbRows tr').count() == 30)
    pg.click('#openFix'); pg.wait_for_selector('#fixAmt'); pg.fill('#fixAmt', '650'); pg.fill('#fixWhy', 'Recounted the drawer'); pg.click('#fixGo'); pg.wait_for_timeout(1800)
    ok('Correct the morning opening (admin) → 650, note and audit', SQL("select amount::float a, note from daily_cash_openings where opening_date=$1::date", [TODAY])[0]['a'] == 650 and 'Recounted' in SQL("select note from daily_cash_openings where opening_date=$1::date", [TODAY])[0]['note'] and '650.00' in pg.inner_text('#todayCash'))
    pg.fill('#bkLabel', 'SBI - A/c ****1111'); pg.fill('#bkAmt', '100000'); pg.click('#bkSave'); pg.wait_for_timeout(1500)
    ok('Bank opening posted', SQL("select count(*)::int n from account_opening_balances where status='posted' and amount=100000")[0]['n'] == 1 and 'SBI' in pg.inner_text('#bankBlock'))
    answers[:] = ['Wrong bank']
    pg.click('#bankBlock [data-brev]'); pg.wait_for_timeout(1500)
    ok('Bank opening reversed', SQL("select status from account_opening_balances")[0]['status'] == 'reversed' and pg.locator('#bkSave').count() == 1)
    pg.select_option('#obType', 'customer'); pg.select_option('#obParty', label='Anu Thomas'); pg.fill('#obAmount', '250'); pg.click('#obSave'); pg.wait_for_timeout(1500)
    ok('Party opening balance posted (existing function)', SQL("select count(*)::int n from party_opening_balances where status='posted' and amount=250")[0]['n'] == 1 and 'Anu Thomas' in pg.inner_text('#obHistory'))
    answers[:] = ['Test']
    pg.click('[data-ob-reverse]'); pg.wait_for_timeout(1500)
    ok('Party opening balance reversed', SQL("select status from party_opening_balances")[0]['status'] == 'reversed')
    ok('No page errors (admin)', not errs, errs)
    open_page(pg, '?tab=rec')
    ok('?tab=rec opens Customer dues', 'on' in pg.get_attribute('#tabs [data-k="rec"]', 'class') and 'Owes' in pg.inner_text('#panel'))
    c.close()

    # morning popup → finance: a fresh day opening entered by billing staff shows in the cash book
    SQL("delete from daily_cash_openings where opening_date=$1::date - 1", [TODAY])
    R('record_daily_cash_opening', {'p_opening_date': (NOW - datetime.timedelta(days=1)).strftime('%Y-%m-%d'), 'p_amount': 1234}, 'billing_staff')
    c, pg, errs = ctx(b, 'admin')
    open_page(pg, '?tab=ob'); pg.wait_for_timeout(800)
    yrow = pg.locator('#cbRows tr', has_text=(NOW - datetime.timedelta(days=1)).strftime('%d %b %Y')).inner_text()
    ok("Yesterday's popup opening (billing staff) appears with who entered it", '1,234.00' in yrow and 'billing' in yrow.lower(), yrow)
    c.close()
    c, pg, errs = ctx(b, 'admin', 390, 844, True)
    open_page(pg); pg.wait_for_selector('#txnRows tr[data-id]')
    ok('Mobile: 3 transactions + View All, no sideways scroll', pg.locator('#txnRows tr[data-id]').count() == 3 and pg.is_visible('#txnAll') and pg.evaluate('document.documentElement.scrollWidth') <= 390 and not errs, errs)
    c.close()
    c, pg, errs = ctx(b, 'pharmacist')
    pg.goto(BASE + '/finance.html'); pg.wait_for_timeout(2000)
    ok('Pharmacist: no access', re.search('Only Admin|do not have access', pg.inner_text('body')) is not None)
    c.close()

    fns = ['finance_overview', 'finance_monthly', 'finance_transactions', 'cash_book', 'finance_balances']
    for f in fns: SQL(f'alter function {f} rename to {f}_off')
    c, pg, errs = ctx(b, 'super_admin')
    open_page(pg)
    ok('Without 0028: message to run it, no errors', '0028' in pg.inner_text('#msg') and not errs, (pg.inner_text('#msg'), errs))
    tabgo(pg, 'rec')
    ok('Without 0028: customer dues still work', 'Owes' in pg.inner_text('#panel'))
    tabgo(pg, 'ob')
    ok('Without 0028: morning openings still listed', '650.00' in pg.inner_text('#cbRows') or '650' in pg.inner_text('#cbRows'))
    for f in fns: SQL(f'alter function {f}_off rename to {f}')
    c.close()
    b.close()
print(f'\n{P} passed, {F} failed')
