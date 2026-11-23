# Invoice View page (invoice-view.html): staff view with the sidebar (?id= / ?no=), every value checked
# against the database, previous / next, print, PDF, WhatsApp, e-mail, links, returns, delivery, roles,
# the customer's private link (?t=), the page before migration 0036, and the phone layout.
import json, re, os, datetime, zoneinfo, urllib.request, urllib.parse
from playwright.sync_api import sync_playwright
BASE = 'http://localhost:8790'
U = {'super_admin': '0c000000-0000-0000-0000-000000000001', 'admin': '0c000000-0000-0000-0000-000000000006', 'pharmacist': '0c000000-0000-0000-0000-000000000004',
     'billing_staff': '0c000000-0000-0000-0000-000000000002', 'inventory_staff': '0c000000-0000-0000-0000-000000000003', 'delivery': '0c000000-0000-0000-0000-000000000005'}
BR = '0b000000-0000-0000-0000-000000000001'
TODAY = datetime.datetime.now(zoneinfo.ZoneInfo('Asia/Kolkata')).strftime('%Y-%m-%d')
JSPDF = '/tmp/jspdf.esm.js'
def api(kind, body, user='super_admin'):
    r = urllib.request.Request(BASE + '/api/' + kind, data=json.dumps({'user': U[user] if user else None, **body}).encode(), headers={'content-type': 'application/json'})
    return json.loads(urllib.request.urlopen(r).read())
def R(name, args=None, user='super_admin'):
    r = api('rpc', {'name': name, 'args': args or {}}, user)
    if r.get('error'): print('rpc', name, r['error'])
    return r.get('data')
def SQL(sql, params=None):
    r = api('ownersql', {'sql': sql, 'params': params or []})
    if r.get('error'): print('sql', r['error'])
    return r.get('data')
def Q(t, cols, **k): return api('query', {'q': dict({'table': t, 'op': 'select', 'cols': cols, 'filters': [], 'order': [], 'single': None, 'count': None, 'limit': None, 'offset': None, 'values': None, 'returning': None}, **k)})['data']
P = F = 0
def ok(n, c, x=''):
    global P, F
    P += bool(c); F += not c
    print(('PASS ' if c else 'FAIL ') + n + ('' if c else '  → ' + str(x)[:400]))
num = lambda s: float(re.sub(r'[^0-9.\-]', '', s) or 0)

# ---- bills made through the real billing functions
ravi = SQL("select id, phone from customers where name='Ravi Kumar'")[0]
SQL("update customers set email='ravi@example.in' where id=$1", [ravi['id']])
def sell(med, qty, pays, customer=None, cart='55555555-0000-0000-0000-0000000000a1', patient=None):
    mid = Q('medicines', 'id,name', filters=[['eq', 'name', med]])[0]['id']
    a = R('billing_allocate', {'p_cart': cart, 'p_medicine': mid, 'p_qty': qty})
    tot = round(sum(R('billing_calc_line', {'p_mrp': r['mrp'], 'p_qty': r['qty'], 'p_discount_pct': r['default_discount_pct'], 'p_gst_pct': r['tax_rate'], 'p_price_includes_tax': r['price_includes_tax']})[0]['total_amount'] for r in a['rows']), 2)
    p = [{'method': m, 'amount': round(tot * f, 2)} for m, f in pays]
    if p and abs(sum(f for _, f in pays) - 1) < 1e-9: p[-1]['amount'] = round(tot - sum(x['amount'] for x in p[:-1]), 2)
    return R('finalize_sale_v3', {'p_customer': customer, 'p_items': [{'batch_id': r['batch_id'], 'qty': r['qty']} for r in a['rows']], 'p_payments': p, 'p_discount': 0, 'p_cart': cart, 'p_expected_total': None, 'p_patient': patient or {}}), tot
A, tA = sell('Dolo', 2, [('cash', .5), ('upi', .5)], ravi['id'])
B, tB = sell('Pan', 1, [('upi', .6)], ravi['id'], '55555555-0000-0000-0000-0000000000a2')
C, tC = sell('Cetirizine', 3, [('cash', 1)], None, '55555555-0000-0000-0000-0000000000a3', {'patient_name': 'Meera Das', 'patient_phone': '9847033333', 'doctor_name': 'Dr. Rajan'})
SQL("insert into delivery_jobs(branch_id,invoice_id,is_requested,assigned_to,status,delivery_address,requested_at) values ($1,$2,true,$3,'pending','Kuruppam Road, Thrissur',now())", [BR, B, U['delivery']])
SQL("update delivery_jobs set status='done' where invoice_id=$1", [B])
ri = R('returnable_items', {'p_invoice': A})
R('process_sales_return', {'p_invoice': A, 'p_items': [{'sales_item_id': ri[0]['sales_item_id'], 'qty': 1, 'disposition': 'restock'}], 'p_method': 'cash', 'p_reason': 'Invoice view test'})
INV = {r['id']: r for r in SQL("select id, invoice_no, total::float total, created_at from sales_invoices where id = any($1::uuid[])", [[A, B, C]])}
noA, noB, noC = INV[A]['invoice_no'], INV[B]['invoice_no'], INV[C]['invoice_no']
rider = SQL("select full_name, staff_id::text sid from profiles where id=$1", [U['delivery']])[0]
cashier = SQL("select full_name from profiles where id=$1", [U['super_admin']])[0]['full_name']
br = SQL("select name, phone, email, gstin from branches where id=$1", [BR])[0]
ret_total = SQL("select total::float t, return_no from sales_returns where invoice_id=$1", [A])[0]
latest = SQL("select id, invoice_no from sales_invoices where branch_id=$1 order by created_at desc, id desc limit 1", [BR])[0]
outst = R('customer_outstanding', {'p_customer': ravi['id']})

def ctx(b, who, w=1536, h=1000, mobile=False, no36=False):
    c = b.new_context(viewport={'width': w, 'height': h}, is_mobile=mobile, has_touch=mobile, accept_downloads=True)
    if os.path.exists(JSPDF): c.route(re.compile(r'https://cdn\.jsdelivr\.net/npm/jspdf.*'), lambda r: r.fulfill(status=200, content_type='application/javascript', body=open(JSPDF).read()))
    c.route(re.compile(r'https://cdn\.jsdelivr\.net/npm/(?!jspdf).*'), lambda r: r.fulfill(status=200, content_type='application/javascript', body='/* offline */'))
    init = "window.__opened=[];window.open=(u)=>{window.__opened.push(String(u));return {};};window.__printed=0;HTMLIFrameElement.prototype.__defineGetter__&&0;"
    init += "const _ap=Node.prototype.appendChild;Node.prototype.appendChild=function(n){const r=_ap.call(this,n);if(n&&n.tagName==='IFRAME'){try{n.contentWindow.print=()=>{window.__printed++;window.__printHTML=n.contentDocument.body.innerHTML;};}catch(e){}}return r;};"
    if who: init += f"localStorage.setItem('e2e_user','{U[who]}');localStorage.setItem('alza_daily_login_v1',JSON.stringify({{userId:'{U[who]}',date:'{TODAY}'}}));"
    c.add_init_script(init)
    if no36:
        def h(route):
            body = json.loads(route.request.post_data or '{}')
            if body.get('name') in ('invoice_view_info', 'invoice_lookup', 'invoice_share_link'):
                return route.fulfill(status=200, content_type='application/json', body=json.dumps({'data': None, 'error': {'message': 'Could not find the function public.' + body['name'] + ' in the schema cache'}}))
            return route.continue_()
        c.route('**/api/rpc', h)
    pg = c.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('dialog', lambda d: d.accept())
    return c, pg, errs
def go(pg, q):
    pg.goto(BASE + '/invoice-view.html' + q); pg.wait_for_selector('#ivPaper, .iv-skel .pos-form-msg, #view p', timeout=15000); pg.wait_for_timeout(700)
T = lambda pg, s: pg.inner_text(s) if pg.query_selector(s) else ''

with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    c, pg, errs = ctx(b, 'admin')
    c.grant_permissions(['clipboard-read', 'clipboard-write'], origin=BASE)
    go(pg, f'?id={B}')
    ok('Opens without errors, sidebar with Sales active', not errs and pg.inner_text('.pp-nav a.on, .pp-side a.on, nav a.active, a.on').strip().startswith('Sales'), errs or T(pg, 'a.on'))
    ok('Header: Invoice View, breadcrumb Sales › Invoices › Invoice #', pg.inner_text('.iv-head h1') == 'Invoice View' and pg.inner_text('#crumbNo') == f'Invoice #{noB}')
    paper = pg.inner_text('#ivPaper')
    ok('Invoice no, TAX INVOICE, date and cashier', noB in pg.inner_text('.iv-no') and 'TAX INVOICE' in paper and cashier in paper, paper[:500])
    ok('Sales type Home Delivery, payment mode UPI + Credit', 'Home Delivery' in paper and 'UPI + Credit' in paper)
    ok('Pharmacy name, phone, e-mail and GSTIN from the branch', br['name'] in paper and br['phone'] in paper and (not br['gstin'] or br['gstin'] in paper))
    ok('Customer: name, mobile, Customer ID and type', 'Ravi Kumar' in paper and ravi['phone'] in paper and (SQL("select customer_no from customers where id=$1", [ravi['id']])[0]['customer_no'] or '—') in paper and 'Regular' in paper)
    items = R('invoice_detail', {'p_invoice': B})['items']
    rows = pg.locator('#ivPaper .iv-items tbody tr')
    ok('Items: one row per bill line with batch, expiry and amount', rows.count() == len(items) and items[0]['batch_no'] in rows.first.inner_text() and f"{float(items[0]['line_total']):,.2f}" in rows.first.inner_text(), [rows.count(), len(items)])
    ok('Total Amount and amount in words', num(pg.inner_text('.iv-grand b')) == round(tB, 2) and pg.inner_text('.iv-words').startswith('Rupees'))
    ok('Totals: subtotal, discount, taxable, GST lines', all(x in pg.inner_text('.iv-totals') for x in ('Subtotal', 'Total Discount', 'Taxable Amount', 'GST')))
    ok('Notes and thank-you line with barcode of the invoice number', 'Notes' in paper and 'Thank you' in paper and pg.locator('#ivPaper svg.iv-bc rect').count() > 30 and noB in (pg.get_attribute('#ivPaper svg.iv-bc', 'aria-label') or ''))
    pay = pg.inner_text('.iv-pay')
    paid_b = SQL("select coalesce(sum(amount) filter (where method<>'credit'),0)::float p, coalesce(sum(amount) filter (where method='credit'),0)::float c from payments where invoice_id=$1", [B])[0]
    ok('Payment summary: Partly paid, amount paid, on credit, balance', 'Partly paid' in pay and f"{paid_b['p']:,.2f}" in pay and f"{paid_b['c']:,.2f}" in pay and num(pg.inner_text('.iv-bal b')) == round(paid_b['c'], 2), pay)
    ok('Customer total credit due shown with link to Customers', (not outst or float(outst) <= 0) or (f"{float(outst):,.2f}" in pay and 'customers.html' in pg.get_attribute('.iv-due', 'href')), [outst, pay])
    dl = pg.inner_text('.iv-del')
    ok('Delivery: Delivered, delivery boy with staff ID, delivered on, address', 'Delivered' in dl and rider['full_name'] in dl and rider['sid'] in dl and 'Delivered On' in dl and 'Kuruppam Road' in dl, dl)
    ok('Mobile-only status bar hidden on desktop', not pg.is_visible('.iv-mstat'))

    # previous / next
    nb = R('invoice_view_info', {'p_invoice': B})
    pg.click('#prevBtn'); pg.wait_for_function(f"document.querySelector('#crumbNo').textContent.includes('{nb['prev']['invoice_no']}')"); pg.wait_for_timeout(300)
    ok('Previous opens the older bill and changes the address', nb['prev']['id'] in pg.url and nb['prev']['invoice_no'] in pg.inner_text('.iv-no'), pg.url)
    pg.keyboard.press('ArrowRight'); pg.wait_for_function(f"document.querySelector('#crumbNo').textContent.includes('{noB}')")
    ok('→ key opens the newer bill', B in pg.url)
    pg.go_back(); pg.wait_for_function(f"document.querySelector('#crumbNo').textContent.includes('{nb['prev']['invoice_no']}')", timeout=5000)
    ok('Browser Back returns to the bill you saw before', nb['prev']['id'] in pg.url)
    go(pg, f'?id={latest["id"]}')
    ok('Newest bill: Next is off, Previous on', pg.is_disabled('#nextBtn') and not pg.is_disabled('#prevBtn'))
    first = SQL("select id from sales_invoices where branch_id=$1 order by created_at, id limit 1", [BR])[0]['id']
    go(pg, f'?id={first}')
    ok('Oldest bill: Previous is off', pg.is_disabled('#prevBtn') and not pg.is_disabled('#nextBtn'))
    go(pg, '')
    ok('No bill chosen: opens the latest bill', latest['invoice_no'] in pg.inner_text('.iv-no') and latest['id'] in pg.url)
    go(pg, f'?no={urllib.parse.quote(noC)}')
    ok('Open by invoice number (?no=)', noC in pg.inner_text('.iv-no') and C in pg.url)
    go(pg, '?id=00000000-0000-0000-0000-000000000000')
    ok('Unknown bill: clear message and Back to Sales', 'not found' in T(pg, '.iv-skel').lower() and pg.is_visible('.iv-skel a[href="sales.html"]'), T(pg, '.iv-skel'))

    # walk-in with patient / doctor
    go(pg, f'?id={C}')
    paper = pg.inner_text('#ivPaper')
    ok('Walk-in bill: patient as name, Walk-in type, doctor line, Counter Sale', 'Meera Das' in paper and 'Walk-in' in paper and 'Dr. Rajan' in paper and 'Counter Sale' in paper and 'Paid' in pg.inner_text('.iv-pay'))
    ok('Counter sale: no delivery, link to arrange one', 'not for home delivery' in pg.inner_text('.iv-del') and pg.is_visible('.iv-del a[href="delivery.html"]'))
    ok('Walk-in: no New bill / Customer shortcuts, Sales return offered', not pg.query_selector('.iv-more a[href^="billing.html"]') and pg.is_visible(f'.iv-more a[href="returns.html?invoice={C}"]'))

    # bill with a return
    go(pg, f'?id={A}')
    rt = pg.inner_text('.iv-rets')
    ok('Returns card: credit note number, amount and refund', ret_total['return_no'] in rt and f"{ret_total['t']:,.2f}" in rt and 'CASH' in rt, rt)
    ok('Payment summary shows the returned amount', 'Returned' in pg.inner_text('.iv-pay'))
    ok('Shortcuts: Sales return, New bill, Customer, In Sales list', pg.is_visible(f'.iv-more a[href="returns.html?invoice={A}"]') and pg.is_visible(f'.iv-more a[href="billing.html?customer={ravi["id"]}"]')
       and pg.is_visible('.iv-more a[href^="customers.html?q="]') and pg.is_visible(f'.iv-more a[href="sales.html?q={urllib.parse.quote(noA)}"]'))

    # print, PDF
    pg.click('[data-fmt="a4"]'); pg.click('[data-a="print"]'); pg.wait_for_timeout(600)
    ok('Print Invoice prints the A4 invoice', pg.evaluate('window.__printed') == 1 and noA in pg.evaluate('window.__printHTML') and '190mm' in pg.evaluate('window.__printHTML'))
    pg.click('[data-fmt="thermal"]'); pg.keyboard.press('Control+p'); pg.wait_for_timeout(600)
    ok('Ctrl+P prints the 80 mm receipt', pg.evaluate('window.__printed') == 2 and '72mm' in pg.evaluate('window.__printHTML'))
    if os.path.exists(JSPDF):
        with pg.expect_download(timeout=15000) as dl_info: pg.click('[data-a="pdf"]')
        d = dl_info.value
        ok('Download PDF saves the invoice PDF', d.suggested_filename == f'{noA}-thermal.pdf' and open(d.path(), 'rb').read(4) == b'%PDF', d.suggested_filename)
    else:
        pg.click('[data-a="pdf"]'); pg.wait_for_timeout(1500)
        ok('Download PDF offline: tells you to use Print → Save as PDF', 'Print' in pg.inner_text('#toast'))

    # WhatsApp, link, e-mail
    pg.click('[data-a="wa"]'); pg.wait_for_timeout(1200)
    wa = [u for u in pg.evaluate('window.__opened') if 'wa.me' in u]
    ok('Share via WhatsApp: opens WhatsApp to the customer with the invoice link', wa and f"wa.me/91{ravi['phone'][-10:]}" in wa[-1] and 'invoice-view.html%3Ft%3D' in wa[-1], wa)
    ok('WhatsApp status line updated', 'WhatsApp' in pg.inner_text('#waMsg'))
    pg.click('[data-a="link"]'); pg.wait_for_timeout(800)
    clip = pg.evaluate('navigator.clipboard.readText()')
    ok('Copy link copies the customer link (same token as WhatsApp)', re.search(r'invoice-view\.html\?t=[0-9a-f]{64}$', clip) and clip.split('t=')[1] in urllib.parse.unquote(wa[-1]), clip)
    pg.click('[data-a="copy"]'); pg.wait_for_timeout(300)
    ok('Copy no. copies the invoice number', pg.evaluate('navigator.clipboard.readText()') == noA)
    ok('Customer link card: valid till and views', 'Active till' in pg.inner_text('.iv-link'))
    pg.click('[data-a="mail"]'); pg.wait_for_timeout(300)
    ok('Email Invoice: dialog with the customer e-mail filled in', pg.is_visible('#ivDlg') and pg.input_value('#mTo') == 'ravi@example.in' and noA in pg.input_value('#mSub'))
    pg.fill('#mTo', 'bad@'); pg.click('#mailF button[type="submit"]'); pg.wait_for_timeout(200)
    ok('Email: checks the address', 'valid e-mail' in pg.inner_text('#mErr'))
    pg.fill('#mTo', 'ravi@example.in'); pg.click('#mailF button[type="submit"]'); pg.wait_for_timeout(900)
    m = urllib.parse.unquote(pg.evaluate('window.__mailto') or '')
    ok('Email opens the mail app with subject, medicines, total and the private link', 'ravi@example.in' in m and f'Invoice {noA}' in m and 'Dolo' in m and 'Total: Rs.' in m and clip.split('t=')[1] in m, m[:300])
    ok('No second link was created', SQL("select count(*)::int n from invoice_share_links where invoice_id=$1 and revoked_at is null", [A])[0]['n'] == 1)
    pg.click('.iv-link [data-a="revoke"]'); pg.wait_for_timeout(1200)
    ok('Stop this link (admin): link revoked, card gone', SQL("select count(*)::int n from invoice_share_links where invoice_id=$1 and revoked_at is null", [A])[0]['n'] == 0 and not pg.query_selector('.iv-link'))

    # search
    pg.fill('#ppSearch', noC[-6:]); pg.wait_for_selector('.pp-sr-item'); pg.locator('.pp-sr-item', has_text=noC).first.click()
    pg.wait_for_url(f'**/invoice-view.html?id={C}'); pg.wait_for_selector('#ivPaper')
    ok('Top search: an invoice result opens it here', noC in pg.inner_text('.iv-no'))
    ok('No page errors (admin)', not errs, errs)
    c.close()

    # Sales page links
    c, pg, errs = ctx(b, 'admin')
    pg.goto(BASE + '/sales.html'); pg.wait_for_selector('#rows tr[data-id]'); pg.wait_for_timeout(800)
    pg.locator('#rows tr[data-id]', has_text=noB).locator('[data-menu]').click(); pg.wait_for_timeout(200)
    ok('Sales row menu: Open invoice page', pg.get_attribute('.pur-row-menu a[href^="invoice-view.html"]', 'href') == f'invoice-view.html?id={B}')
    c.close()

    # roles
    c, pg, errs = ctx(b, 'billing_staff'); go(pg, f'?id={B}')
    ok('Billing staff can open; no Stop link (admin only)', noB in pg.inner_text('.iv-no') and not pg.query_selector('[data-a="revoke"]'))
    c.close()
    c, pg, errs = ctx(b, 'inventory_staff'); pg.goto(BASE + f'/invoice-view.html?id={B}'); pg.wait_for_timeout(2500)
    ok('Inventory staff can open the bill (Sales is a staff page)', pg.query_selector('#ivPaper') is not None)
    c.close()

    # customer link (?t=)
    tok = R('invoice_share_link', {'p_invoice': B, 'p_base_url': BASE + '/sales.html'})['token']
    c, pg, errs = ctx(b, None); pg.goto(BASE + f'/invoice-view.html?t={tok}'); pg.wait_for_selector('#ivPaper'); pg.wait_for_timeout(500)
    t = pg.inner_text('body')
    ok('Customer link: invoice without login or sidebar', noB in t and not pg.query_selector('.pp-side, #ppSearch') and 'TAX INVOICE' in t)
    ok('Customer link: phone masked, no cashier / customer ID / staff tools', '******' in pg.inner_text('.iv-cust') and 'Cashier' not in t and 'Customer ID' not in t and not pg.query_selector('[data-a]'))
    ok('Customer link: Download PDF, Print, Call and WhatsApp the pharmacy', pg.is_visible('#pdf') and pg.is_visible('#prt') and pg.is_visible('a[href^="tel:"]') and pg.is_visible('a[href*="wa.me/"]'))
    pg.click('#prt'); pg.wait_for_timeout(500)
    ok('Customer link: Print works', pg.evaluate('window.__printed') == 1)
    pg.goto(BASE + '/invoice-view.html?t=' + '0' * 64); pg.wait_for_timeout(1500)
    ok('Customer link: wrong or expired link explained', 'Invoice not available' in pg.inner_text('body'))
    pg.goto(BASE + '/invoice-view.html?t=abc'); pg.wait_for_timeout(1200)
    ok('Customer link: incomplete link explained', 'not complete' in pg.inner_text('body'))
    ok('No page errors (customer link)', not errs, errs)
    c.close()

    # before migration 0036
    c, pg, errs = ctx(b, 'admin', no36=True); go(pg, f'?id={B}')
    ok('Without 0036: invoice, items and totals still shown, with a message', noB in pg.inner_text('.iv-no') and pg.locator('#ivPaper .iv-items tbody tr').count() == len(items) and '0036' in pg.inner_text('#msg'))
    ok('Without 0036: Previous / Next still work', not pg.is_disabled('#prevBtn'))
    pg.click('#prevBtn'); pg.wait_for_timeout(1200)
    ok('Without 0036: Previous opens the older bill', B not in pg.url and pg.query_selector('#ivPaper'))
    ok('Without 0036: no page errors', not errs, errs)
    c.close()

    # phone
    c, pg, errs = ctx(b, 'admin', 390, 844, mobile=True); go(pg, f'?id={B}')
    ok('Phone: no sideways scrolling', pg.evaluate('document.documentElement.scrollWidth') <= 390, pg.evaluate('document.documentElement.scrollWidth'))
    ok('Phone: back arrow, title, Previous / Next in one row', pg.is_visible('.iv-back') and abs(pg.eval_on_selector('.iv-back', 'e => e.getBoundingClientRect().top') - pg.eval_on_selector('#prevBtn', 'e => e.getBoundingClientRect().top')) < 12 and not pg.is_visible('.iv-crumbs'))
    ok('Phone: items table fits (batch under the name)', pg.eval_on_selector('.iv-tw', 'e => e.scrollWidth <= e.clientWidth + 1') and pg.is_visible('.iv-m-only'))
    ok('Phone: payment status bar with paid and balance', pg.is_visible('.iv-mstat') and 'Partly paid' in pg.inner_text('.iv-mstat') and not pg.is_visible('.iv-pay'))
    tops = pg.eval_on_selector_all('.iv-acts button.iv-act', 'bs => bs.map(b => Math.round(b.getBoundingClientRect().top))')
    ok('Phone: 4 action buttons, two per row', len(tops) == 4 and tops[0] == tops[1] and tops[2] == tops[3] and tops[2] > tops[0], tops)
    ok('Phone: delivery details shown', 'Delivered' in pg.inner_text('.iv-del'))
    ok('No page errors (phone)', not errs, errs)
    c.close()
    b.close()
print(f'\n{P} passed, {F} failed')
